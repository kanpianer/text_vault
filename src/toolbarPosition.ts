/**
 * Toolbar position calculation utilities.
 *
 * Computes pixel-accurate positions so the toolbar sits directly below
 * the relevant text line, horizontally centred, with a 3 px vertical gap.
 */

const VERTICAL_GAP = 3; // px between the bottom of the targeted line and the toolbar top

export interface ToolbarPosition {
  top: number;
  left: number;
  visibility: 'visible' | 'hidden';
}

/**
 * Narrow mutable helper to avoid reconstructing DOMRect objects.
 * Supports the same properties we read.
 */
interface RectLike {
  left: number;
  right: number;
  bottom: number;
  width: number;
}

/**
 * Calculate toolbar position for a text selection.
 *
 * Uses `range.getClientRects()` to find the **last visible line** of the
 * selection and positions the toolbar right below it, horizontally
 * centred.  Falls back to the full range rect when client rects are
 * unavailable.  The resulting coordinates are relative to the editor's
 * offset parent (the container that `position: absolute` refers to).
 */
export function calculateSelectionPosition(
  range: Range,
  editorContainer: HTMLElement,
  toolbarWidth: number,
): ToolbarPosition {
  const containerRect = editorContainer.getBoundingClientRect();

  // ---- resolve the "target line" rect ----
  const clientRects = range.getClientRects();
  let target: RectLike;

  if (clientRects.length > 0) {
    // Use the last client rect – this is where the selection ends visually.
    // Convert the DOMRectList to an array so we can index the last element.
    let last = clientRects[0];
    for (let i = 1; i < clientRects.length; i++) {
      last = clientRects[i];
    }
    target = last;
  } else {
    // Fallback: use the whole range bounding rect.
    target = range.getBoundingClientRect();
  }

  return computeFinalPosition(target, containerRect, toolbarWidth);
}

/**
 * Calculate toolbar position for an empty-line block element.
 *
 * Centres the toolbar horizontally over the block.
 */
export function calculateEmptyLinePosition(
  blockRect: DOMRect,
  editorContainer: HTMLElement,
  toolbarWidth: number,
): ToolbarPosition {
  const containerRect = editorContainer.getBoundingClientRect();
  return computeFinalPosition(blockRect, containerRect, toolbarWidth);
}

/**
 * Calculate toolbar position for an empty-line block element, left-aligned.
 *
 * Positions the toolbar left edge flush with the block's left edge so it
 * sits exactly at the cursor insertion point.  Clamps within container
 * boundaries to prevent overflow.
 */
export function calculateEmptyLinePositionLeft(
  blockRect: DOMRect,
  editorContainer: HTMLElement,
  toolbarWidth: number,
): ToolbarPosition {
  const containerRect = editorContainer.getBoundingClientRect();

  // Vertical: right below the target block, with a small gap
  const top = blockRect.bottom - containerRect.top + VERTICAL_GAP;

  // Horizontal: left-aligned to the block's left edge
  const rawLeft = blockRect.left - containerRect.left;

  // Clamp so the toolbar never overflows the container boundaries
  const maxLeft = Math.max(0, containerRect.width - toolbarWidth);
  const left = clamp(rawLeft, 0, maxLeft);

  return {
    top,
    left,
    visibility: 'visible',
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeFinalPosition(
  target: RectLike,
  containerRect: DOMRect,
  toolbarWidth: number,
): ToolbarPosition {
  // Vertical: right below the target block, with a small gap
  const top = target.bottom - containerRect.top + VERTICAL_GAP;

  // Horizontal: centre the toolbar over the target block
  const targetCenter = target.left + target.width / 2;
  const rawLeft = targetCenter - containerRect.left - toolbarWidth / 2;

  // Clamp so the toolbar never overflows the container boundaries
  const minLeft = 0;
  const maxLeft = Math.max(0, containerRect.width - toolbarWidth);
  const left = clamp(rawLeft, minLeft, maxLeft);

  return {
    top,
    left,
    visibility: 'visible',
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
