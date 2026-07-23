import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import {
  calculateSelectionPosition,
  calculateEmptyLinePositionLeft,
} from "./toolbarPosition";

// ── style definitions ──────────────────────────────────────────────

const EDITOR_CLASS =
  "editor-body w-full min-h-[500px] outline-none text-zinc-300 text-base md:text-lg leading-normal pt-2";

const EMPTY_LINE_TOOLS = ["Text", "H1", "H2", "H3", "Task", "List", "Toggle", "Quote", "Image", "Code", "Line", "Center", "Table"] as const;
const SELECTION_TOOLS = ["Text", "Bold", "Italic", "Strike", "Under", "Task", "List", "Quote", "Link", "Center"] as const;

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
  root.querySelectorAll("summary.toggle-summary").forEach((summary) => {
    if (summary.childNodes.length === 0) {
      summary.appendChild(document.createElement("br"));
    }
  });
}

function getCurrentBlock(root: HTMLElement, node: Node): HTMLElement | null {
  let el: HTMLElement | null =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    
  if (el === root) {
    const sel = window.getSelection();
    if (sel && sel.anchorNode === root) {
      let child = root.childNodes[sel.anchorOffset];
      if (!child && root.lastChild) child = root.lastChild;
      if (child) {
        el = child.nodeType === Node.TEXT_NODE ? child.parentElement : (child as HTMLElement);
      }
    }
  }

  while (el && el !== root && !["P","DIV","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","PRE","LI","UL","OL","SUMMARY"].includes(el.tagName)) {
    el = el.parentElement;
  }
  return el && el !== root ? el : null;
}

