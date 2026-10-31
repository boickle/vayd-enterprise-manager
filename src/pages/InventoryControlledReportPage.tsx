import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  getControlledReport,
  getVetSnapPatientExport,
  setControlledReconciled,
  type ControlledReport,
  type ControlledReportDoctor,
  type ControlledReportLine,
  type VetSnapPatientExport,
} from '../api/inventoryOps';
import { fetchVeterinarians } from '../api/employee';
import { usePermissions } from '../permissions/PermissionContext';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';
import './InventoryControlledReportPage.css';

function localIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DISPOSAL_LABEL: Record<string, string> = {
  biohazard: 'Biohazard waste',
  sharps: 'Sharps container',
  pharmaceutical: 'Pharmaceutical waste',
  normal_trash: 'Normal trash',
  returned_to_supplier: 'Returned to supplier',
  reverse_distribution: 'Reverse distribution',
  other: 'Other disposal',
};

/** Reason, disposal and the written why for a waste or adjustment line. Exported for tests. */
export function wasteDetail(l: ControlledReportLine): string {
  return [
    l.wasteReason,
    l.wasteDisposal ? DISPOSAL_LABEL[l.wasteDisposal] ?? l.wasteDisposal : null,
    l.wasteExplanation ? `“${l.wasteExplanation}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function amount(ml: number, grams: number | null): string {
  return grams != null ? `${ml} mL (${grams} g)` : `${ml} mL`;
}

function lotLabel(lot: string | null | undefined): string {
  if (!lot?.trim() || lot === '(no lot)') return 'No lot';
  return lot === 'UNASSIGNED' ? 'Existing stock (no lot recorded)' : lot;
}

function withId(name: string | null, id: number | null): string {
  if (!name && id == null) return '—';
  return id != null ? `${name ?? ''} (${id})`.trim() : (name ?? '—');
}

const TYPE_LABEL: Record<ControlledReportLine['type'], string> = {
  dispensed: 'Administered',
  returned: 'Returned',
  wasted: 'Wasted',
  adjusted: 'Adjusted',
};

/**
 * A controlled drug given at the visit is administered; only a medication sent home is
 * dispensed (owner decision, Oct 30, 2026). Exported for tests.
 */
export function typeLabel(l: Pick<ControlledReportLine, 'type' | 'isMedication'>): string {
  return l.type === 'dispensed' && l.isMedication ? 'Dispensed' : TYPE_LABEL[l.type];
}

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
    'Patient ID',
    'Client',
    'Client ID',
    'Log created by',
    'Invoice #',
    'Shelf',
    'Not from doctor’s shelf',
    'Waste reason',
    'Disposal',
    'Explanation',
  ];
  const lines = [header.join(',')];
  for (const doc of report.doctors) {
    for (const l of doc.lines) {
      lines.push(
        [
          doc.name,
          new Date(l.at).toLocaleString(),
          typeLabel(l),
          l.itemName,
          l.lotNumber,
          l.quantityMl,
          l.grams,
          l.patientName,
          l.patientId,
          l.clientName,
          l.clientId,
          l.loggedByName,
          l.invoiceNumber,
          l.shelfName,
          l.fromHomeShelf ? '' : 'Yes',
          l.wasteReason,
          l.wasteDisposal ? DISPOSAL_LABEL[l.wasteDisposal] ?? l.wasteDisposal : '',
          l.wasteExplanation ?? '',
        ]
          .map(csvCell)
          .join(',')
      );
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
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

function saveFile(csv: string, filename: string) {
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

function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One card per entry, laid out like Vet Snap's log so the two can be checked side by side. */
export function controlledLogPrintHtml(report: ControlledReport): string {
  const card = (doc: ControlledReportDoctor, l: ControlledReportLine) => {
    const wasted = l.type === 'wasted';
    const qty = wasted ? '0 mL' : amount(l.quantityMl, l.grams);
    const lot = l.lotNumber?.trim() ? ` - #${lotLabel(l.lotNumber)}` : '';
    const field = (label: string, value: string) =>
      `<div class="f"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div></div>`;
    return `<div class="card">
      <div class="status">${escapeHtml(typeLabel(l))}${wasteDetail(l) ? ` · ${escapeHtml(wasteDetail(l))}` : ''}</div>
      <div class="item">${escapeHtml(l.itemName)}</div>
      ${field('Date', new Date(l.at).toLocaleString())}
      ${field('Quantity', `${qty}${lot}`)}
      ${field('Waste', wasted ? amount(l.quantityMl, l.grams) : '0 mL')}
      ${field('Patient (ID)', withId(l.patientName, l.patientId))}
      ${field('Client (ID)', withId(l.clientName, l.clientId))}
      ${field('Doctor/Provider', doc.name)}
      ${field('Log Created By', l.loggedByName ?? '—')}
      ${l.invoiceNumber ? field('Invoice #', l.invoiceNumber) : ''}
    </div>`;
  };
  const sections = report.doctors
    .map(
      (doc) => `<h2>${escapeHtml(doc.name)} · ${doc.lines.length} entr${doc.lines.length === 1 ? 'y' : 'ies'}</h2>
      <div class="grid">${doc.lines.map((l) => card(doc, l)).join('')}</div>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>Controlled drug log ${escapeHtml(report.fromDate)} to ${escapeHtml(report.toDate)}</title>
  <style>
    body { font: 11px/1.35 -apple-system, system-ui, sans-serif; margin: 18px; color: #111; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    h2 { font-size: 13px; margin: 16px 0 6px; break-after: avoid; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .card { border: 1px solid #bbb; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
    .status { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
    .item { font-weight: 700; font-size: 12px; margin: 2px 0 6px; }
    .f { display: flex; gap: 6px; padding: 1px 0; }
    .k { color: #666; width: 92px; flex: none; }
    .v { font-weight: 600; }
    @media print { body { margin: 0; } }
  </style></head><body>
  <h1>Controlled drug log — ${escapeHtml(report.fromDate)} to ${escapeHtml(report.toDate)}</h1>
  ${sections}
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`;
}

function printLog(report: ControlledReport): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(controlledLogPrintHtml(report));
  win.document.close();
  return true;
}

