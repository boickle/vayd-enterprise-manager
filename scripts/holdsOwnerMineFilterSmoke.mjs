/**
 * Smoke: Holds Mine filter + normalizeHoldListItem ownership reconciliation.
 * Run: node scripts/holdsOwnerMineFilterSmoke.mjs
 *
 * Mirrors src/api/holds.ts normalizeHoldListItem / reconcileHoldOwnerIsCurrentUser
 * and src/utils/holdsHousehold.ts holdMatchesOwnerFilter.
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function truthyApiFlag(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function normalizeOptionalId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeEmployeeRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    firstName: raw.firstName ?? raw.first_name ?? null,
    lastName: raw.lastName ?? raw.last_name ?? null,
  };
}

function normalizeHoldListItem(raw, currentUserEmployeeId) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const holdOwner = normalizeEmployeeRef(o.holdOwner ?? o.hold_owner);
  let effectiveOwnerEmployeeId = normalizeOptionalId(
    o.effectiveOwnerEmployeeId ?? o.effective_owner_employee_id
  );
  if (effectiveOwnerEmployeeId == null && holdOwner) {
    effectiveOwnerEmployeeId = holdOwner.id;
  }
  let ownerIsCurrentUser = truthyApiFlag(
    o.ownerIsCurrentUser ?? o.owner_is_current_user
  );
  if (!ownerIsCurrentUser && currentUserEmployeeId != null) {
    ownerIsCurrentUser =
      holdOwner?.id === currentUserEmployeeId ||
      effectiveOwnerEmployeeId === currentUserEmployeeId;
  }
  return {
    id: normalizeOptionalId(o.id) ?? 0,
    holdOwner,
    effectiveOwnerEmployeeId,
    ownerIsCurrentUser,
    ownerBucket: o.ownerBucket ?? o.owner_bucket ?? 'unassigned',
  };
}

function reconcileHoldOwnerIsCurrentUser(holds, currentUserEmployeeId) {
  if (currentUserEmployeeId == null) return holds;
  return holds.map((hold) => {
    if (hold.ownerIsCurrentUser) return hold;
    const isMine =
      hold.holdOwner?.id === currentUserEmployeeId ||
      hold.effectiveOwnerEmployeeId === currentUserEmployeeId;
    return isMine ? { ...hold, ownerIsCurrentUser: true } : hold;
  });
}

function holdMatchesOwnerFilter(hold, owner, currentUserEmployeeId) {
  if (owner === 'all') return true;
  const isMine =
    hold.ownerIsCurrentUser ||
    (currentUserEmployeeId != null &&
      (hold.holdOwner?.id === currentUserEmployeeId ||
        hold.effectiveOwnerEmployeeId === currentUserEmployeeId));
  if (owner === 'me') return isMine;
  const isUnassignedBucket =
    hold.ownerBucket === 'unassigned' || hold.ownerBucket === 'non_cl_unassigned';
  if (owner === 'unassigned') return isUnassignedBucket;
  if (owner === 'me_unassigned') return isMine || isUnassignedBucket;
  return (
    hold.effectiveOwnerEmployeeId === owner || hold.holdOwner?.id === owner
  );
}

// API owner=all row: holdOwner set, ownerIsCurrentUser omitted/false
const raw = {
  id: 101,
  hold_owner: { id: 44, first_name: 'Michelle', last_name: 'M' },
  owner_bucket: 'owned',
  owner_is_current_user: false,
};
const normalized = normalizeHoldListItem(raw, 44);
assert(normalized.holdOwner?.id === 44, 'normalizes snake_case hold_owner');
assert(normalized.ownerIsCurrentUser === true, 'derives Mine from holdOwner vs current user');
assert(holdMatchesOwnerFilter(normalized, 'me', 44), 'Mine filter accepts normalized row');

const otherUser = normalizeHoldListItem(raw, 99);
assert(otherUser.ownerIsCurrentUser === false, 'does not mark Mine for other staff');

const reconciled = reconcileHoldOwnerIsCurrentUser(
  [
    {
      id: 2,
      holdOwner: { id: 44, firstName: 'M', lastName: 'M' },
      effectiveOwnerEmployeeId: 44,
      ownerIsCurrentUser: false,
      ownerBucket: 'owned',
    },
  ],
  44
);
assert(reconciled[0].ownerIsCurrentUser === true, 'auth employee id reconciles Mine flag');
assert(holdMatchesOwnerFilter(reconciled[0], 'me'), 'Mine works after reconcile without extra id');

console.log('holdsOwnerMineFilterSmoke: ok');
