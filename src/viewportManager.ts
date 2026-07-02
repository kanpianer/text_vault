/**
 * Viewport & Keyboard State Manager for Mobile
 *
 * Provides:
 * 1. Cross-browser visualViewport access with WeChat/Android WebView fallbacks.
 * 2. Keyboard visibility and height detection via dual-strategy.
 * 3. `useMobileViewport()` — React Hook for reactive viewport state.
 * 4. `useScrollToVisible()` — React Hook to keep an element (cursor/selection)
 *    within the visible viewport, accounting for keyboard + toolbar.
 *
 * Compatible targets:
 *   - iOS Safari 14+
 *   - Chrome for Android
 *   - WeChat built-in browser (Android WebView)
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewportState {
  /** Visual viewport height (CSS px). Falls back to window.innerHeight. */
  viewportHeight: number;
  /** Visual viewport width. */
  viewportWidth: number;
  /** Estimated keyboard height in px. 0 when keyboard is hidden. */
  keyboardHeight: number;
  /** Whether the virtual keyboard is likely visible. */
  isKeyboardVisible: boolean;
  /** Visual viewport offset from the top of the page. */
  viewportOffsetTop: number;
  /** Safe area inset at the bottom (for iPhone notch / home indicator). */
  safeAreaBottom: number;
}

export interface ScrollToVisibleOptions {
  /** Height of the fixed toolbar at the bottom (px). Used to compute clearance. */
  toolbarHeight: number;
  /** Extra vertical padding (px) between the element and the toolbar top edge. */
  padding?: number;
  /** Scroll behaviour. */
  behavior?: ScrollBehavior;
}

// ---------------------------------------------------------------------------
// Helper: get safe-area-inset-bottom
// ---------------------------------------------------------------------------

function getSafeAreaBottom(): number {
  try {
    const style = getComputedStyle(document.documentElement);
    const raw = style.getPropertyValue("env(safe-area-inset-bottom)");
    if (!raw) return 0;
    const val = parseFloat(raw);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve visualViewport with WeChat WebView fallback
// ---------------------------------------------------------------------------

interface VvLike {
  height: number;
  width: number;
  offsetTop: number;
}

function getVv(): VvLike | null {
  const vv = window.visualViewport;
  if (!vv) return null;

  // Some WeChat/Android WebViews expose visualViewport but return 0 height.
  // Fall back to window.innerHeight for height in that case.
  const height = vv.height > 0 ? vv.height : window.innerHeight;

  return {
    height,
    width: vv.width > 0 ? vv.width : window.innerWidth,
    // offsetTop may be NaN in older WebViews — treat as 0
    offsetTop: isNaN(vv.offsetTop) ? 0 : vv.offsetTop,
  };
}

// ---------------------------------------------------------------------------
// Helper: compute keyboard height using dual strategy
// ---------------------------------------------------------------------------

function computeKeyboardHeight(): {
  keyboardHeight: number;
  isKeyboardVisible: boolean;
} {
  const vv = getVv();

  if (!vv) {
    // No visualViewport API at all — can't detect keyboard
    return { keyboardHeight: 0, isKeyboardVisible: false };
  }

  // Strategy 1: difference between layout viewport and visual viewport
  const diffFromInner = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

  // Strategy 2: visualViewport offsetTop (iOS Safari shifts entire viewport up)
  const offsetTop = Math.max(0, vv.offsetTop);

  // Use the larger of the two estimates as keyboard height
  const keyboardHeight = Math.max(diffFromInner, offsetTop, 0);

  // Keyboard is considered visible when estimated height exceeds a small threshold.
  // Lowered from 80 to 60 to catch smaller keyboards and IME bars.
  const isKeyboardVisible = keyboardHeight > 60;

  return { keyboardHeight, isKeyboardVisible };
}

// ---------------------------------------------------------------------------
// React Hook: useMobileViewport
// ---------------------------------------------------------------------------

export function useMobileViewport(): ViewportState & {
  /** Re-evaluate viewport state immediately (useful after layout changes). */
  refresh: () => void;
} {
  const [state, setState] = useState<ViewportState>(() => ({
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    ...computeKeyboardHeight(),
    viewportOffsetTop: getVv()?.offsetTop ?? 0,
    safeAreaBottom: getSafeAreaBottom(),
  }));

  // Track previous values to avoid unnecessary re-renders
  const prevRef = useRef<ViewportState | null>(null);

  const refresh = useCallback(() => {
    const vv = getVv();
    const kb = computeKeyboardHeight();
    const safe = getSafeAreaBottom();

    const next: ViewportState = {
      viewportHeight: vv?.height ?? window.innerHeight,
      viewportWidth: vv?.width ?? window.innerWidth,
      keyboardHeight: kb.keyboardHeight,
      isKeyboardVisible: kb.isKeyboardVisible,
      viewportOffsetTop: vv?.offsetTop ?? 0,
      safeAreaBottom: safe,
    };

    // Shallow equality check to avoid re-renders when nothing changed
    const prev = prevRef.current;
    if (
      !prev ||
      prev.viewportHeight !== next.viewportHeight ||
      prev.viewportWidth !== next.viewportWidth ||
      prev.keyboardHeight !== next.keyboardHeight ||
      prev.isKeyboardVisible !== next.isKeyboardVisible ||
      prev.safeAreaBottom !== next.safeAreaBottom
    ) {
      prevRef.current = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    refresh();

    const vv = window.visualViewport;

    // Use a single raf-debounced handler for both resize and scroll
    let rafId: number | null = null;
    const scheduleRefresh = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        refresh();
      });
    };

    vv?.addEventListener("resize", scheduleRefresh);
    vv?.addEventListener("scroll", scheduleRefresh);

    // Also listen to window resize as fallback for browsers without visualViewport
    window.addEventListener("resize", scheduleRefresh);

    // Observe safe-area changes (orientation change may alter insets)
    const orientationHandler = () => {
      // Small delay to let CSS env() variables settle
      setTimeout(refresh, 100);
    };
    window.addEventListener("orientationchange", orientationHandler);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      vv?.removeEventListener("resize", scheduleRefresh);
      vv?.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      window.removeEventListener("orientationchange", orientationHandler);
    };
  }, [refresh]);

  return { ...state, refresh };
}

