// src/components/PreviewMyDayModal.tsx
import { useState } from 'react';
import { DateTime } from 'luxon';
import DoctorDay from '../pages/DoctorDay';
import DoctorDayVisual from '../pages/DoctorDayVisual';

export type PreviewMyDayOption = {
  date: string; // YYYY-MM-DD
  insertionIndex: number;
  suggestedStartIso: string;
  doctorPimsId: string; // already mapped to INTERNAL id earlier
  doctorName: string;
  projectedDriveSeconds?: number;
  currentDriveSeconds?: number;
  workStartLocal?: string;
  effectiveEndLocal?: string;
  bookedServiceSeconds?: number;
  whitespaceAfterBookingSeconds?: number;
};

type Props = {
  option: PreviewMyDayOption;
  serviceMinutes: number;
  newApptMeta: {
    clientId?: string;
    address?: string;
    lat?: number;
    lon?: number;
    city?: string;
    state?: string;
    zip?: string;
  };
  onClose: () => void;
};

function splitAddress(addr?: string) {
  if (!addr) return {};
  const [line, rest = ''] = addr.split(',').map((s) => s.trim());
  const m = rest.match(/^([^,]+)\s+([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
  return m
    ? { address1: line, city: m[1], state: m[2].toUpperCase(), zip: m[3] }
    : { address1: addr };
}

type ViewMode = 'list' | 'visual';

export function PreviewMyDayModal({ option, serviceMinutes, newApptMeta, onClose }: Props) {
  const [mode, setMode] = useState<ViewMode>('visual');
  const parts = splitAddress(newApptMeta?.address);

  const virtualAppt = {
    date: option.date,
    insertionIndex: option.insertionIndex,
    suggestedStartIso: option.suggestedStartIso,
    serviceMinutes: Math.max(1, Math.floor(serviceMinutes)),
    clientName: 'New Appointment',
    // coordinates (optional; DoctorDay will borrow a midpoint if missing)
    lat: Number.isFinite(newApptMeta?.lat) ? Number(newApptMeta!.lat) : undefined,
    lon: Number.isFinite(newApptMeta?.lon) ? Number(newApptMeta!.lon) : undefined,
    // address fields used by DoctorDay.formatAddress
    address1: parts.address1 ?? newApptMeta?.address ?? '',
    city: parts.city ?? newApptMeta?.city,
    state: parts.state ?? newApptMeta?.state,
    zip: parts.zip ?? newApptMeta?.zip,
    // --- Authoritative "winner" facts (what DoctorDay prefers) ---
    projectedDriveSeconds: option.projectedDriveSeconds,
    currentDriveSeconds: option.currentDriveSeconds, // fallback only
    workStartLocal: option.workStartLocal, // "HH:mm" or "HH:mm:ss"
    effectiveEndLocal: option.effectiveEndLocal, // "HH:mm" or "HH:mm:ss"
    bookedServiceSeconds: option.bookedServiceSeconds,
    // If backend returned this on the option, forward it too:
    whitespaceAfterBookingSeconds: (option as any).whitespaceAfterBookingSeconds,
  };

  const commonProps = {
    readOnly: true,
    initialDate: option.date,
    initialDoctorId: option.doctorPimsId, // INTERNAL id (already resolved)
    virtualAppt: virtualAppt,
  };

  const componentKey = `${option.doctorPimsId}-${option.date}-${option.insertionIndex}-${option.suggestedStartIso}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 12,
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>
            {option.doctorName} — {DateTime.fromISO(option.date).toFormat('cccc, LLL dd, yyyy')}
          </h3>
          <div className="muted" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12 }}>View:</span>
            <div
              role="tablist"
              aria-label="View toggle"
              style={{
                display: 'flex',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <button
                role="tab"
                aria-selected={mode === 'list'}
                onClick={() => setMode('list')}
                style={{
                  borderRadius: 0,
                  padding: '6px 10px',
                  border: 'none',
                  background: mode === 'list' ? '#4FB128' : 'transparent',
                  color: mode === 'list' ? '#fff' : '#333',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                List
              </button>
              <button
                role="tab"
                aria-selected={mode === 'visual'}
                onClick={() => setMode('visual')}
                style={{
                  borderRadius: 0,
                  padding: '6px 10px',
                  border: 'none',
                  background: mode === 'visual' ? '#4FB128' : 'transparent',
                  color: mode === 'visual' ? '#fff' : '#333',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                Visual
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Insert at index {option.insertionIndex}
            </div>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {mode === 'list' ? (
          <DoctorDay
            key={`list-${componentKey}`}
            {...commonProps}
          />
        ) : (
          <DoctorDayVisual
            key={`visual-${componentKey}`}
            {...commonProps}
          />
        )}
      </div>
    </div>
  );
}

export default PreviewMyDayModal;
