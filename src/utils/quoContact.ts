/** Click-to-call / SMS links for Quo (OpenPhone) and browser fallbacks. */

import type { Provider } from '../api/employee';

const DEFAULT_QUO_CALL_URL_TEMPLATE = 'openphone://dial?number={digits}&action=call';
const DEFAULT_QUO_SMS_URL_TEMPLATE = 'openphone://message?number={digits}';

export type QuoContactLinkOpts = {
  /** Doctor Quo inbox line — Quo `from` param (caller ID / send-from line). */
  fromLine?: string | null;
};

function phoneToE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

/** Digits for Quo deep links — US numbers use 10-digit NANP when possible. */
export function phoneToQuoDialDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

/** Display a US number as +1 (207) 536-8387. Other values pass through trimmed. */
export function formatDisplayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const nanp =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!nanp) return phone.trim();
  return `+1 (${nanp.slice(0, 3)}) ${nanp.slice(3, 6)}-${nanp.slice(6)}`;
}

function applyQuoUrlTemplate(
  template: string,
  phone: string,
  fromLine?: string | null
): string | null {
  const e164 = phoneToE164(phone);
  const digits = phoneToQuoDialDigits(phone);
  if (!e164 || !digits) return null;
  if (!template.includes('{e164}') && !template.includes('{digits}')) return null;

  const fromDigits = fromLine ? phoneToQuoDialDigits(fromLine) : null;
  if (template.includes('{from}') && !fromDigits) return null;

  let out = template
    .replace(/\{e164\}/g, encodeURIComponent(e164))
    .replace(/\{digits\}/g, digits);
  if (fromDigits) {
    out = out.replace(/\{from\}/g, fromDigits);
  }
  return out;
}

function appendQuoFromParam(url: string, fromLine?: string | null): string {
  const fromDigits = fromLine ? phoneToQuoDialDigits(fromLine) : null;
  if (!fromDigits || url.includes('from=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}from=${encodeURIComponent(fromDigits)}`;
}

function quoCallTemplate(): string {
  const fromEnv = (import.meta.env.VITE_QUO_CALL_URL_TEMPLATE as string | undefined)?.trim();
  return fromEnv || DEFAULT_QUO_CALL_URL_TEMPLATE;
}

function quoSmsTemplate(): string {
  const fromEnv = (import.meta.env.VITE_QUO_SMS_URL_TEMPLATE as string | undefined)?.trim();
  return fromEnv || DEFAULT_QUO_SMS_URL_TEMPLATE;
}

export function buildPhoneDialHref(phone: string, opts?: QuoContactLinkOpts): string {
  const e164 = phoneToE164(phone);
  const tpl = quoCallTemplate();
  const fromTpl = applyQuoUrlTemplate(tpl, phone, opts?.fromLine);
  if (fromTpl) return appendQuoFromParam(fromTpl, opts?.fromLine);
  if (e164) return `tel:${e164}`;
  return `tel:${phone}`;
}

export function buildPhoneSmsHref(phone: string, opts?: QuoContactLinkOpts): string {
  const e164 = phoneToE164(phone);
  const tpl = quoSmsTemplate();
  const fromTpl = applyQuoUrlTemplate(tpl, phone, opts?.fromLine);
  if (fromTpl) return appendQuoFromParam(fromTpl, opts?.fromLine);
  if (e164) return `sms:${e164}`;
  return `sms:${phone}`;
}

function pickQuoLinePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/** True when two phone strings refer to the same line (NANP 10-digit or exact match). */
export function phonesMatchForQuo(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = a?.trim();
  const bb = b?.trim();
  if (!aa || !bb) return false;
  const da = phoneToQuoDialDigits(aa);
  const db = phoneToQuoDialDigits(bb);
  if (da && db) return da === db;
  return aa === bb;
}

/** Resolve the visit assignee's Quo line for outbound call/text. */
export function resolveQuoFromLine(args: {
  appointmentPrimaryProvider?: {
    id?: number | string | null;
    quoLinePhone?: string | null;
  } | null;
  /** `/employees/providers` — lookup when range row omits nested `quoLinePhone`. */
  providers?: readonly Provider[];
}): string | null {
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
