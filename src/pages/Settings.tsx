import React, { FormEvent, useEffect, useState } from 'react';
import { http } from '../api/http';
import { Field } from '../components/Field';
import {
  fetchPracticeSettings,
  updatePracticeSettings,
  type PracticeSettings,
  type ReminderSettings,
} from '../api/settings';
import {
  fetchAllEmployees,
  fetchEmployeeWeeklySchedules,
  updateEmployeeWeeklySchedules,
  fetchEmployeeLocations,
  updateEmployeeLocation,
  type Employee,
  type WeeklySchedule,
  type EmployeeDayLocation,
  type UpdateEmployeeLocationRequest,
} from '../api/employee';

const DAYS_OF_WEEK = [
  { value: 1, label: 'Monday', apiValue: 1 }, // API: 1 = Monday
  { value: 2, label: 'Tuesday', apiValue: 2 }, // API: 2 = Tuesday
  { value: 3, label: 'Wednesday', apiValue: 3 }, // API: 3 = Wednesday
  { value: 4, label: 'Thursday', apiValue: 4 }, // API: 4 = Thursday
  { value: 5, label: 'Friday', apiValue: 5 }, // API: 5 = Friday
  { value: 6, label: 'Saturday', apiValue: 6 }, // API: 6 = Saturday
  { value: 7, label: 'Sunday', apiValue: 0 }, // API: 0 = Sunday, Schedule: 7 = Sunday
];

// Convert schedule dayOfWeek (1-7) to API dayOfWeek (0-6)
function scheduleDayToApiDay(scheduleDay: number): number {
  if (scheduleDay === 7) return 0; // Sunday: 7 -> 0
  return scheduleDay; // Monday-Saturday: 1-6 -> 1-6
}

// Convert API dayOfWeek (0-6) to schedule dayOfWeek (1-7)
function apiDayToScheduleDay(apiDay: number): number {
  if (apiDay === 0) return 7; // Sunday: 0 -> 7
  return apiDay; // Monday-Saturday: 1-6 -> 1-6
}

