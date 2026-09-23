import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { Editor } from "./Editor";

describe("Editor mobile toolbar blur and keyboard collapse behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hides toolbar immediately when editor blurs", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p><br></p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    expect(editorEl).toBeInTheDocument();

    // Focus editor
    act(() => {
      fireEvent.focus(editorEl);
    });

    // Toolbar element is rendered with role or class
    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded");
    expect(toolbar).toBeTruthy();

    // Blur editor
    act(() => {
      fireEvent.blur(editorEl);
    });

    // Toolbar should have opacity 0 and pointerEvents none
    const style = (toolbar as HTMLElement).style;
    expect(style.opacity).toBe("0");
    expect(style.pointerEvents).toBe("none");
  });

  it("shows toolbar at viewport bottom on mobile when in edit state on an empty line, and hides on blur", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    // Mock mobile matchMedia
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    // Mock visualViewport
    let vvHeight = 500;
    const resizeListeners: Array<() => void> = [];
    const mockVisualViewport = {
      get height() {
        return vvHeight;
      },
      offsetTop: 0,
      addEventListener: vi.fn((event, cb) => {
        if (event === "resize") resizeListeners.push(cb);
      }),
      removeEventListener: vi.fn((event, cb) => {
        const idx = resizeListeners.indexOf(cb);
        if (idx !== -1) resizeListeners.splice(idx, 1);
      }),
    };
    Object.defineProperty(window, "visualViewport", {
      value: mockVisualViewport,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 750,
      writable: true,
      configurable: true,
    });

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p><br></p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;

    // Simulate clicking empty line to activate
    act(() => {
      fireEvent.mouseDown(editorEl);
      fireEvent.mouseUp(editorEl);
      fireEvent.focus(editorEl);
    });

    // Caret on empty line: set selection
    const p = editorEl.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Trigger visualViewport resize or selection update
    act(() => {
      resizeListeners.forEach((cb) => cb());
    });

    // Toolbar must be visible, fixed at bottom of viewport on mobile
    expect(toolbar.style.opacity).toBe("1");
    expect(toolbar.style.pointerEvents).toBe("auto");
    expect(toolbar.style.position).toBe("fixed");

    // When editor blurs (exiting focus), toolbar must hide
    act(() => {
      fireEvent.blur(editorEl);
    });

    expect(toolbar.style.opacity).toBe("0");
    expect(toolbar.style.pointerEvents).toBe("none");
  });

  it("hides toolbar immediately when isActive transitions to false", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    const { rerender } = render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p><br></p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;

    // Focus editor
    act(() => {
      fireEvent.focus(editorEl);
    });

    // Switch tab (which forces isActive to false and resets toolbar)
    rerender(
      <Editor
        activeTabId="tab-2"
        initialContent="<p><br></p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    expect(toolbar.style.opacity).toBe("0");
    expect(toolbar.style.pointerEvents).toBe("none");
  });

  it("enters edit state when clicking document content on desktop", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p>Click me to edit</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    const p = editorEl.querySelector("p")!;

    // Initially inactive
    expect(editorEl.getAttribute("contenteditable")).toBe("false");

    // Click on paragraph
    act(() => {
      fireEvent.mouseDown(p);
      fireEvent.click(p);
    });

    // Editor enters edit state
    expect(editorEl.getAttribute("contenteditable")).toBe("true");
    expect(onActiveChange).toHaveBeenCalledWith(true);
  });

  it("enters edit state when tapping document content on mobile", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p>Tap me on mobile</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    const p = editorEl.querySelector("p")!;

    // Tap on mobile
    act(() => {
      fireEvent.touchStart(p, { touches: [{ clientX: 50, clientY: 50 }] });
      fireEvent.touchEnd(p, { touches: [] });
    });

    // Editor enters edit state
    expect(editorEl.getAttribute("contenteditable")).toBe("true");
    expect(onActiveChange).toHaveBeenCalledWith(true);
  });

  it("keeps editor active when clicking between elements inside the editor", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>First paragraph</p><p id='p2'>Second paragraph</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    const p1 = editorEl.querySelector("#p1")!;
    const p2 = editorEl.querySelector("#p2")!;

    // Enter edit state
    act(() => {
      fireEvent.mouseDown(p1);
      fireEvent.click(p1);
    });
    expect(editorEl.getAttribute("contenteditable")).toBe("true");

    // Simulate focus transition within editor (from p1 to p2)
    act(() => {
      fireEvent.blur(editorEl, { relatedTarget: p2 });
    });

    // Editor should still be active!
    expect(editorEl.getAttribute("contenteditable")).toBe("true");
  });

  it("has mobile-friendly attributes to prevent IME/autocorrect interference", () => {
    const editorRef = createRef<HTMLDivElement>();
    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<h1>Heading</h1>"
        onChange={vi.fn()}
        editorRef={editorRef}
        readOnly={false}
      />
    );
    const editorEl = editorRef.current!;
    expect(editorEl.getAttribute("spellcheck")).toBe("false");
    expect(editorEl.getAttribute("autocorrect")).toBe("off");
    expect(editorEl.getAttribute("autocapitalize")).toBe("none");
  });

  it("does not overwrite active editor DOM when re-rendered with stale initialContent during heading edits", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const { rerender } = render(
      <Editor
        activeTabId="tab-1"
        initialContent="<h1>Heading with space</h1>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const h1 = editorEl.querySelector("h1")!;

    // Activate editing
    act(() => {
      fireEvent.mouseDown(h1);
      fireEvent.click(h1);
    });
    expect(editorEl.getAttribute("contenteditable")).toBe("true");

    // Simulate deleting a character at the end of the heading
    h1.textContent = "Heading with spac";
    act(() => {
      fireEvent.input(editorEl, { inputType: "deleteContentBackward" });
    });

    // Re-render with old initialContent (as happens when parent state is slightly behind or TOC updates)
    rerender(
      <Editor
        activeTabId="tab-1"
        initialContent="<h1>Heading with space</h1>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    // Live DOM should NOT be overwritten while active
    expect(editorEl.querySelector("h1")?.textContent).toBe("Heading with spac");
  });

  describe("Editor paste behavior on empty lines", () => {
    function setCaretInNode(node: Node) {
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    it("pastes single-line text into an empty line without creating extra empty paragraphs", async () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<p><br></p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const p = editorEl.querySelector("p")!;

      // Click to activate
      act(() => {
        fireEvent.mouseDown(p);
        fireEvent.click(p);
      });

      setCaretInNode(p);

      act(() => {
        fireEvent.paste(editorEl, {
          clipboardData: {
            getData: (format: string) => (format === "text/plain" ? "Hello world" : ""),
          },
        });
      });

      // Should have exactly 1 paragraph containing "Hello world", no extra <p><br></p>
      const paragraphs = editorEl.querySelectorAll("p");
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].textContent).toBe("Hello world");
      expect(editorEl.querySelectorAll("br").length).toBe(0);
      expect(onChange).toHaveBeenCalledWith("<p>Hello world</p>", editorEl);
    });

    it("pastes text with trailing newline into an empty line without adding an extra line break", async () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<p><br></p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const p = editorEl.querySelector("p")!;

      act(() => {
        fireEvent.mouseDown(p);
        fireEvent.click(p);
      });

      setCaretInNode(p);

      act(() => {
        fireEvent.paste(editorEl, {
          clipboardData: {
            getData: (format: string) => (format === "text/plain" ? "Copied line\n" : ""),
          },
        });
      });

      const paragraphs = editorEl.querySelectorAll("p");
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].textContent).toBe("Copied line");
      expect(editorEl.querySelectorAll("br").length).toBe(0);
    });

    it("pastes into an empty H1 heading without creating extra empty lines and preserving H1", async () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<h1><br></h1>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const h1 = editorEl.querySelector("h1")!;

      act(() => {
        fireEvent.mouseDown(h1);
        fireEvent.click(h1);
      });

      setCaretInNode(h1);

      act(() => {
        fireEvent.paste(editorEl, {
          clipboardData: {
            getData: (format: string) => (format === "text/plain" ? "My Document Title" : ""),
          },
        });
      });

      const headings = editorEl.querySelectorAll("h1");
      expect(headings.length).toBe(1);
      expect(headings[0].textContent).toBe("My Document Title");
      expect(editorEl.querySelectorAll("p").length).toBe(0);
      expect(editorEl.querySelectorAll("br").length).toBe(0);
    });

    it("pastes multi-line text into an empty line without extra trailing empty lines", async () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<p><br></p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const p = editorEl.querySelector("p")!;

      act(() => {
        fireEvent.mouseDown(p);
        fireEvent.click(p);
      });

      setCaretInNode(p);

      act(() => {
        fireEvent.paste(editorEl, {
          clipboardData: {
            getData: (format: string) => (format === "text/plain" ? "Line 1\nLine 2" : ""),
          },
        });
      });

      // Within single paragraph with soft break: <p>Line 1<br>Line 2</p>
      const paragraphs = editorEl.querySelectorAll("p");
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].innerHTML).toContain("Line 1<br>Line 2");
      // Exactly 1 <br> between lines, no trailing extra <br> or <p><br></p>
      expect(editorEl.querySelectorAll("br").length).toBe(1);
    });

    it("pastes multiple markdown paragraphs into an empty line replacing it cleanly without a trailing empty line", async () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<p><br></p>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const p = editorEl.querySelector("p")!;

      act(() => {
        fireEvent.mouseDown(p);
        fireEvent.click(p);
      });

      setCaretInNode(p);

      act(() => {
        fireEvent.paste(editorEl, {
          clipboardData: {
            getData: (format: string) => (format === "text/plain" ? "Para 1\n\nPara 2" : ""),
          },
        });
      });

      const paragraphs = editorEl.querySelectorAll("p");
      expect(paragraphs.length).toBe(2);
      expect(paragraphs[0].textContent).toBe("Para 1");
      expect(paragraphs[1].textContent).toBe("Para 2");
      expect(editorEl.querySelectorAll("br").length).toBe(0);
    });

    it("pastes plain text inside a code block <pre> without converting to rich HTML", async () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();
      document.execCommand = vi.fn();

      render(
        <Editor
          activeTabId="tab-1"
          initialContent="<pre><code></code></pre>"
          onChange={onChange}
          editorRef={editorRef}
          readOnly={false}
        />
      );

      const editorEl = editorRef.current!;
      const pre = editorEl.querySelector("pre")!;

      act(() => {
        fireEvent.mouseDown(pre);
        fireEvent.click(pre);
      });

      setCaretInNode(pre);

      act(() => {
        fireEvent.paste(editorEl, {
          clipboardData: {
            getData: (format: string) => (format === "text/plain" ? "# heading" : ""),
          },
        });
      });

      // Inside pre, it must use insertText instead of insertHTML
      expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "# heading");
    });
  });
});


