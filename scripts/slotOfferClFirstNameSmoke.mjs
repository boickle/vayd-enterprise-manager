/**
 * Smoke checks for text-offer CL first-name attribution.
 * Run: node scripts/slotOfferClFirstNameSmoke.mjs
 *
 * Mirrors src/utils/slotOfferFromRouting.ts resolveClFirstNameForOffer /
 * clFirstNameFromStaffEmail (without importing TS).
 */

function clFirstNameFromStaffEmail(userEmail) {
  const email = userEmail?.trim();
  if (!email) return 'Your care team';
  const local = email.split('@')[0] ?? '';
  const part = local.split(/[._-]/)[0] ?? local;
  if (!part) return 'Your care team';
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function resolveClFirstNameForOffer(opts) {
  const first = opts.actorFirstName?.trim();
  if (first) return first;
  const fallback = opts.actorFallbackLabel?.trim();
  if (fallback && fallback.toLowerCase() !== 'staff') {
    const firstWord = fallback.split(/\s+/)[0]?.trim();
    if (firstWord) return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
  }
  return clFirstNameFromStaffEmail(opts.userEmail);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(clFirstNameFromStaffEmail(null), 'Your care team', 'null email');
assertEqual(clFirstNameFromStaffEmail(''), 'Your care team', 'empty email');
assertEqual(clFirstNameFromStaffEmail('mariah@vetatyourdoor.com'), 'Mariah', 'mariah email');
assertEqual(clFirstNameFromStaffEmail('morgan.saunders@vetatyourdoor.com'), 'Morgan', 'morgan dotted email');

assertEqual(
  resolveClFirstNameForOffer({
    actorFirstName: 'Morgan',
    userEmail: null,
  }),
  'Morgan',
  'actor first name wins without email'
);

assertEqual(
  resolveClFirstNameForOffer({
    actorFirstName: null,
    actorFallbackLabel: 'Staff',
    userEmail: null,
  }),
  'Your care team',
  'staff fallback stays generic without email'
);

assertEqual(
  resolveClFirstNameForOffer({
    actorFirstName: null,
    actorFallbackLabel: 'Staff',
    userEmail: 'morgan@vetatyourdoor.com',
  }),
  'Morgan',
  'email heuristic after staff fallback'
);

console.log('slotOfferClFirstNameSmoke: ok');
