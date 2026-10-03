/**
 * Shared input validation for every backend (Express, Cloudflare Pages Functions, Cloudflare Worker).
 * Plain ESM JavaScript so it can be bundled by esbuild/wrangler and imported from TypeScript.
 */

export const VAULT_NAME_RE = /^[a-z0-9]{1,10}$/;
export const SHARE_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Max length (chars) of a base64 AES-GCM payload. 1M chars of UTF-8 text -> ~5.4MB base64. */
export const MAX_ENCRYPTED_DATA_LENGTH = 8 * 1024 * 1024;
/** Max accepted request body size in bytes. */
export const MAX_BODY_BYTES = 9 * 1024 * 1024;

// Keys that must never be used to index plain objects (prototype pollution).
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype", "hasownproperty", "tostring", "valueof"]);

export function normalizeVaultName(name) {
  return typeof name === "string" ? name.toLowerCase() : "";
}

export function isValidVaultName(name) {
  return typeof name === "string" && VAULT_NAME_RE.test(name) && !RESERVED_KEYS.has(name.toLowerCase());
}

export function isValidShareId(id) {
  return typeof id === "string" && SHARE_ID_RE.test(id) && !RESERVED_KEYS.has(id.toLowerCase());
}

export function isHex64(value) {
  return typeof value === "string" && HEX64_RE.test(value);
}

export function isSaltHex(value) {
  return typeof value === "string" && HEX32_RE.test(value);
}

export function isEncryptedData(value) {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= MAX_ENCRYPTED_DATA_LENGTH &&
    BASE64_RE.test(value)
  );
}

/** Returns an error message, or null when the body is valid. */
export function validateVaultCreate(body) {
  const { salt_enc, salt_auth, auth_hash_double, encrypted_data } = body || {};
  if (!salt_enc || !salt_auth || !auth_hash_double || !encrypted_data) return "Missing required properties.";
  if (!isSaltHex(salt_enc) || !isSaltHex(salt_auth)) return "Invalid salt format.";
  if (!isHex64(auth_hash_double)) return "Invalid verifier format.";
  if (!isEncryptedData(encrypted_data)) return "Invalid or oversized encrypted payload.";
  return null;
}

export function validateVaultUpdate(body) {
  const { encrypted_data, salt_enc, salt_auth, auth_hash_double } = body || {};
  if (!isEncryptedData(encrypted_data)) return "Missing, invalid or oversized encrypted payload.";
  const rotating = salt_enc !== undefined || salt_auth !== undefined || auth_hash_double !== undefined;
  if (rotating) {
    if (!isSaltHex(salt_enc) || !isSaltHex(salt_auth) || !isHex64(auth_hash_double)) {
      return "Password rotation requires valid salt_enc, salt_auth and auth_hash_double.";
    }
  }
  return null;
}

export function validateShareCreate(body) {
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
    if (key_unprotected !== undefined && key_unprotected !== null) return "Password-protected shares must not include a raw key.";
  } else if (key_unprotected !== undefined && key_unprotected !== null && !isHex64(key_unprotected)) {
    // Legacy clients still send a server-held key; new clients keep it in the URL fragment only.
    return "Invalid key format.";
  }
  return null;
}

export function validateShareUpdate(body) {
  const { encrypted_data, key_unprotected, salt_enc, salt_auth, auth_hash_double } = body || {};
  if (!encrypted_data) return "Missing encrypted data.";
  if (!isEncryptedData(encrypted_data)) return "Invalid or oversized encrypted payload.";
  if (key_unprotected !== undefined && key_unprotected !== null && !isHex64(key_unprotected)) return "Invalid key format.";
  const rotating = salt_enc !== undefined || salt_auth !== undefined || auth_hash_double !== undefined;
  if (rotating && (!isSaltHex(salt_enc) || !isSaltHex(salt_auth) || !isHex64(auth_hash_double))) {
    return "Credential rotation requires valid salt_enc, salt_auth and auth_hash_double.";
  }
  return null;
}
