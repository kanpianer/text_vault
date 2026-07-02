/**
 * Tests for mobileToolbarPosition.ts
 *
 * Covers:
 *   - getMobileToolbarStyle: normal (no keyboard), keyboard visible, safe area
 *   - getMobileToolbarStyle with null toolbar element (default height)
 *   - getScrollAdjustment: element below toolbar, fully visible
 *   - isMobileViewport: < 768 true, >= 768 false
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getMobileToolbarStyle, getScrollAdjustment, isMobileViewport } from "./mobileToolbarPosition";
import type { ViewportState } from "./viewportManager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vp(overrides: Partial<ViewportState> = {}): ViewportState {
  return {
    viewportHeight: 812,
    viewportWidth: 375,
    keyboardHeight: 0,
    isKeyboardVisible: false,
    viewportOffsetTop: 0,
    safeAreaBottom: 0,
    ...overrides,
  };
}

function createToolbarEl(height: number = 36): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 300,
      bottom: height,
      width: 300,
      height,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  return el;
}

function r(
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
// getMobileToolbarStyle
// ---------------------------------------------------------------------------

describe("getMobileToolbarStyle", () => {
  it("positions toolbar at bottom with safe area gap when no keyboard", () => {
    const state = vp({ isKeyboardVisible: false, safeAreaBottom: 0 });
    const toolbarEl = createToolbarEl(36);

    const result = getMobileToolbarStyle(state, toolbarEl);

    expect(result.style.position).toBe("fixed");
    expect(result.style.bottom).toBe("8px"); // 0 + 0 + 8
    expect(result.style.left).toBe("50%");
    expect(result.style.transform).toBe("translateX(-50%)");
    expect(result.style.zIndex).toBe(100);
    // totalHeight = toolbar (36) + gap (8) + safe (0) = 44
    expect(result.totalHeight).toBe(44);
  });

  it("accounts for safe area inset on iPhone X", () => {
    const state = vp({ isKeyboardVisible: false, safeAreaBottom: 34 });
    const toolbarEl = createToolbarEl(36);

    const result = getMobileToolbarStyle(state, toolbarEl);

    // bottom = 0 + 34 + 8 = 42
    expect(result.style.bottom).toBe("42px");
    // totalHeight = 36 + 8 + 34 = 78
    expect(result.totalHeight).toBe(78);
  });

  it("accounts for keyboard height when keyboard is visible", () => {
    const state = vp({
      isKeyboardVisible: true,
      keyboardHeight: 350,
      safeAreaBottom: 0,
    });
    const toolbarEl = createToolbarEl(36);

    const result = getMobileToolbarStyle(state, toolbarEl);

    // bottom = 350 + 0 + 8 = 358
    expect(result.style.bottom).toBe("358px");
    expect(result.totalHeight).toBe(44); // only toolbar + gap + safe, not keyboard
  });

  it("accounts for both keyboard and safe area simultaneously", () => {
    // iPhone with keyboard — keyboard above home indicator
    const state = vp({
      isKeyboardVisible: true,
      keyboardHeight: 300,
      safeAreaBottom: 34,
    });
    const toolbarEl = createToolbarEl(40);

    const result = getMobileToolbarStyle(state, toolbarEl);

    // bottom = 300 + 34 + 8 = 342
    expect(result.style.bottom).toBe("342px");
    // totalHeight = 40 + 8 + 34 = 82
    expect(result.totalHeight).toBe(82);
  });

  it("uses default height (36) when toolbar element is null", () => {
    const state = vp({ isKeyboardVisible: false, safeAreaBottom: 0 });

    const result = getMobileToolbarStyle(state, null);

    expect(result.style.bottom).toBe("8px");
    // totalHeight = 36 (default) + 8 + 0 = 44
    expect(result.totalHeight).toBe(44);
  });

  it("horizontal max-width fits within viewport", () => {
    const state = vp();
    const result = getMobileToolbarStyle(state, createToolbarEl(36));

    expect(result.style.maxWidth).toBe("calc(100vw - 2rem)");
    expect(result.style.width).toBe("max-content");
  });

  it("handles narrow keyboard (e.g. 160px floating keyboard on iPad)", () => {
    const state = vp({
      isKeyboardVisible: true,
      keyboardHeight: 160,
      safeAreaBottom: 20,
    });
    const result = getMobileToolbarStyle(state, createToolbarEl(36));

    expect(result.style.bottom).toBe("188px"); // 160 + 20 + 8
  });
});

// ---------------------------------------------------------------------------
// getScrollAdjustment
// ---------------------------------------------------------------------------

describe("getScrollAdjustment", () => {
  it("returns 0 when element is fully visible (no toolbar overlap)", () => {
    const state = vp();
    const targetRect = r(10, 300, 200, 20); // bottom = 320
    const adjustment = getScrollAdjustment(targetRect, state, 44, 8);
    expect(adjustment).toBe(0);
  });

  it("returns positive delta when element bottom is below clearance zone", () => {
    const state = vp();
    // clearanceTop = 0 + 812 - 44 - 8 = 760
    const targetRect = r(10, 750, 200, 20); // bottom = 770
    const adjustment = getScrollAdjustment(targetRect, state, 44, 8);
    // 770 - 760 = 10
    expect(adjustment).toBe(10);
  });

  it("returns negative delta when element top is above viewport", () => {
    const state = vp({ viewportOffsetTop: 200 });
    // clearanceTop = 200 + 812 - 44 - 8 = 960
    const targetRect = r(10, 190, 200, 20); // top = 190 < 200 + 8 = 208
    const adjustment = getScrollAdjustment(targetRect, state, 44, 8);
    // 190 - 200 - 8 = -18
    expect(adjustment).toBe(-18);
  });

  it("returns 0 for zero-area rect", () => {
    const state = vp();
    const targetRect = r(0, 0, 0, 0);
    const adjustment = getScrollAdjustment(targetRect, state, 44, 8);
    expect(adjustment).toBe(0);
  });

  it("accounts for keyboard in viewport state", () => {
    const state = vp({
      isKeyboardVisible: true,
      keyboardHeight: 350,
      viewportHeight: 462, // 812 - 350
    });
    // clearanceTop = 0 + 462 - 44 - 8 = 410
    const targetRect = r(10, 400, 200, 20); // bottom = 420 > 410
    const adjustment = getScrollAdjustment(targetRect, state, 44, 8);
    // 420 - 410 = 10
    expect(adjustment).toBe(10);
  });

  it("respects custom padding", () => {
    const state = vp();
    const targetRect = r(10, 700, 200, 20); // bottom = 720
    // default padding 8: clearance = 812 - 44 - 8 = 760 → no scroll
    expect(getScrollAdjustment(targetRect, state, 44, 8)).toBe(0);

    // padding 20: clearance = 812 - 44 - 20 = 748
    // still no scroll since 720 < 748
    expect(getScrollAdjustment(targetRect, state, 44, 20)).toBe(0);

    // Now with large toolbar
    const largeToolbarH = 100;
    // padding 8: clearance = 812 - 100 - 8 = 704 → 720 > 704 → scroll 16
    expect(getScrollAdjustment(targetRect, state, largeToolbarH, 8)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// isMobileViewport
// ---------------------------------------------------------------------------

describe("isMobileViewport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for mobile width (375px)", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 375,
      configurable: true,
    });
    expect(isMobileViewport()).toBe(true);
  });

  it("returns true for tablet portrait (767px)", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 767,
      configurable: true,
    });
    expect(isMobileViewport()).toBe(true);
  });

  it("returns false for tablet landscape (768px)", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 768,
      configurable: true,
    });
    expect(isMobileViewport()).toBe(false);
  });

  it("returns false for desktop (1440px)", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1440,
      configurable: true,
    });
    expect(isMobileViewport()).toBe(false);
  });
});
