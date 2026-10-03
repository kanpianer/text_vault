import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import {
  isValidVaultName,
  isValidShareId,
  normalizeVaultName,
  isHex64,
  validateVaultCreate,
  validateVaultUpdate,
  validateShareCreate,
  validateShareUpdate,
} from "./shared/validation.js";
import { createMemoryFailureTracker } from "./shared/failureTracker.js";

const app = express();
const PORT = 3000;
const isProd = process.env.NODE_ENV === "production";

// Trust proxy if configured via environment (e.g. 'loopback', '1', or specific IP/CIDR)
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

// Security: Helmet HTTP security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  })
);

// Security: Body parser size limit (max 10MB)
app.use(express.json({ limit: "10mb" }));

// Security: General API Rate Limiter
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // max 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use("/api/", generalApiLimiter);
app.use("/api/", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Security: Strict Authentication Rate Limiter per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // max 60 attempts per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
});

// In-memory progressive back-off failure tracker per resource (vault/share) & client
const failureTracker = createMemoryFailureTracker();

function getClientIp(req: express.Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

// Path to vaults data store
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vaults.json");
const SHARES_FILE = path.join(DATA_DIR, "shares.json");

// Structure of a vault in vaults.json
interface VaultRecord {
  name: string;
  salt_enc: string;
  salt_auth: string;
  auth_hash_double: string; // sha256(auth_hash)
  encrypted_data: string; // AES-GCM encrypted JSON
  createdAt: string;
  updatedAt: string;
}

// Structure of a shared document in shares.json
interface ShareRecord {
  id: string;
  hasPassword: boolean;
  salt_enc?: string;
  salt_auth?: string;
  auth_hash_double?: string; // sha256(auth_hash)
  encrypted_data: string;
  key_unprotected?: string;
  createdAt: string;
  updatedAt?: string;
  owner_auth_hash_double?: string; // sha256(owner token or auth_hash)
}

// Helpers for loading and saving vaults JSON securely (protected against prototype pollution)
function readDb(): Record<string, VaultRecord> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({}), "utf8");
      return Object.create(null);
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const safeDb: Record<string, VaultRecord> = Object.create(null);
    if (parsed && typeof parsed === "object") {
      for (const key of Object.keys(parsed)) {
        if (isValidVaultName(key)) {
          safeDb[key] = parsed[key];
        }
      }
    }
    return safeDb;
  } catch (e) {
    console.error("Error reading database file", e);
    return Object.create(null);
  }
}

function writeDb(data: Record<string, VaultRecord>) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // Write atomically using temporary file to prevent corruption
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (e) {
    console.error("Error writing database file", e);
  }
}

function readSharesDb(): Record<string, ShareRecord> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SHARES_FILE)) {
      fs.writeFileSync(SHARES_FILE, JSON.stringify({}), "utf8");
      return Object.create(null);
    }
    const raw = fs.readFileSync(SHARES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const safeDb: Record<string, ShareRecord> = Object.create(null);
    if (parsed && typeof parsed === "object") {
      for (const key of Object.keys(parsed)) {
        if (isValidShareId(key)) {
          safeDb[key] = parsed[key];
        }
      }
    }
    return safeDb;
  } catch (e) {
    console.error("Error reading shares database file", e);
    return Object.create(null);
  }
}

function writeSharesDb(data: Record<string, ShareRecord>) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${SHARES_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpFile, SHARES_FILE);
  } catch (e) {
    console.error("Error writing shares database file", e);
  }
}

// Helper to double-hash the client's auth_hash
function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Constant-time comparison helper to prevent timing attacks
function safeCompareHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Rate-limit protected endpoints
app.use("/api/vault/:name/create", authLimiter);
app.use("/api/vault/:name/get", authLimiter);
app.use("/api/vault/:name/update", authLimiter);
app.use("/api/vault/:name/delete", authLimiter);
app.use("/api/share/create", authLimiter);
app.use("/api/share/:id/access", authLimiter);
app.use("/api/share/:id/update", authLimiter);
app.use("/api/share/:id/delete", authLimiter);

