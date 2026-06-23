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

export async function deriveKeyAndHash(
  password: string,
  saltEncHex: string,
  saltAuthHex: string
): Promise<{ aesKey: CryptoKey; authHash: string }> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltEncBytes = hexToBytes(saltEncHex);
  const saltAuthBytes = hexToBytes(saltAuthHex);

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltEncBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const authBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltAuthBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    256
  );

  const authHash = bufferToHex(authBits);

  return { aesKey, authHash };
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

  // Convert to Base64 safely
  return btoa(String.fromCharCode(...combined));
}

export async function decryptData(encryptedStr: string, aesKey: CryptoKey): Promise<string> {
  const binaryString = atob(encryptedStr);
  const combined = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    combined[i] = binaryString.charCodeAt(i);
  }

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
  if (password.length < 8 || password.length > 20) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}
