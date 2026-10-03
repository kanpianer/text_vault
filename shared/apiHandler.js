/**
 * Cloudflare API handler shared by:
 *   - functions/api/[[route]].js  (Cloudflare Pages Functions — imported directly)
 *   - worker.js                   (standalone Cloudflare Worker — generated bundle, see `npm run build:worker`)
 *
 * Storage: KV namespace bound as `VAULTS`.
 *   <vaultName>      -> vault record
 *   share:<id>       -> shared document record
 *   rl:...           -> brute-force counters (with TTL)
 *
 * ⚠️ Edit THIS file, not worker.js. Then run `npm run build:worker`.
 */

import {
  MAX_BODY_BYTES,
  normalizeVaultName,
  isValidVaultName,
  isValidShareId,
  isHex64,
  validateVaultCreate,
  validateVaultUpdate,
  validateShareCreate,
  validateShareUpdate,
} from "./validation.js";
import { createKvFailureTracker } from "./failureTracker.js";

const SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  // No Access-Control-Allow-Origin: the API is only meant to be called by the same-origin frontend.
};

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of two equal-length strings. */
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyProof(proof, storedDouble) {
  if (!isHex64(proof) || typeof storedDouble !== "string") return false;
  return safeCompare(await sha256Hex(proof), storedDouble);
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid JSON body.");
  return body;
}

function requireKv(env) {
  if (!env || !env.VAULTS) throw new HttpError(500, "Storage is not configured.");
  return env.VAULTS;
}

async function getJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Real-IP") || "unknown";
}

async function guardAttempt(tracker, scope, ip) {
  const state = await tracker.check(scope, ip);
  if (state.blocked) {
    throw new HttpError(429, "Too many failed attempts. Please try again later.", {
      "Retry-After": String(state.retryAfterSec),
    });
  }
}

function vaultNameFrom(match) {
  const name = normalizeVaultName(match[1]);
  if (!isValidVaultName(name)) {
    throw new HttpError(400, "Invalid vault name. Must be alphanumeric and max 10 characters.");
  }
  return name;
}

function shareIdFrom(match) {
  const id = match[1];
  if (!isValidShareId(id)) throw new HttpError(400, "Invalid share ID.");
  return id;
}

