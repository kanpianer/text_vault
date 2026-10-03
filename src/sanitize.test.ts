import { describe, it, expect } from "vitest";
import { sanitizeEditorHtml, isSafeHref, escapeHtml } from "./sanitize";

function parse(html: string): HTMLElement {
  const div = document.createElement("div");
  // Parsing sanitized output in a detached div is safe for assertions.
  div.innerHTML = html;
  return div;
}

describe("sanitizeEditorHtml - XSS payloads", () => {
  const payloads: Array<[string, string]> = [
    ["img onerror", `<p><img src="x" onerror="alert(1)"></p>`],
    ["script tag", `<p>hi</p><script>alert(1)</script>`],
    ["svg onload", `<svg onload="alert(1)"><circle /></svg>`],
    ["iframe", `<iframe src="javascript:alert(1)"></iframe>`],
    ["javascript href", `<a href="javascript:alert(1)">x</a>`],
    ["entity-obfuscated javascript href", `<a href="jav&#x09;ascript:alert(1)">x</a>`],
    ["details ontoggle", `<details open ontoggle="alert(1)"><summary>s</summary></details>`],
    ["style tag", `<style>body{display:none}</style><p>x</p>`],
    ["form phishing", `<form action="https://evil.example"><input type="password" name="p"><button>Go</button></form>`],
    ["object/embed", `<object data="evil.swf"></object><embed src="evil.swf">`],
    ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.example">`],
    ["base tag", `<base href="https://evil.example/">`],
    ["math", `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`],
  ];

  for (const [name, payload] of payloads) {
    it(`neutralizes ${name}`, () => {
      const out = sanitizeEditorHtml(payload);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/\son[a-z]+\s*=/i);
      expect(out).not.toMatch(/javascript:/i);
      expect(out).not.toMatch(/<(iframe|svg|math|style|form|button|object|embed|meta|base)\b/i);
    });
  }

  it("removes non-checkbox inputs", () => {
    const root = parse(sanitizeEditorHtml(`<p><input type="password"><input type="text"><input type="checkbox" checked></p>`));
    const inputs = root.querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].getAttribute("type")).toBe("checkbox");
  });

  it("strips overlay / remote-loading inline styles", () => {
    const root = parse(sanitizeEditorHtml(
      `<div style="position:fixed;inset:0;z-index:9999">fake</div><p style="background:url(https://evil.example/t.png)">x</p>`
    ));
    root.querySelectorAll("[style]").forEach((el) => {
      expect(el.getAttribute("style")).not.toMatch(/position|url\(/i);
    });
  });

  it("forces safe link targets and rejects non-http protocols", () => {
    const root = parse(sanitizeEditorHtml(`<a href="https://example.com">ok</a><a href="vbscript:x">bad</a><a href="file:///etc/passwd">bad2</a>`));
    const links = root.querySelectorAll("a");
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[1].getAttribute("href") ?? "").not.toMatch(/vbscript/i);
    expect(links[2].getAttribute("href") ?? "").not.toMatch(/^file:/i);
  });

  it("only allows http(s) and raster data images", () => {
    const root = parse(sanitizeEditorHtml(
      `<img src="https://example.com/a.png"><img src="data:image/png;base64,iVBORw0KGgo="><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="javascript:alert(1)">`
    ));
    const imgs = root.querySelectorAll("img");
    expect(imgs[0].getAttribute("src")).toBe("https://example.com/a.png");
    expect(imgs[1].getAttribute("src")).toMatch(/^data:image\/png/);
    expect(imgs[2].getAttribute("src")).toBeNull();
    expect(imgs[3].getAttribute("src")).toBeNull();
  });
});

describe("sanitizeEditorHtml - preserves legitimate editor content", () => {
  it("keeps headings, formatting, lists, quotes and alignment", () => {
    const html =
      `<h1>Title</h1><h2>Sub</h2><p style="text-align: center;"><b>bold</b> <i>it</i> <u>u</u> <strike>s</strike></p>` +
      `<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><hr>`;
    expect(sanitizeEditorHtml(html)).toBe(html);
  });

  it("keeps task checkboxes with contenteditable", () => {
    const html = `<p class="task-done"><input type="checkbox" checked="" style="margin-right:8px" contenteditable="false">done</p>`;
    const root = parse(sanitizeEditorHtml(html));
    const cb = root.querySelector("input")!;
    expect(cb.getAttribute("contenteditable")).toBe("false");
    expect(cb.hasAttribute("checked")).toBe(true);
    expect(root.querySelector("p")!.className).toBe("task-done");
  });

  it("keeps toggles, tables and highlighted code blocks", () => {
    const html =
      `<details open=""><summary class="toggle-summary">T</summary><p>body</p></details>` +
      `<div style="overflow-x:auto;max-width:100%;margin:1rem 0"><table style="border-collapse:collapse;width:100%;text-align:left"><tbody><tr><td>a</td></tr></tbody></table></div>` +
      `<pre data-line-numbers="true"><code class="language-js"><span class="hljs-keyword">const</span> a = 1;</code></pre>`;
    expect(sanitizeEditorHtml(html)).toBe(html);
  });

  it("keeps images with editor attributes", () => {
    const html = `<img src="https://example.com/a.png" alt="a" class="max-w-full" contenteditable="false" draggable="false" style="user-select: none;">`;
    expect(sanitizeEditorHtml(html)).toBe(html);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeEditorHtml("")).toBe("");
    expect(sanitizeEditorHtml(undefined)).toBe("");
  });
});

describe("isSafeHref / escapeHtml", () => {
  it("allows only http(s) and mailto", () => {
    expect(isSafeHref("https://a.com")).toBe(true);
    expect(isSafeHref("http://a.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.c")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref(" JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,x")).toBe(false);
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref(null)).toBe(false);
  });

  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
  });
});
