import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import {
  buildScheduleOverridePayload,
  createScheduleOverride,
  deleteScheduleOverride,
  fetchAllEmployees,
  fetchEmployee,
  fetchScheduleOverrideByDate,
  fetchScheduleOverrides,
  scheduleOverrideIsOff,
  updateScheduleOverride,
  type Employee,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import '../pages/Settings.css';

function formatEmployeeName(emp: Employee): string {
  const nameParts: string[] = [];
  if (emp.title) nameParts.push(emp.title);
  if (emp.firstName) nameParts.push(emp.firstName);
  if (emp.lastName) nameParts.push(emp.lastName);
  if (emp.designation) nameParts.push(emp.designation);
  return nameParts.length > 0
    ? nameParts.join(' ')
    : `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `Employee ${emp.id}`;
}

export type ScheduleOverrideModalProps = {
  open: boolean;
  onClose: () => void;
  initialEmployeeId?: number | string | null;
  initialDate?: string | null;
  onSaved?: () => void;
};

export default function ScheduleOverrideModal({
  open,
  onClose,
  initialEmployeeId,
  initialDate,
  onSaved,
}: ScheduleOverrideModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => dayjs().startOf('month'));
  const [overridesInRange, setOverridesInRange] = useState<ScheduleOverride[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleOverride | (Partial<ScheduleOverride> & { date: string }) | null>(
    null
  );
  const [formLoading, setFormLoading] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [dayOffMode, setDayOffMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const wasOpenRef = useRef(false);

  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      const aProv = a.isProvider === true ? 0 : 1;
      const bProv = b.isProvider === true ? 0 : 1;
      if (aProv !== bProv) return aProv - bProv;
      return formatEmployeeName(a).localeCompare(formatEmployeeName(b));
    });
  }, [employees]);

  const loadFormForDate = useCallback(async (empId: number, dateStr: string) => {
    setSelectedDate(dateStr);
    setFormLoading(true);
    setForm(null);
    setError(null);
    try {
      const [existing, employee] = await Promise.all([
        fetchScheduleOverrideByDate(empId, dateStr),
        fetchEmployee(empId),
      ]);
      const dayOfWeek = dayjs(dateStr).day();
      const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
      const defaultLatLon = {
        startDepotLat: defaultSchedule?.startDepotLat ?? undefined,
        startDepotLon: defaultSchedule?.startDepotLon ?? undefined,
        endDepotLat: defaultSchedule?.endDepotLat ?? undefined,
        endDepotLon: defaultSchedule?.endDepotLon ?? undefined,
      };
      if (existing) {
        const merged = {
          ...existing,
          startDepotLat: existing.startDepotLat ?? defaultLatLon.startDepotLat,
          startDepotLon: existing.startDepotLon ?? defaultLatLon.startDepotLon,
          endDepotLat: existing.endDepotLat ?? defaultLatLon.endDepotLat,
          endDepotLon: existing.endDepotLon ?? defaultLatLon.endDepotLon,
        };
        setForm(merged);
        setDayOffMode(scheduleOverrideIsOff(merged));
      } else {
        const draft = {
          date: dateStr,
          workStartLocal: defaultSchedule?.workStartLocal ?? '',
          workEndLocal: defaultSchedule?.workEndLocal ?? '',
          ...defaultLatLon,
        };
        setForm(draft);
        setDayOffMode(false);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to load override');
    } finally {
      setFormLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (!justOpened) return;

    setError(null);
    setSuccess(null);
    setEmployeesLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const emps = await fetchAllEmployees();
        if (cancelled) return;
        setEmployees(emps);

        const rawId = initialEmployeeId != null ? String(initialEmployeeId).trim() : '';
        const parsedId = rawId ? Number(rawId) : NaN;
        const empId =
          Number.isFinite(parsedId) && emps.some((e) => e.id === parsedId) ? parsedId : null;

        const dateStr =
          initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null;

        setEmployeeId(empId);
        setCalendarMonth(dateStr ? dayjs(dateStr).startOf('month') : dayjs().startOf('month'));
        setSelectedDate(dateStr);
        setForm(null);

        if (empId && dateStr) {
          await loadFormForDate(empId, dateStr);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as { response?: { data?: { message?: string } }; message?: string };
          setError(e?.response?.data?.message || e?.message || 'Failed to load employees');
        }
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialEmployeeId, initialDate, loadFormForDate]);

  useEffect(() => {
    if (!open || !employeeId) {
      setOverridesInRange([]);
      return;
    }
    const start = calendarMonth.format('YYYY-MM-DD');
    const end = calendarMonth.endOf('month').format('YYYY-MM-DD');
    let cancelled = false;
    fetchScheduleOverrides(employeeId, { startDate: start, endDate: end })
      .then((list) => {
        if (!cancelled) setOverridesInRange(list);
      })
      .catch(() => {
        if (!cancelled) setOverridesInRange([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, employeeId, calendarMonth]);

  const handleDayClick = async (dateStr: string) => {
    if (!employeeId) return;
    await loadFormForDate(employeeId, dateStr);
  };

  const persistOverride = async (): Promise<boolean> => {
    if (!employeeId || !form?.date) return false;
    setFormSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = buildScheduleOverridePayload(form);
      const saved =
        'id' in form && form.id
          ? await updateScheduleOverride(employeeId, form.id, payload)
          : await createScheduleOverride(employeeId, { date: form.date, ...payload });
      const start = calendarMonth.format('YYYY-MM-DD');
      const end = calendarMonth.endOf('month').format('YYYY-MM-DD');
      const list = await fetchScheduleOverrides(employeeId, { startDate: start, endDate: end });
      setOverridesInRange(list);
      const updated = list.find((o) => o.date === form.date) ?? saved;
      setForm(updated);
      setDayOffMode(scheduleOverrideIsOff(updated));
      onSaved?.();
      return true;
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to save override');
      return false;
    } finally {
      setFormSaving(false);
    }
  };

  const handleSaveAndClose = async () => {
    if (!(await persistOverride())) return;
    onClose();
  };

  const handleSaveAndAnother = async () => {
    if (!(await persistOverride())) return;
    setSuccess('Saved. Select another day on the calendar to continue.');
    setTimeout(() => setSuccess(null), 4000);
  };

  const handleRemove = async () => {
    if (!employeeId || !form || !('id' in form) || !form.id) return;
    setFormSaving(true);
    setError(null);
    try {
      await deleteScheduleOverride(employeeId, form.id);
      setSuccess('Override removed; default schedule will be used for that day');
      setTimeout(() => setSuccess(null), 3000);
      const start = calendarMonth.format('YYYY-MM-DD');
      const end = calendarMonth.endOf('month').format('YYYY-MM-DD');
      const list = await fetchScheduleOverrides(employeeId, { startDate: start, endDate: end });
      setOverridesInRange(list);
      const employee = await fetchEmployee(employeeId);
      const dayOfWeek = dayjs(form.date).day();
      const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
      setForm({
        date: form.date,
        workStartLocal: defaultSchedule?.workStartLocal ?? '',
        workEndLocal: defaultSchedule?.workEndLocal ?? '',
        startDepotLat: defaultSchedule?.startDepotLat ?? undefined,
        startDepotLon: defaultSchedule?.startDepotLon ?? undefined,
        endDepotLat: defaultSchedule?.endDepotLat ?? undefined,
        endDepotLon: defaultSchedule?.endDepotLon ?? undefined,
      });
      onSaved?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to remove override');
    } finally {
      setFormSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="settings-modal-overlay schedule-override-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        className="settings-modal settings-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-override-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3 id="schedule-override-modal-title">Schedule overrides by day</h3>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          {error ? (
            <p className="settings-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="settings-success" style={{ marginBottom: 12 }}>
              {success}
            </p>
          ) : null}
          {employeesLoading ? (
            <div className="settings-loading" style={{ padding: 24 }}>
              <span className="settings-spinner" />
              <span>Loading…</span>
            </div>
          ) : (
            <>
              <div className="settings-form-group">
                <label className="settings-label">Employee (doctor)</label>
                <select
                  className="settings-select"
                  value={employeeId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setEmployeeId(id);
                    setSelectedDate(null);
                    setForm(null);
                    setDayOffMode(false);
                  }}
                >
                  <option value="">-- Select employee --</option>
                  {sortedEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {formatEmployeeName(emp)}
                    </option>
                  ))}
                </select>
              </div>

              {!employeeId ? (
                <p className="settings-muted" style={{ marginTop: 16 }}>
                  Please select a provider above to view and set schedule overrides by day.
                </p>
              ) : (
                <>
                  <div className="settings-override-calendar-nav">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setCalendarMonth((m) => m.subtract(1, 'month'))}
                    >
                      ← Prev
                    </button>
                    <span className="settings-override-calendar-month">{calendarMonth.format('MMMM YYYY')}</span>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setCalendarMonth((m) => m.add(1, 'month'))}
                    >
                      Next →
                    </button>
                  </div>

                  <div className="settings-override-calendar-grid">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                      <div key={d} className="settings-override-calendar-weekday">
                        {d}
                      </div>
                    ))}
                    {(() => {
                      const start = calendarMonth.startOf('month');
                      const end = calendarMonth.endOf('month');
                      const startDay = start.day();
                      const daysInMonth = end.date();
                      const cells: ReactNode[] = [];
                      for (let i = 0; i < startDay; i++) {
                        cells.push(
                          <div
                            key={`pad-${i}`}
                            className="settings-override-calendar-day settings-override-calendar-day-pad"
                          />
                        );
                      }
                      const overrideByDate = new Map(
                        overridesInRange.map((o) => [o.date, o] as const)
                      );
                      for (let d = 1; d <= daysInMonth; d++) {
                        const date = start.date(d);
                        const dateStr = date.format('YYYY-MM-DD');
                        const override = overrideByDate.get(dateStr);
                        const hasOverride = Boolean(override);
                        const isOff = override ? scheduleOverrideIsOff(override) : false;
                        const isSelected = selectedDate === dateStr;
                        cells.push(
                          <button
                            key={dateStr}
                            type="button"
                            className={[
                              'settings-override-calendar-day',
                              hasOverride && isOff ? 'settings-override-calendar-day-off' : '',
                              hasOverride && !isOff ? 'settings-override-calendar-day-has-override' : '',
                              isSelected ? 'settings-override-calendar-day-selected' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => void handleDayClick(dateStr)}
                          >
                            <span>{d}</span>
                            {isOff ? (
                              <span className="settings-override-calendar-off-label">OFF</span>
                            ) : null}
                          </button>
                        );
                      }
                      return cells;
                    })()}
                  </div>

                  {formLoading ? (
                    <div className="settings-loading" style={{ padding: 24 }}>
                      <span className="settings-spinner" />
                      <span>Loading day…</span>
                    </div>
                  ) : null}

                  {!formLoading && form ? (
                    <div className="settings-override-form">
                      <h4 className="settings-schedule-subtitle">
                        {form.date} {dayjs(form.date).format('dddd')}
                      </h4>
                      <p className="settings-muted" style={{ marginBottom: 12 }}>
                        Set start/end time and depot locations for this day. Routing will use these values instead of
                        the weekly schedule.
                      </p>
                      <div className="settings-override-times-row">
                        {!dayOffMode ? (
                          <div className="settings-schedule-row settings-override-times-fields">
                            <div className="settings-schedule-field">
                              <label className="settings-label">Start time</label>
                              <input
                                type="time"
                                className="settings-input"
                                value={form.workStartLocal ?? ''}
                                onChange={(e) => {
                                  setDayOffMode(false);
                                  setForm((f) => (f ? { ...f, workStartLocal: e.target.value } : null));
                                }}
                              />
                            </div>
                            <div className="settings-schedule-field">
                              <label className="settings-label">End time</label>
                              <input
                                type="time"
                                className="settings-input"
                                value={form.workEndLocal ?? ''}
                                onChange={(e) => {
                                  setDayOffMode(false);
                                  setForm((f) => (f ? { ...f, workEndLocal: e.target.value } : null));
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="settings-muted settings-override-day-off-note">
                            This day is marked <strong>off</strong> — no shift times. Save when ready.
                          </p>
                        )}
                        <button
                          type="button"
                          className="btn secondary settings-override-mark-off-btn"
                          onClick={() => {
                            setDayOffMode(true);
                            setForm((f) =>
                              f
                                ? {
                                    ...f,
                                    workStartLocal: '',
                                    workEndLocal: '',
                                  }
                                : null
                            );
                          }}
                          disabled={formSaving || dayOffMode}
                        >
                          Mark as day off
                        </button>
                      </div>
                      <div className="settings-schedule-section">
                        <h4 className="settings-schedule-subtitle">Start depot</h4>
                        <div className="settings-schedule-row">
                          <div className="settings-schedule-field">
                            <label className="settings-label">Latitude</label>
                            <input
                              type="text"
                              className="settings-input"
                              value={form.startDepotLat ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') {
                                  setForm((f) => (f ? { ...f, startDepotLat: undefined } : null));
                                  return;
                                }
                                const n = parseFloat(v);
                                if (Number.isFinite(n)) setForm((f) => (f ? { ...f, startDepotLat: n } : null));
                              }}
                            />
                          </div>
                          <div className="settings-schedule-field">
                            <label className="settings-label">Longitude</label>
                            <input
                              type="text"
                              className="settings-input"
                              value={form.startDepotLon ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') {
                                  setForm((f) => (f ? { ...f, startDepotLon: undefined } : null));
                                  return;
                                }
                                const n = parseFloat(v);
                                if (Number.isFinite(n)) setForm((f) => (f ? { ...f, startDepotLon: n } : null));
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="settings-schedule-section">
                        <h4 className="settings-schedule-subtitle">End depot</h4>
                        <div className="settings-schedule-row">
                          <div className="settings-schedule-field">
                            <label className="settings-label">Latitude</label>
                            <input
                              type="text"
                              className="settings-input"
                              value={form.endDepotLat ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') {
                                  setForm((f) => (f ? { ...f, endDepotLat: undefined } : null));
                                  return;
                                }
                                const n = parseFloat(v);
                                if (Number.isFinite(n)) setForm((f) => (f ? { ...f, endDepotLat: n } : null));
                              }}
                            />
                          </div>
                          <div className="settings-schedule-field">
                            <label className="settings-label">Longitude</label>
                            <input
                              type="text"
                              className="settings-input"
                              value={form.endDepotLon ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') {
                                  setForm((f) => (f ? { ...f, endDepotLon: undefined } : null));
                                  return;
                                }
                                const n = parseFloat(v);
                                if (Number.isFinite(n)) setForm((f) => (f ? { ...f, endDepotLon: n } : null));
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="settings-action-bar settings-override-save-bar" style={{ marginTop: 16 }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void handleSaveAndClose()}
                          disabled={formSaving}
                        >
                          {formSaving ? 'Saving…' : 'Save and Close'}
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => void handleSaveAndAnother()}
                          disabled={formSaving}
                        >
                          {formSaving ? 'Saving…' : 'Save and Do Another'}
                        </button>
                        {'id' in form && form.id ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => void handleRemove()}
                            disabled={formSaving}
                          >
                            Remove override (use default)
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
