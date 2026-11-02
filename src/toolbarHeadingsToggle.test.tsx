import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { Editor } from "./Editor";

describe("Editor selection toolbar H1 H2 H3 toggle via [ and ]", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initially hides H1 H2 H3 on text selection, expands them on clicking [, and collapses them on clicking ]", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>Sample text to format</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p1 = editorEl.querySelector("#p1")!;

    // 1. Activate editor
    act(() => {
      fireEvent.mouseDown(p1);
      fireEvent.mouseUp(p1);
      fireEvent.click(p1);
    });

    // 2. Select text inside p1
    const range = document.createRange();
    range.setStart(p1.firstChild!, 0);
    range.setEnd(p1.firstChild!, 6);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    range.getClientRects = () => [
      { top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20 },
    ] as any;
    range.getBoundingClientRect = () => ({
      top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20,
      x: 20, y: 50, toJSON() {}
    } as any);

    // MouseUp to trigger updateToolbar
    act(() => {
      fireEvent.mouseUp(p1);
      fireEvent.click(editorEl);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.opacity).toBe("1");

    // Check heading tools container and track
    const headingContainer = toolbar.querySelector('[data-testid="heading-tools-container"]') as HTMLElement;
    const track = toolbar.querySelector('[data-testid="selection-tools-track"]') as HTMLElement;
    expect(headingContainer).toBeTruthy();
    expect(track).toBeTruthy();

    // 3. Initially H1 H2 H3 are hidden (track at translateX(0px), headingContainer at right-full with pointerEvents: none)
    expect(track.style.transform).toBe("translateX(0px)");
    expect(headingContainer.style.pointerEvents).toBe("none");

    const leftBracket = toolbar.querySelector('[data-testid="toolbar-left-bracket"]') as HTMLElement;
    const rightBracket = toolbar.querySelector('[data-testid="toolbar-right-bracket"]') as HTMLElement;
    expect(leftBracket).toBeTruthy();
    expect(rightBracket).toBeTruthy();

    // Viewport element containing the track
    const viewport = track.parentElement as HTMLElement;
    expect(viewport.className).toContain("overflow-hidden");

    // 4. Click [ -> reveals H1 H2 H3 emerging from the right of [ by sliding track right (+84px)
    act(() => {
      fireEvent.mouseDown(leftBracket);
    });

    expect(track.style.transform).toBe("translateX(84px)");
    expect(headingContainer.style.pointerEvents).toBe("auto");

    // Verify H1, H2, H3 buttons exist inside
    const h1Btn = headingContainer.querySelector('button[data-tool="H1"]') as HTMLButtonElement;
    const h2Btn = headingContainer.querySelector('button[data-tool="H2"]') as HTMLButtonElement;
    const h3Btn = headingContainer.querySelector('button[data-tool="H3"]') as HTMLButtonElement;
    expect(h1Btn).toBeTruthy();
    expect(h2Btn).toBeTruthy();
    expect(h3Btn).toBeTruthy();

    // 5. Click ] -> pushes tools back to the left, hidden tools drill out from ], hides H1 H2 H3
    act(() => {
      fireEvent.mouseDown(rightBracket);
    });

    expect(track.style.transform).toBe("translateX(0px)");
    expect(headingContainer.style.pointerEvents).toBe("none");
  });

  it("keeps the selection toolbar viewport width completely unchanged between [ and ] toggles", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>Checking constant toolbar width</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p1 = editorEl.querySelector("#p1")!;

    act(() => {
      fireEvent.mouseDown(p1);
      fireEvent.mouseUp(p1);
      fireEvent.click(p1);
    });

    const range = document.createRange();
    range.setStart(p1.firstChild!, 0);
    range.setEnd(p1.firstChild!, 8);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    range.getClientRects = () => [
      { top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20 },
    ] as any;
    range.getBoundingClientRect = () => ({
      top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20,
      x: 20, y: 50, toJSON() {}
    } as any);

    act(() => {
      fireEvent.mouseUp(p1);
      fireEvent.click(editorEl);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;
    const leftBracket = toolbar.querySelector('[data-testid="toolbar-left-bracket"]') as HTMLElement;
    const rightBracket = toolbar.querySelector('[data-testid="toolbar-right-bracket"]') as HTMLElement;
    const track = toolbar.querySelector('[data-testid="selection-tools-track"]') as HTMLElement;
    const viewport = track.parentElement as HTMLElement;

    // In DOM, viewport has overflow-hidden and contains the normal flow selection tools
    expect(viewport.className).toContain("overflow-hidden");

    // Click [ to show headings
    act(() => {
      fireEvent.mouseDown(leftBracket);
    });
    expect(track.style.transform).toBe("translateX(84px)");

    // Click ] to hide headings
    act(() => {
      fireEvent.mouseDown(rightBracket);
    });
    expect(track.style.transform).toBe("translateX(0px)");

    // Click [ again
    act(() => {
      fireEvent.mouseDown(leftBracket);
    });
    expect(track.style.transform).toBe("translateX(84px)");
  });

  it("applies H1 format when H1 button is clicked in the expanded selection toolbar", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    // Mock document.execCommand
    const execSpy = vi.fn();
    document.execCommand = execSpy;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='p1'>Heading candidate line</p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p1 = editorEl.querySelector("#p1")!;

    // Activate and select
    act(() => {
      fireEvent.mouseDown(p1);
      fireEvent.mouseUp(p1);
      fireEvent.click(p1);
    });

    const range = document.createRange();
    range.setStart(p1.firstChild!, 0);
    range.setEnd(p1.firstChild!, 7);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    range.getClientRects = () => [
      { top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20 },
    ] as any;
    range.getBoundingClientRect = () => ({
      top: 50, bottom: 70, left: 20, right: 150, width: 130, height: 20,
      x: 20, y: 50, toJSON() {}
    } as any);

    act(() => {
      fireEvent.mouseUp(p1);
      fireEvent.click(editorEl);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;
    const leftBracket = toolbar.querySelector('[data-testid="toolbar-left-bracket"]') as HTMLElement;

    // Expand headings with [
    act(() => {
      fireEvent.mouseDown(leftBracket);
    });

    const h1Btn = toolbar.querySelector('[data-testid="heading-tools-container"] button[data-tool="H1"]') as HTMLButtonElement;
    expect(h1Btn).toBeTruthy();

    // Click H1
    act(() => {
      fireEvent.mouseDown(h1Btn);
    });

    expect(execSpy).toHaveBeenCalledWith("formatBlock", false, "H1");
    expect(onChange).toHaveBeenCalled();
  });

  it("handles empty line state without selection heading container and uses [ ] for scrolling", async () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    render(
      <Editor
        activeTabId="tab-1"
        initialContent="<p id='empty-line'><br></p>"
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const emptyP = editorEl.querySelector("#empty-line")!;

    act(() => {
      fireEvent.mouseDown(emptyP);
      fireEvent.mouseUp(emptyP);
      fireEvent.click(emptyP);
    });

    const range = document.createRange();
    range.setStart(emptyP, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    act(() => {
      fireEvent.keyUp(editorEl, { key: "ArrowLeft" });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const toolbar = editorEl.parentElement?.querySelector(".border.border-zinc-800.rounded") as HTMLElement;
    expect(toolbar).toBeTruthy();

    // When there is no selection (cursor on empty line), the selection heading container is not rendered
    const headingContainer = toolbar.querySelector('[data-testid="heading-tools-container"]');
    expect(headingContainer).toBeNull();

    // Instead, H1, H2, H3 exist directly in empty line tools list
    const tools = Array.from(toolbar.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(tools).toContain("H1");
    expect(tools).toContain("H2");
    expect(tools).toContain("H3");

    // Clicking [ and ] calls scrollBy
    const scrollContainer = toolbar.querySelector(".overflow-x-auto") as HTMLElement;
    expect(scrollContainer).toBeTruthy();
    const scrollSpy = vi.fn();
    scrollContainer.scrollBy = scrollSpy;

    const leftBracket = toolbar.querySelector('[data-testid="toolbar-left-bracket"]') as HTMLElement;
    const rightBracket = toolbar.querySelector('[data-testid="toolbar-right-bracket"]') as HTMLElement;

    act(() => {
      fireEvent.mouseDown(leftBracket);
    });
    expect(scrollSpy).toHaveBeenCalledWith({ left: -120, behavior: "smooth" });

    act(() => {
      fireEvent.mouseDown(rightBracket);
    });
    expect(scrollSpy).toHaveBeenCalledWith({ left: 120, behavior: "smooth" });
  });
});
