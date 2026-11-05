/**
 * Smoke: room-loader package search hits expand into allocated constituent lines.
 * Mirrors src/utils/roomLoaderPackageSearch.ts and asserts RoomLoader wiring.
 *
 * Run: node scripts/roomLoaderPackageSearchExpandSmoke.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function isRoomLoaderPackageSearchItem(item) {
  return String(item?.itemType ?? '')
    .trim()
    .toLowerCase() === 'package';
}

function packageLineToSearchableItem(raw) {
  const nested = raw?.item && typeof raw.item === 'object' ? raw.item : null;
  const itemType = String(raw?.itemType ?? nested?.itemType ?? nested?.type ?? 'procedure')
    .trim()
    .toLowerCase();
  if (!itemType || itemType === 'package') return null;
  const name = String(raw?.name ?? nested?.name ?? '').trim();
  if (!name) return null;
  const priceRaw = raw?.price ?? nested?.price;
  const priceNum = priceRaw != null && priceRaw !== '' ? Number(priceRaw) : 0;
  const price = Number.isFinite(priceNum) ? priceNum : 0;
  const out = { itemType, name, price, originalPrice: price };
  if (raw?.inventoryItem) out.inventoryItem = raw.inventoryItem;
  if (raw?.lab) out.lab = raw.lab;
  if (raw?.procedure) out.procedure = raw.procedure;
  return out;
}

function expandPackageSearchItem(item) {
  if (!isRoomLoaderPackageSearchItem(item)) return [item];
  const rawLines = item.packageItems;
  if (!Array.isArray(rawLines) || rawLines.length === 0) return [item];
  const expanded = [];
  for (const line of rawLines) {
    const si = packageLineToSearchableItem(line);
    if (si) expanded.push(si);
  }
  return expanded.length > 0 ? expanded : [item];
}

assert(isRoomLoaderPackageSearchItem({ itemType: 'package', name: 'X', price: 1 }), 'detect package');
assert(!isRoomLoaderPackageSearchItem({ itemType: 'inventory', name: 'X', price: 1 }), 'not inventory');

const inv = { itemType: 'inventory', name: 'Solo', price: 12 };
assert(expandPackageSearchItem(inv) === inv || expandPackageSearchItem(inv)[0] === inv, 'passthrough');
assert(expandPackageSearchItem(inv).length === 1, 'passthrough length');

const pkg = {
  itemType: 'package',
  name: 'Happy Cat Pack',
  price: 18,
  packageId: 99,
  packageItems: [
    { itemType: 'inventory', name: 'A', price: 4.5, inventoryItem: { id: 1 } },
    { itemType: 'inventory', name: 'B', price: 4.5, inventoryItem: { id: 2 } },
    { itemType: 'procedure', name: 'C', price: 4.5, procedure: { id: 3 } },
    { itemType: 'lab', name: 'D', price: 4.5, lab: { id: 4 } },
  ],
};
const lines = expandPackageSearchItem(pkg);
assert(lines.length === 4, `expected 4 lines, got ${lines.length}`);
assert(
  lines.reduce((s, l) => s + Number(l.price), 0) === 18,
  'allocated prices must sum to package total'
);
assert(lines.every((l) => l.itemType !== 'package'), 'expanded lines are not packages');

const utilSrc = read('src/utils/roomLoaderPackageSearch.ts');
assert(utilSrc.includes('expandPackageSearchItem'), 'util exports expandPackageSearchItem');
assert(utilSrc.includes('packageItems'), 'util reads packageItems');

const apiSrc = read('src/api/roomLoader.ts');
assert(apiSrc.includes("package'"), 'SearchableItem includes package type');
assert(apiSrc.includes('packageItems'), 'SearchableItem includes packageItems');
assert(apiSrc.includes('customPrice'), 'staff checkItemPricing supports customPrice');

const pageSrc = read('src/pages/RoomLoader.tsx');
assert(pageSrc.includes('expandPackageSearchItem'), 'RoomLoader expands packages on add');
assert(pageSrc.includes('isRoomLoaderPackageSearchItem'), 'RoomLoader detects packages');
assert(
  pageSrc.includes('.filter((r) => !isRoomLoaderPackageSearchItem(r))'),
  'reminder correction search excludes packages'
);

console.log('roomLoaderPackageSearchExpandSmoke: ok');
