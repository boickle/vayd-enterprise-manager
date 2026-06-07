import type { AppointmentType } from '../api/appointmentSettings';
import type { Appointment } from '../api/roomLoader';

const TYPE_COLOR_FALLBACK = [
  '#16a34a',
  '#2563eb',
  '#db2777',
  '#ca8a04',
  '#9333ea',
  '#dc2626',
  '#64748b',
  '#0d9488',
  '#ea580c',
  '#4f46e5',
];

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function hashColorKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return TYPE_COLOR_FALLBACK[Math.abs(h) % TYPE_COLOR_FALLBACK.length];
}

function normalizeHex(c: string | null | undefined): string | null {
  if (!c || typeof c !== 'string') return null;
  const t = c.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return t;
  return null;
}

/** Background from appointment type row: calendarColor / colorHex / color (hex or CSS named e.g. pink). */
export function typeBackgroundFromRow(
  t: { calendarColor?: string | null; colorHex?: string | null; color?: string | null } | null | undefined
): string | null {
  if (!t) return null;
  const hex =
    normalizeHex(t.calendarColor) ?? normalizeHex(t.colorHex) ?? normalizeHex(t.color);
  if (hex) return hex;
  const named = pickStr(t.color);
  if (named && /^[a-z]{2,20}$/i.test(named)) return named.toLowerCase();
  return null;
}

function hexToRgbChannels(hex7: string): { r: number; g: number; b: number } | null {
  let h = hex7.trim();
  if (!h.startsWith('#')) return null;
  h = h.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function readableTextOnBackground(fill: string): string {
  const hx = normalizeHex(fill);
  if (hx) {
    const rgb = hexToRgbChannels(hx);
    if (rgb) {
      const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
      return lum > 0.55 ? '#0f172a' : '#f8fafc';
    }
  }
  const named = fill.trim().toLowerCase();
  const lightish = new Set([
    'white',
    'yellow',
    'pink',
    'lightgray',
    'wheat',
    'ivory',
    'beige',
    'honeydew',
    'azure',
    'mintcream',
    'lemonchiffon',
    'cornsilk',
    'linen',
    'oldlace',
    'floralwhite',
    'snow',
    'ghostwhite',
    'lightyellow',
    'lightcyan',
  ]);
  if (lightish.has(named)) return '#0f172a';
  return '#f8fafc';
}

function resolveForegroundCss(raw: string | null | undefined): string | null {
  const t = pickStr(raw);
  if (!t) return null;
  const hx = normalizeHex(t);
  if (hx) return hx;
  if (/^rgba?\(/i.test(t)) return t;
  if (/^hsla?\(/i.test(t)) return t;
  if (/^[a-z]{2,20}$/i.test(t)) return t.toLowerCase();
  return null;
}

export function buildTypeFillMap(types: AppointmentType[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const t of types) {
    const bg = typeBackgroundFromRow(t);
    if (bg) m.set(t.id, bg);
  }
  return m;
}

export function colorsForAppointment(
  a: Appointment,
  typeList: AppointmentType[],
  typeFillMap: Map<number, string>
): { fill: string; text: string } {
  const tid = a.appointmentType?.id;
  const fromList = tid != null ? typeList.find((x) => x.id === tid) : undefined;
  const mergedRow = fromList ?? (a.appointmentType as AppointmentType | undefined);

  let fill =
    typeBackgroundFromRow(mergedRow) ??
    (tid != null && typeFillMap.has(tid) ? typeFillMap.get(tid)! : null) ??
    typeBackgroundFromRow(a.appointmentType as AppointmentType);

  if (!fill) {
    const name = a.appointmentType?.prettyName || a.appointmentType?.name || 'type';
    fill = hashColorKey(`${tid ?? ''}:${name}`);
  }

  const textRaw =
    pickStr(fromList?.textColor) ?? pickStr((a.appointmentType as { textColor?: string })?.textColor);
  const text = resolveForegroundCss(textRaw) ?? readableTextOnBackground(fill);
  return { fill, text };
}
