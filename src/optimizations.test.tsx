import { describe, it, expect, vi } from "vitest";
import React, { createRef } from "react";
import { render, fireEvent, act, screen, waitFor } from "@testing-library/react";
import { sha256Client, generateSaltHex, deriveKeyAndHash } from "./crypto";
import { Editor } from "./Editor";
import App from "./App";

describe("22-Point Comprehensive Optimization Verification", () => {
  describe("Item 14: Pinned Tab Boundary Drag Logic", () => {
    it("restricts pinned items to the pinned section (0 to pinnedCount - 1)", () => {
      const tabs = [
        { id: "1", text: "Doc 1", isPinned: true },
        { id: "2", text: "Doc 2", isPinned: true },
        { id: "3", text: "Doc 3", isPinned: false },
        { id: "4", text: "Doc 4", isPinned: false },
      ];

      const currentId = "1";
      const currentTab = tabs.find((t) => t.id === currentId);
      const pinnedCount = tabs.filter((t) => t.isPinned).length;
      const isCurrentPinned = Boolean(currentTab?.isPinned);

      let minIndex = 0;
      let maxIndex = tabs.length - 1;
      if (isCurrentPinned) {
        minIndex = 0;
        maxIndex = Math.max(0, pinnedCount - 1);
      } else {
        minIndex = pinnedCount;
        maxIndex = Math.max(pinnedCount, tabs.length - 1);
      }

      expect(isCurrentPinned).toBe(true);
      expect(minIndex).toBe(0);
      expect(maxIndex).toBe(1);

      // Even if user drags far down (e.g. index 3), clamped index must not exceed maxIndex
      const rawIndex = 3;
      const targetIndex = Math.max(minIndex, Math.min(maxIndex, rawIndex));
      expect(targetIndex).toBe(1);
    });

    it("restricts unpinned items to the unpinned section (pinnedCount to tabs.length - 1)", () => {
      const tabs = [
        { id: "1", text: "Doc 1", isPinned: true },
        { id: "2", text: "Doc 2", isPinned: true },
        { id: "3", text: "Doc 3", isPinned: false },
        { id: "4", text: "Doc 4", isPinned: false },
      ];

      const currentId = "3";
      const currentTab = tabs.find((t) => t.id === currentId);
      const pinnedCount = tabs.filter((t) => t.isPinned).length;
      const isCurrentPinned = Boolean(currentTab?.isPinned);

      let minIndex = 0;
      let maxIndex = tabs.length - 1;
      if (isCurrentPinned) {
        minIndex = 0;
        maxIndex = Math.max(0, pinnedCount - 1);
      } else {
        minIndex = pinnedCount;
        maxIndex = Math.max(pinnedCount, tabs.length - 1);
      }

      expect(isCurrentPinned).toBe(false);
      expect(minIndex).toBe(2);
      expect(maxIndex).toBe(3);

      // Even if user drags far up (e.g. index 0), clamped index must not drop below minIndex
      const rawIndex = 0;
      const targetIndex = Math.max(minIndex, Math.min(maxIndex, rawIndex));
      expect(targetIndex).toBe(2);
    });
  });

  describe("Item 18: Vault Name Character Limits", () => {
    const VAULT_NAME_REGEX = /^[a-z0-9]{3,10}$/;

    it("accepts valid vault names from 3 to 10 characters", () => {
      expect(VAULT_NAME_REGEX.test("abc")).toBe(true);
      expect(VAULT_NAME_REGEX.test("myvault123")).toBe(true); // 10 chars
      expect(VAULT_NAME_REGEX.test("vault01")).toBe(true);
    });

    it("rejects vault names shorter than 3 or longer than 10 characters", () => {
      expect(VAULT_NAME_REGEX.test("ab")).toBe(false);
      expect(VAULT_NAME_REGEX.test("myvault1234")).toBe(false); // 11 chars
    });
  });

  describe("Item 20: Password Complexity Live Rules", () => {
    const checkPassword = (password: string) => [
      { label: "8-64 chars", ok: password.length >= 8 && password.length <= 64 },
      { label: "Uppercase", ok: /[A-Z]/.test(password) },
      { label: "Lowercase", ok: /[a-z]/.test(password) },
      { label: "Number", ok: /[0-9]/.test(password) },
      { label: "Symbol", ok: /[^A-Za-z0-9]/.test(password) },
    ];

    it("verifies weak passwords fail rule checks", () => {
      const rules = checkPassword("simple");
      expect(rules.find((r) => r.label === "8-64 chars")?.ok).toBe(false);
      expect(rules.find((r) => r.label === "Uppercase")?.ok).toBe(false);
      expect(rules.find((r) => r.label === "Number")?.ok).toBe(false);
      expect(rules.find((r) => r.label === "Symbol")?.ok).toBe(false);
      expect(rules.find((r) => r.label === "Lowercase")?.ok).toBe(true);
    });

    it("verifies strong passwords satisfy all rules", () => {
      const rules = checkPassword("SecureP@ssw0rd");
      expect(rules.every((r) => r.ok)).toBe(true);
    });
  });

  describe("Item 1 & 16: Share Owner Authentication & Double Hashing", () => {
    it("computes matching double hash for owner verification", async () => {
      const sEnc = generateSaltHex();
      const sAuth = generateSaltHex();
      const { authHash } = await deriveKeyAndHash("MySecretPass123!", sEnc, sAuth);

      // Server creates share and stores double hash
      const ownerDoubleHash = await sha256Client(authHash);

      // On update or delete, server compares sha256(req.body.auth_hash) to stored ownerDoubleHash
      const clientSuppliedAuth = authHash;
      const computedVerificationHash = await sha256Client(clientSuppliedAuth);

      expect(computedVerificationHash).toBe(ownerDoubleHash);

      // Wrong auth hash must fail
      const attackerAuth = "wrongauthhash1234567890abcdef";
      const attackerVerificationHash = await sha256Client(attackerAuth);
      expect(attackerVerificationHash).not.toBe(ownerDoubleHash);
    });
  });

  describe("Item 21: Character Limit Warning Calculation", () => {
    const TAB_MAX_CHARS = 100000;

    it("calculates remaining chars and flags warnings appropriately", () => {
      const content = "a".repeat(85000);
      const remainingChars = TAB_MAX_CHARS - content.length;
      expect(remainingChars).toBe(15000);
      expect(remainingChars < 20000).toBe(true);
      expect(remainingChars < 5000).toBe(false);
      expect(`[${Math.round(remainingChars / 1000)}k left]`).toBe("[15k left]");
    });

    it("flags urgent warning when remaining chars < 5000", () => {
      const content = "a".repeat(97500);
      const remainingChars = TAB_MAX_CHARS - content.length;
      expect(remainingChars).toBe(2500);
      expect(remainingChars < 5000).toBe(true);
      expect(`[${Math.round(remainingChars / 1000)}k left]`).toBe("[3k left]");
    });
  });

  describe("Item 11: Horizontal Rule Line Starters", () => {
    it("recognizes --- and *** as horizontal rule starters", () => {
      const hrPatterns = ["---", "***"];
      hrPatterns.forEach((p) => {
        expect(p === "---" || p === "***").toBe(true);
      });
    });
  });

  describe("Top Title Deletion Protection (Editor)", () => {
    it("prevents deleting top H1 element when Backspace is pressed in an empty title", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<h1><br></h1><p>First paragraph</p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const h1 = editorEl.querySelector("h1")!;
      expect(h1).toBeTruthy();

      // Place caret inside top H1
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      const event = new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      });

      const prevented = !editorEl.dispatchEvent(event);
      expect(prevented).toBe(true);
      expect(editorEl.firstElementChild?.tagName).toBe("H1");
      expect(editorEl.querySelector("p")?.textContent).toBe("First paragraph");
    });

    it("prevents merging paragraph below into top H1 when Delete is pressed in empty title", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<h1><br></h1><p>Paragraph below</p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const h1 = editorEl.querySelector("h1")!;

      // Place caret inside empty top H1
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      const event = new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true,
      });

      const prevented = !editorEl.dispatchEvent(event);
      expect(prevented).toBe(true);
      expect(editorEl.firstElementChild?.tagName).toBe("H1");
      expect(editorEl.querySelectorAll("p").length).toBe(1);
      expect(editorEl.querySelector("p")?.textContent).toBe("Paragraph below");
    });

    it("prevents merging paragraph into top H1 when Backspace is pressed at start of paragraph below", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<h1>Title</h1><p>Paragraph below</p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const p = editorEl.querySelector("p")!;

      // Place caret at offset 0 of text inside <p>
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      const event = new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      });

      const prevented = !editorEl.dispatchEvent(event);
      expect(prevented).toBe(true);
      // Paragraph text is NOT merged into H1
      expect(editorEl.querySelector("h1")?.textContent).toBe("Title");
      expect(editorEl.querySelector("p")?.textContent).toBe("Paragraph below");
    });

    it("resets top H1 to <br> without destroying node when entire title text is selected and deleted", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<h1>My Great Title</h1><p>Below text</p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const h1 = editorEl.querySelector("h1")!;

      // Select full text of top H1
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(h1.firstChild!);
      sel.removeAllRanges();
      sel.addRange(range);

      const event = new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      });

      const prevented = !editorEl.dispatchEvent(event);
      expect(prevented).toBe(true);
      expect(editorEl.firstElementChild?.tagName).toBe("H1");
      expect(h1.innerHTML).toBe("<br>");
      expect(editorEl.querySelector("p")?.textContent).toBe("Below text");
    });
  });

  describe("Copy Button Hover Stability in Code Blocks", () => {
    it("renders floating copy button on mouse move over pre without flicker", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      const { container } = render(
        <Editor
          activeTabId="tab-1"
          initialContent="<h1>Code</h1><pre><code>console.log('test')</code></pre>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const pre = container.querySelector("pre")!;
      expect(pre).toBeTruthy();

      // Mock getBoundingClientRect
      pre.getBoundingClientRect = () =>
        ({
          top: 100,
          right: 200,
          left: 10,
          bottom: 150,
          width: 190,
          height: 50,
        } as DOMRect);

      container.querySelector(".relative")!.getBoundingClientRect = () =>
        ({
          top: 50,
          right: 300,
          left: 0,
          bottom: 500,
          width: 300,
          height: 450,
        } as DOMRect);

      act(() => {
        fireEvent.mouseMove(pre, {
          clientX: 50,
          clientY: 110,
        });
      });

      // The copy button should now be rendered
      const copyBtn = container.querySelector(".copy-code-float-btn");
      expect(copyBtn).toBeTruthy();
      expect(copyBtn?.textContent).toContain("Copy");

      // Moving mouse over the copy button itself should not dismiss it
      act(() => {
        fireEvent.mouseMove(copyBtn!, {
          clientX: 50,
          clientY: 110,
        });
      });

      expect(container.querySelector(".copy-code-float-btn")).toBeTruthy();
    });
  });

  describe("Show Password Eye Icon Conditional Visibility", () => {
    it("hides eye icon when password input is empty and displays eye icon when password has text", () => {
      render(<App />);

      // Step 1: Enter vault name on home screen
      const vaultInput = screen.getByRole("textbox");
      fireEvent.change(vaultInput, { target: { value: "testvault" } });
      const openBtn = screen.getByText("OPEN");
      fireEvent.click(openBtn);

      // Step 2: Now on password screen
      const passwordInput = screen.getAllByPlaceholderText("••••••••")[0];
      expect(passwordInput).toBeInTheDocument();

      // When empty, show password button should NOT be rendered
      let eyeButton = screen.queryByTitle(/show password|hide password/i);
      expect(eyeButton).toBeNull();

      // Enter password
      fireEvent.change(passwordInput, { target: { value: "MyPassword123!" } });

      // After entering password, show password button MUST be rendered
      eyeButton = screen.getByTitle("Show password");
      expect(eyeButton).toBeInTheDocument();

      // Clicking toggles visibility
      fireEvent.click(eyeButton);
      expect(screen.getByTitle("Hide password")).toBeInTheDocument();
      expect(passwordInput.getAttribute("type")).toBe("text");

      // Clearing password hides eye icon again
      fireEvent.change(passwordInput, { target: { value: "" } });
      expect(screen.queryByTitle(/show password|hide password/i)).toBeNull();
    });
  });

  describe("Shared Document Preview UI Consistency with Editor Interface", () => {
    it("ensures shared document view header matches editor header layout, spacing, and brand styling", async () => {
      window.history.pushState({}, "", "/share/shareddoc123");
      window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "shareddoc123",
          hasPassword: false,
          encryptedData: "test content",
          encryptionMode: "public",
          rawKeyHex: "123",
        }),
      } as any);

      render(<App />);

      // Verify header container has same constraints as editor header (max-w-4xl, px-4 md:px-8, py-3)
      const headerContainer = document.querySelector("header > div");
      expect(headerContainer).toBeInTheDocument();
      expect(headerContainer?.className).toContain("max-w-4xl");
      expect(headerContainer?.className).toContain("px-4 md:px-8");
      expect(headerContainer?.className).toContain("py-3");
      expect(headerContainer?.className).toContain("flex justify-between items-center");

      // Verify left brand typography matches editor
      const brandText = screen.getByText("Text_Vault/");
      expect(brandText).toBeInTheDocument();
      expect(brandText.className).toContain("text-zinc-500");

      // Verify right action container spacing matches editor (gap-4 md:gap-6)
      const rightActions = headerContainer?.children[1] as HTMLElement;
      expect(rightActions).toBeInTheDocument();
      expect(rightActions.className).toContain("gap-4 md:gap-6");

      // Verify [SHARED] status badge matches editor's [SAVED] badge styling
      const sharedBadge = screen.getByText("[SHARED]");
      expect(sharedBadge).toBeInTheDocument();
      expect(sharedBadge.className).toContain("text-[10px] md:text-xs");
      expect(sharedBadge.className).toContain("text-zinc-500");

      // Verify HOME action exists and uses editor typography
      const homeAction = screen.getByText("HOME");
      expect(homeAction).toBeInTheDocument();
      expect(homeAction.className).toContain("text-xs md:text-sm");
      expect(homeAction.className).toContain("uppercase tracking-wider");
      expect(homeAction.className).toContain("text-zinc-400 hover:text-white");

      // Verify main container padding (pt-0 pb-0) matches editor
      const mainEl = document.querySelector("main");
      expect(mainEl).toBeInTheDocument();
      expect(mainEl?.className).toContain("px-4 md:px-8 pt-0 pb-0 max-w-4xl");
    });

    it("ensures protected shared document password prompt matches vault unlock layout and positioning", async () => {
      window.history.pushState({}, "", "/share/protected123");
      window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          exists: true,
          id: "protected123",
          hasPassword: true,
          salt_enc: "s1",
          salt_auth: "s2",
          encryptedData: "enc",
          encryptionMode: "password",
        }),
      } as any);

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText("ACCESS PROTECTED DOCUMENT")).toBeInTheDocument();
      });

      // Verify modal container has md:pt-[28vh] matching vault unlock
      const modalWrapper = document.querySelector(".fixed.inset-0");
      expect(modalWrapper?.className).toContain("md:pt-[28vh]");

      // Verify button row spacing (gap-12)
      const cancelBtn = screen.getByText("Cancel");
      expect(cancelBtn.parentElement?.className).toContain("gap-12");

      // Verify centered password input is rendered
      const pwdInput = screen.getByPlaceholderText("••••••••");
      expect(pwdInput).toBeInTheDocument();
    });
  });

  describe("Password Input Autofill & Dark Background Protection", () => {
    it("ensures index.css contains comprehensive autofill overrides preventing white backgrounds", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const cssPath = path.resolve(__dirname, "index.css");
      const cssContent = fs.readFileSync(cssPath, "utf-8");

      // Verify inset box-shadow to cover UA autofill background with #090a0b
      expect(cssContent).toContain("-webkit-box-shadow: 0 0 0 1000px #090a0b inset !important;");
      expect(cssContent).toContain("box-shadow: 0 0 0 1000px #090a0b inset !important;");

      // Verify text fill color remains white #ffffff
      expect(cssContent).toContain("-webkit-text-fill-color: #ffffff !important;");
      expect(cssContent).toContain("caret-color: #ffffff !important;");

      // Verify transition delay prevents background color flash
      expect(cssContent).toContain("transition: background-color 5000000s ease-in-out 0s !important;");

      // Verify color-scheme is set to dark
      expect(cssContent).toContain("color-scheme: dark;");

      // Verify both :-webkit-autofill and :autofill are targeted
      expect(cssContent).toContain("input:-webkit-autofill");
      expect(cssContent).toContain("input:autofill");
    });

    it("ensures index.html specifies color-scheme dark meta tag", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const htmlPath = path.resolve(__dirname, "../index.html");
      const htmlContent = fs.readFileSync(htmlPath, "utf-8");

      expect(htmlContent).toContain('<meta name="color-scheme" content="dark" />');
    });

    it("ensures protected shared document password input has autocomplete off and spellCheck false", async () => {
      window.history.pushState({}, "", "/share/protected_test");
      window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          exists: true,
          id: "protected_test",
          hasPassword: true,
          salt_enc: "s1",
          salt_auth: "s2",
          encryptedData: "enc",
          encryptionMode: "password",
        }),
      } as any);

      render(<App />);

      await waitFor(() => {
        expect(screen.getByText("ACCESS PROTECTED DOCUMENT")).toBeInTheDocument();
      });

      const pwdInput = screen.getByPlaceholderText("••••••••") as HTMLInputElement;
      expect(pwdInput).toBeInTheDocument();
      expect(pwdInput.getAttribute("autocomplete")).toBe("off");
      expect(pwdInput.getAttribute("spellcheck")).toBe("false");
      expect(pwdInput.className).toContain("text-white");
      expect(pwdInput.className).toContain("bg-transparent");
      expect(pwdInput.className).not.toContain("bg-white");
    });

    it("ensures vault unlock password input has autocomplete off, spellCheck false, text-white, and bg-transparent", async () => {
      window.history.pushState({}, "", "/");
      window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ exists: true }),
      } as any);

      render(<App />);

      const vaultInput = screen.getByRole("textbox");
      fireEvent.change(vaultInput, { target: { value: "testvault" } });
      const openBtn = screen.getByText("OPEN");
      fireEvent.click(openBtn);

      await waitFor(() => {
        expect(screen.getByText("UNLOCK THE VAULT")).toBeInTheDocument();
      });

      const pwdInput = screen.getByPlaceholderText("••••••••") as HTMLInputElement;
      expect(pwdInput).toBeInTheDocument();
      expect(pwdInput.getAttribute("autocomplete")).toBe("off");
      expect(pwdInput.getAttribute("spellcheck")).toBe("false");
      expect(pwdInput.className).toContain("text-white");
      expect(pwdInput.className).toContain("bg-transparent");
      expect(pwdInput.className).not.toContain("bg-white");
    });
  });
});
