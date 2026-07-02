export const MOBILE_BREAKPOINT = 768;
export const MOBILE_TOOLBAR_BASE_GAP = 12;
export const MOBILE_KEYBOARD_THRESHOLD = 80;
export const MOBILE_VISIBILITY_PADDING = 12;
export const DEFAULT_MOBILE_TOOLBAR_HEIGHT = 44;

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface ViewportMetrics {
  layoutWidth: number;
  viewportTop: number;
  viewportHeight: number;
  viewportBottom: number;
  keyboardInset: number;
  isKeyboardOpen: boolean;
  hasVisualViewport: boolean;
}

interface VisualViewportLike {
  height: number;
  offsetTop: number;
}

interface WindowLike {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: VisualViewportLike;
}

export function readViewportMetrics(win: WindowLike): ViewportMetrics {
  const vv = win.visualViewport;
  const viewportTop = vv?.offsetTop ?? 0;
  const viewportHeight = vv?.height ?? win.innerHeight;
  const keyboardInset = Math.max(0, win.innerHeight - viewportHeight - viewportTop);

  return {
    layoutWidth: win.innerWidth,
    viewportTop,
    viewportHeight,
    viewportBottom: viewportTop + viewportHeight,
    keyboardInset,
    isKeyboardOpen: keyboardInset > MOBILE_KEYBOARD_THRESHOLD,
    hasVisualViewport: !!vv,
  };
}

export function isMobileViewport(metrics: ViewportMetrics): boolean {
  return metrics.layoutWidth < MOBILE_BREAKPOINT;
}

export function calculateMobileToolbarBottom(
  metrics: ViewportMetrics,
  baseGap: number = MOBILE_TOOLBAR_BASE_GAP,
): number {
  return Math.max(baseGap, metrics.keyboardInset + baseGap);
}

export function getSelectionVisibleRect(range: Range): RectLike | null {
  const clientRects = range.getClientRects();

  if (clientRects.length > 0) {
    let top = clientRects[0].top;
    let bottom = clientRects[0].bottom;
    let left = clientRects[0].left;
    let right = clientRects[0].right;

    for (let i = 1; i < clientRects.length; i++) {
      const rect = clientRects[i];
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }

    return {
      top,
      bottom,
      left,
      right,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  const rect = range.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) {
    return null;
  }

  return rectToRectLike(rect);
}

export function rectToRectLike(rect: DOMRect | RectLike): RectLike {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}

export interface ScrollVisibilityOptions {
  toolbarHeight: number;
  toolbarBottomOffset: number;
  padding?: number;
}

export function calculateScrollDeltaForVisibility(
  targetRect: RectLike,
  metrics: ViewportMetrics,
  options: ScrollVisibilityOptions,
): number {
  const padding = options.padding ?? MOBILE_VISIBILITY_PADDING;
  const safeTop = metrics.viewportTop + padding;
  const safeBottom =
    metrics.viewportBottom - options.toolbarHeight - options.toolbarBottomOffset - padding;

  if (safeBottom <= safeTop) {
    return targetRect.top - safeTop;
  }

  if (targetRect.top < safeTop) {
    return targetRect.top - safeTop;
  }

  if (targetRect.bottom > safeBottom) {
    return targetRect.bottom - safeBottom;
  }

  return 0;
}
