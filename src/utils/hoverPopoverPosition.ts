/** Snapshot of getBoundingClientRect() for viewport-fixed hover popovers */
export type HoverAnchorRect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
};

export function rectFromElement(el: HTMLElement | null | undefined): HoverAnchorRect | null {
  if (el == null || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    bottom: r.bottom,
    right: r.right,
    width: r.width,
    height: r.height,
  };
}

export type HoverPopoverPositionResult = {
  left: number;
  top: number;
  /**
   * When set, pin the popover above the anchor with `position: fixed; top: auto; bottom: <value>`.
   * Popover bottom sits `offset` px above the anchor's top edge.
   */
  bottom?: number;
  maxCardH: number;
  width: number;
};

/**
 * Position a fixed popover near the hovered appointment block (anchor) or fallback to cursor (x,y).
 * Default: prefers to the right of the block, then left; on narrow viewports places full-width below the block.
 * With preferSide: 'left', tries left of the block first (e.g. My Week when drive bands sit on the right).
 *
 * Vertically: when the anchor is near the bottom of the viewport, prefers opening above the block
 * (more room above than below) so the card stays on-screen; otherwise opens below / beside as before.
 */
export function computeHoverPopoverPosition(args: {
  anchor: HoverAnchorRect | null | undefined;
  x: number;
  y: number;
  vwW: number;
  vwH: number;
  cardMaxW: number;
  cardMinW: number;
  padding: number;
  offset: number;
  /** Prefer opening to the left of the anchor first (default: right). */
  preferSide?: 'left' | 'right';
}): HoverPopoverPositionResult {
  const { anchor, x, y, vwW, vwH, cardMaxW, cardMinW, padding, offset, preferSide = 'right' } = args;
  const maxCardHCap = Math.min(vwH * 0.7, vwH - 2 * padding);
  const maxUsableW = Math.max(0, vwW - 2 * padding);
  let cardWidth = Math.min(cardMaxW, maxUsableW);

  let left: number;
  let top: number;
  /** Full-width row under the anchor (narrow viewport) vs beside the anchor */
  let narrowBelow = false;

  if (anchor) {
    if (preferSide === 'left') {
      left = anchor.left - offset - cardWidth;
      if (left < padding || left + cardWidth > vwW - padding) {
        left = anchor.right + offset;
      }
      if (left < padding || left + cardWidth > vwW - padding) {
        left = padding;
        top = anchor.bottom + offset;
        cardWidth = maxUsableW;
        narrowBelow = true;
      } else {
        top = anchor.top;
      }
    } else {
      left = anchor.right + offset;
      if (left + cardWidth > vwW - padding) {
        left = anchor.left - offset - cardWidth;
      }
      if (left < padding || left + cardWidth > vwW - padding) {
        left = padding;
        top = anchor.bottom + offset;
        cardWidth = maxUsableW;
        narrowBelow = true;
      } else {
        top = anchor.top;
      }
    }
  } else {
    left = x - offset - cardWidth;
    if (left < padding) left = x + offset;
    if (left + cardWidth > vwW - padding) left = Math.max(padding, vwW - padding - cardWidth);
    top = y - 12;
  }

  const width = Math.min(Math.max(cardMinW, cardWidth), maxUsableW);

  if (anchor) {
    const spaceAbove = Math.max(0, anchor.top - padding - offset);
    const spaceBelow = narrowBelow
      ? Math.max(0, vwH - padding - anchor.bottom - offset)
      : Math.max(0, vwH - padding - anchor.top);
    const minComfortAbove = 72;
    /** Prefer flipping up only when there is not enough room below for a comfortable card. */
    const comfortableBelow = Math.min(380, maxCardHCap);
    const crampedBelow = spaceBelow < comfortableBelow;
    const preferAbove =
      crampedBelow &&
      spaceAbove > spaceBelow &&
      spaceAbove >= minComfortAbove;

    if (preferAbove) {
      const bottom = vwH - anchor.top + offset;
      const maxCardH = Math.min(maxCardHCap, spaceAbove);
      return { left, top: padding, bottom, maxCardH, width };
    }
  }

  top = Math.max(padding, top);
  // Cap card height by space *below* `top` so we don't clamp `top` upward to fit an oversized max height
  // (that used to pin the popover to the top of the viewport while the anchor stayed low, e.g. 3 PM).
  const maxCardH = Math.min(maxCardHCap, Math.max(0, vwH - padding - top));
  top = Math.min(top, vwH - padding - maxCardH);

  return { left, top, maxCardH, width };
}
