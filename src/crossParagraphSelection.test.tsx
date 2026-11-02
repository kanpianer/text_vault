import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { Editor } from "./Editor";
import { calculateSelectionPosition } from "./toolbarPosition";

describe("Cross paragraph selection toolbar popup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows toolbar when selecting text across paragraphs with forward mouse drag", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();
    const onActiveChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>First paragraph text</p><p id='p2'>Second paragraph text</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
        onActiveChange={onActiveChange}
      />
    );

    const editorEl = editorRef.current!;
    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;
    expect(toolbar).toBeTruthy();

    const p1 = editorEl.querySelector("#p1")!;
    const p2 = editorEl.querySelector("#p2")!;

    // 1. Click to activate editor
    act(() => {
      fireEvent.mouseDown(p1);
      fireEvent.mouseUp(p1);
      fireEvent.click(p1);
    });
    expect(editorEl.getAttribute("contenteditable")).toBe("true");

    // 2. Select text across p1 and p2
    const range = document.createRange();
    range.setStart(p1.firstChild!, 5);
    range.setEnd(p2.firstChild!, 10);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Mock getClientRects for the range
    range.getClientRects = () => [
      { top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20 },
      { top: 80, bottom: 100, left: 20, right: 120, width: 100, height: 20 },
    ] as any;
    range.getBoundingClientRect = () => ({
      top: 50, bottom: 100, left: 20, right: 150, width: 130, height: 50,
      x: 20, y: 50, toJSON() {}
    } as any);

    // 3. User releases mouse button on p2, followed by click on common ancestor (editorEl)
    act(() => {
      fireEvent.mouseUp(p2);
      fireEvent.click(editorEl);
    });

    // Wait for updateToolbar
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Toolbar should be visible and selection maintained
    expect(sel.isCollapsed).toBe(false);
    expect(toolbar.style.opacity).toBe("1");
    expect(toolbar.style.pointerEvents).toBe("auto");
  });

  it("shows toolbar when selecting text across paragraphs in reverse (backward) drag", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>First paragraph text</p><p id='p2'>Second paragraph text</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;

    const p1 = editorEl.querySelector("#p1")!;
    const p2 = editorEl.querySelector("#p2")!;

    // Activate editor
    act(() => {
      fireEvent.mouseDown(p2);
      fireEvent.mouseUp(p2);
      fireEvent.click(p2);
    });

    // Backward selection: drag started in p2, ended in p1
    const range = document.createRange();
    range.setStart(p1.firstChild!, 2);
    range.setEnd(p2.firstChild!, 15);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    range.getClientRects = () => [
      { top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20 },
      { top: 80, bottom: 100, left: 20, right: 120, width: 100, height: 20 },
    ] as any;

    act(() => {
      fireEvent.mouseUp(p1);
      fireEvent.click(editorEl);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(sel.isCollapsed).toBe(false);
    expect(toolbar.style.opacity).toBe("1");
    expect(toolbar.style.pointerEvents).toBe("auto");
  });

  it("still places caret closest to point on normal single click on root empty area when selection is collapsed", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>Line 1</p><p id='p2'>Line 2</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p1 = editorEl.querySelector("#p1")!;

    // Activate
    act(() => {
      fireEvent.mouseDown(p1);
      fireEvent.mouseUp(p1);
      fireEvent.click(p1);
    });

    // Collapsed selection pointing to editor root (e.g. clicked empty margin)
    const range = document.createRange();
    range.setStart(editorEl, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(sel.isCollapsed).toBe(true);

    // Click on editorEl with collapsed selection should snap caret
    act(() => {
      fireEvent.mouseUp(editorEl, { clientX: 30, clientY: 50 });
      fireEvent.click(editorEl, { clientX: 30, clientY: 50 });
    });

    expect(sel.isCollapsed).toBe(true);
  });

  it("calculates selection position skipping degenerate 0x0 trailing rects at paragraph boundaries", () => {
    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 600,
      width: 500,
      height: 600,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect);

    const range = document.createRange();
    // Simulate getClientRects returning a valid rect for line 1, a valid rect for line 2, and a 0x0 boundary rect
    (range as any).getClientRects = () => [
      { top: 50, bottom: 70, left: 20, right: 200, width: 180, height: 20 },
      { top: 80, bottom: 100, left: 20, right: 150, width: 130, height: 20 },
      { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
    ];

    const pos = calculateSelectionPosition(range, container, 300);
    // Should use the second rect (bottom 100) instead of the 0x0 rect (bottom 0)
    // top = bottom (100) - container.top (0) + 3 = 103
    expect(pos.top).toBe(103);
    expect(pos.visibility).toBe("visible");
  });
});
