// src/components/PreviewMyDayModal.tsx
import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import DoctorDay from '../pages/DoctorDay';
import DoctorDayVisual from '../pages/DoctorDayVisual';
import MyWeek, { type MyWeekVirtualAppt, weekStartSunday } from '../pages/MyWeek';

export type PreviewMyDayOption = {
  date: string; // YYYY-MM-DD
  insertionIndex: number;
  /** 1-based visit order from routing API; use for display (#N) and ordering */
  positionInDay?: number;
  suggestedStartIso: string;
  doctorPimsId: string; // already mapped to INTERNAL id earlier
  doctorName: string;
  projectedDriveSeconds?: number;
  currentDriveSeconds?: number;
  workStartLocal?: string;
  effectiveEndLocal?: string;
  bookedServiceSeconds?: number;
  whitespaceAfterBookingSeconds?: number;
  arrivalWindow?: {
    windowStartSec?: number;
    windowEndSec?: number;
    windowStartIso?: string;
    windowEndIso?: string;
  };
  /** Routing-v2: depot return as seconds since local midnight (overrun-aware). */
  validationReturnSec?: number;
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
  /** When both are set, My Day vs My Week is controlled by the parent (single modal). */
  scheduleScope?: 'day' | 'week';
  onScheduleScopeChange?: (s: 'day' | 'week') => void;
  /** When uncontrolled, which tab opens first (default `day`). */
  initialScheduleScope?: 'day' | 'week';
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

export function PreviewMyDayModal({
  option,
  serviceMinutes,
  newApptMeta,
  onClose,
  scheduleScope: controlledScope,
  onScheduleScopeChange,
  initialScheduleScope = 'day',
}: Props) {
  const controlled =
    controlledScope !== undefined && onScheduleScopeChange !== undefined;
  const [fallbackScheduleScope, setFallbackScheduleScope] = useState<'day' | 'week'>(() =>
    initialScheduleScope
  );
  useEffect(() => {
    if (!controlled) setFallbackScheduleScope(initialScheduleScope);
  }, [option.date, option.insertionIndex, option.suggestedStartIso, controlled, initialScheduleScope]);

  const scheduleScope = controlled ? controlledScope! : fallbackScheduleScope;
  const setScheduleScope = (s: 'day' | 'week') => {
    if (controlled) onScheduleScopeChange!(s);
    else setFallbackScheduleScope(s);
  };

  const [mode, setMode] = useState<ViewMode>('visual');
  const parts = splitAddress(newApptMeta?.address);

  const virtualAppt = {
    date: option.date,
    insertionIndex: option.insertionIndex,
    positionInDay: option.positionInDay ?? option.insertionIndex + 1,
    suggestedStartIso: option.suggestedStartIso,
    serviceMinutes: Math.max(1, Math.floor(serviceMinutes)),
    clientName: (option as any).clientName || 'New Appointment',
    lat: Number.isFinite(newApptMeta?.lat) ? Number(newApptMeta!.lat) : undefined,
    lon: Number.isFinite(newApptMeta?.lon) ? Number(newApptMeta!.lon) : undefined,
    address1: parts.address1 ?? newApptMeta?.address ?? '',
    city: parts.city ?? newApptMeta?.city,
    state: parts.state ?? newApptMeta?.state,
    zip: parts.zip ?? newApptMeta?.zip,
    projectedDriveSeconds: option.projectedDriveSeconds,
    currentDriveSeconds: option.currentDriveSeconds,
    workStartLocal: option.workStartLocal,
    effectiveEndLocal: option.effectiveEndLocal,
    bookedServiceSeconds: option.bookedServiceSeconds,
    whitespaceAfterBookingSeconds: (option as any).whitespaceAfterBookingSeconds,
    arrivalWindow: option.arrivalWindow,
    validationReturnSec: option.validationReturnSec,
  };

  const weekVirtualAppt: MyWeekVirtualAppt = {
    date: option.date,
    insertionIndex: option.insertionIndex,
    positionInDay: option.positionInDay ?? option.insertionIndex + 1,
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
    validationReturnSec: option.validationReturnSec,
  };

  const commonProps = {
    readOnly: true,
    initialDate: option.date,
    initialDoctorId: option.doctorPimsId,
    virtualAppt,
  };

  const initialWeekStart = weekStartSunday(option.date);
  const componentKey = `${option.doctorPimsId}-${option.date}-${option.insertionIndex}-${option.suggestedStartIso}`;

  const tabBtn = (active: boolean) =>
    ({
      borderRadius: 0,
      padding: '6px 10px',
      border: 'none',
      background: active ? '#4FB128' : 'transparent',
      color: active ? '#fff' : '#333',
      cursor: 'pointer',
      fontSize: 14,
    }) as const;

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
          width: scheduleScope === 'week' ? 'min(1200px, 96vw)' : 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 12,
          borderRadius: 12,
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>
            {scheduleScope === 'week'
              ? `${option.doctorName} — Week of ${DateTime.fromISO(initialWeekStart).toFormat('LLL d, yyyy')}`
              : `${option.doctorName} — ${DateTime.fromISO(option.date).toFormat('cccc, LLL dd, yyyy')}`}
          </h3>
          <div
            className="muted"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: 12 }}>Schedule:</span>
            <div
              role="tablist"
              aria-label="My Day or My Week"
              style={{
                display: 'flex',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={scheduleScope === 'day'}
                onClick={() => setScheduleScope('day')}
                style={tabBtn(scheduleScope === 'day')}
              >
                My Day
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scheduleScope === 'week'}
                onClick={() => setScheduleScope('week')}
                style={tabBtn(scheduleScope === 'week')}
              >
                My Week
              </button>
            </div>

            {scheduleScope === 'day' && (
              <>
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
                  <button type="button" role="tab" aria-selected={mode === 'list'} onClick={() => setMode('list')} style={tabBtn(mode === 'list')}>
                    List
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'visual'}
                    onClick={() => setMode('visual')}
                    style={tabBtn(mode === 'visual')}
                  >
                    Visual
                  </button>
                </div>
              </>
            )}

            {scheduleScope === 'day' ? (
              <div className="muted" style={{ fontSize: 12 }}>
                Visit #{option.positionInDay ?? option.insertionIndex + 1}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                New appointment: {DateTime.fromISO(option.date).toFormat('ccc')} @{' '}
                {DateTime.fromISO(option.suggestedStartIso).toFormat('t')} (preview in purple)
              </div>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {scheduleScope === 'day' ? (
          mode === 'list' ? (
            <DoctorDay key={`list-${componentKey}`} {...commonProps} />
          ) : (
            <DoctorDayVisual key={`visual-${componentKey}`} {...commonProps} />
          )
        ) : (
          <MyWeek
            key={`week-${componentKey}`}
            readOnly
            initialWeekStart={initialWeekStart}
            initialDoctorId={option.doctorPimsId}
            virtualAppt={weekVirtualAppt}
          />
        )}
      </div>
    </div>
  );
}

export default PreviewMyDayModal;
