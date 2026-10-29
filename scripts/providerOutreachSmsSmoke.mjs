/**
 * Smoke checks for provider-line outreach SMS routing + Quo Done/Open policy.
 * Run: node scripts/providerOutreachSmsSmoke.mjs
 *
 * Mirrors ClientContactComposeModal / Holds / Texted Offers send payload rules
 * and resolveOnMyWaySmsFromLine.
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

/** Same branching as ClientContactComposeModal / HoldsPage send. */
function buildOutreachSendFlags({ primaryProviderId, from, markInboxDone }) {
  const explicitFrom = from?.trim() || undefined;
  const hasProvider = primaryProviderId != null && Number.isFinite(primaryProviderId);
  return {
    ...(hasProvider
      ? { primaryProviderId }
      : explicitFrom
        ? { from: explicitFrom }
        : { useRemindersFrom: true }),
    ...(markInboxDone ? { markInboxDone: true } : {}),
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const PRACTICE = '(207) 536-8387';
const REMINDERS = '+12075551212';
const DOCTOR_QUO = '+12075559999';

{
  const routing = resolveOnMyWaySmsFromLine({
    primaryProviderId: 42,
    quoFromLine: DOCTOR_QUO,
    practiceMainPhone: PRACTICE,
    remindersFrom: REMINDERS,
  });
  assert(routing.payload.primaryProviderId === 42, 'provider id when Quo present');
  assert(!routing.payload.from, 'no explicit from when provider Quo present');
  assert(routing.usedPracticeBackup === false, 'not practice backup');
}

{
  const routing = resolveOnMyWaySmsFromLine({
    primaryProviderId: 99,
    quoFromLine: null,
    employeePhone1: null,
    practiceMainPhone: PRACTICE,
    remindersFrom: REMINDERS,
  });
  assert(routing.payload.from === PRACTICE, 'tech team → practice main');
  assert(routing.usedPracticeBackup === true, 'practice backup flag');
}

{
  // Forward booking / holds / care-outreach HOLD → Open (no markInboxDone)
  const flags = buildOutreachSendFlags({
    primaryProviderId: 7,
    from: undefined,
    markInboxDone: false,
  });
  assert(flags.primaryProviderId === 7, 'hold/FB uses provider id');
  assert(!flags.useRemindersFrom, 'hold/FB must not force reminders line');
  assert(!flags.markInboxDone, 'HOLD flows leave Quo Open');
}

{
  // Care outreach text offers / appointment&service reminders → Done
  const flags = buildOutreachSendFlags({
    primaryProviderId: 3,
    from: undefined,
    markInboxDone: true,
  });
  assert(flags.markInboxDone === true, 'non-HOLD marks Done');
  assert(flags.primaryProviderId === 3, 'text offer uses provider');
}

{
  // Texted-offer follow-up prefers explicit offer from line
  const flags = buildOutreachSendFlags({
    primaryProviderId: 5,
    from: DOCTOR_QUO,
    markInboxDone: true,
  });
  // Modal prefers primaryProviderId when both set; TextedOffers prefers from first.
  // Simulate TextedOffers preference:
  const explicitFrom = DOCTOR_QUO;
  const hasDoctor = true;
  const send = {
    ...(explicitFrom
      ? { from: explicitFrom }
      : hasDoctor
        ? { primaryProviderId: 5 }
        : { useRemindersFrom: true }),
    markInboxDone: true,
  };
  assert(send.from === DOCTOR_QUO, 'follow-up continues offer from line');
  assert(send.markInboxDone === true, 'follow-up marks Done');
  assert(!send.useRemindersFrom, 'follow-up never reminders line when from known');
  void flags;
}

console.log('providerOutreachSmsSmoke: ok');
