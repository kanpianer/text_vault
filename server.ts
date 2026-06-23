import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

// Path to vaults data store
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vaults.json");

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

// Helpers for loading and saving vaults JSON securely
function readDb(): Record<string, VaultRecord> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({}), "utf8");
      return {};
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error reading database file", e);
    return {};
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

// Helper to double-hash the client's auth_hash
function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

app.use(express.json());

// API: Check if vault exists and return salts
app.get("/api/vault/:name/salts", (req, res) => {
  const name = req.params.name.toLowerCase();
  
  // Validate name (alphanumeric, max 10 chars)
  if (!/^[a-zA-Z0-9]{1,10}$/.test(name)) {
    return res.status(400).json({ error: "Invalid vault name. Must be alphanumeric and max 10 characters." });
  }

  const db = readDb();
  const vault = db[name];
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
  const name = req.params.name.toLowerCase();
  
  if (!/^[a-zA-Z0-9]{1,10}$/.test(name)) {
    return res.status(400).json({ error: "Invalid vault name. Must be alphanumeric and max 10 characters." });
  }

  const db = readDb();
  const exists = !!db[name];
  return res.json({ exists });
});

// API: Create new text vault
app.post("/api/vault/:name/create", (req, res) => {
  const name = req.params.name.toLowerCase();
  const { salt_enc, salt_auth, auth_hash_double, encrypted_data } = req.body;

  if (!/^[a-zA-Z0-9]{1,10}$/.test(name)) {
    return res.status(400).json({ error: "Invalid vault name. Must be alphanumeric and max 10 characters." });
  }

  if (!salt_enc || !salt_auth || !auth_hash_double || !encrypted_data) {
    return res.status(400).json({ error: "Missing required properties." });
  }

  const db = readDb();
  if (db[name]) {
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
  const name = req.params.name.toLowerCase();
  const { auth_hash } = req.body;

  if (!auth_hash) {
    return res.status(400).json({ error: "Authentication verification hash is required to retrieve vault." });
  }

  const db = readDb();
  const vault = db[name];
  if (!vault) {
    return res.status(404).json({ error: "Vault not found." });
  }

  // Double hash client's hash to compare against saved record
  const proof = sha256(auth_hash);
  if (proof !== vault.auth_hash_double) {
    return res.status(401).json({ error: "Password verification failed. Access denied." });
  }

  return res.json({
    success: true,
    encrypted_data: vault.encrypted_data,
    salt_enc: vault.salt_enc,
    salt_auth: vault.salt_auth,
  });
});

// API: Update vault contents (requires password authentication verify)
app.post("/api/vault/:name/update", (req, res) => {
  const name = req.params.name.toLowerCase();
  const { auth_hash, encrypted_data, salt_enc, salt_auth, auth_hash_double } = req.body;

  const db = readDb();
  const vault = db[name];
  if (!vault) {
    return res.status(404).json({ error: "Vault not found." });
  }

  // Security: Check original Owner state
  if (!auth_hash) {
    return res.status(401).json({ error: "Missing verification proof. Update denied." });
  }

  const proof = sha256(auth_hash);
  if (proof !== vault.auth_hash_double) {
    return res.status(401).json({ error: "Verification failed. Access denied." });
  }

  // Update fields
  vault.encrypted_data = encrypted_data;
  vault.updatedAt = new Date().toISOString();

  // If user changed password, update auth parameters too
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
  const name = req.params.name.toLowerCase();
  const { auth_hash } = req.body;

  const db = readDb();
  const vault = db[name];
  if (!vault) {
    return res.status(404).json({ error: "Vault not found." });
  }

  if (!auth_hash) {
    return res.status(401).json({ error: "Authentication hash is required to authorize deletion." });
  }

  // Critical security audit: Match owner verification proof
  const proof = sha256(auth_hash);
  if (proof !== vault.auth_hash_double) {
    return res.status(401).json({ error: "Authorization failed. Incorrect password. Vault deletion blocked." });
  }

  delete db[name];
  writeDb(db);

  return res.json({ success: true });
});

// Start routing and asset rendering for Express + Vite
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is booted at host 0.0.0.0 and port ${PORT}`);
  });
}

startServer();
