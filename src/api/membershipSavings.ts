import { useEffect, useState } from 'react';
import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

export type PercentRange = { min: number; max: number };

export type PlanSavings = {
  packageId: number;
  name: string;
  examPercentOff: number | null;
  storePercentOff: number | null;
};

/** Member savings read from plan settings (exam "% off" benefit and store percent). */
export type MembershipSavings = {
  plans: PlanSavings[];
  examPercentOff: PercentRange | null;
  storePercentOff: PercentRange | null;
};

let cached: Promise<MembershipSavings | null> | null = null;

export function fetchMembershipSavings(): Promise<MembershipSavings | null> {
  if (!cached) {
    cached = http
      .get<MembershipSavings>('/public/memberships/savings', {
        params: { practiceId: currentPracticeId() },
      })
      .then((res) => res.data)
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
}

/** `null` while loading or when the lookup fails, so callers show no claim rather than a guess. */
export function useMembershipSavings(): MembershipSavings | null {
  const [savings, setSavings] = useState<MembershipSavings | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchMembershipSavings().then((s) => {
      if (alive) setSavings(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return savings;
}

function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

export function rangeFromPercent(percent: number | null | undefined): PercentRange | null {
  return percent != null && percent > 0 ? { min: percent, max: percent } : null;
}

/** "50%" when every plan agrees, "up to 50%" when they differ. */
export function formatPercentRange(range: PercentRange | null | undefined): string | null {
  if (!range) return null;
  return range.min === range.max ? pct(range.max) : `up to ${pct(range.max)}`;
}

/** Savings for one plan by name (e.g. "Golden"), falling back to the practice-wide range. */
export function savingsForPlan(
  savings: MembershipSavings | null,
  planName: string,
): { exam: PercentRange | null; store: PercentRange | null } {
  if (!savings) return { exam: null, store: null };
  const needle = planName.trim().toLowerCase();
  const matches = savings.plans.filter((p) => p.name.toLowerCase().includes(needle));
  if (matches.length === 0) {
    return { exam: savings.examPercentOff, store: savings.storePercentOff };
  }
  const range = (values: Array<number | null>): PercentRange | null => {
    const nums = values.filter((v): v is number => v != null && v > 0);
    return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
  };
  return {
    exam: range(matches.map((p) => p.examPercentOff)),
    store: range(matches.map((p) => p.storePercentOff)),
  };
}

/** Benefit bullets for plan cards; empty when the plan has no such discount. */
export function savingsBullets(exam: PercentRange | null, store: PercentRange | null): string[] {
  const out: string[] = [];
  const e = formatPercentRange(exam);
  const s = formatPercentRange(store);
  if (e) out.push(`${e} off exams on additional visits`);
  if (s) out.push(`Member pricing (${s} off) in our online store`);
  return out;
}
