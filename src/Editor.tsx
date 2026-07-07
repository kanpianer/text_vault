import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { marked } from "marked";
import {
  calculateSelectionPosition,
  calculateEmptyLinePositionLeft,
} from "./toolbarPosition";

// ── style definitions ──────────────────────────────────────────────

const EDITOR_CLASS =
  "editor-body w-full min-h-[500px] outline-none text-zinc-300 text-base md:text-lg leading-relaxed pt-2";

const EMPTY_LINE_TOOLS = ["Text", "H1", "H2", "H3", "Task", "List", "Quote", "Image", "Code", "Line", "Center", "Table"] as const;
const SELECTION_TOOLS = ["Text", "Bold", "Italic", "Strike", "Under", "Quote", "Link", "Center", "Code"] as const;

type Tool = (typeof EMPTY_LINE_TOOLS)[number] | (typeof SELECTION_TOOLS)[number];

interface TocItem {
  index: number;
  level: number;
  title: string;
  barWidthRem: number;
}

// ── helpers ─────────────────────────────────────────────────────────

export function normalizeEditorNodes(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll("img").forEach((img) => {
    img.setAttribute("contenteditable", "false");
    img.setAttribute("draggable", "false");
    (img as HTMLElement).style.userSelect = "none";
    (img as HTMLElement).style.webkitUserSelect = "none";
  });
  root.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

function getCurrentBlock(root: HTMLElement, node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  while (el && el !== root && !["P","DIV","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","PRE","LI","UL","OL"].includes(el.tagName)) {
    el = el.parentElement;
  }
  return el && el !== root ? el : null;
}

function getTocBarWidthRem(title: string, level: number) {
  const baseWidth = level === 1 ? 0.21 : level === 2 ? 0.18 : 0.144;
  return Math.min(1.05, baseWidth + title.length * 0.013);
}

function collectEditorHeadings(root: HTMLElement): TocItem[] {
  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));

  return headings
    .map((heading, index) => {
      const title = (heading.textContent || "").replace(/\s+/g, " ").trim();
      const level = Number(heading.tagName.substring(1)) || 1;
      const barWidthRem = getTocBarWidthRem(title, level);
      return { index, level, title, barWidthRem };
    })
    .filter((item) => item.title.length > 0);
}

// ── toolbar actions ─────────────────────────────────────────────────

function applyBlock(editorEl: HTMLElement, tag: string) {
  editorEl.focus();
  document.execCommand("formatBlock", false, tag);
}

function applyAlign(align: string) {
  document.execCommand("justify" + align, false);
}

