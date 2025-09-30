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
          initialDoctorId={option.doctorPimsId} // this is the INTERNAL id now
          virtualAppt={{
            date: option.date,
            insertionIndex: option.insertionIndex,
            suggestedStartIso: option.suggestedStartIso,
            serviceMinutes,
            clientName: 'New Appointment',
            lat: newApptMeta.lat,
            lon: newApptMeta.lon,
            address1: newApptMeta.address,
            city: newApptMeta.city,
            state: newApptMeta.state,
            zip: newApptMeta.zip,

            // NEW — styling hints
            isPreview: true,
            highlightColor: '#f5f3ff', // light purple background
            highlightBorder: '#a78bfa', // purple border
          }}
        />
      </div>
    </div>
  );
}

export default PreviewMyDayModal;
