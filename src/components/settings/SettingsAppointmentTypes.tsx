import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAppointmentType,
  fetchAppointmentType,
  setAppointmentTypeArchived,
  updateAppointmentType,
  type AppointmentType,
  type AppointmentTypeUpdate,
} from '../../api/appointmentSettings';
import {
  appointmentTypeAllowsAllDay,
  appointmentTypeIsArchived,
  formatAppointmentTypeArchivedOn,
  formatPointsSummary,
  normalizeAppointmentTypeFromApi,
} from '../../utils/appointmentTypeSettings';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

function normalizeHex(c: string | null | undefined): string | null {
  if (!c || typeof c !== 'string') return null;
  const t = c.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return t;
  return null;
}

function hexForColorInput(value: string | null | undefined): string {
  const hex = normalizeHex(value);
  if (hex && hex.length === 7) return hex;
  if (hex && hex.length === 4) {
    const h = hex.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return '#4A90D9';
}

function displayColor(type: AppointmentType): string {
  return (
    normalizeHex(type.color) ??
    normalizeHex(type.calendarColor) ??
    normalizeHex(type.colorHex) ??
    '#94a3b8'
  );
}

function displayTextColor(type: AppointmentType): string {
  return normalizeHex(type.textColor) ?? '#FFFFFF';
}

export function formatArrivalWindow(
  before: number | null | undefined,
  after: number | null | undefined
): string {
  if (before == null && after == null) return 'Legacy default';
  const b = before ?? 0;
  const a = after ?? 0;
  if (b === 0 && a === 0) return 'Fixed time';
  if (b === a) return `±${b} min`;
  return `−${b} / +${a} min`;
}

export function formatDefaultDurationMinutes(type: AppointmentType): string {
  const n = normalizeAppointmentTypeFromApi(type).defaultDuration;
  return n > 0 ? `${n} min` : '—';
}

type EditDraft = {
  name: string;
  prettyName: string;
  defaultDuration: string;
  color: string;
  textColor: string;
  windowBeforeMinutes: string;
  windowAfterMinutes: string;
  useLegacyWindow: boolean;
  showInApptRequestForm: boolean;
  newPatientAllowed: boolean;
  formListOrder: string;
  allowAllDay: boolean;
  allowClient: boolean;
  allowAlternateAddress: boolean;
  addressRequired: boolean;
  requiresPatient: boolean;
  excludeFromRouting: boolean;
  excludeFromReminders: boolean;
  isHold: boolean;
  usesLegacyRouting: boolean;
  allowSchedulingOverride: boolean;
  useLegacyPoints: boolean;
  points: string;
};

function draftFromType(type: AppointmentType): EditDraft {
  const t = normalizeAppointmentTypeFromApi(type);
  const legacy = t.windowBeforeMinutes == null && t.windowAfterMinutes == null;
  return {
    name: t.name ?? '',
    prettyName: t.prettyName ?? t.name ?? '',
    defaultDuration:
      t.defaultDuration != null && Number(t.defaultDuration) > 0
        ? String(Math.round(Number(t.defaultDuration)))
        : '',
    color: displayColor(t),
    textColor: displayTextColor(t),
    windowBeforeMinutes:
      t.windowBeforeMinutes != null ? String(t.windowBeforeMinutes) : '',
    windowAfterMinutes:
      t.windowAfterMinutes != null ? String(t.windowAfterMinutes) : '',
    useLegacyWindow: legacy,
    showInApptRequestForm: t.showInApptRequestForm === true,
    newPatientAllowed: t.newPatientAllowed === true,
    formListOrder: t.formListOrder != null ? String(t.formListOrder) : '',
    allowAllDay: appointmentTypeAllowsAllDay(t),
    allowClient: t.allowClient !== false,
    allowAlternateAddress: t.allowAlternateAddress === true,
    addressRequired: t.addressRequired === true,
    requiresPatient: t.requiresPatient === true,
    excludeFromRouting: t.excludeFromRouting === true,
    excludeFromReminders: t.excludeFromReminders === true,
    isHold: t.isHold === true,
    usesLegacyRouting: t.usesLegacyRouting === true,
    allowSchedulingOverride: t.allowSchedulingOverride === true,
    useLegacyPoints: t.points == null,
    points: t.points != null ? String(t.points) : '',
  };
}

function parseWindowField(raw: string): number {
  const t = raw.trim();
  if (t === '') return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error('Window minutes must be a whole number ≥ 0');
  }
  return n;
}

