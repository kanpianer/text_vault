import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("Document Switcher Utilities", () => {
  function filterTabs(tabs: Array<{ id: string; title?: string; text: string }>, query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter((t) => {
      const rawTitle = (t.title || t.text.split("\n")[0] || "Untitled").toLowerCase();
      return rawTitle.includes(q);
    });
  }

  it("filters documents by keyword case-insensitively", () => {
    const tabs = [
      { id: "1", title: "Meeting Notes", text: "Discussion" },
      { id: "2", title: "Shopping List", text: "Apples, Oranges" },
      { id: "3", title: "Weekly Report", text: "Progress update" },
      { id: "4", text: "Important Note\nDetails here" },
    ];

    expect(filterTabs(tabs, "note").map((t) => t.id)).toEqual(["1", "4"]);
    expect(filterTabs(tabs, "SHOPPING").map((t) => t.id)).toEqual(["2"]);
    expect(filterTabs(tabs, "report").map((t) => t.id)).toEqual(["3"]);
    expect(filterTabs(tabs, "xyz")).toHaveLength(0);
    expect(filterTabs(tabs, "")).toHaveLength(4);
  });

  function calculateDocScrollProgress(scrollTop: number, scrollHeight: number, clientHeight: number) {
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) return { canScroll: false, progress: 0 };
    const progress = Math.min(1, Math.max(0, scrollTop / maxScroll));
    return { canScroll: true, progress };
  }

  it("calculates scroll progress and detects overflow correctly", () => {
    expect(calculateDocScrollProgress(0, 300, 400)).toEqual({ canScroll: false, progress: 0 });
    expect(calculateDocScrollProgress(0, 800, 400)).toEqual({ canScroll: true, progress: 0 });
    expect(calculateDocScrollProgress(200, 800, 400)).toEqual({ canScroll: true, progress: 0.5 });
    expect(calculateDocScrollProgress(400, 800, 400)).toEqual({ canScroll: true, progress: 1 });
    expect(calculateDocScrollProgress(-50, 800, 400).progress).toBe(0);
    expect(calculateDocScrollProgress(500, 800, 400).progress).toBe(1);
  });

  function calculatePopupWidth(editorWidth: number) {
    if (editorWidth > 0) {
      return Math.round(editorWidth / 2);
    }
    return 416;
  }

  it("calculates popup width as exactly half the editor width", () => {
    expect(calculatePopupWidth(832)).toBe(416);
    expect(calculatePopupWidth(600)).toBe(300);
    expect(calculatePopupWidth(360)).toBe(180);
  });

  function shouldPreventParentScroll(
    deltaY: number,
    scrollTop: number,
    scrollHeight: number,
    clientHeight: number
  ) {
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) return true;
    const isAtTop = scrollTop <= 0;
    const isAtBottom = scrollTop >= maxScroll - 0.5;
    if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
      return true;
    }
    return false;
  }

  it("correctly identifies when background scrolling should be locked", () => {
    expect(shouldPreventParentScroll(10, 0, 300, 400)).toBe(true);
    expect(shouldPreventParentScroll(-10, 0, 300, 400)).toBe(true);
    expect(shouldPreventParentScroll(10, 50, 800, 400)).toBe(false);
    expect(shouldPreventParentScroll(-10, 0, 800, 400)).toBe(true);
    expect(shouldPreventParentScroll(10, 400, 800, 400)).toBe(true);
  });

  it("reorders list items correctly when dragging up or down", () => {
    function reorderList<T>(list: T[], fromIndex: number, toIndex: number): T[] {
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return list;
      const copy = [...list];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      return copy;
    }

    const tabs = ["Tab A", "Tab B", "Tab C", "Tab D"];
    expect(reorderList(tabs, 0, 2)).toEqual(["Tab B", "Tab C", "Tab A", "Tab D"]);
    expect(reorderList(tabs, 3, 0)).toEqual(["Tab D", "Tab A", "Tab B", "Tab C"]);
    expect(reorderList(tabs, 1, 1)).toEqual(tabs);
  });
});