const ROUTES = {
  salts: /^\/api\/vault\/([^/]+)\/salts$/,
  check: /^\/api\/vault\/([^/]+)\/check$/,
  create: /^\/api\/vault\/([^/]+)\/create$/,
  get: /^\/api\/vault\/([^/]+)\/get$/,
  update: /^\/api\/vault\/([^/]+)\/update$/,
  del: /^\/api\/vault\/([^/]+)\/delete$/,
  shareGet: /^\/api\/share\/([^/]+)$/,
  shareAccess: /^\/api\/share\/([^/]+)\/access$/,
  shareUpdate: /^\/api\/share\/([^/]+)\/update$/,
  shareDelete: /^\/api\/share\/([^/]+)\/delete$/,
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (!path.startsWith("/api/")) return null;

  if (method === "OPTIONS") {
    // Same-origin only: no CORS grants.
    return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  }

  const tracker = createKvFailureTracker(env && env.VAULTS);
  const ip = clientIp(request);
  let m;

  // ── Vaults ──────────────────────────────────────────────────────
  if (method === "GET" && (m = path.match(ROUTES.salts))) {
    const name = vaultNameFrom(m);
    const vault = await getJson(requireKv(env), name);
    return vault
      ? jsonResponse({ exists: true, salt_enc: vault.salt_enc, salt_auth: vault.salt_auth })
      : jsonResponse({ exists: false });
  }

  if (method === "GET" && (m = path.match(ROUTES.check))) {
    const name = vaultNameFrom(m);
    const vault = await getJson(requireKv(env), name);
    return jsonResponse({ exists: !!vault });
  }

  if (method === "POST" && (m = path.match(ROUTES.create))) {
    const name = vaultNameFrom(m);
    const body = await readJsonBody(request);
    const err = validateVaultCreate(body);
    if (err) return jsonResponse({ error: err }, 400);
    const kv = requireKv(env);
    if (await kv.get(name)) return jsonResponse({ error: "Vault already exists." }, 400);
    const now = new Date().toISOString();
    await kv.put(
      name,
      JSON.stringify({
        name,
        salt_enc: body.salt_enc,
        salt_auth: body.salt_auth,
        auth_hash_double: body.auth_hash_double,
        encrypted_data: body.encrypted_data,
        createdAt: now,
        updatedAt: now,
      })
    );
    return jsonResponse({ success: true });
  }

  if (method === "POST" && (m = path.match(ROUTES.get))) {
    const name = vaultNameFrom(m);
    const body = await readJsonBody(request);
    if (!body.auth_hash) {
      return jsonResponse({ error: "Authentication verification hash is required to retrieve vault." }, 400);
    }
    const kv = requireKv(env);
    const vault = await getJson(kv, name);
    if (!vault) return jsonResponse({ error: "Vault not found." }, 404);
    await guardAttempt(tracker, `vault:${name}`, ip);
    if (!(await verifyProof(body.auth_hash, vault.auth_hash_double))) {
      await tracker.fail(`vault:${name}`, ip);
      return jsonResponse({ error: "Password verification failed. Access denied." }, 401);
    }
    await tracker.succeed(`vault:${name}`, ip);
    return jsonResponse({
      success: true,
      encrypted_data: vault.encrypted_data,
      salt_enc: vault.salt_enc,
      salt_auth: vault.salt_auth,
    });
  }

  if (method === "POST" && (m = path.match(ROUTES.update))) {
    const name = vaultNameFrom(m);
    const body = await readJsonBody(request);
    const kv = requireKv(env);
    const vault = await getJson(kv, name);
    if (!vault) return jsonResponse({ error: "Vault not found." }, 404);
    if (!body.auth_hash) return jsonResponse({ error: "Missing verification proof. Update denied." }, 401);
    await guardAttempt(tracker, `vault:${name}`, ip);
    if (!(await verifyProof(body.auth_hash, vault.auth_hash_double))) {
      await tracker.fail(`vault:${name}`, ip);
      return jsonResponse({ error: "Verification failed. Access denied." }, 401);
    }
    const err = validateVaultUpdate(body);
    if (err) return jsonResponse({ error: err }, 400);

    vault.encrypted_data = body.encrypted_data;
    vault.updatedAt = new Date().toISOString();
    if (body.salt_enc && body.salt_auth && body.auth_hash_double) {
      vault.salt_enc = body.salt_enc;
      vault.salt_auth = body.salt_auth;
      vault.auth_hash_double = body.auth_hash_double;
    }
    await kv.put(name, JSON.stringify(vault));
    return jsonResponse({ success: true });
  }

  if (method === "POST" && (m = path.match(ROUTES.del))) {
    const name = vaultNameFrom(m);
    const body = await readJsonBody(request);
    const kv = requireKv(env);
    const vault = await getJson(kv, name);
    if (!vault) return jsonResponse({ error: "Vault not found." }, 404);
    if (!body.auth_hash) return jsonResponse({ error: "Authentication hash is required to authorize deletion." }, 401);
    await guardAttempt(tracker, `vault:${name}`, ip);
    if (!(await verifyProof(body.auth_hash, vault.auth_hash_double))) {
      await tracker.fail(`vault:${name}`, ip);
      return jsonResponse({ error: "Authorization failed. Incorrect password. Vault deletion blocked." }, 401);
    }
    await kv.delete(name);
    return jsonResponse({ success: true });
  }

  // ── Shares ──────────────────────────────────────────────────────
  if (method === "POST" && path === "/api/share/create") {
    const body = await readJsonBody(request);
    const err = validateShareCreate(body);
    if (err) return jsonResponse({ error: err }, 400);
    const kv = requireKv(env);
    if (await kv.get("share:" + body.id)) return jsonResponse({ error: "Share ID already exists." }, 400);
    const now = new Date().toISOString();
    const share = {
      id: body.id,
      hasPassword: body.hasPassword,
      salt_enc: body.hasPassword ? body.salt_enc : undefined,
      salt_auth: body.hasPassword ? body.salt_auth : undefined,
      auth_hash_double: body.hasPassword ? body.auth_hash_double : undefined,
      encrypted_data: body.encrypted_data,
      // Only legacy clients send this; new shares keep the key in the URL fragment.
      key_unprotected: !body.hasPassword && body.key_unprotected ? body.key_unprotected : undefined,
      owner_auth_hash_double: body.owner_auth_hash_double,
      createdAt: now,
      updatedAt: now,
    };
    await kv.put("share:" + body.id, JSON.stringify(share));
    return jsonResponse({ success: true, id: body.id });
  }

  if (method === "GET" && (m = path.match(ROUTES.shareGet))) {
    const id = shareIdFrom(m);
    const share = await getJson(requireKv(env), "share:" + id);
    if (!share) return jsonResponse({ exists: false, error: "Shared document not found." }, 404);
    if (share.hasPassword) {
      return jsonResponse({ exists: true, hasPassword: true, salt_enc: share.salt_enc, salt_auth: share.salt_auth });
    }
    return jsonResponse({
      exists: true,
      hasPassword: false,
      encrypted_data: share.encrypted_data,
      key_unprotected: share.key_unprotected,
    });
  }

  if (method === "POST" && (m = path.match(ROUTES.shareAccess))) {
    const id = shareIdFrom(m);
    const kv = requireKv(env);
    const share = await getJson(kv, "share:" + id);
    if (!share) return jsonResponse({ error: "Shared document not found." }, 404);
    if (!share.hasPassword) {
      return jsonResponse({ success: true, encrypted_data: share.encrypted_data, key_unprotected: share.key_unprotected });
    }
    const body = await readJsonBody(request);
    if (!body.auth_hash) {
      return jsonResponse({ error: "Password verification hash is required to access shared document." }, 401);
    }
    await guardAttempt(tracker, `share:${id}`, ip);
    if (!(await verifyProof(body.auth_hash, share.auth_hash_double))) {
      await tracker.fail(`share:${id}`, ip);
      return jsonResponse({ error: "Password verification failed. Access denied." }, 401);
    }
    await tracker.succeed(`share:${id}`, ip);
    return jsonResponse({ success: true, encrypted_data: share.encrypted_data });
  }

  if (method === "POST" && (m = path.match(ROUTES.shareUpdate))) {
    const id = shareIdFrom(m);
    const body = await readJsonBody(request);
    const err = validateShareUpdate(body);
    if (err) return jsonResponse({ error: err }, 400);
    const kv = requireKv(env);
    const share = await getJson(kv, "share:" + id);
    if (!share) return jsonResponse({ error: "Shared document not found." }, 404);
    if (!share.owner_auth_hash_double) {
      return jsonResponse({ error: "This legacy share has no owner credentials and cannot be modified. Please unshare and share again." }, 403);
    }
    if (!body.auth_hash) return jsonResponse({ error: "Missing owner credentials. Update denied." }, 401);
    await guardAttempt(tracker, `share-owner:${id}`, ip);
    if (!(await verifyProof(body.auth_hash, share.owner_auth_hash_double))) {
      await tracker.fail(`share-owner:${id}`, ip);
      return jsonResponse({ error: "Verification failed. Access denied." }, 401);
    }

    share.encrypted_data = body.encrypted_data;
    share.updatedAt = new Date().toISOString();
    if (!share.hasPassword && body.key_unprotected !== undefined) share.key_unprotected = body.key_unprotected || undefined;
    if (share.hasPassword && body.salt_enc && body.salt_auth && body.auth_hash_double) {
      share.salt_enc = body.salt_enc;
      share.salt_auth = body.salt_auth;
      share.auth_hash_double = body.auth_hash_double;
    }
    await kv.put("share:" + id, JSON.stringify(share));
    return jsonResponse({ success: true, id });
  }

  if (method === "POST" && (m = path.match(ROUTES.shareDelete))) {
    const id = shareIdFrom(m);
    const body = await readJsonBody(request);
    const kv = requireKv(env);
    const share = await getJson(kv, "share:" + id);
    if (share) {
      // Legacy shares created without owner credentials remain deletable (pre-existing behaviour)
      // so their owners can still unshare; all new shares require the owner token.
      if (share.owner_auth_hash_double) {
        if (!body.auth_hash) return jsonResponse({ error: "Missing owner credentials. Delete denied." }, 401);
        await guardAttempt(tracker, `share-owner:${id}`, ip);
        if (!(await verifyProof(body.auth_hash, share.owner_auth_hash_double))) {
          await tracker.fail(`share-owner:${id}`, ip);
          return jsonResponse({ error: "Verification failed. Access denied." }, 401);
        }
      }
      await kv.delete("share:" + id);
    }
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "API route not found." }, 404);
}

/**
 * Handles /api/* requests. Returns `null` for non-API paths so callers can fall through to static assets.
 */
export async function handleApiRequest(request, env) {
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status, error.headers);
    }
    // Never leak internal error details to clients.
    console.error("API error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

export const __testing = { safeCompare, verifyProof, readJsonBody, SECURITY_HEADERS };