export default function Settings() {
  const [settings, setSettings] = useState<PracticeSettings>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string | number>>(new Set());
  const [employeeSchedules, setEmployeeSchedules] = useState<Map<string | number, WeeklySchedule[]>>(new Map());
  const [employeeLocations, setEmployeeLocations] = useState<Map<string | number, EmployeeDayLocation[]>>(new Map());
  const [savingSchedules, setSavingSchedules] = useState<Set<string | number>>(new Set());
  const [savingLocations, setSavingLocations] = useState<Set<string | number>>(new Set());
  
  // Collapsible card states
  const [generalSettingsExpanded, setGeneralSettingsExpanded] = useState(false);
  const [employeeSchedulesExpanded, setEmployeeSchedulesExpanded] = useState(false);

  // Load settings
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setSettingsLoading(true);
        const data = await fetchPracticeSettings(1);
        if (!alive) return;
        setSettings(data);
      } catch (err: any) {
        if (!alive) return;
        setSettingsError(err?.response?.data?.message || err.message || 'Failed to load settings');
      } finally {
        if (alive) setSettingsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load employees
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setEmployeesLoading(true);
        setEmployeesError(null);
        const list = await fetchAllEmployees();
        if (!alive) return;
        console.log('Loaded employees:', list);
        setEmployees(list);
        if (list.length === 0) {
          setEmployeesError('No employees found. The API endpoint may need to be configured.');
        }
      } catch (err: any) {
        console.error('Failed to load employees', err);
        if (!alive) return;
        setEmployeesError(
          err?.response?.data?.message || err.message || 'Failed to load employees. Please check the console for details.'
        );
      } finally {
        if (alive) setEmployeesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load schedule and locations when employee is expanded
  const loadEmployeeSchedule = async (employeeId: string | number) => {
    if (employeeSchedules.has(employeeId)) return; // Already loaded

    try {
      const [schedules, locations] = await Promise.all([
        fetchEmployeeWeeklySchedules(employeeId),
        fetchEmployeeLocations(employeeId).catch(() => []), // Locations are optional
      ]);

      // Ensure all 7 days are present in the schedule
      const allDays = DAYS_OF_WEEK.map((day) => {
        const existing = schedules.find((s) => s.dayOfWeek === day.value);
        return (
          existing || {
            dayOfWeek: day.value,
            isWorkday: false,
            workStartLocal: '09:00',
            workEndLocal: '17:00',
          }
        );
      });
      setEmployeeSchedules((prev) => {
        const next = new Map(prev);
        next.set(employeeId, allDays);
        return next;
      });

      // Store locations (convert API dayOfWeek 0-6 to schedule dayOfWeek 1-7)
      const normalizedLocations = locations.map((loc) => ({
        ...loc,
        dayOfWeek: apiDayToScheduleDay(loc.dayOfWeek),
      }));
      setEmployeeLocations((prev) => {
        const next = new Map(prev);
        next.set(employeeId, normalizedLocations);
        return next;
      });
    } catch (err: any) {
      console.error(`Failed to load schedule for employee ${employeeId}`, err);
      // Initialize with empty schedule on error
      const allDays = DAYS_OF_WEEK.map((day) => ({
        dayOfWeek: day.value,
        isWorkday: false,
        workStartLocal: '09:00',
        workEndLocal: '17:00',
      }));
      setEmployeeSchedules((prev) => {
        const next = new Map(prev);
        next.set(employeeId, allDays);
        return next;
      });
      setEmployeeLocations((prev) => {
        const next = new Map(prev);
        next.set(employeeId, []);
        return next;
      });
    }
  };

  const toggleEmployeeExpanded = (employeeId: string | number) => {
    setExpandedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
        loadEmployeeSchedule(employeeId);
      }
      return next;
    });
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsMsg(null);

    try {
      const updated = await updatePracticeSettings(1, settings);
      setSettings(updated);
      setSettingsMsg('Settings saved successfully');
      setTimeout(() => setSettingsMsg(null), 3000);
    } catch (err: any) {
      setSettingsError(err?.response?.data?.message || err.message || 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSaveEmployeeSchedule = async (employeeId: string | number) => {
    const schedules = employeeSchedules.get(employeeId);
    if (!schedules) return;

    setSavingSchedules((prev) => new Set(prev).add(employeeId));
    try {
      const updated = await updateEmployeeWeeklySchedules(employeeId, schedules);
      setEmployeeSchedules((prev) => {
        const next = new Map(prev);
        next.set(employeeId, updated);
        return next;
      });
    } catch (err: any) {
      console.error(`Failed to save schedule for employee ${employeeId}`, err);
      alert(err?.response?.data?.message || err.message || 'Failed to save schedule');
    } finally {
      setSavingSchedules((prev) => {
        const next = new Set(prev);
        next.delete(employeeId);
        return next;
      });
    }
  };

  const handleSaveEmployeeLocations = async (employeeId: string | number, dayOfWeek: number) => {
    const locations = employeeLocations.get(employeeId) || [];
    const location = locations.find((loc) => loc.dayOfWeek === dayOfWeek) || {
      dayOfWeek,
      validFrom: null,
      startLocation: {},
      endLocation: {},
    };

    // Check if there's anything to save
    const hasStart = location.startLocation?.lat != null && location.startLocation?.lon != null;
    const hasEnd = location.endLocation?.lat != null && location.endLocation?.lon != null;
    if (!hasStart && !hasEnd) {
      alert('Please enter at least one location (start or end depot)');
      return;
    }

    setSavingLocations((prev) => new Set(prev).add(employeeId));
    try {
      // Convert schedule dayOfWeek (1-7) to API dayOfWeek (0-6)
      const apiDayOfWeek = scheduleDayToApiDay(dayOfWeek);
      const updateRequest: UpdateEmployeeLocationRequest = {
        dayOfWeek: apiDayOfWeek,
        validFrom: location.validFrom || null,
      };

      if (hasStart) {
        updateRequest.startDepotLat = location.startLocation!.lat!;
        updateRequest.startDepotLon = location.startLocation!.lon!;
      }

      if (hasEnd) {
        updateRequest.endDepotLat = location.endLocation!.lat!;
        updateRequest.endDepotLon = location.endLocation!.lon!;
      }

      const updated = await updateEmployeeLocation(employeeId, updateRequest);
      // Convert back to schedule dayOfWeek format
      const normalized = {
        ...updated,
        dayOfWeek: apiDayToScheduleDay(updated.dayOfWeek),
      };

      setEmployeeLocations((prev) => {
        const next = new Map(prev);
        const current = next.get(employeeId) || [];
        const index = current.findIndex((loc) => loc.dayOfWeek === dayOfWeek);
        const updatedList = [...current];
        if (index >= 0) {
          updatedList[index] = normalized;
        } else {
          updatedList.push(normalized);
        }
        next.set(employeeId, updatedList);
        return next;
      });
    } catch (err: any) {
      console.error(`Failed to save location for employee ${employeeId}, day ${dayOfWeek}`, err);
      alert(err?.response?.data?.message || err.message || 'Failed to save location');
    } finally {
      setSavingLocations((prev) => {
        const next = new Set(prev);
        next.delete(employeeId);
        return next;
      });
    }
  };

  const updateLocationDay = (
    employeeId: string | number,
    dayOfWeek: number,
    updates: Partial<EmployeeDayLocation>
  ) => {
    setEmployeeLocations((prev) => {
      const next = new Map(prev);
      const current = next.get(employeeId) || [];
      const dayIndex = current.findIndex((loc) => loc.dayOfWeek === dayOfWeek);
      const updated = [...current];

      if (dayIndex >= 0) {
        updated[dayIndex] = { ...updated[dayIndex], ...updates };
      } else {
        updated.push({
          dayOfWeek,
          validFrom: null,
          ...updates,
        });
      }

      next.set(employeeId, updated);
      return next;
    });
  };

  const updateScheduleDay = (
    employeeId: string | number,
    dayOfWeek: number,
    updates: Partial<WeeklySchedule>
  ) => {
    setEmployeeSchedules((prev) => {
      const next = new Map(prev);
      const current = next.get(employeeId) || [];
      const dayIndex = current.findIndex((s) => s.dayOfWeek === dayOfWeek);
      const updated = [...current];

      if (dayIndex >= 0) {
        updated[dayIndex] = { ...updated[dayIndex], ...updates };
      } else {
        updated.push({
          dayOfWeek,
          isWorkday: false,
          workStartLocal: '09:00',
          workEndLocal: '17:00',
          ...updates,
        });
      }

      next.set(employeeId, updated);
      return next;
    });
  };

  const reminders = settings.reminders || {};
  const appointmentReminders = reminders.appointmentReminders || {};

  return (
    <div className="container" style={{ maxWidth: 1200, margin: '30px auto' }}>
      <h1 style={{ marginTop: 0 }}>Settings</h1>

      {/* General Settings */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            padding: '8px 0',
          }}
          onClick={() => setGeneralSettingsExpanded(!generalSettingsExpanded)}
        >
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>General Settings</h2>
          <span style={{ fontSize: '1.2rem', color: 'var(--muted)', userSelect: 'none' }}>
            {generalSettingsExpanded ? '▼' : '▶'}
          </span>
        </div>
        {generalSettingsExpanded && (
          <>
            {settingsLoading ? (
          <p className="muted">Loading settings...</p>
        ) : (
          <form onSubmit={handleSaveSettings} className="grid" style={{ gap: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>Reminders</h3>
            </div>

            {/* Appointment Reminders Toggle */}
            <Field label="Appointment Reminders Enabled">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={reminders.appointmentRemindersEnabled ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        appointmentRemindersEnabled: e.target.checked,
                      },
                    })
                  }
                />
                <span>Enable appointment reminders</span>
              </label>
            </Field>

            {/* Service Reminders Toggle */}
            <Field label="Service Reminders Enabled">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={reminders.serviceRemindersEnabled ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        serviceRemindersEnabled: e.target.checked,
                      },
                    })
                  }
                />
                <span>Enable service reminders</span>
              </label>
            </Field>

            {/* Appointment Reminder Channels */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 style={{ marginTop: 0, marginBottom: 12 }}>Appointment Reminder Channels</h4>
            </div>

            <Field label="Email Enabled">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={appointmentReminders.emailEnabled ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        appointmentReminders: {
                          ...appointmentReminders,
                          emailEnabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                <span>Enable email reminders</span>
              </label>
            </Field>

            <Field label="SMS Enabled">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={appointmentReminders.smsEnabled ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        appointmentReminders: {
                          ...appointmentReminders,
                          smsEnabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                <span>Enable SMS reminders</span>
              </label>
            </Field>

            {/* Email Cadences */}
            {appointmentReminders.emailEnabled && (
              <Field label="Email Reminder Cadences (hours before appointment)">
                <input
                  className="input"
                  type="text"
                  placeholder="30, 15, 1"
                  value={appointmentReminders.email?.join(', ') || ''}
                  onChange={(e) => {
                    const values = e.target.value
                      .split(',')
                      .map((v) => parseInt(v.trim(), 10))
                      .filter((v) => !isNaN(v));
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        appointmentReminders: {
                          ...appointmentReminders,
                          email: values,
                        },
                      },
                    });
                  }}
                />
                <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                  Comma-separated hours (e.g., 30, 15, 1)
                </small>
              </Field>
            )}

            {/* SMS Cadences */}
            {appointmentReminders.smsEnabled && (
              <Field label="SMS Reminder Cadences (hours before appointment)">
                <input
                  className="input"
                  type="text"
                  placeholder="15, 1"
                  value={appointmentReminders.sms?.join(', ') || ''}
                  onChange={(e) => {
                    const values = e.target.value
                      .split(',')
                      .map((v) => parseInt(v.trim(), 10))
                      .filter((v) => !isNaN(v));
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        appointmentReminders: {
                          ...appointmentReminders,
                          sms: values,
                        },
                      },
                    });
                  }}
                />
                <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                  Comma-separated hours (e.g., 15, 1)
                </small>
              </Field>
            )}

            {/* Service Reminder Channels */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 style={{ marginTop: 0, marginBottom: 12 }}>Service Reminder Channels</h4>
            </div>

            <Field label="Email Enabled">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={reminders.serviceReminders?.emailEnabled ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        serviceReminders: {
                          ...reminders.serviceReminders,
                          emailEnabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                <span>Enable email reminders</span>
              </label>
            </Field>

            <Field label="SMS Enabled">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={reminders.serviceReminders?.smsEnabled ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminders: {
                        ...reminders,
                        serviceReminders: {
                          ...reminders.serviceReminders,
                          smsEnabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                <span>Enable SMS reminders</span>
              </label>
            </Field>

            {settingsError && <div className="danger" style={{ gridColumn: '1 / -1' }}>{settingsError}</div>}
            {settingsMsg && <div className="pill" style={{ gridColumn: '1 / -1' }}>{settingsMsg}</div>}

            <button className="btn" type="submit" disabled={settingsSaving} style={{ gridColumn: '1 / -1' }}>
              {settingsSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </form>
            )}
          </>
        )}
      </div>

      {/* Employee Schedules */}
      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            padding: '8px 0',
          }}
          onClick={() => setEmployeeSchedulesExpanded(!employeeSchedulesExpanded)}
        >
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Employee Schedules</h2>
          <span style={{ fontSize: '1.2rem', color: 'var(--muted)', userSelect: 'none' }}>
            {employeeSchedulesExpanded ? '▼' : '▶'}
          </span>
        </div>
        {employeeSchedulesExpanded && (
          <>
            {employeesLoading ? (
          <p className="muted">Loading employees...</p>
        ) : employeesError ? (
          <div>
            <div className="danger">{employeesError}</div>
            <p className="muted" style={{ marginTop: 8 }}>
              Please check that the employees API endpoint is configured correctly.
            </p>
          </div>
        ) : employees.length === 0 ? (
          <p className="muted">No employees found</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Employee</th>
                  <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Email</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600, width: 100 }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const isExpanded = expandedEmployees.has(emp.id);
                  const schedules = employeeSchedules.get(emp.id) || [];
                  const locations = employeeLocations.get(emp.id) || [];
                  const isSaving = savingSchedules.has(emp.id);
                  const isSavingLocation = savingLocations.has(emp.id);

                  return (
                    <React.Fragment key={emp.id}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px' }}>{emp.name}</td>
                        <td style={{ padding: '12px' }}>{emp.email || '-'}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => toggleEmployeeExpanded(emp.id)}
                            style={{ fontSize: '0.875rem', padding: '6px 12px' }}
                          >
                            {isExpanded ? 'Hide' : 'Edit Schedule'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={3} style={{ padding: '24px', backgroundColor: 'var(--bg)' }}>
                            <div style={{ maxWidth: 800 }}>
                              <h4 style={{ marginTop: 0, marginBottom: 16 }}>Weekly Schedule</h4>
                              <div className="grid" style={{ gap: 12 }}>
                                {DAYS_OF_WEEK.map((day) => {
                                  const schedule = schedules.find((s) => s.dayOfWeek === day.value);
                                  const isWorkday = schedule?.isWorkday ?? false;
                                  const workStart = schedule?.workStartLocal || '09:00';
                                  const workEnd = schedule?.workEndLocal || '17:00';

                                  return (
                                    <div
                                      key={day.value}
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: '200px 1fr 1fr 1fr',
                                        gap: 12,
                                        alignItems: 'center',
                                        padding: '12px',
                                        backgroundColor: 'var(--surface)',
                                        borderRadius: 4,
                                      }}
                                    >
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input
                                          type="checkbox"
                                          checked={isWorkday}
                                          onChange={(e) =>
                                            updateScheduleDay(emp.id, day.value, {
                                              isWorkday: e.target.checked,
                                            })
                                          }
                                        />
                                        <strong>{day.label}</strong>
                                      </label>
                                      {isWorkday ? (
                                        <>
                                          <Field label="Start Time">
                                            <input
                                              className="input"
                                              type="time"
                                              value={workStart}
                                              onChange={(e) =>
                                                updateScheduleDay(emp.id, day.value, {
                                                  isWorkday: true,
                                                  workStartLocal: e.target.value,
                                                  workEndLocal: workEnd,
                                                })
                                              }
                                            />
                                          </Field>
                                          <Field label="End Time">
                                            <input
                                              className="input"
                                              type="time"
                                              value={workEnd}
                                              onChange={(e) =>
                                                updateScheduleDay(emp.id, day.value, {
                                                  isWorkday: true,
                                                  workStartLocal: workStart,
                                                  workEndLocal: e.target.value,
                                                })
                                              }
                                            />
                                          </Field>
                                          <div />
                                        </>
                                      ) : (
                                        <div style={{ gridColumn: '2 / -1', color: 'var(--muted)' }}>
                                          Not a workday
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div style={{ marginTop: 16 }}>
                                <button
                                  className="btn"
                                  type="button"
                                  onClick={() => handleSaveEmployeeSchedule(emp.id)}
                                  disabled={isSaving}
                                >
                                  {isSaving ? 'Saving...' : 'Save Schedule'}
                                </button>
                              </div>

                              {/* Depot Locations */}
                              <div style={{ marginTop: 32, borderTop: '2px solid var(--border)', paddingTop: 24 }}>
                                <h4 style={{ marginTop: 0, marginBottom: 16 }}>Depot Locations</h4>
                                <p className="muted" style={{ marginBottom: 16, fontSize: '0.875rem' }}>
                                  Set start and end depot locations for each day. Coordinates will be reverse geocoded to addresses.
                                </p>
                                <div className="grid" style={{ gap: 16 }}>
                                  {DAYS_OF_WEEK.map((day) => {
                                    const location = locations.find((loc) => loc.dayOfWeek === day.value);
                                    const startLat = location?.startLocation?.lat;
                                    const startLon = location?.startLocation?.lon;
                                    const endLat = location?.endLocation?.lat;
                                    const endLon = location?.endLocation?.lon;
                                    const startAddress = location?.startLocation?.address;
                                    const endAddress = location?.endLocation?.address;

                                    return (
                                      <div
                                        key={day.value}
                                        style={{
                                          padding: '16px',
                                          backgroundColor: 'var(--surface)',
                                          borderRadius: 4,
                                          border: '1px solid var(--border)',
                                        }}
                                      >
                                        <h5 style={{ marginTop: 0, marginBottom: 12 }}>{day.label}</h5>
                                        <div className="grid" style={{ gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                                          {/* Start Depot */}
                                          <div>
                                            <Field label="Start Depot">
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                  <input
                                                    className="input"
                                                    type="number"
                                                    step="any"
                                                    placeholder="Latitude"
                                                    value={startLat ?? ''}
                                                    onChange={(e) => {
                                                      const lat = e.target.value ? parseFloat(e.target.value) : undefined;
                                                      updateLocationDay(emp.id, day.value, {
                                                        startLocation: {
                                                          ...location?.startLocation,
                                                          lat: lat,
                                                          lon: startLon,
                                                        },
                                                      });
                                                    }}
                                                  />
                                                  <input
                                                    className="input"
                                                    type="number"
                                                    step="any"
                                                    placeholder="Longitude"
                                                    value={startLon ?? ''}
                                                    onChange={(e) => {
                                                      const lon = e.target.value ? parseFloat(e.target.value) : undefined;
                                                      updateLocationDay(emp.id, day.value, {
                                                        startLocation: {
                                                          ...location?.startLocation,
                                                          lat: startLat,
                                                          lon: lon,
                                                        },
                                                      });
                                                    }}
                                                  />
                                                </div>
                                                {startAddress && (
                                                  <small className="muted" style={{ fontSize: '0.75rem' }}>
                                                    {startAddress}
                                                  </small>
                                                )}
                                              </div>
                                            </Field>
                                          </div>

                                          {/* End Depot */}
                                          <div>
                                            <Field label="End Depot">
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                  <input
                                                    className="input"
                                                    type="number"
                                                    step="any"
                                                    placeholder="Latitude"
                                                    value={endLat ?? ''}
                                                    onChange={(e) => {
                                                      const lat = e.target.value ? parseFloat(e.target.value) : undefined;
                                                      updateLocationDay(emp.id, day.value, {
                                                        endLocation: {
                                                          ...location?.endLocation,
                                                          lat: lat,
                                                          lon: endLon,
                                                        },
                                                      });
                                                    }}
                                                  />
                                                  <input
                                                    className="input"
                                                    type="number"
                                                    step="any"
                                                    placeholder="Longitude"
                                                    value={endLon ?? ''}
                                                    onChange={(e) => {
                                                      const lon = e.target.value ? parseFloat(e.target.value) : undefined;
                                                      updateLocationDay(emp.id, day.value, {
                                                        endLocation: {
                                                          ...location?.endLocation,
                                                          lat: endLat,
                                                          lon: lon,
                                                        },
                                                      });
                                                    }}
                                                  />
                                                </div>
                                                {endAddress && (
                                                  <small className="muted" style={{ fontSize: '0.75rem' }}>
                                                    {endAddress}
                                                  </small>
                                                )}
                                              </div>
                                            </Field>
                                          </div>
                                        </div>
                                        <div style={{ marginTop: 8 }}>
                                          <button
                                            className="btn secondary"
                                            type="button"
                                            onClick={() => handleSaveEmployeeLocations(emp.id, day.value)}
                                            disabled={isSavingLocation}
                                            style={{ fontSize: '0.875rem', padding: '6px 12px' }}
                                          >
                                            {isSavingLocation ? 'Saving...' : 'Save Locations'}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