describe("App Document Switcher Component Integration", () => {
  beforeEach(() => {
    window.history.pushState({}, "Test", "/testpop");
  });

  it("opens popup on hovering Text_Vault/ without black screen / crash", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/check")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ exists: false }),
        });
      }
      if (url.includes("/create")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Create Vault Password/i)).toBeInTheDocument();
    });

    const pwdInputs = screen.getAllByPlaceholderText(/••••••••/i);
    fireEvent.change(pwdInputs[0], { target: { value: "ValidPass123!" } });
    fireEvent.change(pwdInputs[1], { target: { value: "ValidPass123!" } });

    const createBtn = screen.getByText("Initialize");
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/Text_Vault\//i)).toBeInTheDocument();
    });

    const trigger = screen.getByText(/Text_Vault\//i);
    expect(trigger.className).toContain("text-zinc-500");
    expect(trigger.className).toContain("group-hover:text-white");
    const vaultNameEl = trigger.nextElementSibling;
    expect(vaultNameEl?.className).toContain("text-white");
    expect(vaultNameEl?.className).toContain("group-hover:text-zinc-500");

    // Hover over Text_Vault/
    fireEvent.mouseEnter(trigger);

    // Document popup appears successfully without crash
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search documents.../i)).toBeInTheDocument();
    });

    // Verify search works
    const searchInput = screen.getByPlaceholderText(/Search documents.../i);
    expect(searchInput.className).toContain("text-base");
    expect(searchInput.className).toContain("md:text-lg");
    fireEvent.change(searchInput, { target: { value: "notfoundtitle" } });
    expect(screen.getByText(/No matching documents/i)).toBeInTheDocument();

    // Clear search and check active document title styling
    fireEvent.change(searchInput, { target: { value: "" } });
    const tab1Items = screen.getAllByTitle("Tab 1");
    // Only one occurrence now: inside the popup document list (header no longer displays doc title)
    expect(tab1Items).toHaveLength(1);
    const activeDocTitle = tab1Items[0];
    expect(activeDocTitle).toBeInTheDocument();
    expect(activeDocTitle.className).toContain("text-white");
    expect(activeDocTitle.className).toContain("border-zinc-300");
    expect(activeDocTitle.className).toContain("border-b-[1.5px]");
    expect(activeDocTitle.className).toContain("text-base");
    expect(activeDocTitle.className).toContain("md:text-lg");

    // Ensure parent row has reduced padding (distance reduced by another 1/4) and matches editor font size
    const rowEl = activeDocTitle.closest(".group");
    expect(rowEl?.className).not.toContain("bg-zinc-800/60");
    expect(rowEl?.className).not.toContain("hover:bg-");
    expect(rowEl?.className).toContain("text-base");
    expect(rowEl?.className).toContain("md:text-lg");
    expect(rowEl?.className).toContain("py-0.5");
    expect(rowEl?.className).not.toContain("py-2");

    // Verify white dot indicator: size reduced by 1/3 to 5.33px, vertically centered with font horizontal center
    const dot = activeDocTitle.previousElementSibling as HTMLElement;
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain("bg-white");
    expect(dot?.className).toContain("rounded-full");
    expect(dot?.className).toContain("-translate-y-[1.5px]");
    expect(dot?.style.width).toBe("5.33px");
    expect(dot?.style.height).toBe("5.33px");
    expect(dot?.style.boxShadow).toBe("");

    // Verify + button is placed next to Text_Vault/ in the top navigation bar (NEW text removed, only +)
    const newBtn = screen.getByTitle("New Document");
    expect(newBtn).toBeInTheDocument();
    expect(newBtn.textContent).not.toContain("NEW");
    const navLeftContainer = trigger.parentElement?.parentElement;
    expect(navLeftContainer).toContainElement(newBtn);
    expect(navLeftContainer?.textContent).not.toContain("Tab 1"); // Header does NOT show document title

    // Clicking + creates a new document with an H1 line
    fireEvent.click(newBtn);
    await waitFor(() => {
      const editorH1 = document.querySelector(".editor-body h1");
      expect(editorH1).toBeInTheDocument();
    });

    // Re-open doc switcher to verify new tab is placed at the top of the list
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search documents.../i)).toBeInTheDocument();
    });

    const docItemsBefore = document.querySelectorAll("[data-tab-id]");
    expect(docItemsBefore.length).toBe(2);
    // Newly created document is at index 0 (top of document list)
    expect(docItemsBefore[0].textContent).toContain("untitled");
    expect(docItemsBefore[1].textContent).toContain("Tab 1");

    // Click delete tab on the newly created tab at the top
    const deleteBtns = screen.getAllByTitle("Delete Doc");
    expect(deleteBtns.length).toBeGreaterThan(0);
    fireEvent.click(deleteBtns[0]);

    // Verify delete confirmation prompt text and doc title with text-base md:text-lg font size and desktop positioning
    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to delete this doc？/i)).toBeInTheDocument();
      const deleteDocTitle = screen.getByText("untitled");
      expect(deleteDocTitle).toBeInTheDocument();
      expect(deleteDocTitle.className).toContain("text-base");
      expect(deleteDocTitle.className).toContain("md:text-lg");

      // Verify modal position matches delete vault positioning on desktop (md:items-start md:pt-[28vh])
      const modalWrapper = deleteDocTitle.closest(".fixed");
      expect(modalWrapper?.className).toContain("md:items-start");
      expect(modalWrapper?.className).toContain("md:pt-[28vh]");
    });

    // Cancel deletion
    const cancelBtn = screen.getByText("Cancel");
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByText(/are you sure you want to delete this doc？/i)).not.toBeInTheDocument();
    });

    // Verify TIMER hover opens dropdown automatically
    const timerTrigger = screen.getByText("TIMER");
    expect(screen.queryByText("5 MIN")).not.toBeInTheDocument();

    // Hover over TIMER trigger
    fireEvent.mouseEnter(timerTrigger.parentElement!);
    await waitFor(() => {
      expect(screen.getByText("5 MIN")).toBeInTheDocument();
      expect(screen.getByText("10 MIN")).toBeInTheDocument();
      expect(screen.getByText("15 MIN")).toBeInTheDocument();
      expect(screen.getByText("30 MIN")).toBeInTheDocument();
    });

    // Mouse leave TIMER closes dropdown
    fireEvent.mouseLeave(timerTrigger.parentElement!);
    await waitFor(() => {
      expect(screen.queryByText("5 MIN")).not.toBeInTheDocument();
    });

    // Re-open doc switcher to test long-press reordering
    fireEvent.mouseEnter(trigger);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search documents.../i)).toBeInTheDocument();
    });

    const docItems = document.querySelectorAll("[data-tab-id]");
    expect(docItems.length).toBeGreaterThanOrEqual(2);

    // Mock bounding client rects for rows and list container
    const docList = docItems[0].parentElement!;
    docList.getBoundingClientRect = () => ({
      top: 100,
      bottom: 300,
      left: 0,
      right: 200,
      width: 200,
      height: 200,
      x: 0,
      y: 100,
      toJSON: () => {},
    });
    docItems[0].getBoundingClientRect = () => ({
      top: 100,
      bottom: 130,
      left: 0,
      right: 200,
      width: 200,
      height: 30,
      x: 0,
      y: 100,
      toJSON: () => {},
    });
    docItems[1].getBoundingClientRect = () => ({
      top: 131,
      bottom: 160,
      left: 0,
      right: 200,
      width: 200,
      height: 30,
      x: 0,
      y: 131,
      toJSON: () => {},
    });

    // Start pointer down on first item
    fireEvent.pointerDown(docItems[0], { clientX: 50, clientY: 110, button: 0 });

    // Wait for long-press timer (>280ms)
    await new Promise((r) => setTimeout(r, 320));

    // Pointer move down into second item's vertical range
    fireEvent.pointerMove(window, { clientX: 50, clientY: 145 });

    // Pointer up to release drag
    fireEvent.pointerUp(window);

    // Document popup should remain open (not close on drag finish)
    expect(screen.getByPlaceholderText(/Search documents.../i)).toBeInTheDocument();

    // Verify tabs order reordered and marked unsaved
    await waitFor(() => {
      expect(screen.getByText(/\[UNSAVED\]/i)).toBeInTheDocument();
    });
  });
});

