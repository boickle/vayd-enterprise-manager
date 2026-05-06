// src/pages/DoctorDayVisualPdf.tsx — Off-screen DOM for My Day — Visual PDF export (html2canvas).
import type { CSSProperties } from 'react';
import { AlertTriangle, Heart } from 'lucide-react';
import { formatIsoInPracticeZone } from '../utils/practiceTimezone';
import { formatHM, colorForWhitespace, colorForHDRatio, colorForDrive } from '../utils/statsFormat';

const DRIVE_FILL =
  'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';
const BUFFER_FILL = 'rgba(255, 255, 255, 0.35)';
const BUFFER_BORDER = '1px dashed #d1d5db';

export type DoctorDayVisualPdfPatient = {
  name: string;
  status?: string | null;
  recordStatus?: string | null;
  type?: string | null;
  desc?: string | null;
  alerts?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
};

export type DoctorDayVisualPdfAppointmentPayload = {
  key: string;
  client: string;
  address: string;
  clientAlert?: string;
  durMin: number;
  etaIso?: string | null;
  etdIso?: string | null;
  sIso: string;
  eIso: string;
  patients: DoctorDayVisualPdfPatient[];
  isFixedTime?: boolean;
  isPersonalBlock?: boolean;
  isNoLocation?: boolean;
  isPreview?: boolean;
  flexBlock?: boolean;
  effectiveWindow?: { startIso: string; endIso: string };
  windowFromByIndex?: { winStartIso: string; winEndIso: string };
  resolvedWinStartIso: string;
  resolvedWinEndIso: string;
  windowWarning?: boolean;
  showBackToDepotInBlock: boolean;
  backToDepotIso?: string | null;
};

export type DoctorDayVisualPdfSegmentRow = {
  kind: 'fromDepot' | 'buffer' | 'drive';
  title: string;
  mins: number;
};

export type DoctorDayVisualPdfRow =
  | { rowType: 'segment'; segment: DoctorDayVisualPdfSegmentRow }
  | { rowType: 'appointment'; payload: DoctorDayVisualPdfAppointmentPayload };

export type DoctorDayVisualPdfDocumentProps = {
  doctorName: string;
  dateLabel: string;
  showByDriveTime: boolean;
  practiceTimeZone: string;
  stats: {
    points: number;
    driveMin: number;
    householdMin: number;
    ratioText: string;
    whiteMin: number;
    whitePctText: string;
    shiftMin: number;
    backToDepotIso: string | null;
  };
  rows: DoctorDayVisualPdfRow[];
};

function stripZipFromAddressLine(line: string): string {
  if (!line?.trim()) return line;
  return line
    .replace(/,\s*\d{5}(-\d{4})?\s*$/i, '')
    .replace(/\s+\d{5}(-\d{4})?\s*$/i, '')
    .trim();
}

function statusPillStyle(text: string): CSSProperties {
  const s = text.toLowerCase();
  return {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
    background: s.includes('pre-appt email')
      ? '#fee2e2'
      : s.includes('pre-appt form') || s.includes('client submitted')
        ? '#dcfce7'
        : '#e5e7eb',
    color: s.includes('pre-appt email')
      ? '#b91c1c'
      : s.includes('pre-appt form') || s.includes('client submitted')
        ? '#166534'
        : '#334155',
  };
}

