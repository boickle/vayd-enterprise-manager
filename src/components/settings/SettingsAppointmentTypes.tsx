import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAppointmentType,
  updateAppointmentType,
  type AppointmentType,
} from '../../api/appointmentSettings';
import { formatPointsSummary } from '../../utils/appointmentTypeSettings';

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

type EditDraft = {
  prettyName: string;
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
  excludeFromRouting: boolean;
  allowSchedulingOverride: boolean;
  useLegacyPoints: boolean;
  points: string;
};

function draftFromType(type: AppointmentType): EditDraft {
  const legacy =
    type.windowBeforeMinutes == null && type.windowAfterMinutes == null;
  return {
    prettyName: type.prettyName ?? type.name ?? '',
    color: displayColor(type),
    textColor: displayTextColor(type),
    windowBeforeMinutes:
      type.windowBeforeMinutes != null ? String(type.windowBeforeMinutes) : '',
    windowAfterMinutes:
      type.windowAfterMinutes != null ? String(type.windowAfterMinutes) : '',
    useLegacyWindow: legacy,
    showInApptRequestForm: type.showInApptRequestForm === true,
    newPatientAllowed: type.newPatientAllowed === true,
    formListOrder: type.formListOrder != null ? String(type.formListOrder) : '',
    allowAllDay: type.allowAllDay === true,
    allowClient: type.allowClient !== false,
    allowAlternateAddress: type.allowAlternateAddress === true,
    excludeFromRouting: type.excludeFromRouting === true,
    allowSchedulingOverride: type.allowSchedulingOverride === true,
    useLegacyPoints: type.points == null,
    points: type.points != null ? String(type.points) : '',
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

type Props = {
  types: AppointmentType[];
  onTypesChange: (types: AppointmentType[]) => void;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsAppointmentTypes({ types, onTypesChange, onMessage }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const sortedTypes = useMemo(() => {
    return [...types].sort((a, b) => {
      const aShow = a.showInApptRequestForm === true ? 0 : 1;
      const bShow = b.showInApptRequestForm === true ? 0 : 1;
      if (aShow !== bShow) return aShow - bShow;
      const aOrder = a.formListOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.formListOrder ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  }, [types]);

  const closeModal = useCallback(() => {
    setEditingId(null);
    setEditingName('');
    setDraft(null);
    setFormError(null);
    setModalLoading(false);
  }, []);

  useEffect(() => {
    if (editingId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, saving, closeModal]);

  const openEdit = async (type: AppointmentType) => {
    setEditingId(type.id);
    setEditingName(type.name);
    setDraft(draftFromType(type));
    setFormError(null);
    setModalLoading(true);
    try {
      const fresh = await fetchAppointmentType(type.id);
      setEditingName(fresh.name);
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
    if (editingId == null || !draft) return;
    setFormError(null);
    setSaving(true);
    try {
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

      const formListOrder =
        draft.formListOrder.trim() === '' ? null : Number(draft.formListOrder);
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

      const updated = await updateAppointmentType(editingId, {
        prettyName: draft.prettyName.trim() || undefined,
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
        excludeFromRouting: draft.excludeFromRouting,
        allowSchedulingOverride: draft.allowSchedulingOverride,
        points,
      });

      onTypesChange(types.map((t) => (t.id === updated.id ? updated : t)));
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

  return (
    <>
      <div className="settings-table-container">
        <table className="settings-table settings-appt-types-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Display name</th>
              <th>Colors</th>
              <th>Arrival window</th>
              <th>Request form</th>
              <th>New patients</th>
              <th>Order</th>
              <th>Booking</th>
              <th>Points</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedTypes.map((type) => (
              <tr key={type.id}>
                <td>{type.name}</td>
                <td>{type.prettyName || type.name}</td>
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
                <td>{type.showInApptRequestForm ? 'Yes' : 'No'}</td>
                <td>{type.newPatientAllowed ? 'Yes' : 'No'}</td>
                <td>{type.formListOrder ?? '—'}</td>
                <td className="settings-appt-type-flags-cell">
                  {[
                    type.allowAllDay ? 'All-day' : null,
                    type.allowClient === false ? 'No client' : null,
                    type.allowAlternateAddress ? 'Alt addr' : null,
                    type.excludeFromRouting ? 'No route' : null,
                    type.allowSchedulingOverride ? 'Sched override' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </td>
                <td>{formatPointsSummary(type)}</td>
                <td>
                  <button type="button" className="btn secondary" onClick={() => void openEdit(type)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingId != null && draft && (
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
              <h3 id="settings-appt-type-modal-title">Edit appointment type</h3>
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
                    <strong>{editingName}</strong> — PIMS name is read-only. Arrival window controls how
                    early or late a client may arrive relative to the scheduled time.
                  </p>

                  {formError && (
                    <div className="settings-message settings-error-message settings-appt-type-form-error">
                      {formError}
                    </div>
                  )}

                  <div className="settings-form-grid settings-appt-type-form-grid">
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
                        {draft.prettyName.trim() || editingName}
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
                            checked={draft.allowSchedulingOverride}
                            onChange={(e) =>
                              setDraft({ ...draft, allowSchedulingOverride: e.target.checked })
                            }
                          />
                          Allow scheduling override
                        </label>
                      </div>
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
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
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
                      {saving ? 'Saving…' : 'Save changes'}
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
    </>
  );
}
