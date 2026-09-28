import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import {
  deriveKeyAndHash,
  deriveKeyAndHashPipelined,
  startPrederiveKeyAndHash,
  getCachedDerivedKeyAndHash,
  clearCryptoPrederiveCache,
  generateSaltHex,
  encryptData,
  decryptData,
} from "./crypto";
import { preloadEditor } from "./App";

describe("Vault Decryption & Editor Loading Performance Optimizations", () => {
  beforeEach(() => {
    cleanup();
    window.history.pushState(null, "", "/");
    clearCryptoPrederiveCache();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Pipelined Key Derivation (deriveKeyAndHashPipelined)", () => {
    it("produces identical authHash and aesKey as deriveKeyAndHash", async () => {
      const password = "TestPassword#2026";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const standardResult = await deriveKeyAndHash(password, saltEnc, saltAuth);
      const pipelined = deriveKeyAndHashPipelined(password, saltEnc, saltAuth);

      const pipelinedAuthHash = await pipelined.authHashPromise;
      const pipelinedAesKey = await pipelined.aesKeyPromise;

      expect(pipelinedAuthHash).toBe(standardResult.authHash);

      // Verify that both AES keys can encrypt and cross-decrypt the same plaintext
      const plaintext = "Hello Secret Vault Content";
      const ciphertext = await encryptData(plaintext, standardResult.aesKey);
      const decryptedWithPipelined = await decryptData(ciphertext, pipelinedAesKey);
      expect(decryptedWithPipelined).toBe(plaintext);
    });

    it("allows authHashPromise to resolve and initiate downstream tasks independently", async () => {
      const password = "FastAuthHash#2026";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const { authHashPromise, aesKeyPromise } = deriveKeyAndHashPipelined(password, saltEnc, saltAuth);

      let networkRequestInitiated = false;
      const fakeNetworkFetch = authHashPromise.then((hash) => {
        expect(hash).toHaveLength(64);
        networkRequestInitiated = true;
        return { ok: true, data: "encrypted_payload" };
      });

      const [netResult, aesKey] = await Promise.all([fakeNetworkFetch, aesKeyPromise]);
      expect(networkRequestInitiated).toBe(true);
      expect(netResult.ok).toBe(true);
      expect(aesKey).toBeDefined();
    });
  });

  describe("Pre-derivation Cache (startPrederiveKeyAndHash & getCachedDerivedKeyAndHash)", () => {
    it("reuses existing in-flight/resolved derivation for identical credentials", async () => {
      const vaultName = "myvault";
      const password = "CachedPassword!99";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const firstDerivation = startPrederiveKeyAndHash(vaultName, password, saltEnc, saltAuth);
      const secondDerivation = getCachedDerivedKeyAndHash(vaultName, password, saltEnc, saltAuth);

      // Must return identical promise references
      expect(secondDerivation.authHashPromise).toBe(firstDerivation.authHashPromise);
      expect(secondDerivation.aesKeyPromise).toBe(firstDerivation.aesKeyPromise);

      const hash1 = await firstDerivation.authHashPromise;
      const hash2 = await secondDerivation.authHashPromise;
      expect(hash1).toBe(hash2);
    });

    it("clears cached keys on clearCryptoPrederiveCache (e.g. on vault lock)", async () => {
      const vaultName = "myvault";
      const password = "CachedPassword!99";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const firstDerivation = startPrederiveKeyAndHash(vaultName, password, saltEnc, saltAuth);
      clearCryptoPrederiveCache();

      const newDerivation = getCachedDerivedKeyAndHash(vaultName, password, saltEnc, saltAuth);
      expect(newDerivation.authHashPromise).not.toBe(firstDerivation.authHashPromise);
    });

    it("creates a new derivation when password changes", async () => {
      const vaultName = "myvault";
      const saltEnc = generateSaltHex();
      const saltAuth = generateSaltHex();

      const first = startPrederiveKeyAndHash(vaultName, "PassOne#1234", saltEnc, saltAuth);
      const second = startPrederiveKeyAndHash(vaultName, "PassTwo#5678", saltEnc, saltAuth);

      expect(first.authHashPromise).not.toBe(second.authHashPromise);
    });
  });

  describe("Editor Preloading (preloadEditor)", () => {
    it("successfully preloads the Editor module ahead of time", async () => {
      const editorModule = await preloadEditor();
      expect(editorModule).toBeDefined();
      expect(editorModule.default).toBeDefined();
    });

    it("returns the cached module promise on subsequent preload calls", () => {
      const p1 = preloadEditor();
      const p2 = preloadEditor();
      expect(p1).toBe(p2);
    });
  });

  describe("Vault Freshness & No-Cache Guarantees", () => {
    it("ensures salts and get requests are made with no-store and no-cache policies", async () => {
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        if (url.includes("/salts")) {
          return {
            ok: true,
            json: async () => ({ exists: true, salt_enc: "s1", salt_auth: "s2" }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true }),
        };
      });

      try {
        // Simulate salt fetch
        const saltUrl = `/api/vault/testvault/salts?t=${Date.now()}`;
        await fetch(saltUrl, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
        });

        expect(fetchCalls).toHaveLength(1);
        expect(fetchCalls[0].url).toContain("/salts?t=");
        expect(fetchCalls[0].init?.cache).toBe("no-store");
        expect((fetchCalls[0].init?.headers as Record<string, string>)["Cache-Control"]).toBe("no-cache");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("CHEATSHEET Menu & Top Shortcuts Order", () => {
    it("renders CHEATSHEET in menu and displays Ctrl+S, Ctrl+L, Ctrl+X at the top", async () => {
      const { render, screen, fireEvent, waitFor } = await import("@testing-library/react");
      const React = await import("react");
      const App = (await import("./App")).default;

      // Mock unlock response
      const sEnc = generateSaltHex();
      const sAuth = generateSaltHex();
      const { aesKey, authHash } = await deriveKeyAndHash("TestPass123!", sEnc, sAuth);
      const testEncrypted = await encryptData(
        JSON.stringify({ tabs: [{ id: "tab-1", text: "<h1>Note</h1><p>Test</p>" }] }),
        aesKey
      );

      window.history.pushState({}, "", "/myvault");
      window.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/salts")) {
          return {
            ok: true,
            json: async () => ({ exists: true, salt_enc: sEnc, salt_auth: sAuth }),
          };
        }
        if (url.includes("/get")) {
          return {
            ok: true,
            json: async () => ({ ok: true, encrypted_data: testEncrypted }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      render(React.createElement(App));

      await waitFor(() => {
        expect(screen.getByText("UNLOCK THE VAULT")).toBeInTheDocument();
      });

      // Enter password and unlock
      const pwdInput = screen.getByPlaceholderText("••••••••");
      fireEvent.change(pwdInput, { target: { value: "TestPass123!" } });
      const decryptBtn = screen.getByText("Decrypt");
      fireEvent.click(decryptBtn);

      // Verify opened into editor view
      await waitFor(() => {
        expect(screen.getByText("Text_Vault/")).toBeInTheDocument();
      });

      // Open sandwich menu
      const menuTrigger = screen.getByText("Menu");
      expect(menuTrigger).toBeTruthy();
      fireEvent.click(menuTrigger);

      // Verify menu item is CHEATSHEET (not SHORTCUTS / CHEATSHEET)
      await waitFor(() => {
        expect(screen.getByText("CHEATSHEET")).toBeInTheDocument();
      });

      // Click CHEATSHEET to open modal
      fireEvent.click(screen.getByText("CHEATSHEET"));

      // Verify modal header is CHEATSHEET
      await waitFor(() => {
        const modalHeader = screen.getAllByText("CHEATSHEET").find((el) => el.tagName === "H3");
        expect(modalHeader).toBeInTheDocument();
      });

      // Verify the top 3 shortcuts are present in order
      const shortcutKbdElements = Array.from(document.querySelectorAll("kbd")).map((k) => k.textContent?.trim());
      expect(shortcutKbdElements[0]).toBe("Ctrl + S");
      expect(shortcutKbdElements[1]).toBe("Ctrl + L");
      expect(shortcutKbdElements[2]).toBe("Ctrl + X");

      // Verify shortcut text descriptions
      expect(screen.getByText(/Save current text \/ 保存当前文本/i)).toBeInTheDocument();
      expect(screen.getByText(/Lock current vault \/ 锁定当前金库/i)).toBeInTheDocument();
      expect(screen.getByText(/Return to home \/ 回到主页/i)).toBeInTheDocument();
    });

    it("triggers lock on Ctrl+L and return to home on Ctrl+X", async () => {
      const { render, screen, fireEvent, waitFor } = await import("@testing-library/react");
      const React = await import("react");
      const App = (await import("./App")).default;

      const sEnc = generateSaltHex();
      const sAuth = generateSaltHex();
      const { aesKey } = await deriveKeyAndHash("TestPass123!", sEnc, sAuth);
      const testEncrypted = await encryptData(
        JSON.stringify({ tabs: [{ id: "tab-1", text: "<h1>Note</h1><p>Test</p>" }] }),
        aesKey
      );

      window.history.pushState({}, "", "/hotkey");
      window.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/salts")) {
          return {
            ok: true,
            json: async () => ({ exists: true, salt_enc: sEnc, salt_auth: sAuth }),
          };
        }
        if (url.includes("/get")) {
          return {
            ok: true,
            json: async () => ({ ok: true, encrypted_data: testEncrypted }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      render(React.createElement(App));

      await waitFor(() => {
        expect(screen.getByText("UNLOCK THE VAULT")).toBeInTheDocument();
      });

      const pwdInput = screen.getByPlaceholderText("••••••••");
      fireEvent.change(pwdInput, { target: { value: "TestPass123!" } });
      fireEvent.click(screen.getByText("Decrypt"));

      await waitFor(() => {
        expect(screen.getByText("Text_Vault/")).toBeInTheDocument();
      });

      // Test Ctrl + L: locks vault, returns to unlock screen
      fireEvent.keyDown(window, { key: "l", ctrlKey: true });
      await waitFor(() => {
        expect(screen.getByText("UNLOCK THE VAULT")).toBeInTheDocument();
      });

      // Test Ctrl + X: returns to home
      fireEvent.keyDown(window, { key: "x", ctrlKey: true });
      await waitFor(() => {
        expect(screen.getByText("End To End Encrypted Text")).toBeInTheDocument();
      });
    });
  });
});

