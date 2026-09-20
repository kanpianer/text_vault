import { describe, it, expect } from "vitest";
import {
  generateSaltHex,
  deriveKeyAndHash,
  encryptData,
  decryptData,
  sha256Client,
  generateRandomKeyHex,
  encryptDataWithRawKey,
  decryptDataWithRawKey,
  generateShortShareId,
} from "./crypto";

describe("Document Sharing Crypto Tests", () => {
  describe("Short Share ID Generation", () => {
    it("should generate a 6-character string of lowercase letters and digits", () => {
      for (let i = 0; i < 20; i++) {
        const id = generateShortShareId();
        expect(id).toHaveLength(6);
        expect(id).toMatch(/^[a-z0-9]{6}$/);
      }
    });

    it("should generate unique IDs across calls", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateShortShareId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("Password-Protected Shared Document", () => {
    it("should encrypt and decrypt a shared document with password", async () => {
      const password = "SharePassword123!";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const { aesKey, authHash } = await deriveKeyAndHash(password, saltEnc, saltAuth);
      const authHashDouble = await sha256Client(authHash);

      const docPayload = JSON.stringify({
        title: "Confidential Strategy",
        text: "# Strategy Doc\n\nSecret plans for 2026.",
        createdAt: new Date().toISOString(),
      });

      const encryptedData = await encryptData(docPayload, aesKey);
      expect(typeof encryptedData).toBe("string");
      expect(encryptedData.length).toBeGreaterThan(0);

      // Recipient unlocks with the same password
      const recipientCreds = await deriveKeyAndHash(password, saltEnc, saltAuth);
      const recipientAuthDouble = await sha256Client(recipientCreds.authHash);

      // Verify auth double matches
      expect(recipientAuthDouble).toBe(authHashDouble);

      // Decrypt data
      const decryptedString = await decryptData(encryptedData, recipientCreds.aesKey);
      const parsed = JSON.parse(decryptedString);

      expect(parsed.title).toBe("Confidential Strategy");
      expect(parsed.text).toBe("# Strategy Doc\n\nSecret plans for 2026.");
    });

    it("should fail decryption when incorrect password is used", async () => {
      const correctPassword = "CorrectPassword123!";
      const wrongPassword = "WrongPassword456!";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const { aesKey, authHash } = await deriveKeyAndHash(correctPassword, saltEnc, saltAuth);
      const authHashDouble = await sha256Client(authHash);

      const docPayload = JSON.stringify({
        title: "Secret",
        text: "Important content",
        createdAt: new Date().toISOString(),
      });

      const encryptedData = await encryptData(docPayload, aesKey);

      // Attacker tries wrong password
      const wrongCreds = await deriveKeyAndHash(wrongPassword, saltEnc, saltAuth);
      const wrongAuthDouble = await sha256Client(wrongCreds.authHash);

      // Double-hash auth verification must fail
      expect(wrongAuthDouble).not.toBe(authHashDouble);

      // Even if attacker attempted raw decryption with wrong key, AES-GCM tag verification fails
      await expect(decryptData(encryptedData, wrongCreds.aesKey)).rejects.toThrow();
    });
  });

  describe("Unprotected (No Password) Shared Document", () => {
    it("should encrypt and decrypt using raw 256-bit key", async () => {
      const rawKeyHex = generateRandomKeyHex();
      expect(rawKeyHex).toHaveLength(64); // 32 bytes = 64 hex characters

      const docPayload = JSON.stringify({
        title: "Public Announcement",
        text: "# Hello World\n\nThis is a public shared document.",
        createdAt: new Date().toISOString(),
      });

      const encryptedData = await encryptDataWithRawKey(docPayload, rawKeyHex);
      expect(typeof encryptedData).toBe("string");
      expect(encryptedData).not.toContain("Public Announcement");

      const decryptedString = await decryptDataWithRawKey(encryptedData, rawKeyHex);
      const parsed = JSON.parse(decryptedString);

      expect(parsed.title).toBe("Public Announcement");
      expect(parsed.text).toBe("# Hello World\n\nThis is a public shared document.");
    });
  });
});
