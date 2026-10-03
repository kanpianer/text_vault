// shared/validation.js
var VAULT_NAME_RE = /^[a-z0-9]{1,10}$/;
var SHARE_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
var HEX64_RE = /^[0-9a-f]{64}$/i;
var HEX32_RE = /^[0-9a-f]{32}$/i;
var BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
var MAX_ENCRYPTED_DATA_LENGTH = 8 * 1024 * 1024;
var MAX_BODY_BYTES = 9 * 1024 * 1024;
var RESERVED_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype", "hasownproperty", "tostring", "valueof"]);
function normalizeVaultName(name) {
  return typeof name === "string" ? name.toLowerCase() : "";
}
function isValidVaultName(name) {
  return typeof name === "string" && VAULT_NAME_RE.test(name) && !RESERVED_KEYS.has(name.toLowerCase());
}
function isValidShareId(id) {
  return typeof id === "string" && SHARE_ID_RE.test(id) && !RESERVED_KEYS.has(id.toLowerCase());
}
function isHex64(value) {
  return typeof value === "string" && HEX64_RE.test(value);
}
function isSaltHex(value) {
  return typeof value === "string" && HEX32_RE.test(value);
}
function isEncryptedData(value) {
  return typeof value === "string" && value.length >= 16 && value.length <= MAX_ENCRYPTED_DATA_LENGTH && BASE64_RE.test(value);
}
function validateVaultCreate(body) {
  const { salt_enc, salt_auth, auth_hash_double, encrypted_data } = body || {};
  if (!salt_enc || !salt_auth || !auth_hash_double || !encrypted_data) return "Missing required properties.";
  if (!isSaltHex(salt_enc) || !isSaltHex(salt_auth)) return "Invalid salt format.";
  if (!isHex64(auth_hash_double)) return "Invalid verifier format.";
  if (!isEncryptedData(encrypted_data)) return "Invalid or oversized encrypted payload.";
  return null;
}
function validateVaultUpdate(body) {
  const { encrypted_data, salt_enc, salt_auth, auth_hash_double } = body || {};
  if (!isEncryptedData(encrypted_data)) return "Missing, invalid or oversized encrypted payload.";
  const rotating = salt_enc !== void 0 || salt_auth !== void 0 || auth_hash_double !== void 0;
  if (rotating) {
    if (!isSaltHex(salt_enc) || !isSaltHex(salt_auth) || !isHex64(auth_hash_double)) {
      return "Password rotation requires valid salt_enc, salt_auth and auth_hash_double.";
    }
  }
  return null;
}
function validateShareCreate(body) {
  const { id, hasPassword, salt_enc, salt_auth, auth_hash_double, encrypted_data, key_unprotected, owner_auth_hash_double } = body || {};
  if (!isValidShareId(id)) return "Invalid share ID. Must be 6-64 alphanumeric characters.";
  if (typeof hasPassword !== "boolean" || !encrypted_data) return "Missing required properties.";
  if (!isEncryptedData(encrypted_data)) return "Invalid or oversized encrypted payload.";
  if (!isHex64(owner_auth_hash_double)) return "Owner credentials are required to create a share.";
  if (hasPassword) {
    if (!salt_enc || !salt_auth || !auth_hash_double) {
      return "Password-protected shares require salt_enc, salt_auth, and auth_hash_double.";
    }
    if (!isSaltHex(salt_enc) || !isSaltHex(salt_auth) || !isHex64(auth_hash_double)) return "Invalid share credential format.";
    if (key_unprotected !== void 0 && key_unprotected !== null) return "Password-protected shares must not include a raw key.";
  } else if (key_unprotected !== void 0 && key_unprotected !== null && !isHex64(key_unprotected)) {
    return "Invalid key format.";
  }
  return null;
}
function validateShareUpdate(body) {
  const { encrypted_data, key_unprotected, salt_enc, salt_auth, auth_hash_double } = body || {};
  if (!encrypted_data) return "Missing encrypted data.";
  if (!isEncryptedData(encrypted_data)) return "Invalid or oversized encrypted payload.";
  if (key_unprotected !== void 0 && key_unprotected !== null && !isHex64(key_unprotected)) return "Invalid key format.";
  const rotating = salt_enc !== void 0 || salt_auth !== void 0 || auth_hash_double !== void 0;
  if (rotating && (!isSaltHex(salt_enc) || !isSaltHex(salt_auth) || !isHex64(auth_hash_double))) {
    return "Credential rotation requires valid salt_enc, salt_auth and auth_hash_double.";
  }
  return null;
}