function getTocBarWidthRem(title: string, level: number) {
  const baseWidth = level === 1 ? 0.32 : level === 2 ? 0.28 : 0.22;
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
  if (!sel) return;
  const block = getCurrentBlock(el, sel.anchorNode || el);
  if (!block) return;

  const cb = block.querySelector('input[type="checkbox"]');
  if (cb) {
    cb.remove();
    if (block.firstChild && block.firstChild.nodeType === Node.TEXT_NODE) {
      const txt = block.firstChild.textContent || "";
      if (txt.startsWith("\u200B")) {
        block.firstChild.textContent = txt.substring(1);
      }
    }
    return;
  }

  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.style.marginRight = "8px";
  inp.setAttribute("contenteditable", "false");

  const ranges: Range[] = [];
  for (let i = 0; i < sel.rangeCount; i++) {
    ranges.push(sel.getRangeAt(i).cloneRange());
  }

  if (block.firstChild) {
    block.insertBefore(inp, block.firstChild);
  } else {
    block.appendChild(inp);
    const zw = document.createTextNode("\u200B");
    block.appendChild(zw);
  }

  sel.removeAllRanges();
  for (const r of ranges) {
    try {
      sel.addRange(r);
    } catch (err) {
      // ignore
    }
  }

  const blockText = block.textContent || "";
  const cleanedText = blockText.replace(/\u200B/g, "").trim();
  if (sel.isCollapsed && cleanedText.length === 0) {
    const nextNode = inp.nextSibling;
    if (nextNode) {
      const r = document.createRange();
      if (nextNode.nodeType === Node.TEXT_NODE) {
        r.setStart(nextNode, 0);
      } else {
        r.setStartAfter(nextNode);
      }
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
}

function insertToggleBlock(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const block = getCurrentBlock(el, sel.anchorNode || el);
  if (!block) return;

  // Build <details><summary>…</summary><p><br></p></details><p><br></p>
  const details = document.createElement("details");
  details.className = "toggle-block";
  details.setAttribute("open", "");

  const summary = document.createElement("summary");
  summary.className = "toggle-summary";
  summary.setAttribute("contenteditable", "true");
  // Preserve any existing text in the block
  const existingText = (block.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
  if (existingText) {
    summary.textContent = existingText;
  } else {
    summary.appendChild(document.createElement("br"));
  }
  details.appendChild(summary);

  const body = document.createElement("p");
  body.className = "toggle-body";
  body.innerHTML = "<br>";
  details.appendChild(body);

  block.replaceWith(details);

  // Place caret at start of summary
  const r = document.createRange();
  r.selectNodeContents(summary);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
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
    case "Toggle": insertToggleBlock(editorEl); break;
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

function getCaretRangeFromPoint(x: number, y: number, root: HTMLElement): Range | null {

  const doc = root.ownerDocument;

  const caretPositionFromPoint = (doc as Document & {

    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;

  }).caretPositionFromPoint;



  if (caretPositionFromPoint) {

    const pos = caretPositionFromPoint.call(doc, x, y);

    if (pos && root.contains(pos.offsetNode)) {

      const range = doc.createRange();

      range.setStart(pos.offsetNode, pos.offset);

      range.collapse(true);

      return range;

    }

  }



  const caretRangeFromPoint = (doc as Document & {

    caretRangeFromPoint?: (x: number, y: number) => Range | null;

  }).caretRangeFromPoint;



  const range = caretRangeFromPoint?.call(doc, x, y) ?? null;

  if (range && root.contains(range.startContainer)) {

    range.collapse(true);

    return range;

  }



  return null;

}



function placeCaretAtRange(range: Range | null) {

  if (!range) return false;

  const sel = window.getSelection();

  if (!sel) return false;

  sel.removeAllRanges();

  sel.addRange(range);

  return true;

}



// ── component ───────────────────────────────────────────────────────



export function Editor({ activeTabId, initialContent, onChange, editorRef, readOnly, onActiveChange, hideToc = false }: any) {
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
  const [previewTocIndex, setPreviewTocIndex] = useState<number | null>(null);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const [tocLineVisible, setTocLineVisible] = useState(false);
  const tocLineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  useEffect(() => { setIsActive(false); setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" }); setPreviewTocIndex(null); }, [activeTabId]);
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
      
      if (tocButtonRef.current) {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(window.scrollY / docHeight, 1) : 0;
        if (progress > 0.02) {
          tocButtonRef.current.classList.add('opacity-100', 'pointer-events-auto');
          tocButtonRef.current.classList.remove('opacity-0', 'pointer-events-none');
        } else {
          tocButtonRef.current.classList.remove('opacity-100', 'pointer-events-auto');
          tocButtonRef.current.classList.add('opacity-0', 'pointer-events-none');
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
    const stickyHeader = document.querySelector<HTMLElement>(".sticky.top-0");
    const stickyBottom = stickyHeader?.getBoundingClientRect().bottom ?? 0;
    const viewportTopPadding = Math.max(88, Math.ceil(stickyBottom + 12));

    

    if (index === 0 && headingTop - editorTop < 100) {

      window.scrollTo({ top: 0, behavior: "smooth" });

      setPreviewTocIndex(null);

      return;

    }



    const topPadding = Math.max(16, headingTop - editorTop < 40 ? 8 : viewportTopPadding);
    window.scrollTo({
      top: Math.max(0, headingTop - topPadding),
      behavior: "smooth",
    });
    setPreviewTocIndex(null);
  }, [editorRef]);

  const handleTocItemClick = useCallback((index: number) => {
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      setPreviewTocIndex((current) => (current === index ? current : index));
      return;
    }
    scrollToTocHeading(index);
  }, [scrollToTocHeading]);

  // ── toolbar position updater ──────────────────────────────────────

  const updateToolbar = useCallback(() => {

    const el = editorRef.current as HTMLElement | null;

    if (!el || readOnly || hideToc) {
      setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
      return;
    }

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
      let block = getCurrentBlock(el, node);
      let isFallback = false;

      if (!block && el.contains(node)) {
        const text = (el.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
        if (text === "") {
          block = el;
          isFallback = true;
        }
      }

      if (block) {
        const text = (block.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
        if (text === "") {
          let blockRect = block.getBoundingClientRect();
          if (isFallback) {
             blockRect = {
               ...blockRect,
               bottom: blockRect.top + 28,
               left: blockRect.left,
             } as DOMRect;
          }
          const pos = calculateEmptyLinePositionLeft(blockRect, container, tw);
          toolbarPosRef.current = { top: pos.top, left: pos.left };
          setToolbarStyle({ position: "absolute", top: pos.top, left: pos.left, opacity: 1, pointerEvents: "auto" });
          return;
        }
      }
      setToolbarStyle({ position: "absolute", opacity: 0, pointerEvents: "none" });
    }
  }, [editorRef, readOnly, hideToc]);

  useEffect(() => {
    if (hideToc) {
      setToolbarStyle(prev => ({ ...prev, opacity: 0, pointerEvents: "none" }));
      setShowLinkInput(false);
      setShowImageInput(false);
      setShowTableInput(false);
    } else {
      updateToolbar();
    }
  }, [hideToc, updateToolbar]);

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

  // ── scroll idle: hide progress line when paused ──────────────────

  useEffect(() => {
    const handleTocScroll = () => {
      setTocLineVisible(true);
      if (tocLineTimerRef.current) clearTimeout(tocLineTimerRef.current);
      tocLineTimerRef.current = setTimeout(() => setTocLineVisible(false), 1000);
    };
    window.addEventListener('scroll', handleTocScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleTocScroll);
      if (tocLineTimerRef.current) clearTimeout(tocLineTimerRef.current);
    };
  }, []);

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

      // summary (toggle): Enter moves caret into the toggle body
      {
        let summaryEl: HTMLElement | null =
          node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
        while (summaryEl && summaryEl !== el) {
          if (summaryEl.tagName === "SUMMARY") {
            e.preventDefault();
            const details = summaryEl.parentElement;
            if (details) {
              // Find or create the first body paragraph inside details (not the summary)
              let bodyP = Array.from(details.children).find(
                (c) => c !== summaryEl && (c.tagName === "P" || c.tagName === "DIV")
              ) as HTMLElement | undefined;
              if (!bodyP) {
                bodyP = document.createElement("p");
                bodyP.className = "toggle-body";
                bodyP.innerHTML = "<br>";
                details.appendChild(bodyP);
              }
              const r = document.createRange();
              r.selectNodeContents(bodyP);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
              onChange(el.innerHTML, el);
            }
            return;
          }
          summaryEl = summaryEl.parentElement;
        }
      }

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

        let isTaskLine = false;
        let walk: Node | null = range.startContainer;
        if (walk === block && range.startOffset > 0) {
          walk = block.childNodes[range.startOffset - 1];
        }
        let taskCheckbox: HTMLInputElement | null = null;
        while (walk && walk !== block) {
          if (walk.nodeName === "BR") break;
          if (walk.nodeName === "INPUT" && (walk as HTMLInputElement).type === "checkbox") {
            isTaskLine = true;
            taskCheckbox = walk as HTMLInputElement;
            break;
          }
          walk = walk.previousSibling || walk.parentNode;
          if (walk === block) break;
        }

        if (isTaskLine && taskCheckbox) {
          let isEmpty = true;
          let forward = taskCheckbox.nextSibling;
          while (forward && forward.nodeName !== "BR") {
            if (forward.nodeType === Node.TEXT_NODE) {
              const txt = (forward.textContent || "").replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
              if (txt.length > 0) {
                isEmpty = false;
                break;
              }
            }
            forward = forward.nextSibling;
          }

          if (isEmpty) {
            const parent = taskCheckbox.parentNode;
            if (parent) {
              const txt = document.createTextNode("");
              parent.insertBefore(txt, taskCheckbox);
              parent.removeChild(taskCheckbox);
              if (forward && forward.nodeType === Node.TEXT_NODE && (forward.textContent === "\u200B" || forward.textContent === "")) {
                parent.removeChild(forward);
              }
              const newRange = document.createRange();
              newRange.setStart(txt, 0);
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
              onChange(el.innerHTML, el);
            }
            return;
          } else {
            const br = document.createElement("br");
            range.insertNode(br);
            range.setStartAfter(br);

            const newCb = document.createElement("input");
            newCb.type = "checkbox";
            newCb.style.marginRight = "8px";
            newCb.setAttribute("contenteditable", "false");
            range.insertNode(newCb);
            range.setStartAfter(newCb);

            const zw = document.createTextNode("\u200B");
            range.insertNode(zw);
            range.setStartAfter(zw);

            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            onChange(el.innerHTML, el);
            return;
          }
        }

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

  // ── dynamic code block formatting (line numbers & syntax highlighting) ───────────────────────────────

  useEffect(() => {
    const el = editorRef.current as HTMLElement | null;
    if (!el) return;

    const updateBlocks = () => {
      const pres = el.querySelectorAll("pre");
      pres.forEach(pre => {
        // Extract text and calculate offset
        let rawContent = "";
        let savedOffset = -1;
        const sel = window.getSelection();
        const isFocused = sel && sel.rangeCount > 0 && pre.contains(sel.anchorNode);
        const targetNode = isFocused ? sel.anchorNode : null;
        const targetOffset = isFocused ? sel.anchorOffset : 0;

        function walk(node: Node) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node === targetNode) savedOffset = rawContent.length + targetOffset;
            rawContent += node.nodeValue || "";
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node as HTMLElement).tagName;
            if (tag === "BR") rawContent += "\n";
            else if (tag === "DIV" || tag === "P") {
              if (rawContent.length > 0 && !rawContent.endsWith("\n")) rawContent += "\n";
            }
            
            for (let i = 0; i < node.childNodes.length; i++) {
              if (node === targetNode && targetOffset === i) savedOffset = rawContent.length;
              walk(node.childNodes[i]);
            }
            if (node === targetNode && targetOffset === node.childNodes.length) {
              savedOffset = rawContent.length;
            }
            
            if (tag === "DIV" || tag === "P") {
              if (rawContent.length > 0 && !rawContent.endsWith("\n")) rawContent += "\n";
            }
          }
        }
        walk(pre);

        // Strip the trailing newline we add for rendering, if it exists
        if (rawContent.endsWith("\n")) {
          rawContent = rawContent.slice(0, -1);
        }

        // Line numbers
        let linesCount = (rawContent.match(/\n/g) || []).length + 1;
        if (rawContent === "\n" || rawContent === "") linesCount = 1;
        
        const hasContent = (rawContent.replace(/[\s\u200B\u200C\u200D\uFEFF]/g, "") !== "") || (linesCount > 1);

        if (hasContent) {
          let numbers = "";
          for (let i = 1; i <= linesCount; i++) {
            numbers += i + "\n";
          }
          if (pre.getAttribute("data-line-numbers") !== numbers) {
            pre.setAttribute("data-line-numbers", numbers);
          }
        } else {
          if (pre.hasAttribute("data-line-numbers")) {
            pre.removeAttribute("data-line-numbers");
          }
        }

        // Syntax Highlighting
        if (pre.dataset.rawText !== rawContent) {
          let highlighted = hljs.highlightAuto(rawContent).value;
          // Append a trailing newline to ensure the last line is editable in contenteditable
          highlighted += "\n";
          pre.innerHTML = highlighted;
          pre.dataset.rawText = rawContent;

          if (isFocused && savedOffset >= 0 && sel) {
            let currentOffset = 0;
            const treeWalker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT, null);
            let node = treeWalker.nextNode();
            let found = false;
            while (node) {
              const len = node.nodeValue?.length || 0;
              if (currentOffset + len >= savedOffset) {
                const newRange = document.createRange();
                newRange.setStart(node, savedOffset - currentOffset);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                found = true;
                break;
              }
              currentOffset += len;
              node = treeWalker.nextNode();
            }
            if (!found) {
              const newRange = document.createRange();
              newRange.selectNodeContents(pre);
              newRange.collapse(false);
              sel.removeAllRanges();
              sel.addRange(newRange);
            }
          }
        }
      });
    };

    updateBlocks();
    const observer = new MutationObserver(updateBlocks);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [editorRef, activeTabId]);

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

        // unwrap toggle block on backspace at start of summary
        if (e.key === "Backspace") {
          let currNode: Node | null = node;
          let summaryEl: HTMLElement | null = null;
          while (currNode && currNode !== el) {
            if (currNode.nodeName === "SUMMARY") {
              summaryEl = currNode as HTMLElement;
              break;
            }
            currNode = currNode.parentNode;
          }

          if (summaryEl) {
            const testRange = document.createRange();
            testRange.selectNodeContents(summaryEl);
            testRange.setEnd(range.startContainer, range.startOffset);
            const textBefore = testRange.toString().replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
            
            if (textBefore.length === 0) {
              e.preventDefault();
              const details = summaryEl.parentElement;
              if (details) {
                const newP = document.createElement("p");
                const content = summaryEl.innerHTML;
                newP.innerHTML = content || "<br>";
                details.parentNode?.insertBefore(newP, details);
                
                const children = Array.from(details.children);
                for (const child of children) {
                  if (child !== summaryEl) {
                     if (child.tagName === "P" || child.tagName === "DIV") {
                       child.className = "";
                       details.parentNode?.insertBefore(child, details);
                     } else {
                       details.parentNode?.insertBefore(child, details);
                     }
                  }
                }
                details.remove();
                
                const r = document.createRange();
                r.selectNodeContents(newP);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                normalizeEditorNodes(el);
                onChange(el.innerHTML, el);
                setTimeout(updateToolbar, 0);
              }
              return;
            }
          }
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

      if (!window.matchMedia("(pointer: coarse)").matches) {

        editorRef.current.focus({ preventScroll: true });

      }

      setIsActive(true);

    }

  };

  // ── touch: detect tap to activate ─────────────────────────────────

  const touchRef = useRef({ startX: 0, startY: 0, startTime: 0, hasMoved: false });

  const pendingTouchCaretRef = useRef<Range | null>(null);



  const handleTouchStart = (e: React.TouchEvent) => {

    const t = e.target as HTMLElement;

    if (t.tagName === "IMG") { e.preventDefault(); return; }

    const tc = e.touches[0];

    pendingTouchCaretRef.current = null;

    if (!isActive && !readOnly && editorRef.current) {

      pendingTouchCaretRef.current = getCaretRangeFromPoint(tc.clientX, tc.clientY, editorRef.current);

    }

    touchRef.current = { startX: tc.clientX, startY: tc.clientY, startTime: Date.now(), hasMoved: false };

  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const tc = e.touches[0];
    if (Math.abs(tc.clientX - touchRef.current.startX) > 15 || Math.abs(tc.clientY - touchRef.current.startY) > 15) {
      touchRef.current.hasMoved = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {

    const { startTime, hasMoved } = touchRef.current;

    if (!hasMoved && Date.now() - startTime < 300 && !isActive && !readOnly) {

      e.preventDefault();

      const el = editorRef.current as HTMLElement | null;

      if (!el) return;

      const changedEditable = el.contentEditable !== "true";

      el.contentEditable = "true";

      setIsActive(true);



      requestAnimationFrame(() => {

        if (changedEditable) {

          el.focus({ preventScroll: true });

        }

        placeCaretAtRange(pendingTouchCaretRef.current);

        pendingTouchCaretRef.current = null;

        updateToolbar();

      });

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
            return;
          }

          if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
            const cb = target as HTMLInputElement;
            if (cb.checked) {
              cb.setAttribute("checked", "true");
            } else {
              cb.removeAttribute("checked");
            }
            if (!readOnly && editorRef.current) {
              onChange(editorRef.current.innerHTML, editorRef.current);
            }
          }

          if (target === editorRef.current) {
            const el = editorRef.current;
            const lastChild = el.lastElementChild;
            const isLastEmptyP = lastChild && lastChild.tagName === "P" && (!lastChild.textContent || lastChild.textContent.trim() === "");
            
            if (!isLastEmptyP && !readOnly) {
              const p = document.createElement("p");
              p.appendChild(document.createElement("br"));
              el.appendChild(p);
              
              requestAnimationFrame(() => {
                const r = document.createRange();
                r.selectNodeContents(p);
                r.collapse(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
                el.focus();
              });
            }
          }
        }}
      />

      {!hideToc && (

        <nav className="editor-toc relative" aria-label="Document headings">
          <div 

            className="absolute right-0 w-[1px] rounded-full z-[-1] transition-opacity duration-300"



            style={{

              opacity: tocLineVisible ? 1 : 0,



              top: 'calc(0.25rem + 0.375rem)',

              height: `calc((100% - 0.5rem - 0.75rem) * var(--scroll-progress, 0))`,

              background: 'rgb(104, 104, 106)',

              boxShadow: '0 0 8px rgba(255, 255, 255, 0.08)'

            }} 

          />
          <button
            ref={tocButtonRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="absolute flex items-center justify-center text-white/30 hover:text-white/90 transition-colors cursor-pointer rounded-full group transition-opacity duration-300"
            style={{
              right: '0.5px',
              top: `calc(0.25rem + 0.375rem + ((100% - 0.5rem - 0.75rem) * var(--scroll-progress, 0)))`,
              transform: 'translateX(50%)',
              width: '20px',
              height: '20px',
              opacity: tocLineVisible ? 1 : 0,
              pointerEvents: tocLineVisible ? 'auto' : 'none'
            }}
            aria-label="Back to top"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[14px] h-[14px] transition-transform duration-200 ease-out group-hover:scale-[1.2]">
              <line x1="12" y1="21" x2="12" y2="6"></line>
              <polyline points="7 11 12 6 17 11"></polyline>
              <line x1="7" y1="2" x2="17" y2="2"></line>
            </svg>
          </button>
          {tocItems.length > 0 && tocItems.map((item) => (

            <button

              key={`${item.index}-${item.title}`}

              type="button"

              className={`editor-toc-item editor-toc-level-${Math.min(item.level, 6)} ${activeHeadingIndex === item.index ? 'is-active' : ''}`}

              style={{ "--toc-bar-width": `${item.barWidthRem}rem` } as React.CSSProperties}

              onMouseDown={(e) => e.preventDefault()}

              onClick={() => handleTocItemClick(item.index)}

            >

              <span

                className={`editor-toc-title ${previewTocIndex === item.index ? 'is-previewing' : ''}`}

                onClick={(e) => {

                  e.preventDefault();

                  e.stopPropagation();

                  setPreviewTocIndex(null);

                  scrollToTocHeading(item.index);

                }}

              >

                {item.title}

              </span>

              <span 

                className="editor-toc-bar" 

                style={activeHeadingIndex === item.index ? { 

                  opacity: 1, 

                  background: 'rgb(211, 211, 212)', 

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
