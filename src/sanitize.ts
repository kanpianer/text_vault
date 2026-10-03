import DOMPurify from "dompurify";

/**
 * Security helpers for rendering untrusted HTML inside the editor.
 *
 * Every piece of HTML that reaches `innerHTML` (decrypted vault tabs, shared
 * documents created by third parties, imported .md/.zip files) MUST go through
 * `sanitizeEditorHtml` first. Content may be authored by an attacker (e.g. a
 * crafted share link), so it is treated as untrusted even after decryption.
 */

// Tags that are never legitimate editor content and widen the attack surface
// (phishing forms, embedded documents, CSS injection, SVG/MathML parser quirks).
const FORBIDDEN_TAGS = [
  "script", "style", "link", "meta", "base", "title",
  "iframe", "frame", "frameset", "object", "embed", "applet", "portal",
  "form", "button", "select", "option", "textarea", "fieldset", "dialog",
  "svg", "math", "template", "noscript", "audio", "video", "source", "track",
];

const FORBIDDEN_ATTRS = [
  "formaction", "action", "srcdoc", "srcset", "ping", "background", "poster",
  "xlink:href", "autofocus", "name", "form",
];

// Inline styles are needed for alignment / indentation / checkbox spacing, but
// some declarations can be abused for UI redressing (full-screen overlays used
// for phishing) or for loading remote resources.
const DANGEROUS_STYLE_RE = /(position\s*:\s*(fixed|absolute|sticky))|url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|z-index/i;

const SAFE_HREF_RE = /^(https?:|mailto:)/i;

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    // Only checkbox inputs are part of the editor model (task lists).
    if (data.tagName === "input") {
      const el = node as Element;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type !== "checkbox") {
        el.parentNode?.removeChild(el);
      }
    }
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (!el || typeof el.getAttribute !== "function") return;

    const style = el.getAttribute("style");
    if (style && DANGEROUS_STYLE_RE.test(style)) {
      el.removeAttribute("style");
    }

    if (el.tagName === "A") {
      const href = (el.getAttribute("href") || "").trim();
      if (href && !SAFE_HREF_RE.test(href)) {
        el.setAttribute("href", "#");
      }
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }

    if (el.tagName === "IMG") {
      const src = (el.getAttribute("src") || "").trim();
      // Allow http(s) and raster data URIs only; svg data URIs are blocked.
      if (src && !/^(https?:|data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,)/i.test(src)) {
        el.removeAttribute("src");
      }
    }
  });
}

/**
 * Sanitize HTML before it is assigned to the editor's innerHTML.
 * Preserves the structures the editor produces (headings, lists, task
 * checkboxes, toggles, tables, highlighted code blocks, images, links).
 */
export function sanitizeEditorHtml(html: string | null | undefined): string {
  if (!html) return "";
  installHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRS,
    ADD_ATTR: ["contenteditable", "target", "draggable", "open", "checked"],
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: false,
    KEEP_CONTENT: true,
  }) as string;
}

/** Only http(s) and mailto links may be opened from the editor. */
export function isSafeHref(url: string | null | undefined): boolean {
  if (!url) return false;
  return SAFE_HREF_RE.test(url.trim());
}

/** Escape text for safe interpolation into HTML strings (text or attribute). */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
