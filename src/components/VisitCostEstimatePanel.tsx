import React, { useEffect, useState } from 'react';
import {
  fetchVisitCostEstimate,
  formatVisitCostAmount,
  type VisitCostEstimate,
  type VisitCostEstimatePet,
} from '../api/visitCostEstimate';

type Props = {
  practiceId: number;
  zoneName?: string | null;
  pets: VisitCostEstimatePet[];
  visible: boolean;
};

export function VisitCostEstimatePanel({ practiceId, zoneName, pets, visible }: Props) {
  const [estimate, setEstimate] = useState<VisitCostEstimate | null>(null);
  const petsKey = JSON.stringify(pets);
  const zoneKey = zoneName?.trim() ?? '';

  useEffect(() => {
    if (!visible || pets.length === 0) {
      setEstimate(null);
      return;
    }
    let alive = true;
    const timeoutId = window.setTimeout(() => {
      void fetchVisitCostEstimate({
        practiceId,
        zoneName: zoneKey || undefined,
        pets,
      })
        .then((next) => {
          if (!alive) return;
          setEstimate(next.lines.length > 0 ? next : null);
        })
        .catch(() => {
          if (alive) setEstimate(null);
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
    };
  }, [visible, practiceId, zoneKey, petsKey, pets]);

  if (!visible || !estimate || estimate.lines.length === 0 || estimate.total == null) {
    return null;
  }

  return (
    <section
      aria-label="Rough visit cost"
      style={{
        marginTop: '20px',
        padding: '14px 16px',
        background: '#f8fafc',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#111827' }}>
        Rough cost for this visit
      </h2>
      <p style={{ margin: '4px 0 12px', fontSize: '13px', color: '#6b7280', lineHeight: 1.45 }}>
        Usual charges for this kind of visit
        {estimate.areaLabel ? ` in the ${estimate.areaLabel} area` : ''}.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {estimate.lines.map((line) => (
          <div key={line.label}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                fontSize: '14px',
                color: '#111827',
              }}
            >
              <span>{line.label}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                {formatVisitCostAmount(line.amount, line.amountMax)}
              </span>
            </div>
            {line.note ? (
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '1px' }}>{line.note}</div>
            ) : null}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          marginTop: '12px',
          paddingTop: '10px',
          borderTop: '1px solid #e5e7eb',
          fontSize: '15px',
          fontWeight: 700,
          color: '#111827',
        }}
      >
        <span>Estimated total</span>
        <span>{formatVisitCostAmount(estimate.total, estimate.totalMax)}</span>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: '12px', color: '#6b7280', lineHeight: 1.45 }}>
        {estimate.disclaimer}
      </p>
    </section>
  );
}
