import { useCallback, useEffect, useState } from 'react';
import { GitMerge } from 'lucide-react';
import {
  mergeClientsStaff,
  searchClientsStaff,
  type ClientSearchRow,
} from '../../api/clientsStaff';
import { formatClientDisplayName } from '../../utils/clientNamePrefix';
import { appConfirm } from '../../utils/appDialog';

type Props = {
  keepClientId: string | number;
  keepClientName: string;
  onMerged?: () => void;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientSearchName(row: ClientSearchRow): string {
  return formatClientDisplayName(row);
}

function clientSearchSubtitle(row: ClientSearchRow): string {
  const r = row as Record<string, unknown>;
  const cityLine = [pickStr(row.address1), pickStr(row.city), pickStr(row.state)]
    .filter(Boolean)
    .join(', ');
  const email = pickStr(r.email);
  const inactive = r.isActive === false || r.active === false ? 'Inactive' : null;
  return [cityLine, email, inactive, `ID ${row.id}`].filter(Boolean).join(' · ');
}

export default function BriefClientMergePanel({ keepClientId, keepClientName, onMerged }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClientSearchRow[]>([]);
  const [absorb, setAbsorb] = useState<ClientSearchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q || absorb) {
      setHits([]);
      return;
    }
    let canceled = false;
    const t = window.setTimeout(() => {
      void searchClientsStaff(q, { includeInactive: true })
        .then((rows) => {
          if (canceled) return;
          setHits(rows.filter((r) => String(r.id) !== String(keepClientId)).slice(0, 10));
        })
        .catch(() => {
          if (!canceled) setHits([]);
        });
    }, 280);
    return () => {
      canceled = true;
      window.clearTimeout(t);
    };
  }, [query, absorb, keepClientId]);

  const run = useCallback(async () => {
    if (!absorb) return;
    const confirmed = await appConfirm({
      title: 'Merge clients?',
      message: `Merge ${clientSearchName(absorb)} into ${keepClientName}? Pets, visits, invoices, and messages move here. The absorbed client will be deactivated.`,
      confirmLabel: 'Merge',
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    const result = await mergeClientsStaff({
      keepClientId,
      absorbClientId: absorb.id,
    });
    setOk(result.ok);
    setMessage(result.message);
    setBusy(false);
    if (result.ok) onMerged?.();
  }, [absorb, keepClientId, keepClientName, onMerged]);

  return (
    <div className="brief-merge">
      <div className="brief-review__head">
        <GitMerge size={16} aria-hidden />
        <div>
          <h3>Merge clients</h3>
          <p>
            Keep <strong>{keepClientName}</strong> and merge another (duplicate) client{' '}
            <strong>into this household</strong>. Pets and records move here; stop using the
            absorbed client afterward. Confirm it is the same household before you continue.
          </p>
        </div>
      </div>
      {absorb ? (
        <div className="brief-picked">
          <span>
            Absorb <strong>{clientSearchName(absorb)}</strong>
            {clientSearchSubtitle(absorb) ? ` · ${clientSearchSubtitle(absorb)}` : ''}
          </span>
          <button type="button" className="brief-text-btn" onClick={() => setAbsorb(null)}>
            Change
          </button>
        </div>
      ) : (
        <label className="brief-field">
          <span className="brief-field-label">Find the duplicate</span>
          <input
            className="brief-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Client name or email"
          />
        </label>
      )}
      {!absorb && hits.length > 0 ? (
        <ul className="brief-hit-list">
          {hits.map((row) => (
            <li key={String(row.id)}>
              <button type="button" className="brief-hit" onClick={() => setAbsorb(row)}>
                <strong>{clientSearchName(row)}</strong>
                <span>{clientSearchSubtitle(row)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className={ok ? 'brief-muted' : 'brief-error'}>{message}</p> : null}
      <button
        type="button"
        className="brief-btn primary"
        disabled={!absorb || busy}
        onClick={() => void run()}
      >
        {busy ? 'Merging…' : 'Merge into this client'}
      </button>
    </div>
  );
}