// shared/failureTracker.js
var FAILURE_DEFAULTS = {
  perClientFree: 10,
  globalFree: 100,
  baseDelayMs: 1e3,
  maxLockMs: 15 * 60 * 1e3,
  resetAfterMs: 60 * 60 * 1e3
};
function nextFailureState(entry, now, freeBudget, opts = FAILURE_DEFAULTS) {
  const fresh = !entry || now - (entry.lastFailure || 0) > opts.resetAfterMs;
  const count = (fresh ? 0 : entry.count || 0) + 1;
  let lockedUntil = fresh ? 0 : entry.lockedUntil || 0;
  if (count > freeBudget) {
    const over = count - freeBudget;
    const delay = Math.min(opts.maxLockMs, opts.baseDelayMs * Math.pow(2, Math.min(over - 1, 30)));
    lockedUntil = now + delay;
  }
  return { count, lockedUntil, lastFailure: now };
}
function blockedResult(entries, now) {
  const until = Math.max(0, ...entries.map((e) => e && e.lockedUntil || 0));
  if (until > now) {
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((until - now) / 1e3)) };
  }
  return { blocked: false, retryAfterSec: 0 };
}
function createKvFailureTracker(kv, options = {}) {
  const opts = { ...FAILURE_DEFAULTS, ...options };
  const now = options.now || (() => Date.now());
  const ttlSec = Math.max(60, Math.ceil(opts.resetAfterMs / 1e3));
  const clientKey = (scope, ip) => `rl:c:${scope}:${ip || "unknown"}`;
  const globalKey = (scope) => `rl:g:${scope}`;
  async function read(key) {
    if (!kv) return null;
    try {
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  async function write(key, value) {
    if (!kv) return;
    try {
      await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
    } catch {
    }
  }
  return {
    async check(scope, ip) {
      const [c, g] = await Promise.all([read(clientKey(scope, ip)), read(globalKey(scope))]);
      return blockedResult([c, g], now());
    },
    async fail(scope, ip) {
      const t = now();
      const [c, g] = await Promise.all([read(clientKey(scope, ip)), read(globalKey(scope))]);
      await Promise.all([
        write(clientKey(scope, ip), nextFailureState(c, t, opts.perClientFree, opts)),
        write(globalKey(scope), nextFailureState(g, t, opts.globalFree, opts))
      ]);
    },
    async succeed(scope, ip) {
      if (!kv) return;
      try {
        await kv.delete(clientKey(scope, ip));
      } catch {
      }
    }
  };
}

// shared/apiHandler.js
var SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin"
  // No Access-Control-Allow-Origin: the API is only meant to be called by the same-origin frontend.
};
var HttpError = class extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
};
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders }
  });
}
async function sha256Hex(data) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
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
      "Retry-After": String(state.retryAfterSec)
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
var ROUTES = {
  salts: /^\/api\/vault\/([^/]+)\/salts$/,
  check: /^\/api\/vault\/([^/]+)\/check$/,
  create: /^\/api\/vault\/([^/]+)\/create$/,
  get: /^\/api\/vault\/([^/]+)\/get$/,
  update: /^\/api\/vault\/([^/]+)\/update$/,
  del: /^\/api\/vault\/([^/]+)\/delete$/,
  shareGet: /^\/api\/share\/([^/]+)$/,
  shareAccess: /^\/api\/share\/([^/]+)\/access$/,
  shareUpdate: /^\/api\/share\/([^/]+)\/update$/,
  shareDelete: /^\/api\/share\/([^/]+)\/delete$/
};
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!path.startsWith("/api/")) return null;
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  }
  const tracker = createKvFailureTracker(env && env.VAULTS);
  const ip = clientIp(request);
  let m;
  if (method === "GET" && (m = path.match(ROUTES.salts))) {
    const name = vaultNameFrom(m);
    const vault = await getJson(requireKv(env), name);
    return vault ? jsonResponse({ exists: true, salt_enc: vault.salt_enc, salt_auth: vault.salt_auth }) : jsonResponse({ exists: false });
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
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await kv.put(
      name,
      JSON.stringify({
        name,
        salt_enc: body.salt_enc,
        salt_auth: body.salt_auth,
        auth_hash_double: body.auth_hash_double,
        encrypted_data: body.encrypted_data,
        createdAt: now,
        updatedAt: now
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
    if (!await verifyProof(body.auth_hash, vault.auth_hash_double)) {
      await tracker.fail(`vault:${name}`, ip);
      return jsonResponse({ error: "Password verification failed. Access denied." }, 401);
    }
    await tracker.succeed(`vault:${name}`, ip);
    return jsonResponse({
      success: true,
      encrypted_data: vault.encrypted_data,
      salt_enc: vault.salt_enc,
      salt_auth: vault.salt_auth
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
    if (!await verifyProof(body.auth_hash, vault.auth_hash_double)) {
      await tracker.fail(`vault:${name}`, ip);
      return jsonResponse({ error: "Verification failed. Access denied." }, 401);
    }
    const err = validateVaultUpdate(body);
    if (err) return jsonResponse({ error: err }, 400);
    vault.encrypted_data = body.encrypted_data;
    vault.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
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
    if (!await verifyProof(body.auth_hash, vault.auth_hash_double)) {
      await tracker.fail(`vault:${name}`, ip);
      return jsonResponse({ error: "Authorization failed. Incorrect password. Vault deletion blocked." }, 401);
    }
    await kv.delete(name);
    return jsonResponse({ success: true });
  }
  if (method === "POST" && path === "/api/share/create") {
    const body = await readJsonBody(request);
    const err = validateShareCreate(body);
    if (err) return jsonResponse({ error: err }, 400);
    const kv = requireKv(env);
    if (await kv.get("share:" + body.id)) return jsonResponse({ error: "Share ID already exists." }, 400);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const share = {
      id: body.id,
      hasPassword: body.hasPassword,
      salt_enc: body.hasPassword ? body.salt_enc : void 0,
      salt_auth: body.hasPassword ? body.salt_auth : void 0,
      auth_hash_double: body.hasPassword ? body.auth_hash_double : void 0,
      encrypted_data: body.encrypted_data,
      // Only legacy clients send this; new shares keep the key in the URL fragment.
      key_unprotected: !body.hasPassword && body.key_unprotected ? body.key_unprotected : void 0,
      owner_auth_hash_double: body.owner_auth_hash_double,
      createdAt: now,
      updatedAt: now
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
      key_unprotected: share.key_unprotected
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
    if (!await verifyProof(body.auth_hash, share.auth_hash_double)) {
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
    if (!await verifyProof(body.auth_hash, share.owner_auth_hash_double)) {
      await tracker.fail(`share-owner:${id}`, ip);
      return jsonResponse({ error: "Verification failed. Access denied." }, 401);
    }
    share.encrypted_data = body.encrypted_data;
    share.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!share.hasPassword && body.key_unprotected !== void 0) share.key_unprotected = body.key_unprotected || void 0;
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
      if (share.owner_auth_hash_double) {
        if (!body.auth_hash) return jsonResponse({ error: "Missing owner credentials. Delete denied." }, 401);
        await guardAttempt(tracker, `share-owner:${id}`, ip);
        if (!await verifyProof(body.auth_hash, share.owner_auth_hash_double)) {
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
async function handleApiRequest(request, env) {
  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status, error.headers);
    }
    console.error("API error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// worker.entry.js
var worker_entry_default = {
  async fetch(request, env, ctx) {
    try {
      const apiResponse = await handleApiRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }
      const pagesUrl = env && env.PAGES_URL || "https://text-vault-app.pages.dev";
      const url = new URL(request.url);
      const targetUrl = pagesUrl + url.pathname + url.search;
      const isGetOrHead = request.method === "GET" || request.method === "HEAD";
      const pageResponse = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: isGetOrHead ? null : request.body
      });
      if (pageResponse.status === 404 && request.method === "GET") {
        const accept = request.headers.get("accept") || "";
        if (accept.includes("text/html") || !url.pathname.includes(".")) {
          return fetch(pagesUrl + "/index.html", {
            method: "GET",
            headers: request.headers
          });
        }
      }
      return pageResponse;
    } catch (error) {
      console.error("Worker error:", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
  }
};
export {
  worker_entry_default as default
};