// ---------------------------------------------------------------------------
// React Hook: useScrollToVisible
// ---------------------------------------------------------------------------

export function useScrollToVisible(options: {
  /** Ref to the editor container that scrolls. */
  editorRef: React.RefObject<HTMLElement | null>;
  /** Whether to scroll on mobile (< 768px) only. */
  mobileOnly?: boolean;
}) {
  const { editorRef, mobileOnly = true } = options;

  /**
   * Ensure a DOMRect is visible within the visual viewport.
   *
   * - If the rect extends below the toolbar area, scroll the page up.
   * - If the rect is above the viewport top, scroll down.
   */
  const scrollToMakeVisible = useCallback(
    (rect: DOMRect | null, opts: ScrollToVisibleOptions) => {
      if (!rect || rect.height === 0) return;
      if (mobileOnly && window.innerWidth >= 768) return;

      const vv = window.visualViewport;
      const toolbarH = opts.toolbarHeight;
      const padding = opts.padding ?? 8;
      const behavior = opts.behavior ?? "auto";

      if (vv) {
        // Use visualViewport API for accurate positioning
        const vvTop = vv.offsetTop;
        const vvHeight = vv.height > 0 ? vv.height : window.innerHeight;
        const vvBottom = vvTop + vvHeight;

        // Clear zone: bottom margin above the fixed toolbar
        const clearanceBottom = vvBottom - toolbarH - padding;

        if (rect.bottom > clearanceBottom) {
          // Element is hidden behind/below the toolbar area — scroll up
          const delta = rect.bottom - clearanceBottom;
          window.scrollBy({ top: Math.ceil(delta), left: 0, behavior });
        } else if (rect.top < vvTop + padding) {
          // Element is above the visible area — scroll down
          const delta = rect.top - vvTop - padding;
          window.scrollBy({ top: Math.floor(delta), left: 0, behavior });
        }
      } else {
        // Fallback: use window.innerHeight
        const clearanceBottom = window.innerHeight - toolbarH - padding;

        const rectAbsTop = rect.top + window.scrollY;
        const rectAbsBottom = rect.bottom + window.scrollY;

        if (rectAbsBottom > window.scrollY + clearanceBottom) {
          const delta = rectAbsBottom - (window.scrollY + clearanceBottom);
          window.scrollBy({ top: Math.ceil(delta), left: 0, behavior });
        } else if (rectAbsTop < window.scrollY + padding) {
          window.scrollBy({
            top: Math.floor(rectAbsTop - window.scrollY - padding),
            left: 0,
            behavior,
          });
        }
      }
    },
    [mobileOnly],
  );

  /**
   * Ensure a Range (selection) is partially visible.
   * Uses the last client rect of the selection or the focus node rect.
   */
  const ensureRangeVisible = useCallback(
    (range: Range, opts: ScrollToVisibleOptions) => {
      const clientRects = range.getClientRects();
      let targetRect: DOMRect | null = null;

      if (clientRects.length > 0) {
        // Use the last rect (end of selection)
        targetRect = clientRects[clientRects.length - 1];
      } else {
        // Fallback to focus node rect
        const node = range.endContainer;
        if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
          targetRect = node.parentElement.getBoundingClientRect();
        } else if (node instanceof Element) {
          targetRect = node.getBoundingClientRect();
        }
      }

      scrollToMakeVisible(targetRect, opts);
    },
    [scrollToMakeVisible],
  );

  /**
   * Ensure the element containing the collapsed cursor is visible.
   */
  const ensureCursorVisible = useCallback(
    (opts: ScrollToVisibleOptions) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.height === 0 && rect.width === 0) {
        // Collapsed cursor might have zero rect — use parent node
        let node: Node | null = sel.focusNode;
        if (node?.nodeType === Node.TEXT_NODE) {
          node = node.parentNode;
        }
        if (node instanceof Element) {
          scrollToMakeVisible(node.getBoundingClientRect(), opts);
        }
      } else {
        scrollToMakeVisible(rect, opts);
      }
    },
    [scrollToMakeVisible],
  );

  return { scrollToMakeVisible, ensureRangeVisible, ensureCursorVisible };
}
