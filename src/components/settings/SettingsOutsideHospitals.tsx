import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  createOutsideHospital,
  deleteOutsideHospital,
  importOutsideHospitals,
  listOutsideHospitals,
  updateOutsideHospital,
  type ImportOutsideHospitalsResult,
  type OutsideHospital,
  type OutsideHospitalFields,
} from '../../api/outsideHospitals';
import { appConfirm } from '../../utils/appDialog';
import {
  buildImportPreview,
  hospitalDedupeKey,
  isImportable,
  type ImportPreview,
} from '../../utils/outsideHospitalImport';
import OutsideHospitalForm from './OutsideHospitalForm';
import './SettingsOutsideHospitals.css';

function errorText(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null) {
    const response = (err as { response?: { data?: { message?: unknown } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return err instanceof Error ? err.message : fallback;
}

function ImportPanel({
  existing,
  onDone,
  onClose,
}: {
  existing: OutsideHospital[];
  onDone: (result: ImportOutsideHospitalsResult) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingKeys = useMemo(
    () => new Set(existing.map((h) => hospitalDedupeKey(h.name, h.email))),
    [existing],
  );

  const preview: ImportPreview = useMemo(
    () => buildImportPreview(text, existingKeys),
    [text, existingKeys],
  );

  const ready = preview.rows.filter(isImportable);
  const blocked = preview.rows.length - ready.length;

  const readFile = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    if (/\.xlsx?$/i.test(file.name)) {
      setError(
        `${file.name} is an Excel file. In Sheets use File → Download → CSV, or just select the cells and paste them below.`,
      );
      return;
    }
    try {
      setText(await file.text());
    } catch {
      setError('Could not read that file.');
    }
  };

  const runImport = async () => {
    if (ready.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const rows: OutsideHospitalFields[] = ready.map((row) => row.fields);
      onDone(await importOutsideHospitals(rows));
      setText('');
    } catch (err) {
      setError(errorText(err, 'Import failed.'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="outside-hospital-import">
      <p className="settings-muted">
        Select the cells in Google Sheets or Excel and paste them here, or drop a CSV. A
        header row is detected automatically; without one the columns are read as name,
        address, phone, email, notes.
      </p>

      <label
        className={`outside-hospital-import__drop${dragOver ? ' is-drop' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void readFile(e.dataTransfer.files?.[0]);
        }}
      >
        <Upload size={15} aria-hidden />
        <span>{dragOver ? 'Drop to read' : 'Choose a CSV file or drag one here'}</span>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(e) => {
            void readFile(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
      </label>

      <textarea
        className="settings-input outside-hospital-import__paste"
        rows={5}
        value={text}
        placeholder={'Hospital\tAddress\tPhone\tEmail\nSaco Vet Clinic\t331 North St, Saco, ME 04072\t(207) 571-9580\tclinic@sacoveterinaryclinic.com'}
        onChange={(e) => setText(e.target.value)}
      />

      {error ? <p className="settings-message settings-error-message">{error}</p> : null}

      {preview.rows.length > 0 ? (
        <>
          <p className="outside-hospital-import__count">
            <strong>{ready.length}</strong> ready to add
            {blocked > 0 ? ` · ${blocked} skipped` : ''}
            {preview.usedHeaderRow ? ' · header row detected' : ' · no header row'}
          </p>
          <div className="settings-table-container outside-hospital-import__preview">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Hospital</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const blockedRow = !isImportable(row);
                  return (
                    <tr
                      key={row.line}
                      className={blockedRow ? 'outside-hospital-import__row--skip' : undefined}
                    >
                      <td>{row.fields.name || <em>(blank)</em>}</td>
                      <td>{row.fields.email ?? '—'}</td>
                      <td>{row.fields.phone ?? '—'}</td>
                      <td>{row.fields.address ?? '—'}</td>
                      <td>
                        {row.issues.length === 0 ? (
                          'Ready'
                        ) : (
                          <span className={blockedRow ? 'outside-hospital-import__error' : 'settings-muted'}>
                            {row.issues.map((i) => i.message).join(' · ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="outside-hospital-form__actions">
        <button
          type="button"
          className="btn"
          disabled={ready.length === 0 || importing}
          onClick={() => void runImport()}
        >
          {importing ? 'Adding…' : `Add ${ready.length} hospital${ready.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn secondary" disabled={importing} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SettingsOutsideHospitals({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<OutsideHospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const reload = async (includeInactive: boolean) => {
    setLoading(true);
    try {
      setRows(await listOutsideHospitals({ includeInactive }));
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Could not load the hospital directory.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload(showInactive);
  }, [showInactive]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.name, row.email, row.phone, row.address, row.notes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const add = async (fields: OutsideHospitalFields) => {
    setSaving(true);
    setError(null);
    try {
      const created = await createOutsideHospital(fields);
      setRows((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setAdding(false);
      setFlash(`Added ${created.name}.`);
    } catch (err) {
      setError(errorText(err, 'Could not add that hospital.'));
    } finally {
      setSaving(false);
    }
  };

  const save = async (id: number, fields: OutsideHospitalFields) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateOutsideHospital(id, fields);
      setRows((current) =>
        current
          .map((row) => (row.id === id ? updated : row))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingId(null);
      setFlash(`Saved ${updated.name}.`);
    } catch (err) {
      setError(errorText(err, 'Could not save that hospital.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: OutsideHospital) => {
    setError(null);
    try {
      const updated = await updateOutsideHospital(row.id, { isActive: !row.isActive });
      setRows((current) =>
        showInactive
          ? current.map((r) => (r.id === row.id ? updated : r))
          : current.filter((r) => r.id !== row.id),
      );
    } catch (err) {
      setError(errorText(err, 'Could not update that hospital.'));
    }
  };

  const remove = async (row: OutsideHospital) => {
    const ok = await appConfirm({
      title: `Remove ${row.name}?`,
      message:
        'This takes the hospital out of the directory. Records already requested from them are not affected.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteOutsideHospital(row.id);
      setRows((current) => current.filter((r) => r.id !== row.id));
      setFlash(`Removed ${row.name}.`);
    } catch (err) {
      setError(errorText(err, 'Could not remove that hospital.'));
    }
  };

  return (
    <div className={embedded ? undefined : 'settings-card'} style={embedded ? undefined : { marginBottom: 24 }}>
      <h3 className="settings-card-title">Outside hospitals</h3>
      <p className="settings-muted" style={{ marginBottom: 12 }}>
        The other practices we ask for a patient&rsquo;s previous records. Staff pick from this
        list when they request records before a visit, so an email address here is what makes
        the request sendable.
      </p>

      {error ? <p className="settings-message settings-error-message">{error}</p> : null}
      {flash ? <p className="settings-message settings-success-message">{flash}</p> : null}

      <div className="outside-hospital-toolbar">
        <input
          className="settings-input"
          value={search}
          placeholder="Search name, email, or town…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="settings-checkbox-item" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setAdding((v) => !v);
            setImportOpen(false);
            setEditingId(null);
          }}
        >
          <Plus size={14} aria-hidden /> Add hospital
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setImportOpen((v) => !v);
            setAdding(false);
            setEditingId(null);
          }}
        >
          <Upload size={14} aria-hidden /> Import from spreadsheet
        </button>
      </div>

      {adding ? (
        <OutsideHospitalForm
          saving={saving}
          onSubmit={(fields) => void add(fields)}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {importOpen ? (
        <ImportPanel
          existing={rows}
          onClose={() => setImportOpen(false)}
          onDone={(result) => {
            setRows((current) =>
              [...current, ...result.created].sort((a, b) => a.name.localeCompare(b.name)),
            );
            setImportOpen(false);
            setFlash(
              `Added ${result.created.length} hospital${result.created.length === 1 ? '' : 's'}` +
                (result.skipped.length ? `, skipped ${result.skipped.length} already on file.` : '.'),
            );
          }}
        />
      ) : null}

      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="settings-muted">
          {rows.length === 0
            ? 'No hospitals yet. Paste your list in with Import from spreadsheet.'
            : 'No hospitals match that search.'}
        </p>
      ) : (
        <div className="settings-table-container">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) =>
                editingId === row.id ? (
                  <tr key={row.id}>
                    <td colSpan={5}>
                      <OutsideHospitalForm
                        initial={row}
                        saving={saving}
                        onSubmit={(fields) => void save(row.id, fields)}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className={row.isActive ? undefined : 'outside-hospital-row--off'}>
                    <td>
                      {row.name}
                      {row.isActive ? null : <span className="settings-muted"> · inactive</span>}
                      {row.notes ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>{row.notes}</div>
                      ) : null}
                    </td>
                    <td>
                      {row.email ?? (
                        <span className="outside-hospital-import__error">
                          <AlertTriangle size={12} aria-hidden /> none
                        </span>
                      )}
                    </td>
                    <td>{row.phone ?? '—'}</td>
                    <td>{row.address ?? '—'}</td>
                    <td className="outside-hospital-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          setEditingId(row.id);
                          setAdding(false);
                          setImportOpen(false);
                        }}
                      >
                        <Pencil size={13} aria-hidden /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void toggleActive(row)}
                      >
                        {row.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void remove(row)}
                      >
                        <Trash2 size={13} aria-hidden /> Remove
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
