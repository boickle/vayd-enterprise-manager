// src/components/PreviewMyDayModal.tsx
import { DateTime } from 'luxon';
import DoctorDay from '../pages/DoctorDay';

export type PreviewMyDayOption = {
  date: string; // YYYY-MM-DD
  insertionIndex: number;
  suggestedStartIso: string;
  doctorPimsId: string; // already mapped to INTERNAL id earlier
  doctorName: string;
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

export function PreviewMyDayModal({ option, serviceMinutes, newApptMeta, onClose }: Props) {
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
  };

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
          <div className="muted" style={{ marginLeft: 'auto' }}>
            Insert at index {option.insertionIndex}
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <DoctorDay
          // ⬇️ force a remount per click so new props always apply
          key={`${option.doctorPimsId}-${option.date}-${option.insertionIndex}-${option.suggestedStartIso}`}
          readOnly
          initialDate={option.date}
          initialDoctorId={option.doctorPimsId} // INTERNAL id (already resolved)
          virtualAppt={virtualAppt}
        />
      </div>
    </div>
  );
}

export default PreviewMyDayModal;
