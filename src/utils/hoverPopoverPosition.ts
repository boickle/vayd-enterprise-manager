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

/**
 * Position a fixed popover near the hovered appointment block (anchor) or fallback to cursor (x,y).
 * Default: prefers to the right of the block, then left; on narrow viewports places full-width below the block.
 * With preferSide: 'left', tries left of the block first (e.g. My Week when drive bands sit on the right).
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
}): { left: number; top: number; maxCardH: number; width: number } {
  const { anchor, x, y, vwW, vwH, cardMaxW, cardMinW, padding, offset, preferSide = 'right' } = args;
  const maxCardHCap = Math.min(vwH * 0.7, vwH - 2 * padding);
  const maxUsableW = Math.max(0, vwW - 2 * padding);
  let cardWidth = Math.min(cardMaxW, maxUsableW);

  let left: number;
  let top: number;

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

  top = Math.max(padding, top);
  // Cap card height by space *below* `top` so we don't clamp `top` upward to fit an oversized max height
  // (that used to pin the popover to the top of the viewport while the anchor stayed low, e.g. 3 PM).
  const maxCardH = Math.min(maxCardHCap, Math.max(0, vwH - padding - top));
  top = Math.min(top, vwH - padding - maxCardH);

  const width = Math.min(Math.max(cardMinW, cardWidth), maxUsableW);
  return { left, top, maxCardH, width };
}
