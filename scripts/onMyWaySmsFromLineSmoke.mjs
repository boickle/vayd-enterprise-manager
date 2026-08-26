/**
 * Smoke checks for On My Way SMS send-from routing.
 * Run: node scripts/onMyWaySmsFromLineSmoke.mjs
 *
 * Mirrors pure helpers in src/utils/onMyWaySmsFromLine.ts / quoContact.ts.
 */

function phoneToQuoDialDigits(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function phonesMatchForQuo(a, b) {
  const aa = a?.trim();
  const bb = b?.trim();
  if (!aa || !bb) return false;
  const da = phoneToQuoDialDigits(aa);
  const db = phoneToQuoDialDigits(bb);
  if (da && db) return da === db;
  return aa === bb;
}

function trimPhone(raw) {
  const s = raw?.trim();
  return s || null;
}

function resolveOnMyWaySmsFromLine(input) {
  const primaryProviderId =
    input.primaryProviderId != null && Number.isFinite(input.primaryProviderId)
      ? input.primaryProviderId
      : undefined;
  const quoFromLine = trimPhone(input.quoFromLine);
  const employeePhone1 = trimPhone(input.employeePhone1);
  const practiceMainPhone = trimPhone(input.practiceMainPhone);
  const remindersFrom = trimPhone(input.remindersFrom);

  const employeePhoneIsReminders =
    Boolean(employeePhone1) &&
    Boolean(remindersFrom) &&
    phonesMatchForQuo(employeePhone1, remindersFrom);

  const hasProviderSendLine =
    Boolean(quoFromLine) || (Boolean(employeePhone1) && !employeePhoneIsReminders);

  if (hasProviderSendLine && primaryProviderId != null) {
    return {
      payload: { primaryProviderId },
      fromLineLabel: quoFromLine ?? employeePhone1,
      usedPracticeBackup: false,
    };
  }

  if (practiceMainPhone) {
    return {
      payload: { from: practiceMainPhone },
      fromLineLabel: practiceMainPhone,
      usedPracticeBackup: true,
    };
  }

  if (primaryProviderId != null) {
    return {
      payload: { primaryProviderId },
      fromLineLabel: quoFromLine ?? employeePhone1,
      usedPracticeBackup: false,
    };
  }

  return {
    payload: {},
    fromLineLabel: null,
    usedPracticeBackup: false,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const PRACTICE = '(207) 536-8387';
const REMINDERS = '+12075551212';
const DOCTOR_QUO = '+12075559999';

{
  const r = resolveOnMyWaySmsFromLine({
    primaryProviderId: 10,
    quoFromLine: DOCTOR_QUO,
    practiceMainPhone: PRACTICE,
    remindersFrom: REMINDERS,
  });
  assert(r.payload.primaryProviderId === 10, 'doctor Quo should use primaryProviderId');
  assert(r.payload.from == null, 'doctor Quo should not pass from');
  assert(r.usedPracticeBackup === false, 'doctor Quo is not practice backup');
}

{
  const r = resolveOnMyWaySmsFromLine({
    primaryProviderId: 99,
    quoFromLine: null,
    employeePhone1: null,
    practiceMainPhone: PRACTICE,
    remindersFrom: REMINDERS,
  });
  assert(r.payload.from === PRACTICE, 'Tech Team with no line should use practice backup');
  assert(r.payload.primaryProviderId == null, 'must not pass primaryProviderId for practice backup');
  assert(r.usedPracticeBackup === true, 'expected practice backup flag');
}

{
  const r = resolveOnMyWaySmsFromLine({
    primaryProviderId: 99,
    quoFromLine: null,
    employeePhone1: REMINDERS,
    practiceMainPhone: PRACTICE,
    remindersFrom: '207-555-1212',
  });
  assert(
    r.payload.from === PRACTICE,
    'employee phone1 matching reminders must fall back to practice main'
  );
  assert(r.payload.primaryProviderId == null, 'reminders phone1 must not use primaryProviderId');
}

{
  const r = resolveOnMyWaySmsFromLine({
    primaryProviderId: 12,
    quoFromLine: null,
    employeePhone1: '+12075558888',
    practiceMainPhone: PRACTICE,
    remindersFrom: REMINDERS,
  });
  assert(r.payload.primaryProviderId === 12, 'non-reminders phone1 should use primaryProviderId');
  assert(r.usedPracticeBackup === false, 'phone1 provider line is not practice backup');
}

{
  const r = resolveOnMyWaySmsFromLine({
    primaryProviderId: 99,
    practiceMainPhone: null,
    remindersFrom: REMINDERS,
  });
  assert(
    r.payload.primaryProviderId === 99,
    'without practice phone, keep primaryProviderId last-resort'
  );
}

console.log('onMyWaySmsFromLineSmoke: ok');
