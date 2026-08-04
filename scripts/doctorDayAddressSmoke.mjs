/**
 * Smoke checks for My Day address formatting (includes apartment / address2).
 * Run: node scripts/doctorDayAddressSmoke.mjs
 *
 * Mirrors pure helpers in src/utils/doctorDayAddress.ts.
 */

function pickTrimmedString(value) {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t || undefined;
}

function pickFromRecord(obj, keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = pickTrimmedString(obj[key]);
    if (v) return v;
  }
  return undefined;
}

function nestedClient(appt) {
  const client = appt?.client;
  if (!client || typeof client !== 'object') return null;
  return client;
}

function pickDoctorDayAddressPart(appt, keys) {
  if (!appt || typeof appt !== 'object') return undefined;
  return pickFromRecord(appt, keys) ?? pickFromRecord(nestedClient(appt), keys);
}

function formatDoctorDayApptAddress(a) {
  if (!a || typeof a !== 'object') return 'Address not available';

  const address1 = pickDoctorDayAddressPart(a, ['address1', 'address_1']);
  const address2 = pickDoctorDayAddressPart(a, ['address2', 'address_2']);
  const city = pickDoctorDayAddressPart(a, ['city']);
  const state = pickDoctorDayAddressPart(a, ['state']);
  const zip = pickDoctorDayAddressPart(a, ['zip', 'zipcode', 'zipCode']);

  const line = [address1, address2, [city, state].filter(Boolean).join(', '), zip]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+,/g, ',');
  if (line) return line;

  const freeForm =
    pickDoctorDayAddressPart(a, ['address', 'addressStr', 'fullAddress']) ??
    pickFromRecord(nestedClient(a), ['address', 'addressStr', 'fullAddress']);
  if (freeForm) return freeForm;

  const lat = a.lat;
  const lon = a.lon;
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }

  return 'Address not available';
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Baseline without apartment — same shape as prior My Day formatter.
assert(
  formatDoctorDayApptAddress({
    address1: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
  }) === '123 Main St, Austin, TX, 78701',
  'street-only address'
);

// Apartment on top-level doctor-day row (print / PDF path).
assert(
  formatDoctorDayApptAddress({
    address1: '123 Main St',
    address2: 'Apt 4B',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
  }) === '123 Main St, Apt 4B, Austin, TX, 78701',
  'top-level address2'
);

// Apartment only on nested client (range enrichment).
assert(
  formatDoctorDayApptAddress({
    address1: '500 Oak Ave',
    city: 'Austin',
    state: 'TX',
    zip: '78702',
    client: { address2: 'Unit 12', zipcode: '78702' },
  }) === '500 Oak Ave, Unit 12, Austin, TX, 78702',
  'nested client address2'
);

// Prefer top-level address2 over nested.
assert(
  formatDoctorDayApptAddress({
    address1: '9 Pine Rd',
    address2: 'Suite 200',
    city: 'Austin',
    state: 'TX',
    zip: '78703',
    client: { address2: 'Suite 999' },
  }) === '9 Pine Rd, Suite 200, Austin, TX, 78703',
  'top-level address2 wins'
);

// Free-form fallback when structured street is missing.
assert(
  formatDoctorDayApptAddress({
    fullAddress: '1 Freeform Lane, Apt 3, Austin, TX 78704',
  }) === '1 Freeform Lane, Apt 3, Austin, TX 78704',
  'fullAddress fallback'
);

assert(formatDoctorDayApptAddress(null) === 'Address not available', 'null input');

console.log('doctorDayAddressSmoke: ok');
