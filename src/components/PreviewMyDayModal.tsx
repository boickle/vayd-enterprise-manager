// src/components/PreviewMyDayModal.tsx
import { DateTime } from 'luxon';
import DoctorDay from '../pages/DoctorDay';

export type PreviewMyDayOption = {
  date: string; // YYYY-MM-DD
  insertionIndex: number;
  suggestedStartIso: string;
  doctorPimsId: string;
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

export function PreviewMyDayModal({ option, serviceMinutes, newApptMeta, onClose }: Props) {
  const hasCoords = Number.isFinite(newApptMeta?.lat) && Number.isFinite(newApptMeta?.lon);
  const hasAddress = Boolean(newApptMeta?.address);
  const shouldGhost = !newApptMeta?.clientId && (hasCoords || hasAddress);

  // Only build a ghost when we truly need it (typed-in address / no client).
  const ghost = shouldGhost
    ? {
        id: 'proposed-ghost',
        isGhost: true, // <-- let DoctorDay render even w/o client/patient
        title: 'Proposed (address only)',
        date: option.date,
        insertionIndex: option.insertionIndex,
        suggestedStartIso: option.suggestedStartIso,
        serviceMinutes: Math.max(1, Math.floor(serviceMinutes)),
        // display fields
        clientName: 'New Appointment',
        // location hints (map pin if coords available)
        lat: hasCoords ? Number(newApptMeta!.lat) : undefined,
        lon: hasCoords ? Number(newApptMeta!.lon) : undefined,
        address1: newApptMeta?.address ?? 'Typed address',
        city: newApptMeta?.city,
        state: newApptMeta?.state,
        zip: newApptMeta?.zip,
      }
    : undefined;

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
          readOnly
          initialDate={option.date}
          initialDoctorId={option.doctorPimsId} // INTERNAL id (resolved earlier)
          virtualAppt={ghost ?? undefined}
        />
      </div>
    </div>
  );
}

export default PreviewMyDayModal;
