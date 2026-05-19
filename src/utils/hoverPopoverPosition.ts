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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function visibleArea(
  left: number,
  top: number,
  w: number,
  h: number,
  vwW: number,
  vwH: number,
  pad: number
): number {
  const x1 = Math.max(left, pad);
  const y1 = Math.max(top, pad);
  const x2 = Math.min(left + w, vwW - pad);
  const y2 = Math.min(top + h, vwH - pad);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function fullyVisible(
  left: number,
  top: number,
  w: number,
  h: number,
  vwW: number,
  vwH: number,
  pad: number
): boolean {
  return (
    left >= pad - 0.5 &&
    top >= pad - 0.5 &&
    left + w <= vwW - pad + 0.5 &&
    top + h <= vwH - pad + 0.5
  );
}

type Placement =
  | { mode: 'top'; left: number; top: number }
  | { mode: 'bottom'; left: number; bottom: number; spaceH: number };

/**
 * Position a fixed popover so the full card (estimated size) stays on-screen when possible.
 * Tries beside the anchor (right / left), then below, then above (CSS bottom).
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
  preferSide?: 'left' | 'right';
  /** Estimated popover height for placement (Visit Highlights card). */
  cardEstH?: number;
}): HoverPopoverPositionResult {
  const {
    anchor,
    x,
    y,
    vwW,
    vwH,
    cardMaxW,
    cardMinW,
    padding,
    offset,
    preferSide = 'right',
    cardEstH = 260,
  } = args;

  const pad = padding;
  const maxUsableW = Math.max(0, vwW - 2 * pad);
  const width = clamp(Math.min(cardMaxW, maxUsableW), Math.min(cardMinW, maxUsableW), maxUsableW);
  /** Height used only to score “fits in viewport”; real card uses all vertical space below `top`. */
  const H = clamp(cardEstH, 160, vwH - 2 * pad);

  const pickBest = (
    placements: Placement[],
    anchorRect: HoverAnchorRect | null
  ): HoverPopoverPositionResult => {
    const scored = placements.map((p) => {
      if (p.mode === 'top') {
        const fits = fullyVisible(p.left, p.top, width, H, vwW, vwH, pad);
        const area = visibleArea(p.left, p.top, width, H, vwW, vwH, pad);
        return { p, fits, area };
      }
      const topVis = vwH - p.bottom - H;
      const fits = fullyVisible(p.left, topVis, width, H, vwW, vwH, pad);
      const area = visibleArea(p.left, topVis, width, H, vwW, vwH, pad);
      return { p, fits, area };
    });

    const anyFit = scored.some((s) => s.fits);
    const pool = anyFit ? scored.filter((s) => s.fits) : scored;
    pool.sort((a, b) => b.area - a.area);
    let best = pool[0]!;

    /** When the anchor sits low, prefer flipping above so tall cards (or scrollable max-height) stay on-screen. */
    if (anchorRect) {
      const roomBelow = vwH - pad - (anchorRect.bottom + offset);
      if (roomBelow < H + 72) {
        const bottomFit = scored.find((s) => s.p.mode === 'bottom' && s.fits);
        if (bottomFit) best = bottomFit;
      }
    }

    if (best.p.mode === 'bottom') {
      const maxCardH = Math.max(160, Math.min(vwH - 2 * pad, best.p.spaceH - 4));
      return { left: best.p.left, top: 0, bottom: best.p.bottom, maxCardH, width };
    }
    /** Use all space from `top` to the bottom of the viewport (no artificial cap — avoids clipping). */
    let top = best.p.top;
    let maxCardH = vwH - pad - top;
    const minReadable = 280;
    if (maxCardH < minReadable) {
      top = vwH - pad - minReadable;
      maxCardH = minReadable;
    }
    top = Math.max(pad, Math.min(top, vwH - pad - maxCardH));
    maxCardH = vwH - pad - top;
    return { left: best.p.left, top, maxCardH, width };
  };

  if (anchor) {
    const vTop = clamp(anchor.top + (anchor.height - H) / 2, pad, vwH - pad - H);

    const rightLeft = anchor.right + offset;
    const leftLeft = anchor.left - offset - width;
    const belowTop = anchor.bottom + offset;
    const belowLeft = clamp(anchor.left + (anchor.width - width) / 2, pad, vwW - pad - width);
    const spaceAbove = anchor.top - pad - offset;
    const aboveBottom = vwH - anchor.top + offset;
    const aboveLeft = clamp(anchor.left + (anchor.width - width) / 2, pad, vwW - pad - width);

    const besideFirst: Placement[] = [];
    const besideSecond: Placement[] = [];
    if (preferSide === 'left') {
      besideFirst.push({ mode: 'top', left: leftLeft, top: vTop });
      besideSecond.push({ mode: 'top', left: rightLeft, top: vTop });
    } else {
      besideFirst.push({ mode: 'top', left: rightLeft, top: vTop });
      besideSecond.push({ mode: 'top', left: leftLeft, top: vTop });
    }

    const placements: Placement[] = [
      ...besideFirst,
      ...besideSecond,
      { mode: 'top', left: belowLeft, top: belowTop },
    ];
    /** Prefer offering "flip above" whenever there is room — old `H * 0.8` gate hid this option near the bottom of the viewport. */
    if (spaceAbove > pad) {
      placements.push({
        mode: 'bottom',
        left: aboveLeft,
        bottom: aboveBottom,
        spaceH: spaceAbove,
      });
    }

    return pickBest(placements, anchor);
  }

  /** Cursor fallback */
  let left = x + offset;
  let top = y + offset;
  if (left + width > vwW - pad) left = x - offset - width;
  left = clamp(left, pad, vwW - pad - width);
  top = clamp(top, pad, vwH - pad - H);
  const maxCardH = Math.min(vwH - 2 * pad, vwH - pad - top);
  return { left, top, maxCardH, width };
}
