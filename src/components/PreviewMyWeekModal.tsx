// src/components/PreviewMyWeekModal.tsx
import { DateTime } from 'luxon';
import MyWeek, { type MyWeekVirtualAppt } from '../pages/MyWeek';
import type { PreviewMyDayOption } from './PreviewMyDayModal';

function weekStartSunday(dateIso: string): string {
  const dt = DateTime.fromISO(dateIso);
  const weekday = dt.weekday; // 1=Mon .. 7=Sun
  const sunday = weekday === 7 ? dt : dt.minus({ days: weekday });
  return sunday.toISODate() ?? dateIso;
}

function splitAddress(addr?: string): { address1?: string; city?: string; state?: string; zip?: string } {
  if (!addr) return {};
  const [line, rest = ''] = addr.split(',').map((s) => s.trim());
  const m = rest.match(/^([^,]+)\s+([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
  return m
    ? { address1: line, city: m[1], state: m[2].toUpperCase(), zip: m[3] }
    : { address1: addr };
}

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

export function PreviewMyWeekModal({ option, serviceMinutes, newApptMeta, onClose }: Props) {
  const parts = splitAddress(newApptMeta?.address);
  const virtualAppt: MyWeekVirtualAppt = {
    date: option.date,
    suggestedStartIso: option.suggestedStartIso,
    serviceMinutes: Math.max(1, Math.floor(serviceMinutes)),
    clientName: (option as any).clientName || 'New Appointment',
    lat: Number.isFinite(newApptMeta?.lat) ? Number(newApptMeta.lat) : undefined,
    lon: Number.isFinite(newApptMeta?.lon) ? Number(newApptMeta.lon) : undefined,
    address1: parts.address1 ?? newApptMeta?.address ?? '',
    city: parts.city ?? newApptMeta?.city,
    state: parts.state ?? newApptMeta?.state,
    zip: parts.zip ?? newApptMeta?.zip,
    arrivalWindow: option.arrivalWindow,
  };

  const initialWeekStart = weekStartSunday(option.date);

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
          width: 'min(1200px, 96vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 12,
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>
            {option.doctorName} — Week of {DateTime.fromISO(initialWeekStart).toFormat('LLL d, yyyy')}
          </h3>
          <div className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
            New appointment: {DateTime.fromISO(option.date).toFormat('ccc')} @{' '}
            {DateTime.fromISO(option.suggestedStartIso).toFormat('t')} (preview in purple)
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <MyWeek
          readOnly
          initialWeekStart={initialWeekStart}
          initialDoctorId={option.doctorPimsId}
          virtualAppt={virtualAppt}
        />
      </div>
    </div>
  );
}

export default PreviewMyWeekModal;
