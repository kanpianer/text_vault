import { describe, it, expect, vi } from "vitest";
import React, { createRef } from "react";
import { render, fireEvent } from "@testing-library/react";
import { Editor, findCaretClosestToPoint, placeCaretClosestToPoint } from "./Editor";

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

  describe("Caret Positioning Between Checkboxes and Lines", () => {
    it("finds the closest line and closest character when mouse coordinates are between two checkboxes", () => {
      const container = document.createElement("div");
      container.innerHTML = `
        <p id="line1"><input type="checkbox" style="margin-right:8px" contenteditable="false">\u200Bjkgkhgl</p>
        <p id="line2" class="task-done"><input type="checkbox" checked="" style="margin-right:8px" contenteditable="false">\u200B都都分公司</p>
      `;
      document.body.appendChild(container);

      const p1 = container.querySelector("#line1") as HTMLParagraphElement;
      const p2 = container.querySelector("#line2") as HTMLParagraphElement;

      // Mock bounding rects:
      // Line 1: top: 10, bottom: 30
      // Gap: 30 to 42
      // Line 2: top: 42, bottom: 62
      vi.spyOn(p1, "getBoundingClientRect").mockReturnValue({
        top: 10,
        bottom: 30,
        left: 20,
        right: 200,
        width: 180,
        height: 20,
      } as DOMRect);

      vi.spyOn(p2, "getBoundingClientRect").mockReturnValue({
        top: 42,
        bottom: 62,
        left: 20,
        right: 200,
        width: 180,
        height: 20,
      } as DOMRect);

      // Click at y = 33 (closer to Line 1 bottom: 30, dist: 3; Line 2 top: 42, dist: 9)
      // x = 10 (at the checkbox, to the left of text)
      const range1 = findCaretClosestToPoint(10, 33, container);
      expect(range1).not.toBeNull();
      // Should land in Line 1 text node
      const tn1 = p1.childNodes[1] as Text;
      expect(range1?.startContainer).toBe(tn1);
      // Closest character to x=10 is the first character after zero-width space
      expect(range1?.startOffset).toBe(1);

      // Click at y = 39 (closer to Line 2 top: 42, dist: 3; Line 1 bottom: 30, dist: 9)
      // x = 10 (at the checkbox)
      const range2 = findCaretClosestToPoint(10, 39, container);
      expect(range2).not.toBeNull();
      const tn2 = p2.childNodes[1] as Text;
      expect(range2?.startContainer).toBe(tn2);
      expect(range2?.startOffset).toBe(1);

      document.body.removeChild(container);
    });

    it("places caret in the closest task line and never outside the document when clicking between checkboxes", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      const initialContent = `<p><input type="checkbox" style="margin-right:8px" contenteditable="false">\u200Bjkgkhgl</p><p class="task-done"><input type="checkbox" checked="" style="margin-right:8px" contenteditable="false">\u200B都都分公司</p>`;

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
      expect(paragraphs.length).toBe(2);

      const p1 = paragraphs[0];
      const p2 = paragraphs[1];

      vi.spyOn(p1, "getBoundingClientRect").mockReturnValue({
        top: 10,
        bottom: 30,
        left: 20,
        right: 200,
        width: 180,
        height: 20,
      } as DOMRect);

      vi.spyOn(p2, "getBoundingClientRect").mockReturnValue({
        top: 42,
        bottom: 62,
        left: 20,
        right: 200,
        width: 180,
        height: 20,
      } as DOMRect);

      // Simulate mousedown & click on editor root between the two checkboxes (y = 34, closer to p1)
      fireEvent.mouseDown(editorEl, { clientX: 10, clientY: 34 });
      fireEvent.mouseUp(editorEl, { clientX: 10, clientY: 34 });
      fireEvent.click(editorEl, { clientX: 10, clientY: 34 });

      const sel = window.getSelection()!;
      expect(sel.rangeCount).toBeGreaterThan(0);
      const range = sel.getRangeAt(0);

      // Caret must NEVER be on editorEl
      expect(range.startContainer).not.toBe(editorEl);
      // Caret must NEVER be at offset 0 before the checkbox
      expect(range.startContainer).not.toBe(p1);
      expect(range.startContainer).not.toBe(p2);

      // Caret must be inside p1's text node, after the checkbox
      expect(p1.contains(range.startContainer)).toBe(true);

      // No unexpected paragraph should have been appended at the bottom
      expect(editorEl.querySelectorAll("p").length).toBe(2);
    });

    it("appends a paragraph when clicking below all content in empty bottom space", () => {
      const editorRef = createRef<HTMLDivElement>();
      const onChange = vi.fn();

      const initialContent = `<p><input type="checkbox" style="margin-right:8px" contenteditable="false">\u200BOnly task</p>`;

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

      vi.spyOn(p1, "getBoundingClientRect").mockReturnValue({
        top: 10,
        bottom: 30,
        left: 20,
        right: 200,
        width: 180,
        height: 20,
      } as DOMRect);

      // Click way below content (e.g. y = 300)
      fireEvent.click(editorEl, { clientX: 50, clientY: 300 });

      // Should append a paragraph because click was below all content
      expect(editorEl.querySelectorAll("p").length).toBe(2);
    });
  });
});