function parseDefaultDurationField(raw: string): number {
  const t = raw.trim();
  if (t === '') {
    throw new Error('Default duration (minutes) is required.');
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new Error('Default duration must be a whole number ≥ 1');
  }
  return n;
}

function emptyDraft(): EditDraft {
  return {
    name: '',
    prettyName: '',
    defaultDuration: '45',
    color: '#4A90D9',
    textColor: '#FFFFFF',
    windowBeforeMinutes: '',
    windowAfterMinutes: '',
    useLegacyWindow: true,
    showInApptRequestForm: false,
    newPatientAllowed: true,
    formListOrder: '',
    allowAllDay: false,
    allowClient: true,
    allowAlternateAddress: false,
    addressRequired: false,
    requiresPatient: false,
    excludeFromRouting: false,
    excludeFromReminders: false,
    isHold: false,
    usesLegacyRouting: false,
    allowSchedulingOverride: false,
    useLegacyPoints: true,
    points: '',
  };
}

function buildUpdatePayloadFromDraft(draft: EditDraft): AppointmentTypeUpdate {
  const name = draft.name.trim();
  if (!name) {
    throw new Error('Name is required.');
  }

  const colorHex = normalizeHex(draft.color);
  if (!colorHex) {
    throw new Error('Background color must be a valid hex value (e.g. #4A90D9)');
  }
  const textHex = normalizeHex(draft.textColor);
  if (!textHex) {
    throw new Error('Text color must be a valid hex value (e.g. #FFFFFF)');
  }

  let windowBeforeMinutes: number | null;
  let windowAfterMinutes: number | null;
  if (draft.useLegacyWindow) {
    windowBeforeMinutes = null;
    windowAfterMinutes = null;
  } else {
    windowBeforeMinutes = parseWindowField(draft.windowBeforeMinutes);
    windowAfterMinutes = parseWindowField(draft.windowAfterMinutes);
  }

  const formListOrder = draft.formListOrder.trim() === '' ? null : Number(draft.formListOrder);
  if (formListOrder != null && (!Number.isFinite(formListOrder) || formListOrder < 1)) {
    throw new Error('Form list order must be a positive number or empty');
  }

  let points: number | null;
  if (draft.useLegacyPoints) {
    points = null;
  } else {
    const raw = draft.points.trim();
    if (raw === '') {
      throw new Error('Enter points (0–100) or check “Use legacy points rules”.');
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error('Points must be a number from 0 to 100');
    }
    points = n;
  }

  return {
    name,
    prettyName: draft.prettyName.trim() || undefined,
    defaultDuration: parseDefaultDurationField(draft.defaultDuration),
    color: colorHex,
    textColor: textHex,
    windowBeforeMinutes,
    windowAfterMinutes,
    showInApptRequestForm: draft.showInApptRequestForm,
    newPatientAllowed: draft.newPatientAllowed,
    formListOrder,
    allowAllDay: draft.allowAllDay,
    allowClient: draft.allowClient,
    allowAlternateAddress: draft.allowAlternateAddress,
    addressRequired: draft.addressRequired,
    requiresPatient: draft.requiresPatient,
    excludeFromRouting: draft.excludeFromRouting,
    excludeFromReminders: draft.excludeFromReminders,
    isHold: draft.isHold,
    usesLegacyRouting: draft.usesLegacyRouting,
    allowSchedulingOverride: draft.allowSchedulingOverride,
    points,
  };
}

