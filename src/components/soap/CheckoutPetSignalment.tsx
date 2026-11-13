import { useEffect, useState } from 'react';
import { fetchPatientByIdStaff } from '../../api/patients';
import { http } from '../../api/http';
import {
  patientAgeYearsMonthsDisplay,
  patientSexNaturalLabelFromRecord,
  sixteenWeekBoosterNote,
} from '../../utils/schedulerVisitDisplay';
import { practiceTimeZoneOrDefault } from '../../utils/practiceTimezone';

export type PetWeight = {
  value: string;
  unit: string;
  at: string | null;
  /** Shown in brackets when the weight was recorded in kg, e.g. "9.9 lb (4.5 kg)". */
  alt?: string | null;
};

const LB_PER_KG = 2.2046226218;

/**
 * Unit of a weight-history point. `weightUnitValue` is the eVet unit code (nothing in this repo or the API
 * documents it; 1 = pounds, 2 = kilograms is the working assumption), or a text unit when one is sent.
 */
export function weightPointIsKg(p: { weightUnitValue?: unknown; weightUnit?: unknown }): boolean {
  const text = typeof p.weightUnit === 'string' ? p.weightUnit : null;
  if (text) return /kg|kilo/i.test(text);
  const v = p.weightUnitValue;
  if (typeof v === 'string' && /kg|kilo/i.test(v)) return true;
  return Number(v) === 2;
}
export type PetSignalmentData = {
  profile: Record<string, unknown> | null;
  weight: PetWeight | null;
};

function str(v: unknown): string | null {
  return v != null && String(v).trim() ? String(v).trim() : null;
}

function formatWeightNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function formatWeightDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: practiceTimeZoneOrDefault(undefined),
  });
}

/** "Feline · Domestic Shorthair · FS · 7y 2m · 9.8 lb (Nov 4, 2026)" or "... · No weight on file". */
export function formatPetSignalment(data: PetSignalmentData): string {
  const p = data.profile;
  const parts: string[] = [];
  if (p) {
    const speciesEntity = p.speciesEntity as Record<string, unknown> | null | undefined;
    const breedEntity = p.breedEntity as Record<string, unknown> | null | undefined;
    const species = str(speciesEntity?.name) ?? str(p.species);
    const breed = str(breedEntity?.name) ?? str(p.breed) ?? str(p.breedDescription);
    const sex = patientSexNaturalLabelFromRecord(p);
    const dob = str(p.dob) ?? str(p.dateOfBirth);
    const tz = practiceTimeZoneOrDefault(undefined);
    const ageOnly = patientAgeYearsMonthsDisplay({ ...p, dob } as never, tz);
    const booster = sixteenWeekBoosterNote(dob, tz);
    const age = ageOnly && booster ? `${ageOnly} (${booster})` : ageOnly;
    for (const part of [species, breed, sex, age]) if (part) parts.push(part);
  }
  const w = data.weight;
  if (w) {
    const date = formatWeightDate(w.at);
    parts.push(`${w.value} ${w.unit}${w.alt ? ` (${w.alt})` : ''}${date ? ` (${date})` : ''}`);
  } else {
    parts.push('No weight on file');
  }
  return parts.join(' · ');
}

const CACHE_MS = 60_000;
const cache = new Map<number, { at: number; promise: Promise<PetSignalmentData> }>();

/** Test hook. */
export function clearPetSignalmentCache(): void {
  cache.clear();
}

async function loadPetSignalment(patientId: number): Promise<PetSignalmentData> {
  const [profileRes, weightsRes] = await Promise.allSettled([
    fetchPatientByIdStaff(patientId),
    http.get<{
      currentWeight?: number | null;
      points?: {
        serviceDate?: string;
        weight?: number | string;
        weightUnitValue?: number | string | null;
        weightUnit?: string | null;
      }[];
    }>(`/patients/${encodeURIComponent(String(patientId))}/weights`),
  ]);
  const raw = profileRes.status === 'fulfilled' ? profileRes.value : null;
  const profile = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  let weight: PetWeight | null = null;
  if (weightsRes.status === 'fulfilled') {
    const pts = (weightsRes.value.data?.points ?? [])
      .map((p) => ({ at: str(p.serviceDate), w: Number(p.weight), kg: weightPointIsKg(p) }))
      .filter((p) => p.at && Number.isFinite(p.w) && p.w > 0)
      .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
    const last = pts[pts.length - 1];
    if (last) {
      weight = last.kg
        ? {
            value: formatWeightNumber(last.w * LB_PER_KG),
            unit: 'lb',
            at: last.at,
            alt: `${formatWeightNumber(last.w)} kg`,
          }
        : { value: formatWeightNumber(last.w), unit: 'lb', at: last.at };
    }
  }
  return { profile, weight };
}

function getPetSignalment(patientId: number): Promise<PetSignalmentData> {
  const hit = cache.get(patientId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = loadPetSignalment(patientId);
  cache.set(patientId, { at: Date.now(), promise });
  return promise;
}

/**
 * Compact signalment + latest weight under a checkout pet header. `todayWeight` (this chart's SOAP vitals)
 * wins over the weight history when entered.
 */
export default function CheckoutPetSignalment({
  patientId,
  todayWeight,
}: {
  patientId: number;
  todayWeight?: { value: string; unit: string } | null;
}) {
  const [data, setData] = useState<PetSignalmentData | null>(null);
  useEffect(() => {
    let canceled = false;
    setData(null);
    void getPetSignalment(patientId)
      .then((d) => {
        if (!canceled) setData(d);
      })
      .catch(() => {
        if (!canceled) setData({ profile: null, weight: null });
      });
    return () => {
      canceled = true;
    };
  }, [patientId]);
  if (!data) return null;
  const weight: PetWeight | null = todayWeight
    ? { ...todayWeight, at: new Date().toISOString() }
    : data.weight;
  return (
    <div className="soap-invoice-pet-signalment" data-testid={`checkout-pet-signalment-${patientId}`}>
      {formatPetSignalment({ profile: data.profile, weight })}
    </div>
  );
}
