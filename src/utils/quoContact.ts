/** Click-to-call / SMS links for Quo (OpenPhone) and browser fallbacks. */

function phoneToE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

export function buildPhoneDialHref(phone: string): string {
  const e164 = phoneToE164(phone);
  if (!e164) return `tel:${phone}`;
  const tpl = (import.meta.env.VITE_QUO_CALL_URL_TEMPLATE as string | undefined)?.trim();
  if (tpl && (tpl.includes('{e164}') || tpl.includes('{digits}'))) {
    const digits = e164.replace(/\D/g, '');
    return tpl.replace(/\{e164\}/g, encodeURIComponent(e164)).replace(/\{digits\}/g, digits);
  }
  return `tel:${e164}`;
}

export function buildPhoneSmsHref(phone: string): string {
  const e164 = phoneToE164(phone);
  if (!e164) return `sms:${phone}`;
  const tpl = (import.meta.env.VITE_QUO_SMS_URL_TEMPLATE as string | undefined)?.trim();
  if (tpl && (tpl.includes('{e164}') || tpl.includes('{digits}'))) {
    const digits = e164.replace(/\D/g, '');
    return tpl.replace(/\{e164\}/g, encodeURIComponent(e164)).replace(/\{digits\}/g, digits);
  }
  return `sms:${e164}`;
}