type ReconcileTab = 'pending' | 'done' | 'all';

/** Vet Snap's date style: "Thu, 10/29/2026". */
function vsDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${day}, ${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}`;
}

/** Vet Snap's quantity: "0.6 ml - #26-07"; a waste entry is 0 there, with the amount under Waste. */
export function vsQuantity(l: ControlledReportLine): { quantity: string; waste: string } {
  const lot = l.lotNumber?.trim() && l.lotNumber !== 'UNASSIGNED' ? ` - #${l.lotNumber.trim()}` : '';
  const ml = (n: number) => `${Math.round(n * 1e4) / 1e4} ml`;
  return l.type === 'wasted'
    ? { quantity: `0 ml${lot}`, waste: ml(l.quantityMl) }
    : { quantity: `${ml(l.quantityMl)}${lot}`, waste: '0 ml' };
}

function DoctorSection({
  doctor,
  onReconcile,
}: {
  doctor: ControlledReportDoctor;
  onReconcile: (movementIds: number[], reconciled: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<ReconcileTab>('pending');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const offShelf = doctor.lines.filter((l) => !l.fromHomeShelf).length;
  const pending = doctor.lines.filter((l) => !l.reconciledAt);
  const done = doctor.lines.filter((l) => l.reconciledAt);
  const shown = tab === 'pending' ? pending : tab === 'done' ? done : doctor.lines;
  const pickable = shown.filter((l) => !l.reconciledAt);

  const run = async (ids: number[], reconciled: boolean) => {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      await onReconcile(ids, reconciled);
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginBottom: 28 }} aria-label={doctor.name}>
      <h3 style={{ margin: '0 0 4px' }}>{doctor.name}</h3>
      {doctor.employeeId != null && doctor.hasHomeShelf === false ? (
        <p className="settings-muted" style={{ margin: '0 0 8px' }}>
          No home shelf is set for {doctor.name}, so doses aren&apos;t checked against one. Set it
          under Employee directory → the doctor → Default inventory location.
        </p>
      ) : offShelf > 0 ? (
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
              <th>Administered / dispensed</th>
              <th>Returned</th>
              <th>Wasted</th>
              <th>Adjusted</th>
            </tr>
          </thead>
          <tbody>
            {doctor.totals.map((t) => (
              <tr key={`${t.inventoryItemId}-${t.lotNumber}`}>
                <td style={{ fontWeight: 600 }}>{t.itemName}</td>
                <td>{lotLabel(t.lotNumber)}</td>
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
        {open ? 'Hide' : 'Show'} the log ({doctor.lines.length})
      </button>
      {open ? (
        <>
          <div className="vs-tabs" role="tablist">
            {(
              [
                ['pending', `To reconcile (${pending.length})`],
                ['done', `Reconciled (${done.length})`],
                ['all', `All (${doctor.lines.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`vs-tab${tab === key ? ' is-on' : ''}`}
                onClick={() => {
                  setTab(key);
                  setPicked(new Set());
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {pickable.length ? (
            <div className="vs-selectall">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={picked.size > 0 && picked.size === pickable.length}
                  onChange={(e) =>
                    setPicked(e.target.checked ? new Set(pickable.map((l) => l.movementId)) : new Set())
                  }
                />
                Select all to reconcile ({pickable.length})
              </label>
              {picked.size ? (
                <button
                  type="button"
                  className="vs-btn"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                  disabled={busy}
                  onClick={() => void run([...picked], true)}
                >
                  Mark {picked.size} reconciled
                </button>
              ) : null}
            </div>
          ) : null}
          {shown.length === 0 ? (
            <p className="settings-muted" style={{ marginTop: 12 }}>
              {tab === 'pending' ? 'Everything here is reconciled.' : 'Nothing here yet.'}
            </p>
          ) : (
            <ul className="vs-list">
              {shown.map((l) => {
                const q = vsQuantity(l);
                const isDone = Boolean(l.reconciledAt);
                return (
                  <li key={l.movementId} className={`vs-card${isDone ? ' is-done' : ''}`}>
                    {isDone ? (
                      <span aria-hidden />
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.itemName} ${vsDate(l.at)}`}
                        checked={picked.has(l.movementId)}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(l.movementId);
                            else next.delete(l.movementId);
                            return next;
                          })
                        }
                      />
                    )}
                    <div>
                      <span
                        className={`vs-pill${isDone ? ' is-done' : l.type === 'wasted' ? ' is-waste' : ''}`}
                      >
                        {isDone ? 'Reconciled' : typeLabel(l)}
                      </span>
                      <div className="vs-title">{l.itemName}</div>
                      <div className="vs-fields">
                        <div>
                          <div className="vs-k">Date</div>
                          <div className="vs-v">{vsDate(l.at)}</div>
                        </div>
                        <div>
                          <div className="vs-k">Quantity</div>
                          <div className="vs-v">{q.quantity}</div>
                        </div>
                        <div>
                          <div className="vs-k">Waste</div>
                          <div className="vs-v">{q.waste}</div>
                        </div>
                        <div>
                          <div className="vs-k">Patient (ID)</div>
                          <div className="vs-v">{withId(l.patientName, l.patientId)}</div>
                        </div>
                        <div>
                          <div className="vs-k">Client (ID)</div>
                          <div className="vs-v">{withId(l.clientName, l.clientId)}</div>
                        </div>
                        <div>
                          <div className="vs-k">Doctor/Provider</div>
                          <div className="vs-v">{doctor.name}</div>
                        </div>
                        <div>
                          <div className="vs-k">Log Created By</div>
                          <div className="vs-v">{l.loggedByName ?? '—'}</div>
                        </div>
                        <div>
                          <div className="vs-k">Invoice #</div>
                          <div className="vs-v">{l.invoiceNumber ?? '—'}</div>
                        </div>
                        <div>
                          <div className="vs-k">Shelf</div>
                          <div className="vs-v">{l.shelfName ?? '—'}</div>
                        </div>
                      </div>
                      {wasteDetail(l) ? <div className="vs-flag" style={{ color: '#475569' }}>{wasteDetail(l)}</div> : null}
                      {l.fromHomeShelf ? null : (
                        <div className="vs-flag">Not this doctor&apos;s shelf — check the doctor on the charge</div>
                      )}
                    </div>
                    <div className="vs-actions">
                      {isDone ? (
                        <>
                          <div className="vs-done">
                            Reconciled
                            {l.reconciledByName ? ` by ${l.reconciledByName}` : ''}
                            <br />
                            {new Date(l.reconciledAt as string).toLocaleString()}
                          </div>
                          <button
                            type="button"
                            className="vs-undo"
                            disabled={busy}
                            onClick={() => void run([l.movementId], false)}
                          >
                            Undo
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="vs-btn"
                          disabled={busy}
                          onClick={() => void run([l.movementId], true)}
                        >
                          Reconciled
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
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
  const [exporting, setExporting] = useState(false);
  const [doctorFilter, setDoctorFilter] = useState<string>('');
  const [reloadTick, setReloadTick] = useState(0);
  const [vets, setVets] = useState<Array<{ key: string; name: string }>>([]);
  const { scopeOf } = usePermissions();
  const ownOnly = scopeOf('inventory.controlled_report.view') === 'own';
  const vetSnapScope = scopeOf('controlled.vetsnap_export');

  const downloadVetSnap = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await getVetSnapPatientExport(practiceId);
      if (data.rows.length === 0) {
        setError(`No patients were given a controlled drug from ${data.fromDate} to ${data.toDate}.`);
        return;
      }
      saveFile(vetSnapPatientsCsv(data), `vet-snap-patients-${data.fromDate}-to-${data.toDate}.csv`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not build the Vet Snap file');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (ownOnly) return;
    let cancelled = false;
    void fetchVeterinarians()
      .then((res) => {
        if (cancelled) return;
        setVets(
          res.providers
            .filter((v) => v.id != null && Number.isFinite(Number(v.id)))
            .map((v) => ({ key: String(v.id), name: v.name }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ownOnly]);

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
  }, [practiceId, fromDate, toDate, reloadTick]);

  const reconcile = useCallback(
    async (movementIds: number[], reconciled: boolean) => {
      try {
        await setControlledReconciled(practiceId, movementIds, reconciled);
        setReloadTick((n) => n + 1);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not save');
      }
    },
    [practiceId]
  );

  const doctorKey = (d: ControlledReportDoctor) => String(d.employeeId ?? 'none');
  // Every veterinarian, plus anyone else with entries in this range, so a doctor can be picked
  // even before they have any (owner request, Oct 30, 2026).
  const doctorOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const v of vets) byKey.set(v.key, v.name);
    for (const d of report?.doctors ?? []) byKey.set(doctorKey(d), d.name);
    return [...byKey.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name)));
  }, [vets, report]);
  const shownDoctors = (report?.doctors ?? []).filter(
    (d) => !doctorFilter || doctorKey(d) === doctorFilter
  );

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        Controlled drugs under each doctor&apos;s name, from any shelf, to reconcile against
        their Vet Snap log. Amounts are in mL.
        {ownOnly ? ' You are seeing the doses recorded under you.' : null}
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
          onClick={() =>
            report &&
            saveFile(
              controlledReportCsv(report),
              `controlled-drugs-${report.fromDate}-to-${report.toDate}.csv`
            )
          }
        >
          Download CSV
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!report || report.doctors.length === 0}
          onClick={() => {
            if (report && !printLog(report)) {
              setError('Allow pop-ups for this site to print the log.');
            }
          }}
        >
          Print log
        </button>
        {!ownOnly ? (
          <label className="settings-label">
            Doctor
            <select
              className="settings-input"
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
            >
              <option value="">All doctors</option>
              {doctorOptions.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {vetSnapScope !== 'none' ? (
          <button
            type="button"
            className="btn secondary"
            disabled={exporting}
            onClick={() => void downloadVetSnap()}
            title={
              vetSnapScope === 'own'
                ? 'Your patients given a controlled drug in the last 14 days'
                : 'Every patient given a controlled drug in the last 14 days'
            }
          >
            {exporting ? 'Building…' : 'Vet Snap patients (last 14 days)'}
          </button>
        ) : null}
      </div>
      {busy && !report ? (
        <p className="settings-muted">Loading…</p>
      ) : !report || report.doctors.length === 0 ? (
        <p className="settings-muted">No controlled drugs moved in this range.</p>
      ) : (
        shownDoctors.length === 0 ? (
          <p className="settings-muted">
            No controlled drugs under{' '}
            {doctorOptions.find((d) => d.key === doctorFilter)?.name ?? 'this doctor'} in this range.
          </p>
        ) : shownDoctors.map((d) => (
          <DoctorSection key={doctorKey(d)} doctor={d} onReconcile={reconcile} />
        ))
      )}
    </div>
  );
}
