import { describe, expect, it } from "vitest";
import {
  calculateMobileToolbarBottom,
  calculateScrollDeltaForVisibility,
  getSelectionVisibleRect,
  isMobileViewport,
  readViewportMetrics,
  type RectLike,
  type ViewportMetrics,
} from "./mobileViewport";

function makeMetrics(overrides: Partial<ViewportMetrics> = {}): ViewportMetrics {
  return {
    layoutWidth: 390,
    viewportTop: 0,
    viewportHeight: 640,
    viewportBottom: 640,
    keyboardInset: 0,
    isKeyboardOpen: false,
    hasVisualViewport: true,
    ...overrides,
  };
}

function makeRect(rect: Partial<RectLike> & Pick<RectLike, "top" | "bottom">): RectLike {
  const left = rect.left ?? 0;
  const right = rect.right ?? left + (rect.width ?? 0);
  const width = rect.width ?? Math.max(0, right - left);
  const height = rect.height ?? Math.max(0, rect.bottom - rect.top);

  return {
    top: rect.top,
    bottom: rect.bottom,
    left,
    right,
    width,
    height,
  };
}

function domRect(top: number, bottom: number, left: number, right: number): DOMRect {
  return {
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

describe("readViewportMetrics", () => {
  it("uses visualViewport metrics when available", () => {
    const metrics = readViewportMetrics({
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: {
        height: 520,
        offsetTop: 24,
      },
    });

    expect(metrics.viewportTop).toBe(24);
    expect(metrics.viewportHeight).toBe(520);
    expect(metrics.viewportBottom).toBe(544);
    expect(metrics.keyboardInset).toBe(300);
    expect(metrics.isKeyboardOpen).toBe(true);
    expect(metrics.hasVisualViewport).toBe(true);
  });

  it("falls back to innerHeight when visualViewport is unavailable", () => {
    const metrics = readViewportMetrics({
      innerWidth: 1024,
      innerHeight: 768,
    });

    expect(metrics.viewportTop).toBe(0);
    expect(metrics.viewportHeight).toBe(768);
    expect(metrics.keyboardInset).toBe(0);
    expect(metrics.isKeyboardOpen).toBe(false);
    expect(metrics.hasVisualViewport).toBe(false);
  });
});

describe("isMobileViewport", () => {
  it("detects widths below the breakpoint as mobile", () => {
    expect(isMobileViewport(makeMetrics({ layoutWidth: 767 }))).toBe(true);
  });

  it("treats breakpoint and above as desktop", () => {
    expect(isMobileViewport(makeMetrics({ layoutWidth: 768 }))).toBe(false);
  });
});

describe("calculateMobileToolbarBottom", () => {
  it("keeps a base gap when the keyboard is hidden", () => {
    expect(calculateMobileToolbarBottom(makeMetrics())).toBe(12);
  });

  it("adds keyboard inset to the fixed bottom offset", () => {
    expect(calculateMobileToolbarBottom(makeMetrics({ keyboardInset: 260 }))).toBe(272);
  });
});

describe("getSelectionVisibleRect", () => {
  it("merges multi-line client rects into one visible area", () => {
    const range = document.createRange();
    (range as any).getClientRects = () => {
      const rects = [
        domRect(100, 120, 10, 110),
        domRect(124, 144, 20, 130),
        domRect(148, 168, 5, 140),
      ];
      return {
        length: rects.length,
        item: (index: number) => rects[index] ?? null,
        0: rects[0],
        1: rects[1],
        2: rects[2],
        [Symbol.iterator]: () => rects[Symbol.iterator](),
      } as unknown as DOMRectList;
    };

    const rect = getSelectionVisibleRect(range);

    expect(rect).toEqual(
      makeRect({
        top: 100,
        bottom: 168,
        left: 5,
        right: 140,
        width: 135,
        height: 68,
      }),
    );
  });

  it("falls back to getBoundingClientRect when client rects are empty", () => {
    const range = document.createRange();
    (range as any).getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: () => [][Symbol.iterator](),
      }) as DOMRectList;
    range.getBoundingClientRect = () => domRect(200, 232, 16, 116);

    expect(getSelectionVisibleRect(range)).toEqual(
      makeRect({
        top: 200,
        bottom: 232,
        left: 16,
        right: 116,
        width: 100,
        height: 32,
      }),
    );
  });
});

describe("calculateScrollDeltaForVisibility", () => {
  it("returns 0 when the target is already inside the safe area", () => {
    const metrics = makeMetrics({ viewportHeight: 700, viewportBottom: 700 });
    const delta = calculateScrollDeltaForVisibility(
      makeRect({ top: 120, bottom: 160 }),
      metrics,
      { toolbarHeight: 44, toolbarBottomOffset: 12 },
    );

    expect(delta).toBe(0);
  });

  it("scrolls upward when the target is above the visible area", () => {
    const metrics = makeMetrics({ viewportTop: 20, viewportHeight: 600, viewportBottom: 620 });
    const delta = calculateScrollDeltaForVisibility(
      makeRect({ top: 10, bottom: 40 }),
      metrics,
      { toolbarHeight: 44, toolbarBottomOffset: 12 },
    );

    expect(delta).toBe(-22);
  });

  it("scrolls downward when the target would be hidden behind the toolbar", () => {
    const metrics = makeMetrics({ viewportHeight: 600, viewportBottom: 600, keyboardInset: 280 });
    const delta = calculateScrollDeltaForVisibility(
      makeRect({ top: 520, bottom: 548 }),
      metrics,
      { toolbarHeight: 44, toolbarBottomOffset: 292 },
    );

    expect(delta).toBe(296);
  });

  it("prefers top alignment when the safe area collapses under a tall keyboard", () => {
    const metrics = makeMetrics({
      viewportTop: 30,
      viewportHeight: 180,
      viewportBottom: 210,
      keyboardInset: 420,
      isKeyboardOpen: true,
    });
    const delta = calculateScrollDeltaForVisibility(
      makeRect({ top: 90, bottom: 110 }),
      metrics,
      { toolbarHeight: 44, toolbarBottomOffset: 432 },
    );

    expect(delta).toBe(48);
  });
});