function AppointmentPdfBlock({
  payload,
  practiceTimeZone,
}: {
  payload: DoctorDayVisualPdfAppointmentPayload;
  practiceTimeZone: string;
}) {
  const addrNoZip = stripZipFromAddressLine(payload.address);
  const showArrive = !!(payload.etaIso || payload.etdIso);
  const showWindow =
    !!(payload.resolvedWinStartIso && payload.resolvedWinEndIso) &&
    !(payload.isPersonalBlock && payload.isFixedTime);
  const showSecondRow = showArrive || showWindow;
  const winStartIso = payload.resolvedWinStartIso;
  const winEndIso = payload.resolvedWinEndIso;

  const borderColor = payload.flexBlock
    ? '#ca8a04'
    : payload.isPersonalBlock
      ? '#9ca3af'
      : payload.isNoLocation
        ? '#ef4444'
        : payload.isPreview
          ? '#a855f7'
          : '#38bdf8';
  const bg = payload.flexBlock
    ? '#fef9c3'
    : payload.isPersonalBlock
      ? '#e5e7eb'
      : payload.isNoLocation
        ? '#fee2e2'
        : payload.isPreview
          ? '#ede9fe'
          : '#e0f2fe';

  return (
    <div
      style={{
        marginBottom: 10,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        background: bg,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        color: payload.isPersonalBlock ? '#111827' : undefined,
      }}
    >
      <div style={{ padding: '10px 12px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <span style={{ fontWeight: 800, color: '#14532d' }}>{payload.client}</span>
          <span style={{ color: '#64748b' }}>·</span>
          <span style={{ color: '#64748b', flex: '1 1 12rem', minWidth: 0 }}>{addrNoZip}</span>
          {payload.windowWarning && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: '#b45309',
                fontWeight: 600,
                fontSize: 12,
                background: '#fef3c7',
                padding: '2px 6px',
                borderRadius: 6,
                border: '1px solid #f59e0b',
              }}
            >
              <AlertTriangle size={14} strokeWidth={2.25} aria-hidden />
              Window Warning
            </span>
          )}
        </div>
        {payload?.clientAlert && (
          <div style={{ marginBottom: 4, color: '#dc2626', fontSize: 12, lineHeight: 1.35 }}>
            Alert: {payload.clientAlert}
          </div>
        )}
      </div>
      <div
        style={{ padding: '10px 12px 12px', fontSize: 13, lineHeight: 1.35, background: '#fff' }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'baseline',
            marginBottom: 4,
            color: '#334155',
          }}
        >
          <span>
            <b>Scheduled:</b> {formatIsoInPracticeZone(payload.sIso, practiceTimeZone)}
          </span>
          <span>
            <b>Duration:</b> {payload.durMin} min
          </span>
          {payload.isFixedTime && !payload.isPersonalBlock && (
            <span style={{ color: '#dc2626', fontWeight: 600 }}>FIXED TIME</span>
          )}
          {payload.isPersonalBlock && (
            <span style={{ color: '#6b7280', fontWeight: 600 }}>{payload.client || 'Block'}</span>
          )}
          {payload.isNoLocation && (
            <span style={{ color: '#dc2626', fontWeight: 600 }}>No location</span>
          )}
          {payload.showBackToDepotInBlock && payload.backToDepotIso && (
            <span>
              <b>Back to depot:</b>{' '}
              {formatIsoInPracticeZone(payload.backToDepotIso, practiceTimeZone)}
            </span>
          )}
        </div>

        {showSecondRow && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'baseline',
              marginBottom: 4,
              fontSize: 13,
              color: '#334155',
            }}
          >
            {showArrive && (
              <span>
                <b>Arrive/Leave:</b>{' '}
                {payload.etaIso ? formatIsoInPracticeZone(payload.etaIso, practiceTimeZone) : '—'}
                {' – '}
                {payload.etdIso ? formatIsoInPracticeZone(payload.etdIso, practiceTimeZone) : '—'}
              </span>
            )}
            {showWindow && (
              <span>
                <b>Window of arrival:</b>{' '}
                {payload.isFixedTime ? (
                  <>
                    {formatIsoInPracticeZone(payload.sIso, practiceTimeZone)} –{' '}
                    {formatIsoInPracticeZone(payload.eIso, practiceTimeZone)}
                  </>
                ) : (
                  <>
                    {formatIsoInPracticeZone(winStartIso, practiceTimeZone)} –{' '}
                    {formatIsoInPracticeZone(winEndIso, practiceTimeZone)}
                  </>
                )}
              </span>
            )}
          </div>
        )}

        {!!payload.patients?.length && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: '#14532d' }}>Patients</div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {payload.patients.map((p, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {p.isMember && (
                        <Heart
                          size={14}
                          fill="#dc2626"
                          color="#dc2626"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                      )}
                      <span>{p.name}</span>
                    </span>
                    {p.isMember && p.membershipName?.trim() ? (
                      <span style={{ color: '#991b1b', fontWeight: 600, fontSize: 13 }}>
                        {p.membershipName.trim()}
                      </span>
                    ) : null}
                    {p?.alerts ? (
                      <>
                        {' '}
                        — <strong>Alert</strong>:{' '}
                        <span style={{ color: '#dc2626' }}>{p.alerts}</span>
                      </>
                    ) : null}
                  </div>

                  <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                    {p.type ? (
                      <>
                        <b>{p.type}</b>
                        {p.desc ? ` — ${p.desc}` : ''}
                      </>
                    ) : (
                      p.desc || '—'
                    )}
                  </div>
                  {(p.status || p.recordStatus) && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 4,
                      }}
                    >
                      {p.status ? <span style={statusPillStyle(p.status)}>{p.status}</span> : null}
                      {p.recordStatus ? (
                        <span style={statusPillStyle(p.recordStatus)}>{p.recordStatus}</span>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function DoctorDayVisualPdfDocument({
  doctorName,
  dateLabel,
  showByDriveTime,
  practiceTimeZone,
  stats,
  rows,
}: DoctorDayVisualPdfDocumentProps) {
  const whitePct =
    Number.isFinite(stats.shiftMin) && stats.shiftMin > 0
      ? (stats.whiteMin / stats.shiftMin) * 100
      : 0;
  const whiteColor = colorForWhitespace(whitePct);
  const driveColor = colorForDrive(stats.driveMin);
  const ratioNum = stats.driveMin > 0 ? stats.householdMin / stats.driveMin : Infinity;
  const hdColor = colorForHDRatio(ratioNum);

  return (
    <div
      style={{
        width: 780,
        padding: 20,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        background: '#fff',
        color: '#111827',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>My Day — Visual</h1>
      <p style={{ margin: '0 0 6px', fontSize: 14, color: '#64748b' }}>
        {doctorName} · {dateLabel}
      </p>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b' }}>
        {showByDriveTime
          ? 'Blocks are positioned by projected ETA/ETD (drive time).'
          : 'Blocks are positioned by appointment start/end time.'}
      </p>

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 16,
          background: '#fafafa',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>Day Metrics</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, color: '#475569' }}>
          <span>
            <strong>Points:</strong> {stats.points}
          </span>
          <span style={{ color: driveColor }}>
            <strong>Drive:</strong> {formatHM(stats.driveMin)}
          </span>
          <span>
            <strong>Households:</strong> {formatHM(stats.householdMin)}
          </span>
          <span style={{ color: hdColor }}>
            <strong>H:D ratio:</strong> {stats.ratioText}
          </span>
          <span style={{ color: whiteColor }}>
            <strong>Whitespace:</strong> {formatHM(stats.whiteMin)}
            {stats.shiftMin > 0 && <> ({stats.whitePctText})</>}
          </span>
          <span style={{ color: '#64748b' }}>Shift: {formatHM(stats.shiftMin)}</span>
          <span>
            <strong>Back to depot:</strong>{' '}
            {stats.backToDepotIso
              ? formatIsoInPracticeZone(stats.backToDepotIso, practiceTimeZone)
              : '—'}
          </span>
        </div>
      </div>

      <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>Schedule</h2>
      <div
        style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' }}
      >
        {rows.map((row, i) => {
          if (row.rowType === 'segment') {
            const { segment } = row;
            const h = Math.max(22, Math.min(56, 14 + segment.mins * 1.2));
            const isDrive = segment.kind !== 'buffer';
            return (
              <div
                key={`seg-${i}-${segment.title.slice(0, 24)}`}
                style={{
                  marginBottom: 8,
                  borderRadius: 8,
                  minHeight: h,
                  background: isDrive ? DRIVE_FILL : BUFFER_FILL,
                  border: isDrive ? undefined : BUFFER_BORDER,
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  fontSize: 12,
                  color: '#475569',
                  fontWeight: 600,
                }}
              >
                {segment.title}
              </div>
            );
          }
          return (
            <AppointmentPdfBlock
              key={row.payload.key || `appt-${i}`}
              payload={row.payload}
              practiceTimeZone={practiceTimeZone}
            />
          );
        })}
      </div>
    </div>
  );
}
