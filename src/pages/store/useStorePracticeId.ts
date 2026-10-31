import { useEffect, useState } from 'react';
import { loadHostPractice } from '../../api/practices';
import { currentPracticeId } from '../../utils/practiceIdFromToken';

/** Host practice id for public catalog/checkout — waits for /public/practice/current. */
export async function resolveStorePracticeId(): Promise<number> {
  await loadHostPractice().catch(() => {});
  return currentPracticeId();
}

export function useStorePracticeId(): { practiceId: number; ready: boolean } {
  const [practiceId, setPracticeId] = useState(currentPracticeId);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void resolveStorePracticeId().then((next) => {
      if (cancelled) return;
      setPracticeId(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { practiceId, ready };
}