// API: Check if vault exists and return salts
app.get("/api/vault/:name/salts", (req, res) => {
  const name = normalizeVaultName(req.params.name);
  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name. Must be alphanumeric and max 10 characters." });
  }

  const db = readDb();
  const vault = Object.hasOwn(db, name) ? db[name] : undefined;
  if (vault) {
    return res.json({
      exists: true,
      salt_enc: vault.salt_enc,
      salt_auth: vault.salt_auth,
    });
  } else {
    return res.json({ exists: false });
  }
});

// API: Creator checks if a vault name is available
app.get("/api/vault/:name/check", (req, res) => {
  const name = normalizeVaultName(req.params.name);
  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name. Must be alphanumeric and max 10 characters." });
  }

  const db = readDb();
  const exists = Object.hasOwn(db, name);
  return res.json({ exists });
});

// API: Create new text vault
app.post("/api/vault/:name/create", (req, res) => {
  const name = normalizeVaultName(req.params.name);
  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name. Must be alphanumeric and max 10 characters." });
  }

  const err = validateVaultCreate(req.body);
  if (err) {
    return res.status(400).json({ error: err });
  }

  const { salt_enc, salt_auth, auth_hash_double, encrypted_data } = req.body;
  const db = readDb();
  if (Object.hasOwn(db, name)) {
    return res.status(400).json({ error: "Vault already exists." });
  }

  db[name] = {
    name,
    salt_enc,
    salt_auth,
    auth_hash_double,
    encrypted_data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeDb(db);
  return res.json({ success: true });
});

// API: Get encrypted vault contents (requires sending auth_hash for verification)
app.post("/api/vault/:name/get", (req, res) => {
  const name = normalizeVaultName(req.params.name);
  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name." });
  }

  const { auth_hash } = req.body || {};
  if (!auth_hash || !isHex64(auth_hash)) {
    return res.status(400).json({ error: "Authentication verification hash is required to retrieve vault." });
  }

  const db = readDb();
  const vault = Object.hasOwn(db, name) ? db[name] : undefined;
  if (!vault) {
    return res.status(404).json({ error: "Vault not found." });
  }

  const ip = getClientIp(req);
  const scope = `vault:${name}`;
  const state = failureTracker.check(scope, ip);
  if (state.blocked) {
    res.setHeader("Retry-After", String(state.retryAfterSec));
    return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
  }

  const proof = sha256(auth_hash);
  if (!safeCompareHex(proof, vault.auth_hash_double)) {
    failureTracker.fail(scope, ip);
    return res.status(401).json({ error: "Password verification failed. Access denied." });
  }

  failureTracker.succeed(scope, ip);
  return res.json({
    success: true,
    encrypted_data: vault.encrypted_data,
    salt_enc: vault.salt_enc,
    salt_auth: vault.salt_auth,
  });
});

// API: Update vault contents (requires password authentication verify)
app.post("/api/vault/:name/update", (req, res) => {
  const name = normalizeVaultName(req.params.name);
  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name." });
  }

  const db = readDb();
  const vault = Object.hasOwn(db, name) ? db[name] : undefined;
  if (!vault) {
    return res.status(404).json({ error: "Vault not found." });
  }

  const { auth_hash } = req.body || {};
  if (!auth_hash || !isHex64(auth_hash)) {
    return res.status(401).json({ error: "Missing verification proof. Update denied." });
  }

  const ip = getClientIp(req);
  const scope = `vault:${name}`;
  const state = failureTracker.check(scope, ip);
  if (state.blocked) {
    res.setHeader("Retry-After", String(state.retryAfterSec));
    return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
  }

  const proof = sha256(auth_hash);
  if (!safeCompareHex(proof, vault.auth_hash_double)) {
    failureTracker.fail(scope, ip);
    return res.status(401).json({ error: "Verification failed. Access denied." });
  }

  const err = validateVaultUpdate(req.body);
  if (err) {
    return res.status(400).json({ error: err });
  }

  failureTracker.succeed(scope, ip);
  const { encrypted_data, salt_enc, salt_auth, auth_hash_double } = req.body;
  vault.encrypted_data = encrypted_data;
  vault.updatedAt = new Date().toISOString();

  if (salt_enc && salt_auth && auth_hash_double) {
    vault.salt_enc = salt_enc;
    vault.salt_auth = salt_auth;
    vault.auth_hash_double = auth_hash_double;
  }

  db[name] = vault;
  writeDb(db);

  return res.json({ success: true });
});

