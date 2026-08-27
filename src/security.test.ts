import { describe, it, expect } from "vitest";
import {
  validatePassword,
  generateSaltHex,
  uint8ArrayToBase64,
  base64ToUint8Array,
  deriveKeyAndHash,
  encryptData,
  decryptData,
  sha256Client,
} from "./crypto";
import { sanitizeUrl, normalizeEditorNodes } from "./Editor";
import DOMPurify from "dompurify";

describe("Security & Crypto Verification Tests", () => {
  describe("Password Policy Validation (8-64 chars)", () => {
    it("should accept compliant passwords with upper, lower, digits, and symbols", () => {
      expect(validatePassword("P@ssw0rd123")).toBe(true);
      expect(validatePassword("Secure#P@ssphrase_2026_With_Long_Length!")).toBe(true);
      expect(validatePassword("A".repeat(20) + "a".repeat(20) + "1".repeat(20) + "!")).toBe(true); // 61 chars
    });

    it("should reject passwords shorter than 8 characters", () => {
      expect(validatePassword("P@s1")).toBe(false);
      expect(validatePassword("P@ssw1")).toBe(false);
    });

    it("should reject passwords longer than 64 characters", () => {
      expect(validatePassword("A1!a" + "x".repeat(61))).toBe(false); // 65 chars
    });

    it("should reject passwords missing character classes", () => {
      expect(validatePassword("alllowercase123!")).toBe(false); // no uppercase
      expect(validatePassword("ALLUPPERCASE123!")).toBe(false); // no lowercase
      expect(validatePassword("NoDigitsSpecial!@#")).toBe(false); // no digit
      expect(validatePassword("NoSpecialChars12345")).toBe(false); // no special char
    });
  });

  describe("Base64 Chunking & Call Stack Overflow Prevention", () => {
    it("should encode and decode arbitrary byte arrays correctly", () => {
      const sample = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4]);
      const base64 = uint8ArrayToBase64(sample);
      const decoded = base64ToUint8Array(base64);
      expect(Array.from(decoded)).toEqual(Array.from(sample));
    });

    it("should safely encode large binary arrays (>64KB) without stack overflow", () => {
      // 150KB array (would fail with RangeError on String.fromCharCode(...combined))
      const largeArray = new Uint8Array(150 * 1024);
      for (let i = 0; i < largeArray.length; i++) {
        largeArray[i] = i % 256;
      }

      expect(() => {
        const b64 = uint8ArrayToBase64(largeArray);
        const decoded = base64ToUint8Array(b64);
        expect(decoded.length).toBe(largeArray.length);
        expect(decoded[0]).toBe(0);
        expect(decoded[150 * 1024 - 1]).toBe((150 * 1024 - 1) % 256);
      }).not.toThrow();
    });
  });

  describe("End-to-End Encryption & Large Payload Verification", () => {
    it("should correctly encrypt and decrypt large markdown notes", async () => {
      const sEnc = generateSaltHex();
      const sAuth = generateSaltHex();
      const pwd = "Test_Password#2026";

      const { aesKey, authHash } = await deriveKeyAndHash(pwd, sEnc, sAuth);
      expect(aesKey).toBeDefined();
      expect(authHash).toHaveLength(64);

      const doubleHash = await sha256Client(authHash);
      expect(doubleHash).toHaveLength(64);

      // Large payload: 100,000 characters
      const largeText = "# Secret Document\n\n" + "Confidential information line.\n".repeat(3000);
      const encrypted = await encryptData(largeText, aesKey);
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(1000);

      const decrypted = await decryptData(encrypted, aesKey);
      expect(decrypted).toBe(largeText);
    });
  });

  describe("XSS URL Sanitization & Protocol Blocking", () => {
    it("should neutralize dangerous javascript: pseudo-protocols", () => {
      expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
      expect(sanitizeUrl("JAVASCRIPT:fetch('//evil.com')")).toBe("#");
      expect(sanitizeUrl("javascript: void(0)")).toBe("#");
    });

    it("should neutralize data: and vbscript: pseudo-protocols", () => {
      expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
      expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("#");
    });

    it("should accept and format legitimate http/https URLs", () => {
      expect(sanitizeUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
      expect(sanitizeUrl("http://example.com/docs")).toBe("http://example.com/docs");
      expect(sanitizeUrl("example.com/my-page")).toBe("https://example.com/my-page");
    });
  });

  describe("DOMPurify XSS Filter Verification", () => {
    it("should strip malicious script tags and event handlers from HTML", () => {
      const maliciousHtml = '<p>Normal text</p><script>alert("xss")</script><img src="x" onerror="alert(1)">';
      const clean = DOMPurify.sanitize(maliciousHtml, {
        ALLOWED_TAGS: ["p", "b", "i", "img", "a"],
        ALLOWED_ATTR: ["href", "src", "alt"],
      });

      expect(clean).not.toContain("<script>");
      expect(clean).not.toContain("onerror");
      expect(clean).toContain("<p>Normal text</p>");
    });

    it("should sanitize anchor elements in normalizeEditorNodes", () => {
      const container = document.createElement("div");
      container.innerHTML = '<a href="javascript:alert(1)">Click Me</a><a href="https://google.com">Google</a>';

      normalizeEditorNodes(container);

      const links = container.querySelectorAll("a");
      expect(links[0].getAttribute("href")).toBe("#");
      expect(links[0].getAttribute("target")).toBe("_blank");
      expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");

      expect(links[1].getAttribute("href")).toBe("https://google.com");
      expect(links[1].getAttribute("target")).toBe("_blank");
      expect(links[1].getAttribute("rel")).toBe("noopener noreferrer");
    });
  });
});
