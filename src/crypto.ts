export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function sha256Client(val: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(val);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hashBuffer);
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : globalThis.crypto;
  return cryptoObj.subtle;
}

export interface PipelinedKeyDerivation {
  authHashPromise: Promise<string>;
  aesKeyPromise: Promise<CryptoKey>;
}

export function deriveKeyAndHashPipelined(
  password: string,
  saltEncHex: string,
  saltAuthHex: string
): PipelinedKeyDerivation {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltEncBytes = hexToBytes(saltEncHex);
  const saltAuthBytes = hexToBytes(saltAuthHex);
  const subtle = getSubtleCrypto();

  const baseKeyPromise = subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const authHashPromise = baseKeyPromise.then(async (baseKey) => {
    const authBits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltAuthBytes,
        iterations: 600000,
        hash: "SHA-256",
      },
      baseKey,
      256
    );
    return bufferToHex(authBits);
  });

  const aesKeyPromise = baseKeyPromise.then((baseKey) =>
    subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltEncBytes,
        iterations: 600000,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  );

  return { authHashPromise, aesKeyPromise };
}

// In-memory pre-derivation cache to eliminate perceived key derivation lag on unlock
interface PrederiveCacheEntry {
  cacheKey: string;
  derivation: PipelinedKeyDerivation;
  createdAt: number;
}
let prederiveCache: PrederiveCacheEntry | null = null;

export function startPrederiveKeyAndHash(
  vaultKey: string,
  password: string,
  saltEncHex: string,
  saltAuthHex: string
): PipelinedKeyDerivation {
  const cacheKey = `${vaultKey}:${saltEncHex}:${saltAuthHex}:${password}`;
  if (prederiveCache && prederiveCache.cacheKey === cacheKey) {
    return prederiveCache.derivation;
  }
  const derivation = deriveKeyAndHashPipelined(password, saltEncHex, saltAuthHex);
  prederiveCache = {
    cacheKey,
    derivation,
    createdAt: Date.now(),
  };
  return derivation;
}

export function getCachedDerivedKeyAndHash(
  vaultKey: string,
  password: string,
  saltEncHex: string,
  saltAuthHex: string
): PipelinedKeyDerivation {
  const cacheKey = `${vaultKey}:${saltEncHex}:${saltAuthHex}:${password}`;
  if (prederiveCache && prederiveCache.cacheKey === cacheKey) {
    return prederiveCache.derivation;
  }
  return startPrederiveKeyAndHash(vaultKey, password, saltEncHex, saltAuthHex);
}

export function clearCryptoPrederiveCache(): void {
  prederiveCache = null;
}

export async function deriveKeyAndHash(
  password: string,
  saltEncHex: string,
  saltAuthHex: string
): Promise<{ aesKey: CryptoKey; authHash: string }> {
  const { authHashPromise, aesKeyPromise } = deriveKeyAndHashPipelined(
    password,
    saltEncHex,
    saltAuthHex
  );
  const [authHash, aesKey] = await Promise.all([authHashPromise, aesKeyPromise]);
  return { aesKey, authHash };
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks to prevent RangeError: Maximum call stack size exceeded
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function encryptData(plaintext: string, aesKey: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    aesKey,
    plaintextBytes
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(iv.length + ciphertextBytes.length);
  combined.set(iv, 0);
  combined.set(ciphertextBytes, iv.length);

  // Convert to Base64 safely without call stack limit errors
  return uint8ArrayToBase64(combined);
}

export async function decryptData(encryptedStr: string, aesKey: CryptoKey): Promise<string> {
  const combined = base64ToUint8Array(encryptedStr);

  const iv = combined.slice(0, 12);
  const ciphertextBytes = combined.slice(12);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    aesKey,
    ciphertextBytes
  );

  return new TextDecoder().decode(decryptedBuffer);
}

export function generateSaltHex(): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return bufferToHex(bytes);
}

export function validatePassword(password: string): boolean {
  if (password.length < 8 || password.length > 64) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

export function generateRandomKeyHex(): string {
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : globalThis.crypto;
  const bytes = cryptoObj.getRandomValues(new Uint8Array(32));
  return bufferToHex(bytes);
}

export async function importRawAesKey(keyHex: string): Promise<CryptoKey> {
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : globalThis.crypto;
  const keyBytes = hexToBytes(keyHex);
  return cryptoObj.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptDataWithRawKey(plaintext: string, keyHex: string): Promise<string> {
  const key = await importRawAesKey(keyHex);
  return encryptData(plaintext, key);
}

export async function decryptDataWithRawKey(encryptedStr: string, keyHex: string): Promise<string> {
  const key = await importRawAesKey(keyHex);
  return decryptData(encryptedStr, key);
}

export const SHARE_ID_LENGTH = 12;
const SHARE_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generates an unguessable share ID: 12 base62 chars (~71 bits of entropy).
 * Uses rejection sampling so every character is uniformly distributed.
 */
export function generateShortShareId(length: number = SHARE_ID_LENGTH): string {
  const chars = SHARE_ID_ALPHABET;
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : globalThis.crypto;
  // Largest multiple of 62 below 256 — bytes >= this are rejected to avoid modulo bias.
  const limit = 256 - (256 % chars.length);
  let result = "";
  while (result.length < length) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(length * 2));
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < limit) {
        result += chars[bytes[i] % chars.length];
      }
    }
  }
  return result;
}

/** Random per-share owner secret; the server only stores sha256(token). */
export function generateShareOwnerToken(): string {
  return generateRandomKeyHex();
}