// API: Delete vault securely (requires 3-step auth confirmation + auth_hash match)
app.post("/api/vault/:name/delete", (req, res) => {
  const name = normalizeVaultName(req.params.name);
  if (!isValidVaultName(name)) {
    return res.status(400).json({ error: "Invalid vault name." });
  }

  const db = readDb();
  const vault = Object.hasOwn(db, name) ? db[name] : undefined;
  if (!vault) {
    return res.status(404).json({ error: "Vault not found." });
  }

  const { auth_hash } = req.body || {};
  if (!auth_hash || !isHex64(auth_hash)) {
    return res.status(401).json({ error: "Authentication hash is required to authorize deletion." });
  }

  const ip = getClientIp(req);
  const scope = `vault:${name}`;
  const state = failureTracker.check(scope, ip);
  if (state.blocked) {
    res.setHeader("Retry-After", String(state.retryAfterSec));
    return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
  }

  const proof = sha256(auth_hash);
  if (!safeCompareHex(proof, vault.auth_hash_double)) {
    failureTracker.fail(scope, ip);
    return res.status(401).json({ error: "Authorization failed. Incorrect password. Vault deletion blocked." });
  }

  failureTracker.succeed(scope, ip);
  delete db[name];
  writeDb(db);

  return res.json({ success: true });
});

// API: Create new shared document
app.post("/api/share/create", (req, res) => {
  const err = validateShareCreate(req.body);
  if (err) {
    return res.status(400).json({ error: err });
  }

  const { id, hasPassword, salt_enc, salt_auth, auth_hash_double, encrypted_data, key_unprotected, owner_auth_hash_double } = req.body;
  const db = readSharesDb();
  if (Object.hasOwn(db, id)) {
    return res.status(400).json({ error: "Share ID already exists." });
  }

  db[id] = {
    id,
    hasPassword,
    salt_enc: hasPassword ? salt_enc : undefined,
    salt_auth: hasPassword ? salt_auth : undefined,
    auth_hash_double: hasPassword ? auth_hash_double : undefined,
    encrypted_data,
    key_unprotected: !hasPassword && key_unprotected ? key_unprotected : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    owner_auth_hash_double,
  };

  writeSharesDb(db);
  return res.json({ success: true, id });
});

// API: Get shared document metadata or unprotected content
app.get("/api/share/:id", (req, res) => {
  const id = req.params.id;
  if (!isValidShareId(id)) {
    return res.status(400).json({ error: "Invalid share ID." });
  }

  const db = readSharesDb();
  const share = Object.hasOwn(db, id) ? db[id] : undefined;
  if (!share) {
    return res.status(404).json({ exists: false, error: "Shared document not found." });
  }

  if (share.hasPassword) {
    return res.json({
      exists: true,
      hasPassword: true,
      salt_enc: share.salt_enc,
      salt_auth: share.salt_auth,
    });
  } else {
    return res.json({
      exists: true,
      hasPassword: false,
      encrypted_data: share.encrypted_data,
      key_unprotected: share.key_unprotected,
    });
  }
});

// API: Access password-protected shared document
app.post("/api/share/:id/access", (req, res) => {
  const id = req.params.id;
  if (!isValidShareId(id)) {
    return res.status(400).json({ error: "Invalid share ID." });
  }

  const db = readSharesDb();
  const share = Object.hasOwn(db, id) ? db[id] : undefined;
  if (!share) {
    return res.status(404).json({ error: "Shared document not found." });
  }

  if (!share.hasPassword) {
    return res.json({
      success: true,
      encrypted_data: share.encrypted_data,
      key_unprotected: share.key_unprotected,
    });
  }

  const { auth_hash } = req.body || {};
  if (!auth_hash || !isHex64(auth_hash)) {
    return res.status(401).json({ error: "Password verification hash is required to access shared document." });
  }

  const ip = getClientIp(req);
  const scope = `share:${id}`;
  const state = failureTracker.check(scope, ip);
  if (state.blocked) {
    res.setHeader("Retry-After", String(state.retryAfterSec));
    return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
  }

  const proof = sha256(auth_hash);
  if (!share.auth_hash_double || !safeCompareHex(proof, share.auth_hash_double)) {
    failureTracker.fail(scope, ip);
    return res.status(401).json({ error: "Password verification failed. Access denied." });
  }

  failureTracker.succeed(scope, ip);
  return res.json({
    success: true,
    encrypted_data: share.encrypted_data,
  });
});

