/**
 * Smoke: Appointment type / routing preview Book must stay on-screen.
 * Repro (bugs-scout): Preview schedule closes the edit form; Book lives only on the
 * fixed calendar popover. Tall cards near end-of-day clipped Book behind overflow:hidden.
 *
 * Run: node scripts/editVisitPreviewBookActionSmoke.mjs
 */

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Mirrors src/utils/hoverPopoverPosition.ts computeEditPreviewPopoverPosition */
function computeEditPreviewPopoverPosition(args) {
  const { slotAnchor, dayColumnAnchor, vwW, vwH, cardW, cardEstH, padding, gutter } = args;
  const pad = padding;
  const width = cardW;
  const H = clamp(cardEstH, 200, vwH - 2 * pad);
  const column = dayColumnAnchor ?? slotAnchor;
  const minReadable = 220;

  let left = pad;
  let finalWidth = width;
  const leftOfColumn = column.left - gutter - width;
  if (leftOfColumn >= pad) {
    left = leftOfColumn;
  } else {
    const rightOfColumn = column.right + gutter;
    if (rightOfColumn + width <= vwW - pad) {
      left = rightOfColumn;
    } else {
      const leftOfSlot = slotAnchor.left - gutter - width;
      if (leftOfSlot >= pad) {
        left = leftOfSlot;
      } else {
        left = pad;
        finalWidth = Math.min(width, vwW - 2 * pad);
      }
    }
  }

  const spaceBelow = vwH - pad - slotAnchor.top;
  const spaceAbove = slotAnchor.top - pad;
  if (spaceBelow < Math.min(H, minReadable + 80) && spaceAbove > spaceBelow) {
    const bottom = clamp(vwH - slotAnchor.top + gutter, pad, vwH - pad - minReadable);
    const maxCardH = Math.max(minReadable, Math.min(H, vwH - pad - bottom));
    return { left, top: 0, bottom, maxCardH, width: finalWidth };
  }

  let top = clamp(slotAnchor.top, pad, vwH - pad - minReadable);
  let maxCardH = Math.max(minReadable, Math.min(H, vwH - pad - top));
  if (maxCardH < minReadable) {
    top = Math.max(pad, vwH - pad - minReadable);
    maxCardH = Math.max(minReadable, vwH - pad - top);
  }
  top = Math.max(pad, Math.min(top, vwH - pad - maxCardH));
  maxCardH = Math.max(minReadable, vwH - pad - top);
  return { left, top, maxCardH, width: finalWidth };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const vwW = 1440;
const vwH = 900;
const slotNearBottom = {
  top: 780,
  left: 900,
  bottom: 860,
  right: 1040,
  width: 140,
  height: 80,
};
const dayColumn = {
  top: 120,
  left: 880,
  bottom: 880,
  right: 1060,
  width: 180,
  height: 760,
};

const lowSlotPos = computeEditPreviewPopoverPosition({
  slotAnchor: slotNearBottom,
  dayColumnAnchor: dayColumn,
  vwW,
  vwH,
  cardW: 300,
  cardEstH: 420,
  padding: 12,
  gutter: 10,
});

assert(lowSlotPos.bottom != null, 'low slot should flip above (CSS bottom pin)');
assert(lowSlotPos.maxCardH >= 220, 'maxCardH must leave room for Book chrome');
assert(
  lowSlotPos.bottom + lowSlotPos.maxCardH <= vwH - 12 + 0.5,
  'pinned card must fit in viewport'
);

const slotMid = {
  top: 200,
  left: 900,
  bottom: 280,
  right: 1040,
  width: 140,
  height: 80,
};
const midPos = computeEditPreviewPopoverPosition({
  slotAnchor: slotMid,
  dayColumnAnchor: dayColumn,
  vwW,
  vwH,
  cardW: 300,
  cardEstH: 420,
  padding: 12,
  gutter: 10,
});
assert(midPos.bottom == null, 'mid-day slot stays top-anchored');
assert(midPos.top + midPos.maxCardH <= vwH - 12 + 0.5, 'top-anchored card fits viewport');
assert(midPos.maxCardH >= 220, 'mid-day maxCardH keeps Book reachable');

const fs = await import('node:fs/promises');
const css = await fs.readFile(new URL('../src/pages/Scheduler.css', import.meta.url), 'utf8');
assert(
  /scheduler-edit-preview-popover--book-action/.test(css),
  'CSS must style book-action preview layout'
);
assert(
  /\.scheduler-edit-preview-popover-shell > \.scheduler-edit-preview-popover/.test(css),
  'shell must constrain nested popover max-height'
);

const editPopover = await fs.readFile(
  new URL('../src/components/EditVisitPreviewPopover.tsx', import.meta.url),
  'utf8'
);
assert(
  editPopover.includes('scheduler-edit-preview-popover--book-action'),
  'EditVisitPreviewPopover pins Book via book-action layout'
);
assert(
  editPopover.includes('scheduler-edit-preview-popover-scroll'),
  'EditVisitPreviewPopover scrolls body, not the Book row'
);

const routingPopover = await fs.readFile(
  new URL('../src/components/RoutingPreviewSlotPopover.tsx', import.meta.url),
  'utf8'
);
assert(
  routingPopover.includes('scheduler-edit-preview-popover--book-action'),
  'RoutingPreviewSlotPopover pins Book via book-action layout'
);

const scheduler = await fs.readFile(new URL('../src/pages/Scheduler.tsx', import.meta.url), 'utf8');
assert(
  /maxHeight:\s*editPreviewPopoverPos\.maxCardH/.test(scheduler),
  'edit preview shell must apply maxCardH'
);
assert(
  /maxHeight:\s*routingPreviewPopoverPos\.maxCardH/.test(scheduler),
  'routing preview shell must apply maxCardH'
);

console.log('editVisitPreviewBookActionSmoke: ok');
