import type { CSSProperties, ReactNode } from 'react';
import { Heart } from 'lucide-react';

export type MyDayVisualPatientDetailData = {
  name: string;
  type?: string | null;
  sex?: string | null;
  appointmentNotes?: string | null;
  staffNotes?: string | null;
  petAlerts?: string | null;
  /** @deprecated use petAlerts */
  alerts?: string | null;
  status?: string | null;
  recordStatus?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
};

type Props = {
  patient: MyDayVisualPatientDetailData;
  variant?: 'hover' | 'pdf';
  statusPillStyle?: (text: string) => CSSProperties;
};

function noteLine(
  label: string,
  value: string | null | undefined,
  opts: { fontSize: number; alert?: boolean; pdf?: boolean }
): ReactNode {
  const text = value?.trim();
  if (!text) return null;
  return (
    <div
      style={{
        fontSize: opts.fontSize,
        color: opts.alert ? '#dc2626' : '#475569',
        marginTop: opts.pdf ? 4 : 2,
        lineHeight: 1.4,
      }}
    >
      <b>{label}:</b> {text}
    </div>
  );
}

export function MyDayVisualPatientDetail({
  patient: p,
  variant = 'hover',
  statusPillStyle,
}: Props) {
  const isPdf = variant === 'pdf';
  const nameSize = isPdf ? 18 : 13;
  const metaSize = isPdf ? 16 : 12;
  const petAlerts = p.petAlerts?.trim() || p.alerts?.trim() || null;

  const detail = (
    <>
      <div
        style={{
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          fontSize: nameSize,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {p.isMember ? (
            <Heart size={isPdf ? 16 : 14} fill="#dc2626" color="#dc2626" strokeWidth={1.5} aria-hidden />
          ) : null}
          <span>{p.name}</span>
        </span>
        {p.sex?.trim() ? (
          <span style={{ color: '#64748b', fontWeight: 600, fontSize: metaSize }}>{p.sex.trim()}</span>
        ) : null}
        {p.isMember && p.membershipName?.trim() ? (
          <span style={{ color: '#991b1b', fontWeight: 600, fontSize: metaSize }}>
            {p.membershipName.trim()}
          </span>
        ) : null}
      </div>

      {p.type?.trim() ? (
        <div style={{ fontSize: metaSize, color: '#475569', marginTop: isPdf ? 4 : 2 }}>
          <b>{p.type.trim()}</b>
        </div>
      ) : null}

      {noteLine('Appt notes', p.appointmentNotes, { fontSize: metaSize, pdf: isPdf })}
      {noteLine('Staff notes', p.staffNotes, { fontSize: metaSize, pdf: isPdf })}
      {noteLine('Pet alerts', petAlerts, { fontSize: metaSize, alert: true, pdf: isPdf })}

      {(p.status || p.recordStatus) && statusPillStyle ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginTop: 4,
          }}
        >
          {p.status ? (
            <span style={statusPillStyle(p.status)} title="Status">
              {p.status}
            </span>
          ) : null}
          {p.recordStatus ? (
            <span style={statusPillStyle(p.recordStatus)} title="Records status">
              {p.recordStatus}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (isPdf) {
    return (
      <li
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '10px 12px 10px 10px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              color: '#0284c7',
              fontWeight: 800,
              fontSize: 22,
              lineHeight: 1.15,
              marginTop: 1,
            }}
          >
            •
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>{detail}</div>
        </div>
      </li>
    );
  }

  return <li style={{ marginBottom: 6 }}>{detail}</li>;
}