import { updateH1Placeholders } from "./Editor";

describe("H1 Placeholder and Title Mechanics", () => {
  it("sets untitled placeholder on empty H1 when not focused and removes it on cursor focus", () => {
    const container = document.createElement("div");
    container.tabIndex = 0;
    const h1 = document.createElement("h1");
    h1.innerHTML = "<br>";
    container.appendChild(h1);
    document.body.appendChild(container);

    // Initially not focused
    updateH1Placeholders(container);
    expect(h1.getAttribute("data-placeholder")).toBe("untitled");

    // Set focus and selection inside H1
    container.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(h1);
    sel?.removeAllRanges();
    sel?.addRange(range);

    updateH1Placeholders(container);
    expect(h1.hasAttribute("data-placeholder")).toBe(false);

    // When user types text
    h1.textContent = "My New Note";
    updateH1Placeholders(container);
    expect(h1.hasAttribute("data-placeholder")).toBe(false);

    // Blur container
    container.blur();
    sel?.removeAllRanges();
    updateH1Placeholders(container);
    expect(h1.hasAttribute("data-placeholder")).toBe(false); // still has text

    // Clear text
    h1.innerHTML = "<br>";
    updateH1Placeholders(container);
    expect(h1.getAttribute("data-placeholder")).toBe("untitled");

    document.body.removeChild(container);
  });
});

describe("Shared Document View Dividers", () => {
  it("renders shared document view without borders on header or footer", async () => {
    window.history.pushState({}, "", "/share/testdoc123");
    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "testdoc123",
        hasPassword: false,
        encryptedData: "abc",
        encryptionMode: "public",
        rawKeyHex: "123",
      }),
    } as any);

    render(<App />);

    await waitFor(() => {
      const header = document.querySelector("header");
      expect(header).toBeInTheDocument();
      expect(header?.className).not.toContain("border-b");

      const footer = document.querySelector("footer");
      expect(footer).toBeInTheDocument();
      expect(footer?.className).not.toContain("border-t");
    });
  });
});

describe("Unified Black Background #090a0b", () => {
  it("uses #090a0b for shared view page, header, and main container", async () => {
    window.history.pushState({}, "", "/share/testdoc123");
    render(<App />);

    await waitFor(() => {
      const pageWrapper = document.querySelector(".min-h-screen");
      expect(pageWrapper?.className).toContain("bg-[#090a0b]");

      const header = document.querySelector("header");
      expect(header?.className).toContain("bg-[#090a0b]/95");

      const mainContainer = document.querySelector("main");
      expect(mainContainer?.className).toContain("bg-[#090a0b]");
    });
  });
});


