/**
 * Mobile Toolbar Position Calculator
 *
 * Provides the fixed-bottom positioning logic for the text-action toolbar on mobile devices.
 *
 * Rules:
 *   1. Toolbar is ALWAYS `position: fixed; bottom: X` on mobile (width < 768px).
 *   2. When keyboard is visible, `bottom = keyboardHeight + safeAreaBottom + gap`.
 *   3. When keyboard is hidden, `bottom = safeAreaBottom + gap`.
 *   4. Horizontal centering via `left: 50%; transform: translateX(-50%)`.
 */

import type { ViewportState } from "./viewportManager";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gap between the viewport bottom edge (or keyboard top) and the toolbar top. */
const TOOLBAR_BOTTOM_GAP = 8;

/** Toolbar z-index when fixed at bottom. */
const TOOLBAR_Z_INDEX = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MobileToolbarStyle {
  position: "fixed";
  bottom: string;
  left: string;
  transform: string;
  zIndex: number;
  maxWidth: string;
  width: string;
}

export interface MobileToolbarState {
  /** The CSS style object for the toolbar container. */
  style: MobileToolbarStyle;
  /** The pixel height of the toolbar area including gap (for scroll offset calculations). */
  totalHeight: number;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Compute the fixed-bottom toolbar style for mobile.
 *
 * @param viewport     Current viewport state from `useMobileViewport`.
 * @param toolbarEl    The toolbar DOM element (to measure its height).
 *                    If null, uses a default estimate of 36px.
 * @returns            CSS style object and total height for scroll calculations.
 */
export function getMobileToolbarStyle(
  viewport: ViewportState,
  toolbarEl: HTMLElement | null,
): MobileToolbarState {
  const toolbarHeight = toolbarEl ? toolbarEl.getBoundingClientRect().height : 36;

  const keyboardH = viewport.isKeyboardVisible ? viewport.keyboardHeight : 0;
  const safeBottom = viewport.safeAreaBottom;

  // bottom = keyboard + safe-area + gap
  const bottomPx = keyboardH + safeBottom + TOOLBAR_BOTTOM_GAP;

  const style: MobileToolbarStyle = {
    position: "fixed",
    bottom: `${bottomPx}px`,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: TOOLBAR_Z_INDEX,
    // Leave some horizontal margin
    maxWidth: "calc(100vw - 2rem)",
    width: "max-content",
  };

  return {
    style,
    totalHeight: toolbarHeight + TOOLBAR_BOTTOM_GAP + safeBottom,
  };
}

/**
 * Calculate the scroll adjustment needed to keep a target element visible
 * above the fixed toolbar area.
 *
 * @param targetRect     The `getBoundingClientRect()` of the cursor/selection.
 * @param viewport       Current viewport state.
 * @param toolbarHeight  Pixel height of the toolbar (from `MobileToolbarState.totalHeight`).
 * @param padding        Extra padding above the toolbar (px).
 * @returns              Delta to pass to `window.scrollBy()`.
 */
export function getScrollAdjustment(
  targetRect: DOMRect,
  viewport: ViewportState,
  toolbarHeight: number,
  padding: number = 8,
): number {
  if (targetRect.height === 0 && targetRect.width === 0) return 0;

  const vvTop = viewport.viewportOffsetTop;
  const vvHeight = viewport.viewportHeight;
  const vvBottom = vvTop + vvHeight;

  // The top edge of the clearance zone (toolbar + padding from bottom)
  const clearTop = vvBottom - toolbarHeight - padding;

  if (targetRect.bottom > clearTop) {
    return targetRect.bottom - clearTop;
  }

  // If target is above the viewport, scroll down
  if (targetRect.top < vvTop + padding) {
    return targetRect.top - vvTop - padding;
  }

  return 0;
}

/**
 * Determine whether the current device is mobile based on viewport width.
 */
export function isMobileViewport(): boolean {
  return window.innerWidth < 768;
}
