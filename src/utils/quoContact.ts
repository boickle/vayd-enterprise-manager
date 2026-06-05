/** Click-to-call / SMS links for Quo (OpenPhone) and browser fallbacks. */

const DEFAULT_QUO_CALL_URL_TEMPLATE = 'openphone://dial?number={digits}&action=call';
const DEFAULT_QUO_SMS_URL_TEMPLATE = 'openphone://message?number={digits}';

function phoneToE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

/** Digits for Quo deep links — US numbers use 10-digit NANP when possible. */
function phoneToQuoDialDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function applyQuoUrlTemplate(template: string, phone: string): string | null {
  const e164 = phoneToE164(phone);
  const digits = phoneToQuoDialDigits(phone);
  if (!e164 || !digits) return null;
  if (!template.includes('{e164}') && !template.includes('{digits}')) return null;
  return template
    .replace(/\{e164\}/g, encodeURIComponent(e164))
    .replace(/\{digits\}/g, digits);
}

function quoCallTemplate(): string {
  const fromEnv = (import.meta.env.VITE_QUO_CALL_URL_TEMPLATE as string | undefined)?.trim();
  return fromEnv || DEFAULT_QUO_CALL_URL_TEMPLATE;
}

function quoSmsTemplate(): string {
  const fromEnv = (import.meta.env.VITE_QUO_SMS_URL_TEMPLATE as string | undefined)?.trim();
  return fromEnv || DEFAULT_QUO_SMS_URL_TEMPLATE;
}

export function buildPhoneDialHref(phone: string): string {
  const e164 = phoneToE164(phone);
  const tpl = quoCallTemplate();
  const fromTpl = applyQuoUrlTemplate(tpl, phone);
  if (fromTpl) return fromTpl;
  if (e164) return `tel:${e164}`;
  return `tel:${phone}`;
}

export function buildPhoneSmsHref(phone: string): string {
  const e164 = phoneToE164(phone);
  const tpl = quoSmsTemplate();
  const fromTpl = applyQuoUrlTemplate(tpl, phone);
  if (fromTpl) return fromTpl;
  if (e164) return `sms:${e164}`;
  return `sms:${phone}`;
}
