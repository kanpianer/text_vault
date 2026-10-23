import { describe, it, expect, vi } from "vitest";
import React, { createRef } from "react";
import { render, fireEvent } from "@testing-library/react";
import { Editor, adjustTaskSelection } from "./Editor";

describe("Task Checkbox Independent Strikethrough", () => {
  it("only marks the clicked task line with task-done, leaving other lines untouched", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<h1>My Document Title</h1><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Buy apples</p><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Buy oranges</p><p>Normal notes paragraph</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const h1 = editorEl.querySelector("h1")!;
    const paragraphs = editorEl.querySelectorAll("p");
    expect(paragraphs.length).toBe(3);

    const pTask1 = paragraphs[0];
    const pTask2 = paragraphs[1];
    const pNotes = paragraphs[2];

    const cb1 = pTask1.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const cb2 = pTask2.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(cb1.checked).toBe(false);
    expect(pTask1.classList.contains("task-done")).toBe(false);

    // Click checkbox 1 to check it
    fireEvent.click(cb1);

    // Verify checkbox 1 is checked and ONLY pTask1 has task-done
    expect(cb1.checked).toBe(true);
    expect(pTask1.classList.contains("task-done")).toBe(true);
    expect(pTask1.getAttribute("class")).toContain("task-done");

    // Verify h1, task 2, and notes paragraph DO NOT have task-done
    expect(h1.classList.contains("task-done")).toBe(false);
    expect(pTask2.classList.contains("task-done")).toBe(false);
    expect(pNotes.classList.contains("task-done")).toBe(false);
    expect(cb2.checked).toBe(false);

    // Verify editor root container NEVER has task-done
    expect(editorEl.classList.contains("task-done")).toBe(false);

    // Click checkbox 1 again to uncheck it
    fireEvent.click(cb1);
    expect(cb1.checked).toBe(false);
    expect(pTask1.classList.contains("task-done")).toBe(false);
  });

  it("handles tasks inside nested wrapper divs without marking the wrapper div as task-done", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<div class="content-wrapper"><h1>Title</h1><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Single Task</p><p>Another line</p></div>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const wrapper = editorEl.querySelector(".content-wrapper") as HTMLDivElement;
    expect(wrapper).toBeTruthy();

    const cb = editorEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const taskP = cb.parentElement!;

    fireEvent.click(cb);

    expect(cb.checked).toBe(true);
    expect(taskP.classList.contains("task-done")).toBe(true);
    expect(wrapper.classList.contains("task-done")).toBe(false);
    expect(editorEl.classList.contains("task-done")).toBe(false);
  });

  it("normalizes a top-level checkbox directly under root into its own paragraph and never puts task-done on root", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<input type="checkbox" style="margin-right:8px" contenteditable="false">Root task<p>Following paragraph</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const cb = editorEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const followingP = editorEl.querySelectorAll("p")[1];

    expect(cb.parentElement).not.toBe(editorEl);
    expect(cb.parentElement?.tagName).toBe("P");

    fireEvent.click(cb);

    expect(cb.checked).toBe(true);
    expect(cb.parentElement?.classList.contains("task-done")).toBe(true);
    expect(followingP.classList.contains("task-done")).toBe(false);
    expect(editorEl.classList.contains("task-done")).toBe(false);
  });

  it("clears task-done when a task checkbox is deleted via Backspace", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<p><input type="checkbox" checked="" style="margin-right:8px" contenteditable="false">Done Task</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p = editorEl.querySelector("p")!;
    expect(p.classList.contains("task-done")).toBe(true);

    const cb = p.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const textNode = p.childNodes[1];

    // Caret right at start before any text (after cb and zw)
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 0);
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.keyDown(editorEl, { key: "Backspace" });

    // Checkbox is removed and task-done class is cleared from paragraph
    expect(p.querySelector('input[type="checkbox"]')).toBeNull();
    expect(p.classList.contains("task-done")).toBe(false);
  });

  it("auto-creates next task without inheriting task-done when Enter is pressed on checked task", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<p><input type="checkbox" checked="" style="margin-right:8px" contenteditable="false">First task</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p1 = editorEl.querySelector("p")!;
    expect(p1.classList.contains("task-done")).toBe(true);

    const textNode = p1.childNodes[1];
    const sel = window.getSelection()!;
    const range = document.createRange();
    // Caret at end of first task text
    range.setStart(textNode, textNode.textContent?.length || 0);
    range.setEnd(textNode, textNode.textContent?.length || 0);
    sel.removeAllRanges();
    sel.addRange(range);

    // Fire beforeinput for Enter
    const beforeInputEvent = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertParagraph",
    });
    editorEl.dispatchEvent(beforeInputEvent);

    const paragraphs = editorEl.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);

    const p2 = paragraphs[1];
    const cb2 = p2.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb2).toBeTruthy();
    expect(cb2.checked).toBe(false);
    // New task MUST NOT have task-done
    expect(p2.classList.contains("task-done")).toBe(false);
    expect(p1.classList.contains("task-done")).toBe(true);
  });

  it("clears task-done when exiting task mode on empty task line with Enter", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    // Checked empty task (e.g. checked while empty)
    const initialContent = `<p class="task-done"><input type="checkbox" checked="" style="margin-right:8px" contenteditable="false">\u200B</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const p = editorEl.querySelector("p")!;
    expect(p.classList.contains("task-done")).toBe(true);

    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(p, 0);
    sel.removeAllRanges();
    sel.addRange(range);

    const beforeInputEvent = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertParagraph",
    });
    editorEl.dispatchEvent(beforeInputEvent);

    expect(p.querySelector('input[type="checkbox"]')).toBeNull();
    // Exiting task mode MUST clear task-done
    expect(p.classList.contains("task-done")).toBe(false);
  });

  it("prevents caret from being positioned before task checkbox and moves it after checkbox", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<p><input type="checkbox" style="margin-right:8px" contenteditable="false">First task</p><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Second task</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const paragraphs = editorEl.querySelectorAll("p");
    const p2 = paragraphs[1];

    // Put selection before checkbox (offset 0 in p2)
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(p2, 0);
    range.setEnd(p2, 0);
    sel.removeAllRanges();
    sel.addRange(range);

    adjustTaskSelection(editorEl);

    // Verify selection is now in the text node after the checkbox
    const currentRange = sel.getRangeAt(0);
    const cb2 = p2.querySelector('input[type="checkbox"]')!;
    expect(currentRange.startContainer).not.toBe(p2);
    expect(currentRange.startContainer).not.toBe(cb2);
    expect(currentRange.startContainer.nodeType).toBe(Node.TEXT_NODE);
  });

  it("adjusts selection when caret is placed on root container between two task lines", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<p><input type="checkbox" style="margin-right:8px" contenteditable="false">First task</p><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Second task</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;

    // Set selection directly on root element at offset 1 (between p1 and p2)
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(editorEl, 1);
    range.setEnd(editorEl, 1);
    sel.removeAllRanges();
    sel.addRange(range);

    adjustTaskSelection(editorEl);

    // Verify selection was moved inside p2 after its checkbox
    const currentRange = sel.getRangeAt(0);
    expect(currentRange.startContainer).not.toBe(editorEl);
    expect(currentRange.startContainer.nodeType).toBe(Node.TEXT_NODE);
  });

  it("handles ArrowLeft at the start of task text by navigating to previous block instead of before checkbox", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<p><input type="checkbox" style="margin-right:8px" contenteditable="false">First task</p><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Second task</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const paragraphs = editorEl.querySelectorAll("p");
    const p1 = paragraphs[0];
    const p2 = paragraphs[1];

    const textNode2 = p2.childNodes[1] as Text;

    // Caret at start of task 2 text
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode2, 0);
    range.setEnd(textNode2, 0);
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.keyDown(editorEl, { key: "ArrowLeft" });

    // Caret should have moved to previous paragraph (p1), NOT before p2's checkbox
    const newRange = sel.getRangeAt(0);
    expect(p1.contains(newRange.startContainer)).toBe(true);
  });

  it("handles clicking between two task lines on editor container without appending bottom paragraph", () => {
    const editorRef = createRef<HTMLDivElement>();
    const onChange = vi.fn();

    const initialContent = `<p><input type="checkbox" style="margin-right:8px" contenteditable="false">First task</p><p><input type="checkbox" style="margin-right:8px" contenteditable="false">Second task</p>`;

    render(
      <Editor
        activeTabId="tab-1"
        initialContent={initialContent}
        onChange={onChange}
        editorRef={editorRef}
        readOnly={false}
      />
    );

    const editorEl = editorRef.current!;
    const paragraphs = editorEl.querySelectorAll("p");
    const p1 = paragraphs[0];
    const p2 = paragraphs[1];

    // Mock bounding client rects for layout
    p1.getBoundingClientRect = () => ({
      top: 10,
      bottom: 30,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 10,
      toJSON: () => {},
    });
    p2.getBoundingClientRect = () => ({
      top: 40,
      bottom: 60,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 40,
      toJSON: () => {},
    });

    // Simulate clicking in the gap between p1 and p2 (clientY = 35)
    fireEvent.click(editorEl, { clientX: 20, clientY: 35 });

    // Ensure no new paragraph was appended at bottom (still 2 paragraphs)
    expect(editorEl.querySelectorAll("p").length).toBe(2);

    // Caret should be inside one of the paragraphs after its checkbox
    const sel = window.getSelection()!;
    const currentRange = sel.getRangeAt(0);
    expect(currentRange.startContainer.nodeType).toBe(Node.TEXT_NODE);
  });
});
