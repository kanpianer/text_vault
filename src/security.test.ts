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

  describe("Backend Validation & Prototype Pollution Defense", () => {
    it("should reject prototype pollution attempts and reserved identifiers", async () => {
      const { isValidVaultName, isValidShareId } = await import("../shared/validation.js");
      expect(isValidVaultName("__proto__")).toBe(false);
      expect(isValidVaultName("constructor")).toBe(false);
      expect(isValidVaultName("prototype")).toBe(false);
      expect(isValidShareId("__proto__")).toBe(false);
      expect(isValidShareId("constructor")).toBe(false);
      expect(isValidShareId("prototype")).toBe(false);
      expect(isValidVaultName("vault123")).toBe(true);
      expect(isValidVaultName("toolongvaultname")).toBe(false);
      expect(isValidShareId("valid_share-123")).toBe(true);
    });

    it("should validate vault creation payloads strictly", async () => {
      const { validateVaultCreate } = await import("../shared/validation.js");
      // Missing properties
      expect(validateVaultCreate({})).toMatch(/Missing required properties/);

      // Malformed salt
      expect(validateVaultCreate({
        salt_enc: "invalid-salt",
        salt_auth: "b".repeat(32),
        auth_hash_double: "c".repeat(64),
        encrypted_data: "validbase64payload1234==",
      })).toMatch(/Invalid salt/);

      // Malformed hash verifier
      expect(validateVaultCreate({
        salt_enc: "a".repeat(32),
        salt_auth: "b".repeat(32),
        auth_hash_double: "short",
        encrypted_data: "validbase64payload1234==",
      })).toMatch(/Invalid verifier/);

      // Valid payload
      expect(validateVaultCreate({
        salt_enc: "a".repeat(32),
        salt_auth: "b".repeat(32),
        auth_hash_double: "c".repeat(64),
        encrypted_data: "validbase64payload1234==",
      })).toBeNull();
    });

    it("should validate share creation payloads and enforce owner auth", async () => {
      const { validateShareCreate } = await import("../shared/validation.js");
      // Missing owner credentials
      expect(validateShareCreate({
        id: "share123456",
        hasPassword: false,
        encrypted_data: "data1234567890==",
      })).toMatch(/Owner credentials are required/);

      // Valid unprotected share with owner credentials
      expect(validateShareCreate({
        id: "share123456",
        hasPassword: false,
        encrypted_data: "data1234567890==",
        owner_auth_hash_double: "d".repeat(64),
      })).toBeNull();
    });
  });

  describe("Progressive Backoff Failure Tracker", () => {
    it("should enforce free attempts then trigger exponential backoff with Retry-After", async () => {
      const { createMemoryFailureTracker } = await import("../shared/failureTracker.js");
      let currentTime = 1000000;
      const tracker = createMemoryFailureTracker({
        perClientFree: 3,
        globalFree: 5,
        baseDelayMs: 1000,
        now: () => currentTime,
      });

      // 3 free failures allowed
      expect(tracker.check("vault:v1", "127.0.0.1").blocked).toBe(false);
      tracker.fail("vault:v1", "127.0.0.1");
      expect(tracker.check("vault:v1", "127.0.0.1").blocked).toBe(false);
      tracker.fail("vault:v1", "127.0.0.1");
      expect(tracker.check("vault:v1", "127.0.0.1").blocked).toBe(false);
      tracker.fail("vault:v1", "127.0.0.1");
      expect(tracker.check("vault:v1", "127.0.0.1").blocked).toBe(false);

      // 4th failure: starts backoff (1000ms)
      tracker.fail("vault:v1", "127.0.0.1");
      const blocked1 = tracker.check("vault:v1", "127.0.0.1");
      expect(blocked1.blocked).toBe(true);
      expect(blocked1.retryAfterSec).toBe(1);

      // Advance time past delay
      currentTime += 1001;
      expect(tracker.check("vault:v1", "127.0.0.1").blocked).toBe(false);

      // Next failure doubles the delay (2000ms)
      tracker.fail("vault:v1", "127.0.0.1");
      const blocked2 = tracker.check("vault:v1", "127.0.0.1");
      expect(blocked2.blocked).toBe(true);
      expect(blocked2.retryAfterSec).toBe(2);

      // Success clears client lock
      tracker.succeed("vault:v1", "127.0.0.1");
      expect(tracker.check("vault:v1", "127.0.0.1").blocked).toBe(false);
    });
  });

  describe("Shared Cloudflare API Handler Security", () => {
    it("should enforce owner auth on share deletion", async () => {
      const { handleApiRequest } = await import("../shared/apiHandler.js");
      const mockKvStore = new Map<string, string>();
      const mockEnv = {
        VAULTS: {
          get: async (k: string) => mockKvStore.get(k) || null,
          put: async (k: string, v: string) => { mockKvStore.set(k, v); },
          delete: async (k: string) => { mockKvStore.delete(k); },
        },
      };

      const ownerSecret = "a".repeat(64);
      // SHA-256 of 64 'a's:
      const encoder = new TextEncoder();
      const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(ownerSecret));
      const ownerHashDouble = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Create a share with owner credentials
      mockKvStore.set("share:testshare123", JSON.stringify({
        id: "testshare123",
        hasPassword: false,
        encrypted_data: "data1234567890==",
        owner_auth_hash_double: ownerHashDouble,
      }));

      // 1. Delete without auth_hash -> 401
      const reqNoAuth = new Request("https://vault.local/api/share/testshare123/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const resNoAuth = await handleApiRequest(reqNoAuth, mockEnv);
      expect(resNoAuth?.status).toBe(401);
      expect(mockKvStore.has("share:testshare123")).toBe(true);

      // 2. Delete with wrong auth_hash -> 401
      const reqBadAuth = new Request("https://vault.local/api/share/testshare123/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_hash: "b".repeat(64) }),
      });
      const resBadAuth = await handleApiRequest(reqBadAuth, mockEnv);
      expect(resBadAuth?.status).toBe(401);
      expect(mockKvStore.has("share:testshare123")).toBe(true);

      // 3. Delete with valid owner credentials -> 200 and deleted
      const reqGoodAuth = new Request("https://vault.local/api/share/testshare123/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_hash: ownerSecret }),
      });
      const resGoodAuth = await handleApiRequest(reqGoodAuth, mockEnv);
      expect(resGoodAuth?.status).toBe(200);
      expect(mockKvStore.has("share:testshare123")).toBe(false);
    });

    it("should never send wildcard Access-Control-Allow-Origin header", async () => {
      const { handleApiRequest } = await import("../shared/apiHandler.js");
      const req = new Request("https://vault.local/api/vault/testvault/salts", {
        method: "GET",
      });
      const res = await handleApiRequest(req, { VAULTS: { get: async () => null } });
      expect(res?.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res?.headers.get("Cache-Control")).toContain("no-store");
      expect(res?.headers.get("X-Frame-Options")).toBe("DENY");
    });
  });
});

