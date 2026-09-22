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

  it("hides toolbar and deactivates editor when keyboard collapses on mobile empty line", async () => {
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
    let vvHeight = 400; // keyboard open
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

    // Simulate clicking empty line to activate and show toolbar
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

    // Keyboard collapse: visualViewport expands from 400 to 750
    vvHeight = 750;
    act(() => {
      resizeListeners.forEach((cb) => cb());
    });

    // Toolbar must be immediately hidden
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
});
