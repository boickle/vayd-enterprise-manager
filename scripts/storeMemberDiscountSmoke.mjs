/**
 * Smoke checks for online-store member pricing and the membership tout.
 * Run: node scripts/storeMemberDiscountSmoke.mjs
 *
 * Bundles the real src/utils modules with esbuild so this exercises shipped code
 * rather than a copy that can drift.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'store-member-smoke-'));
const bundle = join(out, 'bundle.mjs');
const entry = join(out, 'entry.ts');

const root = new URL('..', import.meta.url).pathname;
writeFileSync(
  entry,
  `export * from '${root}src/utils/storeMemberPrice.ts';
export * from '${root}src/utils/storeMemberPromo.ts';
`,
);
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [entry, '--bundle', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'],
  { stdio: 'inherit' },
);

const {
  applyMemberStoreDiscount,
  memberDiscountForPets,
  buildStoreMemberPromo,
  ADVERTISED_MEMBER_STORE_PERCENT,
} = await import(bundle);

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

/* ---------- per-pet pricing: one member pet in a two-pet household ---------- */
const BELLA = 101; // member
const MAX = 202; // not a member
const discounts = { [BELLA]: 10 };

assert(memberDiscountForPets(discounts, [BELLA]) === 10, "member pet's line gets 10%");
assert(memberDiscountForPets(discounts, [MAX]) === 0, "non-member pet's line gets nothing");
assert(memberDiscountForPets(discounts, []) === 0, 'unassigned line gets nothing');

assert(applyMemberStoreDiscount(50, 10) === 45, '$50 member line charges $45');
assert(applyMemberStoreDiscount(50, 0) === 50, '$50 non-member line stays $50');
assert(applyMemberStoreDiscount(19.99, 10) === 17.99, 'rounds to cents');

// Same item bought for both pets: only the member half is discounted.
const bellaLine = applyMemberStoreDiscount(50, memberDiscountForPets(discounts, [BELLA]));
const maxLine = applyMemberStoreDiscount(50, memberDiscountForPets(discounts, [MAX]));
assert(bellaLine + maxLine === 95, 'two-pet order of the same item totals $95, not $90');

/* ---------- tout copy ---------- */
const loggedOut = buildStoreMemberPromo({ loggedIn: false, pets: [], discounts: {} });
assert(loggedOut.kind === 'join', 'logged-out visitor sees the join pitch');
assert(
  loggedOut.headline.includes(`${ADVERTISED_MEMBER_STORE_PERCENT}%`),
  'join pitch advertises the standard percent',
);
assert(loggedOut.showPortalLink === true, 'join pitch points at the client portal');

const noMembers = buildStoreMemberPromo({
  loggedIn: true,
  pets: [{ id: MAX, name: 'Max' }],
  discounts: {},
});
assert(noMembers.kind === 'join', 'household with no members sees the join pitch');
assert(noMembers.body.includes('Max'), 'join pitch names the pet who could join');

const mixed = buildStoreMemberPromo({
  loggedIn: true,
  pets: [
    { id: BELLA, name: 'Bella' },
    { id: MAX, name: 'Max' },
  ],
  discounts,
});
assert(mixed.kind === 'mixed', 'mixed household gets the mixed message');
assert(mixed.headline.includes('Bella'), 'mixed message credits the member pet');
assert(mixed.body.includes('Max'), 'mixed message invites the non-member pet');
assert(mixed.percent === 10, 'mixed message uses the real plan percent');

const allMembers = buildStoreMemberPromo({
  loggedIn: true,
  pets: [
    { id: BELLA, name: 'Bella' },
    { id: MAX, name: 'Max' },
  ],
  discounts: { [BELLA]: 10, [MAX]: 10 },
});
assert(allMembers.kind === 'member', 'all-member household gets reassurance, not a pitch');
assert(allMembers.showPortalLink === false, 'members are not nagged to the portal');

// A richer plan should advertise its own rate rather than the default.
const richer = buildStoreMemberPromo({
  loggedIn: true,
  pets: [
    { id: BELLA, name: 'Bella' },
    { id: MAX, name: 'Max' },
  ],
  discounts: { [BELLA]: 15 },
});
assert(richer.percent === 15, 'a 15% plan advertises 15%');

rmSync(out, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll store member pricing checks passed.');