// API: Update shared document (requires owner verification)
app.post("/api/share/:id/update", (req, res) => {
  const id = req.params.id;
  if (!isValidShareId(id)) {
    return res.status(400).json({ error: "Invalid share ID." });
  }

  const err = validateShareUpdate(req.body);
  if (err) {
    return res.status(400).json({ error: err });
  }

  const db = readSharesDb();
  const share = Object.hasOwn(db, id) ? db[id] : undefined;
  if (!share) {
    return res.status(404).json({ error: "Shared document not found." });
  }

  const { auth_hash, encrypted_data, key_unprotected, salt_enc, salt_auth, auth_hash_double } = req.body;
  if (!share.owner_auth_hash_double) {
    return res.status(403).json({ error: "This legacy share has no owner credentials and cannot be modified. Please unshare and share again." });
  }
  if (!auth_hash || !isHex64(auth_hash)) {
    return res.status(401).json({ error: "Missing owner credentials. Update denied." });
  }

  const ip = getClientIp(req);
  const scope = `share-owner:${id}`;
  const state = failureTracker.check(scope, ip);
  if (state.blocked) {
    res.setHeader("Retry-After", String(state.retryAfterSec));
    return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
  }

  const proof = sha256(auth_hash);
  if (!safeCompareHex(proof, share.owner_auth_hash_double)) {
    failureTracker.fail(scope, ip);
    return res.status(401).json({ error: "Verification failed. Access denied." });
  }
  failureTracker.succeed(scope, ip);

  share.encrypted_data = encrypted_data;
  share.updatedAt = new Date().toISOString();
  if (!share.hasPassword && key_unprotected !== undefined) {
    share.key_unprotected = key_unprotected || undefined;
  }
  if (share.hasPassword && salt_enc && salt_auth && auth_hash_double) {
    share.salt_enc = salt_enc;
    share.salt_auth = salt_auth;
    share.auth_hash_double = auth_hash_double;
  }

  db[id] = share;
  writeSharesDb(db);

  return res.json({ success: true, id });
});

// API: Delete shared document (requires owner verification if protected)
app.post("/api/share/:id/delete", (req, res) => {
  const id = req.params.id;
  if (!isValidShareId(id)) {
    return res.status(400).json({ error: "Invalid share ID." });
  }

  const { auth_hash } = req.body || {};
  const db = readSharesDb();
  const share = Object.hasOwn(db, id) ? db[id] : undefined;
  if (share) {
    if (share.owner_auth_hash_double) {
      if (!auth_hash || !isHex64(auth_hash)) {
        return res.status(401).json({ error: "Missing owner credentials. Delete denied." });
      }
      const ip = getClientIp(req);
      const scope = `share-owner:${id}`;
      const state = failureTracker.check(scope, ip);
      if (state.blocked) {
        res.setHeader("Retry-After", String(state.retryAfterSec));
        return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
      }
      const proof = sha256(auth_hash);
      if (!safeCompareHex(proof, share.owner_auth_hash_double)) {
        failureTracker.fail(scope, ip);
        return res.status(401).json({ error: "Verification failed. Access denied." });
      }
      failureTracker.succeed(scope, ip);
    }
    delete db[id];
    writeSharesDb(db);
  }
  return res.json({ success: true });
});

// Start routing and asset rendering for Express + Vite
async function startServer() {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(
      express.static(distPath, {
        maxAge: "1y",
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is booted at host 0.0.0.0 and port ${PORT}`);
  });
}

// Only start the server when run directly (not when imported in tests)
if (process.env.NODE_ENV !== "test") {
  startServer();
}

export { app, readDb, writeDb, readSharesDb, writeSharesDb, failureTracker };
