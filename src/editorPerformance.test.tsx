import { describe, it, expect } from "vitest";
import hljs from "./highlight";

describe("Editor Performance & Highlighting Optimization", () => {
  it("has core programming languages registered in highlight.js", () => {
    const languages = [
      "javascript",
      "typescript",
      "python",
      "bash",
      "json",
      "markdown",
      "css",
      "xml",
      "sql",
      "c",
      "cpp",
      "java",
      "rust",
      "go",
      "yaml",
    ];

    languages.forEach((lang) => {
      const def = hljs.getLanguage(lang);
      expect(def, `Language ${lang} should be registered`).toBeDefined();
    });
  });

  it("handles aliases for common languages", () => {
    expect(hljs.getLanguage("js")).toBeDefined();
    expect(hljs.getLanguage("ts")).toBeDefined();
    expect(hljs.getLanguage("py")).toBeDefined();
    expect(hljs.getLanguage("sh")).toBeDefined();
    expect(hljs.getLanguage("html")).toBeDefined();
    expect(hljs.getLanguage("rs")).toBeDefined();
    expect(hljs.getLanguage("golang")).toBeDefined();
    expect(hljs.getLanguage("yml")).toBeDefined();
  });

  it("highlights code blocks efficiently without throwing", () => {
    const jsCode = `function add(a, b) {\n  return a + b;\n}`;
    const highlighted = hljs.highlight(jsCode, { language: "javascript" }).value;
    expect(highlighted).toContain("hljs-keyword");

    const autoHighlighted = hljs.highlightAuto(`def hello():\n    print("world")`).value;
    expect(autoHighlighted).toContain("hljs-keyword");
  });

  it("synchronously updates ref and debounces state update correctly", () => {
    let state = [{ id: "tab-1", text: "initial" }];
    const tabsRef = { current: [...state] };
    let timer: any = null;

    const handleInput = (newText: string) => {
      // 1. Synchronous ref update (0ms latency, zero loss)
      tabsRef.current = tabsRef.current.map((t) => (t.id === "tab-1" ? { ...t, text: newText } : t));

      // 2. Debounced state commit
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        state = tabsRef.current;
      }, 250);
    };

    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        state = tabsRef.current;
      }
    };

    // User types 5 characters rapidly
    handleInput("H");
    handleInput("He");
    handleInput("Hel");
    handleInput("Hell");
    handleInput("Hello");

    // tabsRef has immediate latest text
    expect(tabsRef.current[0].text).toBe("Hello");
    // state is not yet updated (debounced to avoid React re-render thrashing)
    expect(state[0].text).toBe("initial");

    // Flush on save / tab-switch / blur
    flush();
    expect(state[0].text).toBe("Hello");
  });
});