type Props = {
  types: AppointmentType[];
  practiceId?: number;
  onTypesChange: (types: AppointmentType[]) => void;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

type ListView = 'active' | 'archived';

export default function SettingsAppointmentTypes({
  types,
  practiceId: practiceIdProp,
  onTypesChange,
  onMessage,
}: Props) {
  const [listView, setListView] = useState<ListView>('active');
  const [archivedSearch, setArchivedSearch] = useState('');
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<{ id: number; name: string } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const sortTypes = useCallback((rows: AppointmentType[]) => {
    return [...rows].sort((a, b) => {
      const aName = String(a.name ?? a.prettyName ?? '').trim();
      const bName = String(b.name ?? b.prettyName ?? '').trim();
      return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    });
  }, []);

  const activeTypes = useMemo(
    () => sortTypes(types.filter((t) => !appointmentTypeIsArchived(t))),
    [types, sortTypes]
  );
  const archivedTypes = useMemo(
    () => sortTypes(types.filter((t) => appointmentTypeIsArchived(t))),
    [types, sortTypes]
  );

  const archivedTypesFiltered = useMemo(() => {
    const q = archivedSearch.trim().toLowerCase();
    if (!q) return archivedTypes;
    return archivedTypes.filter((t) => {
      const name = String(t.name ?? '').toLowerCase();
      const pretty = String(t.prettyName ?? '').toLowerCase();
      return name.includes(q) || pretty.includes(q);
    });
  }, [archivedTypes, archivedSearch]);

  const practiceId = useMemo(() => {
    if (practiceIdProp != null && Number.isFinite(practiceIdProp) && practiceIdProp > 0) {
      return practiceIdProp;
    }
    const fromType = types.find((t) => t.practice?.id)?.practice?.id;
    if (fromType != null && Number.isFinite(fromType)) return fromType;
    return 1;
  }, [practiceIdProp, types]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditingId(null);
    setDraft(null);
    setFormError(null);
    setModalLoading(false);
  }, []);

  useEffect(() => {
    if (modalMode == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalMode, saving, closeModal]);

  const openCreate = () => {
    setModalMode('create');
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setModalLoading(false);
  };

  const openEdit = async (type: AppointmentType) => {
    setModalMode('edit');
    setEditingId(type.id);
    setDraft(draftFromType(type));
    setFormError(null);
    setModalLoading(true);
    try {
      const fresh = await fetchAppointmentType(type.id);
      setDraft(draftFromType(fresh));
    } catch (e) {
      setFormError(extractErr(e));
    } finally {
      setModalLoading(false);
    }
  };

  const applyWindowPreset = (before: number, after: number) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            useLegacyWindow: false,
            windowBeforeMinutes: String(before),
            windowAfterMinutes: String(after),
          }
        : d
    );
  };

  const handleSave = async () => {
    if (modalMode == null || !draft) return;
    setFormError(null);
    setSaving(true);
    try {
      const payload = buildUpdatePayloadFromDraft(draft);

      if (modalMode === 'create') {
        const created = await createAppointmentType({
          ...payload,
          name: payload.name!,
          practiceId,
        });
        const normalized = normalizeAppointmentTypeFromApi(created);
        onTypesChange([...types, normalized]);
        onMessage?.('Appointment type created successfully', 'success');
        closeModal();
        return;
      }

      if (editingId == null) {
        throw new Error('Missing appointment type id.');
      }

      const updated = await updateAppointmentType(editingId, payload);

      onTypesChange(
        types.map((t) => (t.id === updated.id ? normalizeAppointmentTypeFromApi(updated) : t))
      );
      onMessage?.('Appointment type updated successfully', 'success');
      closeModal();
    } catch (e) {
      const msg = extractErr(e);
      setFormError(msg);
      onMessage?.(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const applyTypeUpdate = (updated: AppointmentType, archived?: boolean) => {
    const normalized = normalizeAppointmentTypeFromApi(updated);
    const merged =
      archived === undefined
        ? normalized
        : { ...normalized, isDeleted: archived };
    onTypesChange(types.map((t) => (t.id === merged.id ? merged : t)));
  };

  const handleArchiveConfirm = async () => {
    if (!archiveConfirm) return;
    setArchiveBusy(true);
    try {
      const updated = await setAppointmentTypeArchived(archiveConfirm.id, true);
      applyTypeUpdate(updated, true);
      onMessage?.(`"${archiveConfirm.name}" archived — it will not appear for new bookings.`, 'success');
      setArchiveConfirm(null);
      setListView('archived');
      setArchivedSearch('');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleRestore = async (type: AppointmentType) => {
    const label = type.prettyName || type.name;
    setArchiveBusy(true);
    try {
      const updated = await setAppointmentTypeArchived(type.id, false);
      applyTypeUpdate(updated, false);
      onMessage?.(`"${label}" restored — it is available for new bookings again.`, 'success');
      setListView('active');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setArchiveBusy(false);
    }
  };

  const renderTypeRow = (raw: AppointmentType, mode: 'active' | 'archived') => {
    const type = normalizeAppointmentTypeFromApi(raw);
    return (
      <tr key={type.id} className={mode === 'archived' ? 'settings-appt-type-row--archived' : undefined}>
        <td>{type.name}</td>
        <td>
          {type.prettyName || type.name}
        </td>
        {mode === 'archived' ? (
          <td className="settings-appt-type-archived-on-cell">
            {formatAppointmentTypeArchivedOn(type)}
          </td>
        ) : null}
        <td>
          <span
            className="settings-appt-type-swatch"
            style={{
              background: displayColor(type),
              color: displayTextColor(type),
            }}
            title={`${displayColor(type)} on ${displayTextColor(type)}`}
          >
            Aa
          </span>
        </td>
        <td>{formatArrivalWindow(type.windowBeforeMinutes, type.windowAfterMinutes)}</td>
        <td>{formatDefaultDurationMinutes(type)}</td>
        <td>{type.showInApptRequestForm ? 'Yes' : 'No'}</td>
        <td>{type.newPatientAllowed ? 'Yes' : 'No'}</td>
        <td>{type.formListOrder ?? '—'}</td>
        <td className="settings-appt-type-flags-cell">
          {[
            appointmentTypeAllowsAllDay(type) ? 'All-day' : null,
            type.allowClient === false ? 'No client' : null,
            type.allowAlternateAddress ? 'Alt addr' : null,
            type.addressRequired ? 'Addr required' : null,
            type.requiresPatient ? 'Patient required' : null,
            type.excludeFromRouting ? 'No route' : null,
            type.excludeFromReminders ? 'No reminders' : null,
            type.isHold ? 'Hold' : null,
            type.usesLegacyRouting ? 'Legacy routing' : null,
            type.allowSchedulingOverride ? 'Sched override' : null,
          ]
            .filter(Boolean)
            .join(', ') || '—'}
        </td>
        <td>{formatPointsSummary(type)}</td>
        <td className="settings-appt-type-actions-cell">
          <button type="button" className="btn secondary" onClick={() => void openEdit(type)}>
            Edit
          </button>
          {mode === 'active' ? (
            <button
              type="button"
              className="btn secondary settings-appt-type-archive-btn"
              disabled={archiveBusy}
              onClick={() =>
                setArchiveConfirm({ id: type.id, name: type.prettyName || type.name })
              }
            >
              Archive
            </button>
          ) : (
            <button
              type="button"
              className="btn secondary"
              disabled={archiveBusy}
              onClick={() => void handleRestore(type)}
            >
              Restore
            </button>
          )}
        </td>
      </tr>
    );
  };

  const tableHead = (mode: 'active' | 'archived') => (
    <thead>
      <tr>
        <th>Name</th>
        <th>Display name</th>
        {mode === 'archived' ? <th>Archived on</th> : null}
        <th>Colors</th>
        <th>Arrival window</th>
        <th>Duration</th>
        <th>Request form</th>
        <th>New patients</th>
        <th>Order</th>
        <th>Booking</th>
        <th>Points</th>
        <th>Actions</th>
      </tr>
    </thead>
  );

  const colSpan = listView === 'archived' ? 12 : 11;
  const visibleTypes = listView === 'active' ? activeTypes : archivedTypesFiltered;

  return (
    <>
      <div className="settings-appt-type-list-header">
        <div
          className="settings-appt-type-subtabs"
          role="tablist"
          aria-label="Appointment type list"
        >
          <button
            type="button"
            role="tab"
            id="settings-appt-types-tab-active"
            aria-selected={listView === 'active'}
            aria-controls="settings-appt-types-panel"
            className={`settings-appt-type-subtab${listView === 'active' ? ' settings-appt-type-subtab--active' : ''}`}
            onClick={() => setListView('active')}
          >
            Active
            <span className="settings-appt-type-subtab-count">{activeTypes.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="settings-appt-types-tab-archived"
            aria-selected={listView === 'archived'}
            aria-controls="settings-appt-types-panel"
            className={`settings-appt-type-subtab${listView === 'archived' ? ' settings-appt-type-subtab--active' : ''}`}
            onClick={() => setListView('archived')}
          >
            Archived
            <span className="settings-appt-type-subtab-count">{archivedTypes.length}</span>
          </button>
        </div>
        {listView === 'active' ? (
          <button type="button" className="btn" onClick={openCreate}>
            Add appointment type
          </button>
        ) : null}
      </div>

      <div
        id="settings-appt-types-panel"
        role="tabpanel"
        aria-labelledby={listView === 'active' ? 'settings-appt-types-tab-active' : 'settings-appt-types-tab-archived'}
        className="settings-table-container"
      >
        {listView === 'archived' ? (
          <>
            <p className="settings-muted settings-appt-types-archived-note">
              Archived types are hidden from new booking pickers. Existing appointments still display
              the type name and colors.
            </p>
            <label className="settings-appt-types-archived-search">
              <span className="settings-label">Search archived types</span>
              <input
                type="search"
                className="settings-input"
                value={archivedSearch}
                onChange={(e) => setArchivedSearch(e.target.value)}
                placeholder="Filter by name…"
                aria-label="Search archived appointment types"
              />
            </label>
          </>
        ) : null}
        <table className="settings-table settings-appt-types-table">
          {tableHead(listView)}
          <tbody>
            {visibleTypes.length > 0 ? (
              visibleTypes.map((type) => renderTypeRow(type, listView))
            ) : (
              <tr>
                <td colSpan={colSpan} className="settings-muted">
                  {listView === 'active'
                    ? 'No active appointment types.'
                    : archivedTypes.length === 0
                      ? 'No archived appointment types.'
                      : 'No archived types match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalMode != null && draft && (
        <div
          className="settings-modal-overlay"
          role="presentation"
          onClick={() => {
            if (!saving) closeModal();
          }}
        >
          <div
            className="settings-modal settings-modal-wide settings-appt-type-modal"
            role="dialog"
            aria-labelledby="settings-appt-type-modal-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <h3 id="settings-appt-type-modal-title">
                {modalMode === 'create' ? 'Add appointment type' : 'Edit appointment type'}
              </h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              {modalLoading ? (
                <div className="settings-loading">
                  <span className="settings-spinner" aria-hidden />
                  <span>Loading…</span>
                </div>
              ) : (
                <>
                  <p className="settings-muted settings-appt-type-modal-intro">
                    Arrival window controls how early or late a client may arrive relative to the
                    scheduled time.
                  </p>

                  {formError && (
                    <div className="settings-message settings-error-message settings-appt-type-form-error">
                      {formError}
                    </div>
                  )}

                  <div className="settings-form-grid settings-appt-type-form-grid">
                    <div className="settings-form-group settings-form-group--full">
                      <label className="settings-label" htmlFor="appt-type-name">
                        Name
                      </label>
                      <input
                        id="appt-type-name"
                        type="text"
                        className="settings-input"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </div>
                    <div className="settings-form-group settings-form-group--full">
                      <label className="settings-label" htmlFor="appt-type-pretty-name">
                        Display name (pretty name)
                      </label>
                      <input
                        id="appt-type-pretty-name"
                        type="text"
                        className="settings-input"
                        value={draft.prettyName}
                        onChange={(e) => setDraft({ ...draft, prettyName: e.target.value })}
                      />
                    </div>

                    <div className="settings-form-group">
                      <label className="settings-label" htmlFor="appt-type-default-duration">
                        Default duration (minutes)
                      </label>
                      <input
                        id="appt-type-default-duration"
                        type="number"
                        min={1}
                        step={1}
                        required
                        className="settings-input"
                        placeholder="45"
                        value={draft.defaultDuration}
                        onChange={(e) =>
                          setDraft({ ...draft, defaultDuration: e.target.value })
                        }
                      />
                      <p className="settings-muted settings-appt-type-window-hint">
                        Used when booking or routing this type (unless the doctor had 5+ of this type in the last 30 days).
                      </p>
                    </div>

                    <div className="settings-form-group">
                      <label className="settings-label" htmlFor="appt-type-color">
                        Background color
                      </label>
                      <div className="settings-color-row">
                        <input
                          id="appt-type-color"
                          type="color"
                          className="settings-color-input"
                          value={hexForColorInput(draft.color)}
                          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                        />
                        <input
                          type="text"
                          className="settings-input"
                          value={draft.color}
                          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                          placeholder="#4A90D9"
                        />
                      </div>
                    </div>

                    <div className="settings-form-group">
                      <label className="settings-label" htmlFor="appt-type-text-color">
                        Text color
                      </label>
                      <div className="settings-color-row">
                        <input
                          id="appt-type-text-color"
                          type="color"
                          className="settings-color-input"
                          value={hexForColorInput(draft.textColor)}
                          onChange={(e) => setDraft({ ...draft, textColor: e.target.value })}
                        />
                        <input
                          type="text"
                          className="settings-input"
                          value={draft.textColor}
                          onChange={(e) => setDraft({ ...draft, textColor: e.target.value })}
                          placeholder="#FFFFFF"
                        />
                      </div>
                    </div>

                    <div className="settings-form-group settings-form-group--full">
                      <span className="settings-label">Preview</span>
                      <span
                        className="settings-appt-type-preview-chip"
                        style={{
                          background: normalizeHex(draft.color) ?? '#94a3b8',
                          color: normalizeHex(draft.textColor) ?? '#fff',
                        }}
                      >
                        {draft.prettyName.trim() || draft.name.trim() || 'Type'}
                      </span>
                    </div>

                    <fieldset className="settings-appt-type-window-fieldset settings-form-group--full">
                      <legend className="settings-label">Arrival window</legend>
                      <label className="settings-checkbox-label">
                        <input
                          type="checkbox"
                          checked={draft.useLegacyWindow}
                          onChange={(e) =>
                            setDraft({ ...draft, useLegacyWindow: e.target.checked })
                          }
                        />
                        Use legacy defaults (clears custom window on save)
                      </label>

                      {!draft.useLegacyWindow && (
                        <>
                          <div className="settings-appt-type-window-presets">
                            <span className="settings-muted">Presets:</span>
                            <button
                              type="button"
                              className="btn secondary btn-sm"
                              onClick={() => applyWindowPreset(0, 0)}
                            >
                              Fixed time (0 / 0)
                            </button>
                            <button
                              type="button"
                              className="btn secondary btn-sm"
                              onClick={() => applyWindowPreset(60, 60)}
                            >
                              ±60 min
                            </button>
                            <button
                              type="button"
                              className="btn secondary btn-sm"
                              onClick={() => applyWindowPreset(30, 60)}
                            >
                              −30 / +60 min
                            </button>
                          </div>
                          <div className="settings-appt-type-window-inputs">
                            <div className="settings-form-group">
                              <label className="settings-label" htmlFor="appt-window-before">
                                Minutes before
                              </label>
                              <input
                                id="appt-window-before"
                                type="number"
                                min={0}
                                step={1}
                                className="settings-input"
                                value={draft.windowBeforeMinutes}
                                onChange={(e) =>
                                  setDraft({ ...draft, windowBeforeMinutes: e.target.value })
                                }
                              />
                            </div>
                            <div className="settings-form-group">
                              <label className="settings-label" htmlFor="appt-window-after">
                                Minutes after
                              </label>
                              <input
                                id="appt-window-after"
                                type="number"
                                min={0}
                                step={1}
                                className="settings-input"
                                value={draft.windowAfterMinutes}
                                onChange={(e) =>
                                  setDraft({ ...draft, windowAfterMinutes: e.target.value })
                                }
                              />
                            </div>
                          </div>
                          <p className="settings-muted settings-appt-type-window-hint">
                            Current:{' '}
                            {formatArrivalWindow(
                              draft.windowBeforeMinutes === ''
                                ? null
                                : Number(draft.windowBeforeMinutes),
                              draft.windowAfterMinutes === ''
                                ? null
                                : Number(draft.windowAfterMinutes)
                            )}
                          </p>
                        </>
                      )}
                    </fieldset>

                    <div className="settings-form-group">
                      <label className="settings-checkbox-label">
                        <input
                          type="checkbox"
                          checked={draft.showInApptRequestForm}
                          onChange={(e) =>
                            setDraft({ ...draft, showInApptRequestForm: e.target.checked })
                          }
                        />
                        Show in appointment request form
                      </label>
                    </div>

                    <div className="settings-form-group">
                      <label className="settings-checkbox-label">
                        <input
                          type="checkbox"
                          checked={draft.newPatientAllowed}
                          onChange={(e) =>
                            setDraft({ ...draft, newPatientAllowed: e.target.checked })
                          }
                        />
                        New patients allowed
                      </label>
                    </div>

                    <div className="settings-form-group">
                      <label className="settings-label" htmlFor="appt-form-order">
                        Form list order
                      </label>
                      <input
                        id="appt-form-order"
                        type="number"
                        min={1}
                        className="settings-input"
                        placeholder="1 = top"
                        value={draft.formListOrder}
                        onChange={(e) => setDraft({ ...draft, formListOrder: e.target.value })}
                      />
                    </div>

                    <fieldset className="settings-appt-type-window-fieldset settings-form-group--full">
                      <legend className="settings-label">Booking &amp; routing</legend>
                      <div className="settings-appt-type-booking-flags">
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.allowAllDay}
                            onChange={(e) => setDraft({ ...draft, allowAllDay: e.target.checked })}
                          />
                          Allow all-day booking
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.allowClient}
                            onChange={(e) => setDraft({ ...draft, allowClient: e.target.checked })}
                          />
                          Allow client on appointment
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.allowAlternateAddress}
                            onChange={(e) =>
                              setDraft({ ...draft, allowAlternateAddress: e.target.checked })
                            }
                          />
                          Allow alternate address
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.addressRequired}
                            onChange={(e) =>
                              setDraft({ ...draft, addressRequired: e.target.checked })
                            }
                          />
                          Address required
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.requiresPatient}
                            onChange={(e) =>
                              setDraft({ ...draft, requiresPatient: e.target.checked })
                            }
                          />
                          Requires patient
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.excludeFromRouting}
                            onChange={(e) =>
                              setDraft({ ...draft, excludeFromRouting: e.target.checked })
                            }
                          />
                          Exclude from routing
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.excludeFromReminders}
                            onChange={(e) =>
                              setDraft({ ...draft, excludeFromReminders: e.target.checked })
                            }
                          />
                          Exclude from reminders &amp; visit analytics
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.isHold}
                            onChange={(e) =>
                              setDraft({ ...draft, isHold: e.target.checked })
                            }
                          />
                          Hold type (shows on Holds board, counts as on hold)
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.usesLegacyRouting}
                            onChange={(e) =>
                              setDraft({ ...draft, usesLegacyRouting: e.target.checked })
                            }
                          />
                          Legacy routing
                        </label>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.allowSchedulingOverride}
                            onChange={(e) =>
                              setDraft({ ...draft, allowSchedulingOverride: e.target.checked })
                            }
                          />
                          Allow scheduling override
                        </label>
                      </div>
                      <p className="settings-muted settings-appt-type-window-hint">
                        Address required means the visit must have a linked client with an address, or an
                        alternate address when alternate address is allowed. Requires patient means the visit
                        must have a patient linked to be saved as that type.
                      </p>
                      <p className="settings-muted settings-appt-type-window-hint">
                        Scheduling override is shown in the scheduler UI only; appointment create/update
                        APIs do not validate this flag.
                      </p>
                    </fieldset>

                    <fieldset className="settings-appt-type-window-fieldset settings-form-group--full">
                      <legend className="settings-label">Ops points (per patient)</legend>
                      <label className="settings-checkbox-label">
                        <input
                          type="checkbox"
                          checked={draft.useLegacyPoints}
                          onChange={(e) => setDraft({ ...draft, useLegacyPoints: e.target.checked })}
                        />
                        Use legacy points rules (e.g. euthanasia = 2, tech = 0.5)
                      </label>
                      {!draft.useLegacyPoints ? (
                        <div className="settings-form-group" style={{ marginTop: 8 }}>
                          <label className="settings-label" htmlFor="appt-type-points">
                            Points (0–100)
                          </label>
                          <input
                            id="appt-type-points"
                            type="text"
                            inputMode="decimal"
                            className="settings-input settings-input--narrow"
                            value={draft.points}
                            onChange={(e) => setDraft({ ...draft, points: e.target.value })}
                            placeholder="1"
                          />
                        </div>
                      ) : (
                        <p className="settings-muted settings-appt-type-window-hint">
                          Leave unset to match server name-based defaults for this type.
                        </p>
                      )}
                    </fieldset>
                  </div>

                  <div className="settings-modal-actions">
                    <button type="button" className="btn" onClick={() => void handleSave()} disabled={saving}>
                      {saving
                        ? modalMode === 'create'
                          ? 'Creating…'
                          : 'Saving…'
                        : modalMode === 'create'
                          ? 'Create appointment type'
                          : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={closeModal}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {archiveConfirm ? (
        <div
          className="settings-modal-overlay"
          role="presentation"
          onClick={() => {
            if (!archiveBusy) setArchiveConfirm(null);
          }}
        >
          <div
            className="settings-modal settings-appt-type-archive-modal"
            role="alertdialog"
            aria-labelledby="settings-appt-type-archive-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <h3 id="settings-appt-type-archive-title">Archive appointment type?</h3>
            </div>
            <div className="settings-modal-body">
              <p>
                Archive <strong>{archiveConfirm.name}</strong>? It will not appear in scheduler or
                manual booking pickers for new appointments. Existing appointments on the calendar
                are not affected.
              </p>
              <div className="settings-modal-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={archiveBusy}
                  onClick={() => void handleArchiveConfirm()}
                >
                  {archiveBusy ? 'Archiving…' : 'Archive'}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={archiveBusy}
                  onClick={() => setArchiveConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