function insertTaskBlock(el: HTMLElement) {
  const sel = window.getSelection();
  const block = getCurrentBlock(el, sel?.anchorNode || el);
  const tag = block ? block.tagName.toLowerCase() : "p";
  const cb = block?.querySelector('input[type="checkbox"]');
  if (cb) { document.execCommand("insertUnorderedList", false); return; }
  const p = document.createElement(tag);
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.style.marginRight = "8px";
  inp.setAttribute("contenteditable", "false");
  p.appendChild(inp);
  const zw = document.createTextNode("\u200B");
  p.appendChild(zw);
  if (block?.parentNode) {
    block.parentNode.insertBefore(p, block.nextSibling);
  } else {
    el.appendChild(p);
  }
  const r = document.createRange();
  r.setStartAfter(zw);
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

function insertTableBlock(rows: number, cols: number) {
  let html =
    '<div style="overflow-x:auto;max-width:100%;margin:1rem 0"><table style="border-collapse:collapse;width:100%;text-align:left">';
  for (let r = 0; r < rows; r++) {
    html += "<tr>";
    for (let c = 0; c < cols; c++) {
      const tag = r === 0 ? "th" : "td";
      const bg = r === 0 ? 'background:rgba(39,39,42,0.5)' : "";
      html += `<${tag} style="border:1px solid #3f3f46;padding:0.5rem;${bg}"><br></${tag}>`;
    }
    html += "</tr>";
  }
  html += "</table></div><p><br></p>";
  document.execCommand("insertHTML", false, html);
}

function handleToolClick(tool: Tool, editorEl: HTMLElement) {
  editorEl.focus();
  const sel = window.getSelection();
  const hasSel = sel && !sel.isCollapsed;

  switch (tool) {
    case "H1":     applyBlock(editorEl, "H1"); break;
    case "H2":     applyBlock(editorEl, "H2"); break;
    case "H3":     applyBlock(editorEl, "H3"); break;
    case "Task":   insertTaskBlock(editorEl); break;
    case "List":   document.execCommand("insertUnorderedList", false); break;
    case "Quote":  applyBlock(editorEl, "blockquote"); break;

    case "Code":
      if (hasSel) {
        document.execCommand(
          "insertHTML",
          false,
          `<code class="bg-zinc-800 text-red-400 px-1 py-0.5 rounded font-mono text-xs">${sel?.toString()}</code>`
        );
      } else {
        applyBlock(editorEl, "PRE");
      }
      break;
    case "Bold":   document.execCommand("bold", false); break;
    case "Italic": document.execCommand("italic", false); break;
    case "Strike": document.execCommand("strikeThrough", false); break;
    case "Under":  document.execCommand("underline", false); break;
    case "Line":   document.execCommand("insertHorizontalRule", false); break;
    case "Center": applyAlign("Center"); break;
    case "Text":
      document.execCommand("removeFormat", false);
      applyBlock(editorEl, "P");
      break;
  }
}

// ── markdown patterns ───────────────────────────────────────────────

interface PatternMatch {
  type: "heading" | "quote" | "list" | "olist" | "task" | "codeblock" | "center";
  level?: number;
}

function detectLineStartPattern(textBefore: string): PatternMatch | null {
  if (/^#{1,6}$/.test(textBefore)) return { type: "heading", level: textBefore.length };
  if (/^>$/.test(textBefore)) return { type: "quote" };
  if (/^[-*]$/.test(textBefore)) return { type: "list" };
  if (/^1\.$/.test(textBefore)) return { type: "olist" };
  if (/^\[\s?\]$/.test(textBefore)) return { type: "task" };
  if (/^```$/.test(textBefore) || /^    $/.test(textBefore)) return { type: "codeblock" };
  if (/^->$/.test(textBefore)) return { type: "center" };
  return null;
}

interface InlineMatch {
  type: "bold" | "italic" | "strike" | "underline" | "code" | "image" | "link";
  content: string;
  url?: string;
}

function detectInlinePattern(textBefore: string): InlineMatch | null {
  let m: RegExpMatchArray | null;
  m = textBefore.match(/!\[([^\]]*)\]\(([^)]+)\)$/);
  if (m) return { type: "image", content: m[1], url: m[2] };
  m = textBefore.match(/(^|[^!])\[([^\]]+)\]\(([^)]+)\)$/);
  if (m) return { type: "link", content: m[2], url: m[3] };
  m = textBefore.match(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/);
  if (m) return { type: "bold", content: m[1] };
  m = textBefore.match(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)$/);
  if (m) return { type: "italic", content: m[1] };
  m = textBefore.match(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)$/);
  if (m) return { type: "italic", content: m[1] };
  m = textBefore.match(/~~([^~]+)~~$/);
  if (m) return { type: "strike", content: m[1] };
  m = textBefore.match(/<u>([^<]+)<\/u>$/);
  if (m) return { type: "underline", content: m[1] };
  m = textBefore.match(/`([^`]+)`$/);
  if (m) return { type: "code", content: m[1] };
  return null;
}

// ── component ───────────────────────────────────────────────────────

export function Editor({ activeTabId, initialContent, onChange, editorRef, readOnly, onActiveChange, scrollProgress = 0 }: any) {
  const previousTabId = useRef(activeTabId);
  const isFirstRender = useRef(true);
  const [isActive, setIsActive] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarScrollRef = useRef<HTMLDivElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [showImageInput, setShowImageInput] = useState(false);

  const [imageValue, setImageValue] = useState("");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const inputOpenTimeRef = useRef(0);

  const [showTableInput, setShowTableInput] = useState(false);

  const [tableRowValue, setTableRowValue] = useState("");

  const [tableColValue, setTableColValue] = useState("3");

  const tableRowRef = useRef<HTMLInputElement>(null);

  const tableColRef = useRef<HTMLInputElement>(null);

  const toolbarPosRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 });

  const savedRangeRef = useRef<Range | null>(null);
  const isActiveRef = useRef(isActive);

  // floating toolbar state
  const [toolbarStyle, setToolbarStyle] = useState<React.CSSProperties>({ position: "absolute", opacity: 0, pointerEvents: "none" });
  const hideToolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number>(-1);

  // ── tab switching / content init ──────────────────────────────────

  useLayoutEffect(() => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;
    if (activeTabId !== previousTabId.current || isFirstRender.current) {
      el.innerHTML = initialContent || "<p><br></p>";
      normalizeEditorNodes(el);
      previousTabId.current = activeTabId;
      isFirstRender.current = false;
    } else {
      const hasFocus = document.activeElement === el || el.contains(document.activeElement);
      if (!hasFocus && el.innerHTML !== initialContent) {
        el.innerHTML = initialContent || "<p><br></p>";
        normalizeEditorNodes(el);
      }
    }
  }, [activeTabId, initialContent, editorRef]);

  // ── focus on activate ─────────────────────────────────────────────

  useEffect(() => {
    if (isActive && editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.focus({ preventScroll: true });
    }
  }, [isActive, editorRef]);

  useEffect(() => { if (readOnly) setIsActive(false); }, [readOnly]);
  useEffect(() => { setIsActive(false); setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" }); }, [activeTabId]);
  useEffect(() => { onActiveChange?.(isActive && !readOnly); }, [isActive, readOnly, onActiveChange]);
  isActiveRef.current = isActive;

  const updateToc = useCallback(() => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;
    setTocItems(collectEditorHeadings(el));
  }, [editorRef]);

  useEffect(() => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;

    let frameId = window.requestAnimationFrame(updateToc);
    const scheduleTocUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateToc);
    };
    const observer = new MutationObserver(scheduleTocUpdate);

    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener("resize", scheduleTocUpdate);
    window.addEventListener("load", scheduleTocUpdate);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleTocUpdate);
      window.removeEventListener("load", scheduleTocUpdate);
    };
  }, [activeTabId, initialContent, editorRef, updateToc]);

  useEffect(() => {
    const handleScroll = () => {
      const el = editorRef.current as HTMLElement | null;
      if (!el || tocItems.length === 0) return;

      const headings = Array.from(el.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
      let newActiveIndex = -1;

      for (let i = 0; i < tocItems.length; i++) {
        const item = tocItems[i];
        const headingEl = headings[item.index];
        if (headingEl) {
          const rect = headingEl.getBoundingClientRect();
          if (rect.top <= window.innerHeight * 0.3) {
            newActiveIndex = item.index;
          } else {
            break;
          }
        }
      }
      
      if (window.scrollY < 50) {
        newActiveIndex = -1;
      }
      
      setActiveHeadingIndex(newActiveIndex);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, [tocItems, editorRef]);

  const scrollToTocHeading = useCallback((index: number) => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;
    const heading = Array.from(el.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"))[index];
    if (!heading) return;

    const editorTop = el.getBoundingClientRect().top + window.scrollY;
    const headingTop = heading.getBoundingClientRect().top + window.scrollY;
    
    if (index === 0 && headingTop - editorTop < 100) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const topPadding = Math.max(16, headingTop - editorTop < 40 ? 8 : 88);
    window.scrollTo({
      top: Math.max(0, headingTop - topPadding),
      behavior: "smooth",
    });
  }, [editorRef]);

  // ── toolbar position updater ──────────────────────────────────────

  const updateToolbar = useCallback(() => {

    const el = editorRef.current as HTMLElement | null;

    if (!el || readOnly) return;

    if (!isActiveRef.current) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" }); return; }

    const range = sel.getRangeAt(0);
    const container = el.parentElement as HTMLElement;
    if (!container) return;

    const tw = toolbarRef.current?.offsetWidth || 320;
    const selecting = !sel.isCollapsed;
    setHasSelection(selecting);

    if (selecting) {
      // text selected → show below last line of selection
      const pos = calculateSelectionPosition(range, container, tw);
      toolbarPosRef.current = { top: pos.top, left: pos.left };
      setToolbarStyle({ position: "absolute", top: pos.top, left: pos.left, opacity: 1, pointerEvents: "auto" });
    } else {
      // cursor on empty line → show left-aligned
      const node = range.startContainer;
      const block = getCurrentBlock(el, node);
      if (block) {
        const text = (block.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
        if (text === "") {
          const blockRect = block.getBoundingClientRect();
          const pos = calculateEmptyLinePositionLeft(blockRect, container, tw);
          toolbarPosRef.current = { top: pos.top, left: pos.left };
          setToolbarStyle({ position: "absolute", top: pos.top, left: pos.left, opacity: 1, pointerEvents: "auto" });
          return;
        }
      }
      setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
    }
  }, [editorRef, readOnly]);

  // ── schedule toolbar hide ─────────────────────────────────────────

  const scheduleHideToolbar = useCallback(() => {
    if (hideToolbarTimer.current) clearTimeout(hideToolbarTimer.current);
    hideToolbarTimer.current = setTimeout(() => {
      setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
    }, 300);
  }, []);

  // ── link submission ───────────────────────────────────────────────

  const handleLinkSubmit = (url: string) => {
    const el = editorRef.current as HTMLElement | null;
    if (!el || !url) return;
    const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    // restore saved selection before creating link
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    // reactivate editor (may have been deactivated when focus moved to link input)
    if (!isActive && !readOnly) {
      el.contentEditable = "true";
      setIsActive(true);
    }
    el.focus();
    document.execCommand("createLink", false, finalUrl);
    normalizeEditorNodes(el);
    onChange(el.innerHTML, el);
    setShowLinkInput(false);
    setLinkValue("");
    setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
    savedRangeRef.current = null;
  };

  // ── image submission ──────────────────────────────────────────────

  const handleImageSubmit = (url: string) => {
    const el = editorRef.current as HTMLElement | null;
    if (!el || !url) return;

    // reactivate editor if focus was lost to the image input
    if (!isActive && !readOnly) {
      el.contentEditable = "true";
      setIsActive(true);
    }

    // restore saved cursor position before inserting image
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    const html = `<img src="${url}" class="max-w-full rounded border border-zinc-800 my-2 block" contenteditable="false" draggable="false" style="user-select:none;-webkit-user-select:none">`;
    el.focus();
    document.execCommand("insertHTML", false, html);
    normalizeEditorNodes(el);
    onChange(el.innerHTML, el);
    setShowImageInput(false);
    setImageValue("");
    setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
    savedRangeRef.current = null;
  };

  // ── table submission ──────────────────────────────────────────────

  const handleTableSubmit = () => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;
    const rows = Math.max(3, Math.min(30, parseInt(tableRowValue) || 3));
    const cols = Math.max(3, Math.min(15, parseInt(tableColValue) || 3));

    if (!isActive && !readOnly) {
      el.contentEditable = "true";
      setIsActive(true);
    }

    // restore saved cursor position before inserting table
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    el.focus();
    insertTableBlock(rows, cols);
    normalizeEditorNodes(el);
    onChange(el.innerHTML, el);
    setShowTableInput(false);
    setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
    savedRangeRef.current = null;
  };

  // ── selectionchange: show toolbar on mobile text selection ────────

  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current as HTMLElement | null;
      if (!el || readOnly || !isActive) return;
      const sel = window.getSelection();
      // only respond to non-collapsed selections (text is selected)
      if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) {
        updateToolbar();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [isActive, readOnly, updateToolbar]);

  // ── beforeinput: handle enter in pre / quote / task ───────────────

  useEffect(() => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;

    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "insertLineBreak" && e.inputType !== "insertParagraph") return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      let node: Node | null = range.startContainer;

      // pre block: insert literal newline
      let curr: HTMLElement | null =
        node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      while (curr && curr !== el) {
        if (curr.tagName === "PRE") {
          e.preventDefault();
          document.execCommand("insertText", false, "\n");
          onChange(el.innerHTML, el);
          return;
        }
        curr = curr.parentElement;
      }

      const block = getCurrentBlock(el, node);
      if (!block) return;

      // quote
      if (block.tagName === "BLOCKQUOTE") {
        if ((block.textContent || "").trim() === "") {
          e.preventDefault();
          document.execCommand("formatBlock", false, "P");
          return;
        }
        e.preventDefault();
        const br = document.createElement("br");
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        onChange(el.innerHTML, el);
        return;
      }

      // task
      const cb = block.querySelector('input[type="checkbox"]');
      if (cb) {
        const raw = (block.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
        if (raw.trim() === "") {
          e.preventDefault();
          cb.remove();
          if (!block.textContent?.trim()) block.innerHTML = "<br>";
          const r = document.createRange();
          r.selectNodeContents(block);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          onChange(el.innerHTML, el);
          return;
        }
        // auto-create next task
        e.preventDefault();
        const newBlock = document.createElement(block.tagName.toLowerCase());
        const newCb = document.createElement("input");
        newCb.type = "checkbox";
        newCb.style.marginRight = "8px";
        newCb.setAttribute("contenteditable", "false");
        const zw = document.createTextNode("\u200B");
        newBlock.appendChild(newCb);
        newBlock.appendChild(zw);
        if (range.startContainer === block) {
          const kids = Array.from(block.childNodes);
          for (let i = range.startOffset; i < kids.length; i++) newBlock.appendChild(kids[i]);
        } else {
          const tn = range.startContainer as Text;
          const after = tn.textContent?.substring(range.startOffset) || "";
          tn.textContent = tn.textContent?.substring(0, range.startOffset) || "";
          let sib = tn.nextSibling;
          while (sib) { const n = sib.nextSibling; newBlock.appendChild(sib); sib = n; }
          if (after) newBlock.appendChild(document.createTextNode(after));
        }
        block.parentNode?.insertBefore(newBlock, block.nextSibling);
        const r = document.createRange();
        r.setStartAfter(zw);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);

        onChange(el.innerHTML, el);

        return;

      }



      // empty list item → exit list

      if (block.tagName === "LI") {

        const raw = (block.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();

        if (raw === "") {

          e.preventDefault();

          document.execCommand("outdent", false);

          onChange(el.innerHTML, el);

          return;

        }

      }

    };

    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [onChange, editorRef]);

  // ── paste: parse markdown to styled HTML ──────────────────────────

  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    let html = await marked.parse(text, { breaks: true });
    html = html.replace(
      /<input disabled="" type="checkbox">/gi,
      '<input type="checkbox" style="margin-right:8px" contenteditable="false">'
    );
    html = html.replace(
      /<input checked="" disabled="" type="checkbox">/gi,
      '<input type="checkbox" checked style="margin-right:8px" contenteditable="false">'
    );
    document.execCommand("insertHTML", false, html);
    normalizeEditorNodes(editorRef.current);
    onChange(editorRef.current.innerHTML, editorRef.current);
  };

  // ── keydown: markdown shortcuts ───────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {

    const el = editorRef.current as HTMLElement | null;

    if (!el || readOnly) return;



    // Backspace / Delete: remove adjacent image

    if (e.key === "Backspace" || e.key === "Delete") {

      const sel = window.getSelection();

      if (sel && sel.isCollapsed && sel.rangeCount > 0) {

        const range = sel.getRangeAt(0);

        const dir = e.key === "Backspace" ? "backward" : "forward";



        // walk DOM from cursor to find an adjacent image

        let node: Node | null = range.startContainer;

        const offset = range.startOffset;



        // find the sibling node adjacent to cursor

        let candidate: Node | null = null;

        if (node.nodeType === Node.TEXT_NODE) {

          const text = node.textContent || "";

          const checkStr = dir === "backward" ? text.substring(0, offset) : text.substring(offset);

          if (checkStr.trim().length === 0) {

            candidate = dir === "backward" ? node.previousSibling : node.nextSibling;

          }

        } else if (node.nodeType === Node.ELEMENT_NODE) {

          const children = node.childNodes;

          const idx = dir === "backward" ? offset - 1 : offset;

          if (idx >= 0 && idx < children.length) candidate = children[idx];

        }



        // check if candidate is an image

        let img: HTMLImageElement | null = null;

        if (candidate) {

          if (candidate.nodeName === "IMG") img = candidate as HTMLImageElement;

          else {

            // traverse into the candidate

            let cur: Node | null = candidate;

            while (cur) {

              if (cur.nodeName === "IMG") { img = cur as HTMLImageElement; break; }

              if (cur.nodeType === Node.TEXT_NODE && (cur.textContent || "").trim().length > 0) break;

              cur = dir === "backward" ? cur.lastChild : cur.firstChild;

            }

          }

        }



        if (img) {

          e.preventDefault();

          img.remove();

          normalizeEditorNodes(el);

          onChange(el.innerHTML, el);

          setTimeout(updateToolbar, 0);

          return;

        }

      }

    }



    if (e.key === " ") {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const node = sel.getRangeAt(0).startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;
      const text = node.textContent || "";
      const offset = sel.getRangeAt(0).startOffset;
      const textBefore = text.substring(0, offset);

      // inline patterns
      const inline = detectInlinePattern(textBefore);
      if (inline) {
        e.preventDefault();
        const matchedLen = (() => {
          switch (inline.type) {
            case "bold": return inline.content.length + 4;
            case "italic": return inline.content.length + 2;
            case "strike": return inline.content.length + 4;
            case "underline": return inline.content.length + 7;
            case "code": return inline.content.length + 2;
            case "image": return inline.content.length + (inline.url?.length || 0) + 5;
            case "link": return inline.content.length + (inline.url?.length || 0) + 4;
          }
        })();
        const startIdx = offset - matchedLen;
        const before = text.substring(0, startIdx);
        const after = text.substring(offset);
        (node as Text).textContent = before;

        let html = "";
        switch (inline.type) {
          case "bold": html = `<b>${inline.content}</b>`; break;
          case "italic": html = `<i>${inline.content}</i>`; break;
          case "strike": html = `<strike>${inline.content}</strike>`; break;
          case "underline": html = `<u>${inline.content}</u>`; break;
          case "code": html = `<code class="bg-zinc-800 text-red-400 px-1 py-0.5 rounded font-mono text-xs">${inline.content}</code>`; break;
          case "image": html = `<img src="${inline.url}" alt="${inline.content}" class="max-w-full rounded border border-zinc-800 my-2 block" contenteditable="false" draggable="false" style="user-select:none;-webkit-user-select:none">`; break;
          case "link": html = `<a href="${inline.url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline cursor-pointer">${inline.content}</a>`; break;
        }

        const tail = document.createTextNode("\u200B" + after);
        const parent = node.parentNode;
        const next = node.nextSibling;
        const tpl = document.createElement("span");
        tpl.innerHTML = html;
        while (tpl.firstChild) parent?.insertBefore(tpl.firstChild, next);
        parent?.insertBefore(tail, next);

        const r = document.createRange();
        r.setStart(tail, 1);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        normalizeEditorNodes(el);
        onChange(el.innerHTML, el);
        return;
      }

      // line-start patterns
      const pattern = detectLineStartPattern(textBefore);
      if (pattern) {
        e.preventDefault();
        (node as Text).textContent = text.substring(offset);
        const block = getCurrentBlock(el, node);
        if (block) {
          const r = document.createRange();
          r.selectNodeContents(block);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);

          switch (pattern.type) {
            case "heading": document.execCommand("formatBlock", false, `H${pattern.level}`); break;
            case "quote": document.execCommand("formatBlock", false, "blockquote"); break;
            case "list": document.execCommand("insertUnorderedList", false); break;
            case "olist": document.execCommand("insertOrderedList", false); break;
            case "task": {
              document.execCommand("formatBlock", false, "P");
              const b2 = getCurrentBlock(el, node) || block;
              const cb = document.createElement("input");
              cb.type = "checkbox";
              cb.style.marginRight = "8px";
              cb.setAttribute("contenteditable", "false");
              const zw = document.createTextNode("\u200B");
              const tailText = text.substring(offset);
              b2.innerHTML = "";
              b2.appendChild(cb);
              b2.appendChild(zw);
              if (tailText) b2.appendChild(document.createTextNode(tailText));
              const rr = document.createRange();
              rr.setStartAfter(zw);
              rr.collapse(true);
              sel.removeAllRanges();
              sel.addRange(rr);
              break;
            }
            case "codeblock": document.execCommand("formatBlock", false, "PRE"); document.execCommand("insertHTML", false, "\n"); break;
            case "center": block.style.textAlign = "center"; break;
          }
        }
        onChange(el.innerHTML, el);
      }
    }

    // update toolbar on any key that might change selection
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Backspace", "Delete"].includes(e.key)) {
      setTimeout(updateToolbar, 0);
    }
  };

  // ── mouse / selection events for floating toolbar ─────────────────

  const handleMouseUp = () => {
    setTimeout(updateToolbar, 0);
  };

  const handleKeyUp = () => {
    updateToolbar();
  };

  // ── click: activate editor ────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG") {
      e.preventDefault();
      return;
    }
    if (!isActive && !readOnly) {
      editorRef.current.contentEditable = "true";
      editorRef.current.focus({ preventScroll: true });
      setIsActive(true);
    }
  };

  // ── touch: detect tap to activate ─────────────────────────────────

  const touchRef = useRef({ startX: 0, startY: 0, startTime: 0, hasMoved: false });

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG") { e.preventDefault(); return; }
    const tc = e.touches[0];
    touchRef.current = { startX: tc.clientX, startY: tc.clientY, startTime: Date.now(), hasMoved: false };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const tc = e.touches[0];
    if (Math.abs(tc.clientX - touchRef.current.startX) > 15 || Math.abs(tc.clientY - touchRef.current.startY) > 15) {
      touchRef.current.hasMoved = true;
    }
  };

  const handleTouchEnd = () => {
    const { startTime, hasMoved } = touchRef.current;
    if (!hasMoved && Date.now() - startTime < 300 && !isActive && !readOnly) {
      editorRef.current.contentEditable = "true";
      editorRef.current.focus({ preventScroll: true });
      setIsActive(true);
      setTimeout(updateToolbar, 100);
    }
  };

  // ── blur: deactivate ──────────────────────────────────────────────

  const handleBlur = () => {
    if (!readOnly) setIsActive(false);
  };

  // ── toolbar scroll ────────────────────────────────────────────────

  const scrollToolbar = (direction: "left" | "right") => {
    const el = toolbarScrollRef.current;
    if (!el) return;
    const amount = direction === "left" ? -120 : 120;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  // ── render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col w-full relative">
      {/* Editor body */}
      <div
        ref={editorRef}
        className={EDITOR_CLASS}
        contentEditable={isActive && !readOnly}
        suppressContentEditableWarning
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onKeyUp={handleKeyUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPaste={handlePaste}
        onInput={(e) => {
          normalizeEditorNodes(e.currentTarget);
          onChange(e.currentTarget.innerHTML, editorRef.current);
        }}
        onKeyDown={handleKeyDown}

        onBlur={handleBlur}

        onClick={(e) => {

          const target = e.target as HTMLElement;

          const anchor = target.closest("a[href]") as HTMLAnchorElement | null;

          if (anchor) {

            e.preventDefault();

            e.stopPropagation();

            window.open(anchor.href, "_blank", "noopener,noreferrer");

          }

        }}

      />

      {tocItems.length > 0 && (
        <nav className="editor-toc relative" aria-label="Document headings">
          <div 
            className="absolute right-0 w-[1px] rounded-full z-[-1]" 
            style={{ 
              top: 'calc(0.25rem + 1px)',
              height: `calc((100% - 0.5rem - 2px) * ${scrollProgress})`,
              background: 'rgba(255, 255, 255, 0.38)',
              boxShadow: '0 0 8px rgba(255, 255, 255, 0.08)',
              transition: 'height 100ms ease-out'
            }} 
          />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="absolute flex items-center justify-center text-white/30 hover:text-white/90 transition-colors cursor-pointer bg-[#0c0c0e] rounded-full group"
            style={{
              right: '0.5px',
              top: `calc(0.25rem + 1px + ((100% - 0.5rem - 2px) * ${scrollProgress}))`,
              transform: 'translateX(50%)',
              width: '20px',
              height: '20px',
              transition: 'top 100ms ease-out, opacity 150ms ease-out, color 150ms ease-out',
              opacity: scrollProgress > 0.02 ? 1 : 0,
              pointerEvents: scrollProgress > 0.02 ? 'auto' : 'none'
            }}
            aria-label="Back to top"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[14px] h-[14px] transition-transform duration-200 ease-out group-hover:scale-[1.2]">
              <line x1="12" y1="21" x2="12" y2="6"></line>
              <polyline points="7 11 12 6 17 11"></polyline>
              <line x1="7" y1="2" x2="17" y2="2"></line>
            </svg>
          </button>
          {tocItems.map((item) => (
            <button
              key={`${item.index}-${item.title}`}
              type="button"
              className={`editor-toc-item editor-toc-level-${Math.min(item.level, 6)} ${activeHeadingIndex === item.index ? 'is-active' : ''}`}
              style={{ "--toc-bar-width": `${item.barWidthRem}rem` } as React.CSSProperties}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => scrollToTocHeading(item.index)}
            >
              <span className="editor-toc-title">{item.title}</span>
              <span 
                className="editor-toc-bar" 
                style={activeHeadingIndex === item.index ? { 
                  opacity: 1, 
                  background: 'rgba(255, 255, 255, 0.82)', 
                  boxShadow: '0 0 8px rgba(255, 255, 255, 0.22)' 
                } : undefined} 
              />
            </button>
          ))}
        </nav>
      )}

      {/* Floating toolbar */}
      <div
        ref={toolbarRef}
        className="flex items-center select-none font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] border border-zinc-800 rounded z-50 shadow-2xl max-w-[calc(100vw-2rem)]"
        style={toolbarStyle}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => {
          if (hideToolbarTimer.current) clearTimeout(hideToolbarTimer.current);
        }}
        onMouseLeave={scheduleHideToolbar}
      >
        <span
          className="px-2 cursor-pointer hover:text-white flex-shrink-0"
          onMouseDown={(e) => { e.preventDefault(); scrollToolbar("left"); }}
        >
          [
        </span>
        <div
          ref={toolbarScrollRef}
          className="flex items-center overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap"
        >
          {(hasSelection ? SELECTION_TOOLS : EMPTY_LINE_TOOLS).map((tool) => (
            <button
              key={tool}
              onMouseDown={(e) => {
                e.preventDefault();
                if (tool === "Link") {
                  if (hasSelection) {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
                    }
                    setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
                    inputOpenTimeRef.current = Date.now();
                    setShowLinkInput(true);
                    setLinkValue("");
                    setTimeout(() => linkInputRef.current?.focus(), 0);
                  }
                  return;
                }
                if (tool === "Image") {

                  const sel = window.getSelection();

                  if (sel && sel.rangeCount > 0) {

                    savedRangeRef.current = sel.getRangeAt(0).cloneRange();

                  }

                  setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });

                  setShowImageInput(true);

                  setImageValue("");

                  setTimeout(() => imageInputRef.current?.focus(), 0);

                  return;

                }

                if (tool === "Table") {
                  const sel = window.getSelection();
                  if (sel && sel.rangeCount > 0) {
                    savedRangeRef.current = sel.getRangeAt(0).cloneRange();
                  }
                  setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
                  setShowTableInput(true);
                  setTableRowValue("");
                  setTableColValue("");
                  setTimeout(() => tableRowRef.current?.focus(), 0);

                  return;

                }
                handleToolClick(tool, editorRef.current);
                onChange(editorRef.current.innerHTML, editorRef.current);
                setTimeout(() => setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" }), 200);
              }}
              className="px-1.5 py-0.5 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {tool}
            </button>
          ))}
        </div>
        <span
          className="px-2 cursor-pointer hover:text-white flex-shrink-0"
          onMouseDown={(e) => { e.preventDefault(); scrollToolbar("right"); }}
        >
          ]
        </span>
      </div>

      {/* Link input */}
      {showLinkInput && (
        <div
          className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] border border-zinc-800 rounded z-50 shadow-2xl max-w-[400px]"
          style={{
            position: "absolute",
            top: toolbarPosRef.current.top,
            left: toolbarPosRef.current.left,
          }}
        >
          <span className="px-2">[</span>
          <input
            ref={linkInputRef}
            type="text"
            value={linkValue}
            placeholder="输入链接地址"
            onChange={(e) => setLinkValue(e.target.value)}

            onKeyDown={(e) => {

              if (e.key === "Enter") {

                e.preventDefault();

                handleLinkSubmit(linkInputRef.current?.value || linkValue);

              } else if (e.key === "Escape") {

                setShowLinkInput(false);

                setLinkValue("");

              }

            }}

            onBlur={() => { if (Date.now() - inputOpenTimeRef.current > 200) { setShowLinkInput(false); setLinkValue(""); } }}

            className="bg-transparent outline-none border-none text-zinc-200 w-full placeholder-zinc-600 font-mono text-xs"

          />

          <span className="px-2">]</span>

          <span

            className="px-2 cursor-pointer hover:text-white font-bold"

            onMouseDown={(e) => { e.preventDefault(); handleLinkSubmit(linkInputRef.current?.value || linkValue); }}

          >

            OK

          </span>
        </div>
      )}

      {/* Image input */}
      {showImageInput && (
        <div
          className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] border border-zinc-800 rounded z-50 shadow-2xl max-w-[400px]"
          style={{
            position: "absolute",
            top: toolbarPosRef.current.top,
            left: toolbarPosRef.current.left,
          }}
        >
          <span className="px-2">[</span>
          <input
            ref={imageInputRef}
            type="text"
            value={imageValue}
            placeholder="输入图片地址"
            onChange={(e) => setImageValue(e.target.value)}

            onKeyDown={(e) => {

              if (e.key === "Enter") {

                e.preventDefault();

                handleImageSubmit(imageInputRef.current?.value || imageValue);

              } else if (e.key === "Escape") {

                setShowImageInput(false);

                setImageValue("");

              }

            }}

            onBlur={() => { if (Date.now() - inputOpenTimeRef.current > 200) { setShowImageInput(false); setImageValue(""); } }}

            className="bg-transparent outline-none border-none text-zinc-200 w-full placeholder-zinc-600 font-mono text-xs"
          />
          <span className="px-2">]</span>
          <span
            className="px-2 cursor-pointer hover:text-white font-bold"
            onMouseDown={(e) => { e.preventDefault(); handleImageSubmit(imageInputRef.current?.value || imageValue); }}
          >
            OK
          </span>
        </div>
      )}

      {/* Table input */}
      {showTableInput && (
        <div
          className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] border border-zinc-800 rounded z-50 shadow-2xl max-w-[500px]"
          style={{
            position: "absolute",
            top: toolbarPosRef.current.top,
            left: toolbarPosRef.current.left,
          }}
        >
          <span className="px-2">[</span>
          <label className="flex items-center gap-1">
            <span>row:</span>
            <input
              ref={tableRowRef}
              type="number"
              min={3}
              max={30}
              value={tableRowValue}
              onChange={(e) => setTableRowValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleTableSubmit(); }
                if (e.key === "Escape") { setShowTableInput(false); }
                if (e.key === "Tab") { e.preventDefault(); tableColRef.current?.focus(); }
              }}
              onBlur={() => {
                if (Date.now() - inputOpenTimeRef.current < 200) return;
                const v = parseInt(tableRowValue);
                if (isNaN(v) || v < 3) setTableRowValue("3");
                else if (v > 30) setTableRowValue("30");
              }}
              className="bg-transparent outline-none border-none text-zinc-200 w-10 font-mono text-xs text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
          <label className="flex items-center gap-1 ml-2">
            <span>column:</span>
            <input
              ref={tableColRef}
              type="number"
              min={3}
              max={15}
              value={tableColValue}
              onChange={(e) => setTableColValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleTableSubmit(); }
                if (e.key === "Escape") { setShowTableInput(false); }
              }}
              onBlur={() => {
                const v = parseInt(tableColValue);
                if (isNaN(v) || v < 3) setTableColValue("3");
                else if (v > 15) setTableColValue("15");
              }}
              className="bg-transparent outline-none border-none text-zinc-200 w-10 font-mono text-xs text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
          <span className="px-2">]</span>
          <span
            className="px-2 cursor-pointer hover:text-white font-bold"
            onMouseDown={(e) => { e.preventDefault(); handleTableSubmit(); }}
          >
            OK
          </span>
        </div>
      )}
    </div>
  );
}
