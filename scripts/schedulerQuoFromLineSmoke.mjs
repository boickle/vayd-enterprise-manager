/**
 * Smoke checks: scheduler context-menu Call/Text must pin Quo `from` to the
 * visit doctor's quoLinePhone (same resolveQuoFromLine + buildPhone*Href pattern
 * as preview popovers). Without `from`, Quo uses the active inbox (e.g. another
 * doctor's line or Reminders).
 *
 * Run: node scripts/schedulerQuoFromLineSmoke.mjs
 */

function phoneToQuoDialDigits(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function pickQuoLinePhone(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

function resolveQuoFromLine(args) {
  const fromAppt = pickQuoLinePhone(args.appointmentPrimaryProvider?.quoLinePhone);
  if (fromAppt) return fromAppt;

  const apptProviderId = args.appointmentPrimaryProvider?.id;
  if (apptProviderId != null && args.providers?.length) {
    const row = args.providers.find((p) => String(p.id) === String(apptProviderId));
    const fromRow = pickQuoLinePhone(row?.quoLinePhone);
    if (fromRow) return fromRow;
  }

  return null;
}

function appendQuoFromParam(url, fromLine) {
  const fromDigits = fromLine ? phoneToQuoDialDigits(fromLine) : null;
  if (!fromDigits || url.includes('from=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}from=${encodeURIComponent(fromDigits)}`;
}

function buildPhoneSmsHref(phone, opts) {
  const digits = phoneToQuoDialDigits(phone);
  if (!digits) return `sms:${phone}`;
  const base = `openphone://message?number=${digits}`;
  return appendQuoFromParam(base, opts?.fromLine);
}

function buildPhoneDialHref(phone, opts) {
  const digits = phoneToQuoDialDigits(phone);
  if (!digits) return `tel:${phone}`;
  const base = `openphone://dial?number=${digits}&action=call`;
  return appendQuoFromParam(base, opts?.fromLine);
}

/** Mirrors Scheduler context-menu call/text href construction. */
function schedulerContextMenuQuoHrefs(appt, providers, clientPhone) {
  const fromLine = resolveQuoFromLine({
    appointmentPrimaryProvider: appt.primaryProvider,
    providers,
  });
  return {
    fromLine,
    dial: buildPhoneDialHref(clientPhone, { fromLine }),
    sms: buildPhoneSmsHref(clientPhone, { fromLine }),
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const providers = [
  { id: 10, name: 'Julie Greenlaw', quoLinePhone: '+12075551111' },
  { id: 20, name: 'LB Doctor', quoLinePhone: '+12075552222' },
];

const clientPhone = '207-555-9999';

// Nested quoLinePhone on the appointment wins.
{
  const hrefs = schedulerContextMenuQuoHrefs(
    { primaryProvider: { id: 20, quoLinePhone: '+12075552222' } },
    providers,
    clientPhone
  );
  assert(hrefs.fromLine === '+12075552222', 'expected visit doctor line from nested quoLinePhone');
  assert(hrefs.sms.includes('from=2075552222'), `sms missing from= visit line: ${hrefs.sms}`);
  assert(hrefs.dial.includes('from=2075552222'), `dial missing from= visit line: ${hrefs.dial}`);
  assert(!hrefs.sms.includes('from=2075551111'), 'must not use unrelated Julie line');
}

// Range row omits nested quoLinePhone — look up from /employees/providers.
{
  const hrefs = schedulerContextMenuQuoHrefs(
    { primaryProvider: { id: 20 } },
    providers,
    clientPhone
  );
  assert(hrefs.fromLine === '+12075552222', 'expected provider-list lookup for quoLinePhone');
  assert(hrefs.sms.includes('from=2075552222'), `sms after provider lookup: ${hrefs.sms}`);
}

// No doctor line configured — omit from= (Quo may use active inbox; same as preview).
{
  const hrefs = schedulerContextMenuQuoHrefs(
    { primaryProvider: { id: 99 } },
    providers,
    clientPhone
  );
  assert(hrefs.fromLine == null, 'expected null when provider has no quoLinePhone');
  assert(!hrefs.sms.includes('from='), `must not invent from= when unknown: ${hrefs.sms}`);
}

// Regression: omitting fromLine (old context-menu bug) leaves Quo free to use active inbox.
{
  const bare = buildPhoneSmsHref(clientPhone);
  assert(!bare.includes('from='), `bare sms must not pin from: ${bare}`);
}

console.log('schedulerQuoFromLineSmoke: ok');
