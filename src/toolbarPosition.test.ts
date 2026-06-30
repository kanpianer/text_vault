/**
 * Unit tests for toolbarPosition utilities.
 *
 * We simulate DOM layout via jsdom so positioning calculations can be
 * verified against known geometry.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateSelectionPosition,
  calculateEmptyLinePosition,
} from "./toolbarPosition";

// ---------------------------------------------------------------------------
// Helpers to set up a fake container and faked getBoundingClientRect
// ---------------------------------------------------------------------------

/** Create a container div with a faked bounding rect. */
function createContainer(
  left: number,
  top: number,
  width: number,
  height: number,
): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON() {},
    }) as DOMRect;
  return el;
}

/** Create a text node inside a block element, then create a Range from it. */
function createTextRange(
  container: HTMLElement,
  text: string,
  selectAll: boolean,
): Range {
  const block = document.createElement("p");
  block.style.display = "block";
  const textNode = document.createTextNode(text);
  block.appendChild(textNode);
  container.appendChild(block);

  const range = document.createRange();
  if (selectAll && text.length > 0) {
    range.setStart(textNode, 0);
    range.setEnd(textNode, text.length);
  } else {
    range.selectNodeContents(block);
  }
  return range;
}

/** Override getClientRects on a range so it returns a specific rect list. */
function setRangeClientRects(range: Range, rects: DOMRect[]) {
  (range as any).getClientRects = () => {
    // Return a DOMRectList-like object
    const list = {
      length: rects.length,
      item: (i: number) => rects[i] ?? null,
      [Symbol.iterator]: () => rects[Symbol.iterator](),
    };
    // DOMRectList is not constructable in jsdom – fake via index access
    for (let i = 0; i < rects.length; i++) {
      (list as any)[i] = rects[i];
    }
    return list as unknown as DOMRectList;
  };
}

/** Create a faked DOMRect. */
function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

// ---------------------------------------------------------------------------
// Tests – Selection positioning
// ---------------------------------------------------------------------------

describe("calculateSelectionPosition", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer(0, 200, 800, 600);
  });

  it("positions toolbar below the last line of a single-line selection", () => {
    const range = createTextRange(container, "Hello world", true);
    setRangeClientRects(range, [rect(100, 250, 120, 20)]);

    const pos = calculateSelectionPosition(range, container, 200);

    // top = target.bottom - container.top + 3 (gap)
    expect(pos.top).toBe(250 + 20 - 200 + 3); // 73
    // left = targetCenter - containerCenter = (100 + 60) - 400 - 100 = -340 → clamped to 0
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.visibility).toBe("visible");
  });

  it("centres toolbar horizontally on the target line", () => {
    const range = createTextRange(container, "Hello", true);
    setRangeClientRects(range, [rect(400, 300, 100, 20)]);

    const pos = calculateSelectionPosition(range, container, 200);
    const targetCenter = 400 + 50; // 450
    const expectedLeft = targetCenter - container.getBoundingClientRect().left - 100; // 450 - 0 - 100 = 350
    expect(pos.left).toBe(expectedLeft);
    expect(pos.top).toBe(300 + 20 - 200 + 3); // 123
  });

  it("uses the **last** client rect for multi-line selections", () => {
    const range = createTextRange(container, "Line 1\nLine 2\nLine 3", true);
    setRangeClientRects(range, [
      rect(100, 250, 150, 20),
      rect(100, 272, 150, 20),
      rect(100, 294, 150, 20),
    ]);

    const pos = calculateSelectionPosition(range, container, 200);
    // last line: top 294, height 20 → bottom = 314
    expect(pos.top).toBe(314 - 200 + 3); // 117
    // targetCenter = 100 + 75 = 175; left = 175 - 100 = 75
    expect(pos.left).toBe(75);
  });

  it("clamps left to 0 when toolbar would overflow left edge", () => {
    const range = createTextRange(container, "Hi", true);
    setRangeClientRects(range, [rect(10, 300, 30, 20)]);

    const pos = calculateSelectionPosition(range, container, 300);
    // targetCenter = 10 + 15 = 25; left = 25 - 150 = -125 → clamped to 0
    expect(pos.left).toBe(0);
  });

  it("clamps left when toolbar would overflow right edge", () => {
    const range = createTextRange(container, "Hi", true);
    setRangeClientRects(range, [rect(750, 300, 50, 20)]);

    const pos = calculateSelectionPosition(range, container, 300);
    // targetCenter = 750 + 25 = 775; left = 775 - 150 = 625
    // maxLeft = 800 - 300 = 500 → clamped to 500
    expect(pos.left).toBe(500);
  });

  it("handles single-character selections correctly", () => {
    const range = createTextRange(container, "A", true);
    setRangeClientRects(range, [rect(200, 400, 10, 22)]);

    const pos = calculateSelectionPosition(range, container, 200);
    expect(pos.top).toBe(400 + 22 - 200 + 3); // 225
    // center = 205; left = 205 - 100 = 105
    expect(pos.left).toBe(105);
  });

  it("falls back to range.getBoundingClientRect when getClientRects returns empty", () => {
    const range = createTextRange(container, "Fallback", true);
    // Do NOT set client rects – let the native getBoundingClientRect work.
    // Override getClientRects on range to return an empty list.
    (range as any).getClientRects = () => ({ length: 0, item: () => null, 0: undefined, [Symbol.iterator]: [][Symbol.iterator]() });
    // set a faked bounding rect via range.getBoundingClientRect
    range.getBoundingClientRect = () => rect(300, 400, 120, 20);

    const pos = calculateSelectionPosition(range, container, 200);
    expect(pos.top).toBe(400 + 20 - 200 + 3); // 223
    expect(pos.left).toBe(300 + 60 - 100); // 260
  });
});

// ---------------------------------------------------------------------------
// Tests – Empty-line positioning
// ---------------------------------------------------------------------------

describe("calculateEmptyLinePosition", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer(0, 0, 700, 500);
  });

  it("positions toolbar right below the empty block", () => {
    const blockRect = rect(50, 100, 600, 24);
    const pos = calculateEmptyLinePosition(blockRect, container, 200);

    expect(pos.top).toBe(100 + 24 - 0 + 3); // 127
    const targetCenter = 50 + 300; // 350
    expect(pos.left).toBe(350 - 100); // 250
    expect(pos.visibility).toBe("visible");
  });

  it("centres toolbar over a narrow block", () => {
    const blockRect = rect(300, 200, 100, 20);
    const pos = calculateEmptyLinePosition(blockRect, container, 200);

    expect(pos.top).toBe(200 + 20 + 3); // 223
    expect(pos.left).toBe(300 + 50 - 100); // 250
  });

  it("clamps left for a block near the right edge", () => {
    const blockRect = rect(600, 400, 100, 20);
    const pos = calculateEmptyLinePosition(blockRect, container, 250);

    // maxLeft = 700 - 250 = 450
    expect(pos.left).toBe(450);
  });
});

// ---------------------------------------------------------------------------
// Regression – editor bottom-edge selection (viewport boundary)
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("near-editor-bottom selection still returns sensible coordinates", () => {
    const container = createContainer(0, 0, 800, 2000);
    const range = createTextRange(container, "Bottom line", true);
    setRangeClientRects(range, [rect(100, 1980, 100, 20)]);

    const pos = calculateSelectionPosition(range, container, 200);
    // top = 1980 + 20 - 0 + 3 = 2003 (may be outside container – that's fine,
    // toolbar scrolls naturally with the container)
    expect(pos.top).toBe(2003);
    expect(pos.visibility).toBe("visible");
  });
});
