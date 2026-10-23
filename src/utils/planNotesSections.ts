/**
 * Helpers for the SOAP Plan narrative's sectioned layout:
 *
 *   Diagnostics:
 *   - …
 *   Treatment Plan/Medications:
 *   - …
 *   Client Communication:
 *   - …
 */

const TREATMENT_MEDS_HEADER = 'Treatment Plan/Medications:';

/** Prefix for inventory meds auto-added to Treatment Plan/Medications. */
export const RXED_PLAN_PREFIX = "Rx'ed ";

/** Prefix for vaccines auto-added to Treatment Plan/Medications (already charging). */
export const VX_ADMINISTERED_PLAN_PREFIX = 'Vx administered: ';

/** Canonical headers the Document-view Plan placeholder uses, in order. */
const PLAN_SECTION_ORDER = [
  'Diagnostics:',
  TREATMENT_MEDS_HEADER,
  'Client Communication:',
] as const;

export type TreatmentPlanItemKind = 'medication' | 'vaccine';

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripBulletMarker(text: string): string {
  return text.replace(/^[-•*]\s*/, '').trim();
}

function asBullet(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return t.startsWith('-') || t.startsWith('•') || t.startsWith('*')
    ? `- ${stripBulletMarker(t)}`
    : `- ${t}`;
}

/** Strip auto Plan prefixes so matching works against the catalog item name. */
function stripAutoPlanPrefixes(text: string): string {
  return (
    text
      .trim()
      .replace(/^rx'?ed\s+/i, '')
      .replace(/^vx\s+administered:\s*/i, '')
      // Legacy vaccine wording before "Vx administered:"
      .replace(/^administered\s+/i, '')
      .replace(/\s+sq\.?$/i, '')
      .trim()
  );
}

/** Label written into Plan when an inventory item is charged. */
export function treatmentPlanMedicationLabel(
  itemName: string,
  kind: TreatmentPlanItemKind = 'medication'
): string {
  const name = stripAutoPlanPrefixes(itemName);
  if (!name) return '';
  if (kind === 'vaccine') {
    return `${VX_ADMINISTERED_PLAN_PREFIX}${name} SQ`;
  }
  return `${RXED_PLAN_PREFIX}${name}`;
}

/** Bullet body variants that all mean the same inventory line. */
function medicationMatchKeys(itemName: string): Set<string> {
  const raw = stripBulletMarker(itemName);
  const base = stripAutoPlanPrefixes(raw);
  const withRx = treatmentPlanMedicationLabel(base || raw, 'medication');
  const withVax = treatmentPlanMedicationLabel(base || raw, 'vaccine');
  // Legacy vaccine line from before "Vx administered:"
  const legacyVax = base ? `Administered ${base} SQ` : '';
  return new Set([raw, base, withRx, withVax, legacyVax].filter(Boolean).map((s) => norm(s)));
}

/**
 * True when the Plan narrative already has this medication/vaccine bullet (any auto-prefix),
 * so adding an inventory item a second time does not duplicate the line.
 */
export function planNotesAlreadyHasBullet(planNotes: string, text: string): boolean {
  const keys = medicationMatchKeys(text);
  if (keys.size === 0) return false;
  for (const raw of planNotes.split('\n')) {
    const m = raw.trim().match(/^[-•*]\s*(.+)$/);
    if (m && keys.has(norm(m[1]))) return true;
  }
  return false;
}

function isSectionHeader(line: string): boolean {
  const t = line.trim();
  return Boolean(t) && t.endsWith(':') && !/^[-•*]/.test(t);
}

/**
 * Keep Treatment Plan/Medications compact: no blank lines between its bullets, and exactly
 * one blank line before the following section header when one follows.
 */
function tidyTreatmentMedsSection(lines: string[]): string[] {
  const headerIdx = lines.findIndex((l) => norm(l) === norm(TREATMENT_MEDS_HEADER));
  if (headerIdx < 0) return lines;

  let end = headerIdx + 1;
  while (end < lines.length && !isSectionHeader(lines[end])) end += 1;

  const body = lines
    .slice(headerIdx + 1, end)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');

  const next = [...lines.slice(0, headerIdx + 1), ...body];
  if (end < lines.length) {
    next.push('');
    next.push(...lines.slice(end));
  }
  return next;
}

/**
 * Inserts an auto Plan bullet under `Treatment Plan/Medications:`:
 * - meds → `- Rx'ed {itemName}`
 * - vaccines → `- Vx administered: {itemName} SQ`
 */
export function appendTreatmentPlanMedicationBullet(
  planNotes: string,
  itemName: string,
  opts?: { kind?: TreatmentPlanItemKind }
): string {
  const kind = opts?.kind ?? 'medication';
  const label = treatmentPlanMedicationLabel(itemName, kind);
  const bullet = asBullet(label);
  if (!bullet) return planNotes;
  if (planNotesAlreadyHasBullet(planNotes, itemName)) return planNotes;

  const lines = planNotes.replace(/\r\n/g, '\n').split('\n');
  const headerIdx = lines.findIndex((l) => norm(l) === norm(TREATMENT_MEDS_HEADER));

  if (headerIdx >= 0) {
    let insertAt = headerIdx + 1;
    while (insertAt < lines.length && !isSectionHeader(lines[insertAt])) {
      insertAt += 1;
    }
    // Sit after the last non-blank line in this section (not after trailing blanks).
    while (insertAt > headerIdx + 1 && lines[insertAt - 1].trim() === '') {
      insertAt -= 1;
    }
    const next = [...lines];
    next.splice(insertAt, 0, bullet);
    return tidyTreatmentMedsSection(next).join('\n');
  }

  // No Treatment Plan/Medications header yet — create it in the right place.
  const clientIdx = lines.findIndex((l) => norm(l) === norm('Client Communication:'));
  const block = [TREATMENT_MEDS_HEADER, bullet];

  if (clientIdx >= 0) {
    const next = [...lines];
    const before = clientIdx > 0 && lines[clientIdx - 1].trim() === '' ? clientIdx - 1 : clientIdx;
    next.splice(before, clientIdx - before, '', ...block, '');
    return next
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  const trimmed = planNotes.trim();
  if (!trimmed) {
    return `${TREATMENT_MEDS_HEADER}\n${bullet}`;
  }
  void PLAN_SECTION_ORDER;
  return `${trimmed}\n\n${TREATMENT_MEDS_HEADER}\n${bullet}`;
}

/**
 * Removes the auto-added Treatment Plan/Medications bullet for an inventory item
 * (matches Rx'ed or Vx administered: … SQ wording).
 */
export function removeTreatmentPlanMedicationBullet(planNotes: string, itemName: string): string {
  const keys = medicationMatchKeys(itemName);
  if (keys.size === 0) return planNotes;

  const lines = planNotes.replace(/\r\n/g, '\n').split('\n');
  const next = lines.filter((raw) => {
    const m = raw.trim().match(/^[-•*]\s*(.+)$/);
    if (!m) return true;
    return !keys.has(norm(m[1]));
  });

  if (next.length === lines.length) return planNotes;
  return tidyTreatmentMedsSection(next).join('\n');
}
