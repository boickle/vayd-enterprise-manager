import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  getControlledReport,
  type ControlledReport,
  type ControlledReportDoctor,
  type ControlledReportLine,
} from '../api/inventoryOps';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

function localIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function amount(ml: number, grams: number | null): string {
  return grams != null ? `${ml} mL (${grams} g)` : `${ml} mL`;
}

const TYPE_LABEL: Record<ControlledReportLine['type'], string> = {
  dispensed: 'Dispensed',
  returned: 'Returned',
  wasted: 'Wasted',
  adjusted: 'Adjusted',
};

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per dose, grouped by doctor, the way each doctor reconciles in Vet Snap. */
export function controlledReportCsv(report: ControlledReport): string {
  const header = [
    'Doctor',
    'Date',
    'Type',
    'Item',
    'Lot #',
    'mL',
    'g',
    'Patient',
    'Invoice #',
    'Shelf',
    'Not from doctor’s shelf',
    'Waste reason',
  ];
  const lines = [header.join(',')];
  for (const doc of report.doctors) {
    for (const l of doc.lines) {
      lines.push(
        [
          doc.name,
          new Date(l.at).toLocaleString(),
          TYPE_LABEL[l.type],
          l.itemName,
          l.lotNumber,
          l.quantityMl,
          l.grams,
          l.patientName,
          l.invoiceNumber,
          l.shelfName,
          l.fromHomeShelf ? '' : 'Yes',
          l.wasteReason,
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

function downloadCsv(report: ControlledReport) {
  const blob = new Blob([controlledReportCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `controlled-drugs-${report.fromDate}-to-${report.toDate}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DoctorSection({ doctor }: { doctor: ControlledReportDoctor }) {
  const [open, setOpen] = useState(false);
  const offShelf = doctor.lines.filter((l) => !l.fromHomeShelf).length;
  return (
    <section style={{ marginBottom: 24 }} aria-label={doctor.name}>
      <h3 style={{ margin: '0 0 4px' }}>{doctor.name}</h3>
      {offShelf > 0 ? (
        <p className="settings-message settings-error-message" style={{ margin: '0 0 8px' }}>
          {offShelf} dose{offShelf === 1 ? '' : 's'} came off a shelf that isn&apos;t this
          doctor&apos;s own. Check the doctor on the charge.
        </p>
      ) : null}
      <div className="settings-table-container">
        <table className="settings-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Lot</th>
              <th>Dispensed</th>
              <th>Returned</th>
              <th>Wasted</th>
              <th>Adjusted</th>
            </tr>
          </thead>
          <tbody>
            {doctor.totals.map((t) => (
              <tr key={`${t.inventoryItemId}-${t.lotNumber}`}>
                <td style={{ fontWeight: 600 }}>{t.itemName}</td>
                <td>{t.lotNumber || '—'}</td>
                <td>{amount(t.dispensedMl, t.dispensedGrams)}</td>
                <td>{t.returnedMl ? `${t.returnedMl} mL` : '—'}</td>
                <td>{t.wastedMl ? `${t.wastedMl} mL` : '—'}</td>
                <td>{t.adjustedMl ? `${t.adjustedMl} mL` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn secondary"
        style={{ marginTop: 8 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Show'} each dose ({doctor.lines.length})
      </button>
      {open ? (
        <div className="settings-table-container" style={{ marginTop: 8 }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Item / lot</th>
                <th>Amount</th>
                <th>Patient</th>
                <th>Invoice #</th>
                <th>Shelf</th>
              </tr>
            </thead>
            <tbody>
              {doctor.lines.map((l) => (
                <Fragment key={l.movementId}>
                  <tr>
                    <td>{new Date(l.at).toLocaleString()}</td>
                    <td>
                      {TYPE_LABEL[l.type]}
                      {l.wasteReason ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          {l.wasteReason}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {l.itemName}
                      {l.lotNumber ? ` · ${l.lotNumber}` : ''}
                    </td>
                    <td>{amount(l.quantityMl, l.grams)}</td>
                    <td>{l.patientName ?? '—'}</td>
                    <td>{l.invoiceNumber ?? '—'}</td>
                    <td>
                      {l.shelfName ?? '—'}
                      {l.fromHomeShelf ? null : (
                        <div style={{ fontSize: 12, color: '#9a3412', fontWeight: 600 }}>
                          Not this doctor&apos;s shelf
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default function InventoryControlledReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    return localIso(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [toDate, setToDate] = useState(() => localIso(new Date()));
  const [report, setReport] = useState<ControlledReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fromDate || !toDate) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void getControlledReport(practiceId, fromDate, toDate)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load the report');
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, fromDate, toDate]);

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        Controlled drugs under each doctor&apos;s name, from any shelf, to reconcile against
        their Vet Snap log. Amounts are in mL; items weighed in grams show grams too.
      </p>
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'end' }}>
        <label className="settings-label">
          From
          <input
            type="date"
            className="settings-input"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="settings-label">
          To
          <input
            type="date"
            className="settings-input"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={!report || report.doctors.length === 0}
          onClick={() => report && downloadCsv(report)}
        >
          Download CSV
        </button>
      </div>
      {busy && !report ? (
        <p className="settings-muted">Loading…</p>
      ) : !report || report.doctors.length === 0 ? (
        <p className="settings-muted">No controlled drugs moved in this range.</p>
      ) : (
        report.doctors.map((d) => <DoctorSection key={d.employeeId ?? 'none'} doctor={d} />)
      )}
    </div>
  );
}
