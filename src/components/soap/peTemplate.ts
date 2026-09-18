// Physical exam template (spec §5.1). Runs head to tail, system by system,
// normal by default with tap-to-expand on abnormal. We never require typing
// "WNL" on every system — only flagged systems open a note field.

export type PeSystemStatus = 'normal' | 'abnormal' | 'not_examined';

export type PeSystemFinding = {
  status: PeSystemStatus;
  note?: string;
};

export type PeExamState = Record<string, PeSystemFinding>;

export type PeSystemDef = {
  key: string;
  label: string;
  /** Default "normal" phrasing surfaced when a system is left normal. */
  normalText: string;
};

/** Head-to-tail body systems for the comprehensive PE. */
export const PE_SYSTEMS: PeSystemDef[] = [
  { key: 'general', label: 'General / Attitude', normalText: 'BAR, well hydrated, appropriate BCS' },
  { key: 'eyes', label: 'Eyes (OU)', normalText: 'No discharge, clear corneas, PLRs intact' },
  { key: 'ears', label: 'Ears (AU)', normalText: 'Clean, no odor or discharge' },
  { key: 'oral', label: 'Oral / Dental', normalText: 'Mucous membranes pink, CRT < 2s, no significant dental disease' },
  { key: 'lymph', label: 'Lymph Nodes', normalText: 'Symmetrical, no enlargement' },
  { key: 'integument', label: 'Integument / Skin & Coat', normalText: 'No lesions, ectoparasites, or alopecia' },
  { key: 'musculoskeletal', label: 'Musculoskeletal', normalText: 'Ambulatory x4, no lameness or pain on palpation' },
  { key: 'cardiovascular', label: 'Cardiovascular', normalText: 'No murmurs or arrhythmias, strong synchronous pulses' },
  { key: 'respiratory', label: 'Respiratory', normalText: 'Normal effort, clear on auscultation' },
  { key: 'gastrointestinal', label: 'Gastrointestinal / Abdomen', normalText: 'Soft, non-painful, no organomegaly or masses' },
  { key: 'urogenital', label: 'Urogenital', normalText: 'No abnormalities detected' },
  { key: 'neurologic', label: 'Neurologic', normalText: 'Appropriate mentation, no deficits' },
];

export function defaultPeExamState(): PeExamState {
  const state: PeExamState = {};
  for (const s of PE_SYSTEMS) state[s.key] = { status: 'normal' };
  return state;
}

export function peExamFromValue(value: unknown): PeExamState {
  const base = defaultPeExamState();
  if (!value || typeof value !== 'object') return base;
  const obj = value as Record<string, unknown>;
  for (const s of PE_SYSTEMS) {
    const raw = obj[s.key];
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      const status =
        r.status === 'abnormal' || r.status === 'not_examined' ? r.status : 'normal';
      base[s.key] = {
        status: status as PeSystemStatus,
        note: typeof r.note === 'string' ? r.note : undefined,
      };
    }
  }
  return base;
}

export function countAbnormalSystems(state: PeExamState): number {
  return Object.values(state).filter((f) => f.status === 'abnormal').length;
}
