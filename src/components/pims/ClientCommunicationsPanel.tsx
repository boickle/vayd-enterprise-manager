import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronRight, Mail } from 'lucide-react';
import { listClientCommunications, type ClientCommunicationRow } from '../../api/scoutChart';
import { communicationBodyForDisplay } from '../../utils/clientCommunicationDisplay';
import './ClientCommunicationsPanel.css';

const TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function formatWhen(iso: string | Date): string {
  const d = typeof iso === 'string' ? DateTime.fromISO(iso, { setZone: true }) : DateTime.fromJSDate(iso);
  const local = d.setZone(TZ);
  if (!local.isValid) return '—';
  return local.toFormat('MMM d, yyyy · t');
}

function commMeta(row: ClientCommunicationRow): string {
  const bits = [formatWhen(row.serviceDate)];
  if (row.destination) bits.push(row.destination);
  if (row.sentFrom?.trim()) bits.push(`from ${row.sentFrom.trim()}`);
  if (row.sentByName?.trim()) bits.push(`by ${row.sentByName.trim()}`);
  const petNames =
    row.patientNames?.length
      ? row.patientNames
      : row.patientName
        ? [row.patientName]
        : [];
  if (petNames.length) bits.push(petNames.join(', '));
  if (row.includeOnMedicalRecordView) bits.push('On patient EMR');
  return bits.join(' · ');
}

export default function ClientCommunicationsPanel({
  clientId,
  refreshKey = 0,
  collapsed,
  onToggleCollapse,
}: {
  clientId: number;
  refreshKey?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [rows, setRows] = useState<ClientCommunicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listClientCommunications(clientId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load communications.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  return (
    <section className="pims-emr-story__card client-comms" aria-labelledby="pims-client-comms">
      {onToggleCollapse ? (
        <button
          type="button"
          id="pims-client-comms"
          className="pims-emr-story__collapse"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          <Mail size={15} aria-hidden />
          Client communications{rows.length ? ` (${rows.length})` : ''}
        </button>
      ) : (
        <h3 id="pims-client-comms">
          <Mail size={15} aria-hidden />
          Client communications
        </h3>
      )}
      {collapsed ? null : loading ? (
        <p className="pims-emr-story__muted">Loading messages…</p>
      ) : error ? (
        <p className="client-comms__err">{error}</p>
      ) : rows.length === 0 ? (
        <p className="pims-emr-story__muted">
          Emails and texts sent from Scout land here — invoices, receipts, and other clerical
          notes stay off the patient medical record unless you choose otherwise.
        </p>
      ) : (
        <ul className="client-comms__list">
          {rows.map((row) => {
            const open = openId === row.id;
            const parsed = communicationBodyForDisplay(row.message);
            const summary = parsed.subject || parsed.text || row.typeLabel;
            const preview =
              summary.length > 140 ? `${summary.slice(0, 140)}…` : summary;
            return (
              <li key={row.id} className={`client-comms__item${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="client-comms__row"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : row.id)}
                >
                  {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                  <span className="client-comms__main">
                    <span className="client-comms__type">{row.typeLabel}</span>
                    <span className="client-comms__preview">{preview}</span>
                    <span className="client-comms__meta">{commMeta(row)}</span>
                  </span>
                </button>
                {open ? (
                  <div className="client-comms__body">
                    {row.destination || row.sentFrom || row.sentByName ? (
                      <dl className="client-comms__routing">
                        {row.destination ? (
                          <>
                            <dt>To</dt>
                            <dd>{row.destination}</dd>
                          </>
                        ) : null}
                        {row.sentFrom?.trim() ? (
                          <>
                            <dt>From</dt>
                            <dd>{row.sentFrom.trim()}</dd>
                          </>
                        ) : null}
                        {row.sentByName?.trim() ? (
                          <>
                            <dt>Sent by</dt>
                            <dd>{row.sentByName.trim()}</dd>
                          </>
                        ) : null}
                      </dl>
                    ) : null}
                    {parsed.subject ? (
                      <div className="client-comms__subject">Subject: {parsed.subject}</div>
                    ) : null}
                    {parsed.html ? (
                      <div
                        className="client-comms__html"
                        dangerouslySetInnerHTML={{ __html: parsed.html }}
                      />
                    ) : (
                      <pre className="client-comms__text">{parsed.text || '—'}</pre>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
