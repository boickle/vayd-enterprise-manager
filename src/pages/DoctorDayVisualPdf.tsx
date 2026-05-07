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
    fontSize: 16,
    fontWeight: 700,
    padding: '4px 12px',
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

  const hasPatients = !!payload.patients?.length;

  return (
    <div
      style={{
        marginBottom: 6,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: bg,
        overflow: 'hidden',
        color: payload.isPersonalBlock ? '#111827' : undefined,
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          fontSize: 19,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 800, color: '#14532d', fontSize: 22 }}>{payload.client}</span>
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
                fontSize: 15,
                background: '#fef3c7',
                padding: '2px 8px',
                borderRadius: 6,
                border: '1px solid #f59e0b',
              }}
            >
              <AlertTriangle size={16} strokeWidth={2.25} aria-hidden />
              Window Warning
            </span>
          )}
        </div>
        {payload?.clientAlert && (
          <div style={{ marginTop: 2, color: '#dc2626', fontSize: 16, lineHeight: 1.3 }}>
            Alert: {payload.clientAlert}
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 14,
          padding: '8px 12px 10px',
          fontSize: 18,
          lineHeight: 1.3,
          background: '#fff',
        }}
      >
        <div
          style={{
            flex: hasPatients ? '0 0 30%' : '1 1 100%',
            color: '#334155',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div>
            <b>Scheduled:</b> {formatIsoInPracticeZone(payload.sIso, practiceTimeZone)}
            {' · '}
            <b>Dur:</b> {payload.durMin} min
          </div>
          {showArrive && (
            <div>
              <b>Arrive/Leave:</b>{' '}
              {payload.etaIso ? formatIsoInPracticeZone(payload.etaIso, practiceTimeZone) : '—'}
              {' – '}
              {payload.etdIso ? formatIsoInPracticeZone(payload.etdIso, practiceTimeZone) : '—'}
            </div>
          )}
          {showWindow && (
            <div>
              <b>Window:</b>{' '}
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
            </div>
          )}
          {(payload.isFixedTime && !payload.isPersonalBlock) ||
          payload.isPersonalBlock ||
          payload.isNoLocation ||
          (payload.showBackToDepotInBlock && payload.backToDepotIso) ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
              {payload.isFixedTime && !payload.isPersonalBlock && (
                <span style={{ color: '#dc2626', fontWeight: 600 }}>FIXED TIME</span>
              )}
              {payload.isPersonalBlock && (
                <span style={{ color: '#6b7280', fontWeight: 600 }}>
                  {payload.client || 'Block'}
                </span>
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
          ) : null}
          {!showSecondRow ? null : null}
        </div>

        {hasPatients && (
          <div
            style={{
              flex: '1 1 70%',
              borderLeft: '1px solid #e5e7eb',
              paddingLeft: 14,
              minWidth: 0,
            }}
          >
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {payload.patients.map((p, i) => (
                <li
                  key={i}
                  style={{
                    marginBottom: i === payload.patients.length - 1 ? 0 : 4,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    gap: 6,
                    fontSize: 18,
                    color: '#334155',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontWeight: 700,
                    }}
                  >
                    {p.isMember && (
                      <Heart
                        size={16}
                        fill="#dc2626"
                        color="#dc2626"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    )}
                    <span>{p.name}</span>
                  </span>
                  {p.isMember && p.membershipName?.trim() ? (
                    <span style={{ color: '#991b1b', fontWeight: 600 }}>
                      {p.membershipName.trim()}
                    </span>
                  ) : null}
                  <span style={{ color: '#475569' }}>
                    {p.type ? (
                      <>
                        — <b>{p.type}</b>
                        {p.desc ? ` — ${p.desc}` : ''}
                      </>
                    ) : p.desc ? (
                      <>— {p.desc}</>
                    ) : null}
                  </span>
                  {p?.alerts ? (
                    <span style={{ color: '#dc2626' }}>
                      — <strong>Alert</strong>: {p.alerts}
                    </span>
                  ) : null}
                  {p.status ? <span style={statusPillStyle(p.status)}>{p.status}</span> : null}
                  {p.recordStatus ? (
                    <span style={statusPillStyle(p.recordStatus)}>{p.recordStatus}</span>
                  ) : null}
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
        width: 1240,
        padding: 22,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        background: '#fff',
        color: '#111827',
        boxSizing: 'border-box',
        fontSize: 22,
        lineHeight: 1.3,
      }}
    >
      <h1 style={{ margin: '0 0 4px', fontSize: 32, fontWeight: 800 }}>My Day — Visual</h1>
      <p style={{ margin: '0 0 4px', fontSize: 20, color: '#64748b' }}>
        {doctorName} · {dateLabel}
      </p>
      <p style={{ margin: '0 0 10px', fontSize: 18, color: '#64748b' }}>
        {showByDriveTime
          ? 'Blocks are positioned by projected ETA/ETD (drive time).'
          : 'Blocks are positioned by appointment start/end time.'}
      </p>

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '6px 12px',
          marginBottom: 8,
          background: '#fafafa',
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Day Metrics</h2>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 18, color: '#475569' }}>
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

      <div
        style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff' }}
      >
        {rows.map((row, i) => {
          if (row.rowType === 'segment') {
            const { segment } = row;
            const isDrive = segment.kind !== 'buffer';
            return (
              <div
                key={`seg-${i}-${segment.title.slice(0, 24)}`}
                style={{
                  marginBottom: 4,
                  borderRadius: 6,
                  background: isDrive ? DRIVE_FILL : BUFFER_FILL,
                  border: isDrive ? undefined : BUFFER_BORDER,
                  boxSizing: 'border-box',
                  padding: '4px 10px',
                  fontSize: 16,
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
