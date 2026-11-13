import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  getVetSnapLastDownload,
  getVetSnapPatientExport,
  type VetSnapLastDownload,
  type VetSnapPatientExport,
} from '../../api/inventoryOps';
import { usePermissions } from '../../permissions/PermissionContext';

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The Vet Snap patient import: its 12 columns, in its order, with Scout IDs. */
export function vetSnapPatientsCsv(data: VetSnapPatientExport): string {
  const header = [
    'Patient ID',
    'Patient Name',
    'Species',
    'Breed',
    'Client ID',
    'Client First Name',
    'Client Last Name',
    'Client Address 1',
    'Client Address 2',
    'Client City',
    'Client State',
    'Client Zip Code',
  ];
  const lines = [header.join(',')];
  for (const r of data.rows) {
    lines.push(
      [
        r.patientId,
        r.patientName,
        r.species,
        r.breed,
        r.clientId,
        r.clientFirstName,
        r.clientLastName,
        r.clientAddress1,
        r.clientAddress2,
        r.clientCity,
        r.clientState,
        r.clientZipCode,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

function saveCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** "Last downloaded by Abigail Smith on Thu 11/12 at 9:14 AM". */
export function lastDownloadLabel(last: VetSnapLastDownload | null): string {
  if (!last) return 'Not downloaded yet.';
  const d = new Date(last.at);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Last downloaded by ${last.byName ?? 'someone'} on ${day.replace(',', '')} at ${time}.`;
}

/**
 * Download the Vet Snap patient file: every client given a controlled drug in the last 14
 * days, under any doctor. Vet Snap is shared across doctors, so everyone gets the same file
 * (owner decision, Nov 8, 2026). Shows who downloaded it last. Hidden without
 * `controlled.vetsnap_export`.
 */
export default function VetSnapDownload({
  practiceId,
  style,
}: {
  practiceId: number;
  style?: CSSProperties;
}) {
  const { scopeOf } = usePermissions();
  const allowed = scopeOf('controlled.vetsnap_export') !== 'none';
  const [last, setLast] = useState<VetSnapLastDownload | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLast = useCallback(async () => {
    try {
      setLast(await getVetSnapLastDownload(practiceId));
    } catch {
      setLast(undefined);
    }
  }, [practiceId]);

  useEffect(() => {
    if (allowed) void loadLast();
  }, [allowed, loadLast]);

  if (!allowed) return null;

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await getVetSnapPatientExport(practiceId);
      if (data.rows.length === 0) {
        setMessage(
          `No patients were given a controlled drug from ${data.fromDate} to ${data.toDate}.`
        );
      } else {
        saveCsv(
          vetSnapPatientsCsv(data),
          `vet-snap-patients-${data.fromDate}-to-${data.toDate}.csv`
        );
      }
      await loadLast();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Could not build the Vet Snap file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="vet-snap-download"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        ...style,
      }}
    >
      <button
        type="button"
        className="btn secondary"
        disabled={busy}
        onClick={() => void download()}
        title="Every client given a controlled drug in the last 14 days, under any doctor, for the Vet Snap upload"
      >
        {busy ? 'Building…' : 'Vet Snap patients (last 14 days)'}
      </button>
      {last !== undefined ? (
        <span className="muted settings-muted" style={{ fontSize: 12 }}>
          {lastDownloadLabel(last)}
        </span>
      ) : null}
      {message ? (
        <span role="alert" style={{ fontSize: 12, color: '#b91c1c' }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
