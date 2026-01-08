// src/pages/Settings.tsx
import { useState, useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  fetchAllAppointmentTypes,
  fetchAllEmployees,
  fetchEmployee,
  updateEmployeeAppointmentTypes,
  updateEmployeeScheduleZones,
  updateAppointmentType,
  updateWeeklySchedule,
  type AppointmentType,
  type Employee,
  type EmployeeWeeklySchedule,
} from '../api/appointmentSettings';
import './Settings.css';

export default function Settings() {
  const { role } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<'appointment-types' | 'employee-types' | 'employee-zones' | 'employee-schedule'>('appointment-types');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Appointment Types state
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [editingAppointmentType, setEditingAppointmentType] = useState<AppointmentType | null>(null);

  // Employee Appointment Types state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedAppointmentTypeIds, setSelectedAppointmentTypeIds] = useState<number[]>([]);

  // Employee Zones state
  const [selectedEmployeeForZones, setSelectedEmployeeForZones] = useState<Employee | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<EmployeeWeeklySchedule | null>(null);
  const [zoneUpdates, setZoneUpdates] = useState<Array<{ zoneId: number; acceptingNewPatients: boolean }>>([]);

  // Employee Schedule state
  const [selectedEmployeeForSchedule, setSelectedEmployeeForSchedule] = useState<Employee | null>(null);
  // Use composite key: `${employeeId}-${dayOfWeek}` since schedules might not have ids
  const [scheduleUpdates, setScheduleUpdates] = useState<Map<string, Partial<EmployeeWeeklySchedule>>>(new Map());

  // Normalize roles
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const isAdmin = roles.some((r) => ['admin', 'superadmin'].includes(String(r).toLowerCase()));

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
  }, [isAdmin]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [types, emps] = await Promise.all([
        fetchAllAppointmentTypes(),
        fetchAllEmployees(),
      ]);
      setAppointmentTypes(types);
      setEmployees(emps);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadEmployee = async (employeeId: number) => {
    setLoading(true);
    setError(null);
    try {
      const employee = await fetchEmployee(employeeId);
      setSelectedEmployee(employee);
      setSelectedAppointmentTypeIds(
        employee.appointmentTypes && Array.isArray(employee.appointmentTypes)
          ? employee.appointmentTypes.map((at) => at.id)
          : []
      );
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load employee');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadEmployeeForZones = async (employeeId: number) => {
    setLoading(true);
    setError(null);
    try {
      const employee = await fetchEmployee(employeeId);
      setSelectedEmployeeForZones(employee);
      if (employee.weeklySchedules && employee.weeklySchedules.length > 0) {
        // Find first workday schedule, or first schedule if no workdays
        const firstSchedule = employee.weeklySchedules.find((s) => s.isWorkday) || employee.weeklySchedules[0];
        setSelectedSchedule(firstSchedule);
        if (firstSchedule.zones) {
          setZoneUpdates(
            firstSchedule.zones.map((z) => ({
              zoneId: z.zoneId,
              acceptingNewPatients: z.acceptingNewPatients,
            }))
          );
        } else {
          setZoneUpdates([]);
        }
      } else {
        setSelectedSchedule(null);
        setZoneUpdates([]);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load employee');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAppointmentType = async () => {
    if (!editingAppointmentType) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateAppointmentType(editingAppointmentType.id, {
        prettyName: editingAppointmentType.prettyName,
        showInApptRequestForm: editingAppointmentType.showInApptRequestForm,
        newPatientAllowed: editingAppointmentType.newPatientAllowed,
      });
      setAppointmentTypes((prev) =>
        prev.map((at) => (at.id === updated.id ? updated : at))
      );
      setEditingAppointmentType(null);
      setSuccess('Appointment type updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update appointment type');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmployeeAppointmentTypes = async () => {
    if (!selectedEmployee) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateEmployeeAppointmentTypes(selectedEmployee.id, selectedAppointmentTypeIds);
      setSuccess('Employee appointment types updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      // Reload employee data
      await handleLoadEmployee(selectedEmployee.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update employee appointment types');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadEmployeeForSchedule = async (employeeId: number) => {
    setLoading(true);
    setError(null);
    try {
      const employee = await fetchEmployee(employeeId);
      setSelectedEmployeeForSchedule(employee);
      // Initialize schedule updates map with current schedule data
      // Use composite key: `${employeeId}-${dayOfWeek}` since schedules might not have ids
      const updates = new Map<string, Partial<EmployeeWeeklySchedule>>();
      if (employee.weeklySchedules) {
        employee.weeklySchedules.forEach((schedule) => {
          const key = `${employeeId}-${schedule.dayOfWeek}`;
          updates.set(key, {
            isWorkday: schedule.isWorkday,
            workStartLocal: schedule.workStartLocal || undefined,
            workEndLocal: schedule.workEndLocal || undefined,
            startDepotLat: schedule.startDepotLat || undefined,
            startDepotLon: schedule.startDepotLon || undefined,
            endDepotLat: schedule.endDepotLat || undefined,
            endDepotLon: schedule.endDepotLon || undefined,
          });
        });
      }
      setScheduleUpdates(updates);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load employee');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEmployeeZones = async () => {
    if (!selectedSchedule || !selectedEmployeeForZones) return;
    if (selectedSchedule.id == null) {
      setError('Schedule ID is missing. Cannot update zones.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateEmployeeScheduleZones(selectedSchedule.id, zoneUpdates);
      setSuccess('Employee zones updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      // Reload employee data
      await handleLoadEmployeeForZones(selectedEmployeeForZones.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update employee zones');
    } finally {
      setSaving(false);
    }
  };

  const updateScheduleField = (employeeId: number, dayOfWeek: number, field: keyof EmployeeWeeklySchedule, value: any) => {
    setScheduleUpdates((prev) => {
      const newMap = new Map(prev);
      const key = `${employeeId}-${dayOfWeek}`;
      const current = newMap.get(key) || {};
      newMap.set(key, { ...current, [field]: value });
      return newMap;
    });
  };

  const handleSaveEmployeeSchedule = async () => {
    if (!selectedEmployeeForSchedule) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Update all schedules that have changes
      const updatePromises: Promise<any>[] = [];
      scheduleUpdates.forEach((updates, key) => {
        // Extract dayOfWeek from key (format: `${employeeId}-${dayOfWeek}`)
        const dayOfWeek = Number(key.split('-')[1]);
        const schedule = selectedEmployeeForSchedule.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
        
        // Only update if schedule exists and has an id (required for API)
        if (schedule && schedule.id != null && Object.keys(updates).length > 0) {
          updatePromises.push(updateWeeklySchedule(schedule.id, updates));
        } else if (schedule && schedule.id == null) {
          // Schedule exists but has no id - this is a problem
          console.warn(`Schedule for day ${dayOfWeek} has no id, cannot update`);
        }
      });

      if (updatePromises.length === 0) {
        setError('No valid schedules to update. Schedules may be missing IDs.');
        return;
      }

      await Promise.all(updatePromises);
      setSuccess('Employee schedule updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      // Reload employee data
      await handleLoadEmployeeForSchedule(selectedEmployeeForSchedule.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update employee schedule');
    } finally {
      setSaving(false);
    }
  };

  const toggleAppointmentTypeSelection = (typeId: number) => {
    setSelectedAppointmentTypeIds((prev) =>
      prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId]
    );
  };

  const updateZoneAcceptingNewPatients = (zoneId: number, accepting: boolean) => {
    setZoneUpdates((prev) => {
      const existing = prev.find((z) => z.zoneId === zoneId);
      if (existing) {
        return prev.map((z) => (z.zoneId === zoneId ? { ...z, acceptingNewPatients: accepting } : z));
      } else {
        return [...prev, { zoneId, acceptingNewPatients: accepting }];
      }
    });
  };

  if (!isAdmin) {
    return (
      <div className="container">
        <div className="settings-error">
          <h2>Access Denied</h2>
          <p>You need admin privileges to access settings.</p>
        </div>
      </div>
    );
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Settings</h1>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'appointment-types' ? 'active' : ''}`}
            onClick={() => setActiveTab('appointment-types')}
          >
            Appointment Types
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-types' ? 'active' : ''}`}
            onClick={() => setActiveTab('employee-types')}
          >
            Employee Appointment Types
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-zones' ? 'active' : ''}`}
            onClick={() => setActiveTab('employee-zones')}
          >
            Employee Zones
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('employee-schedule')}
          >
            Employee Schedule
          </button>
        </div>

        {error && (
          <div className="settings-message settings-error-message">
            {error}
            <button onClick={() => setError(null)} className="settings-close">×</button>
          </div>
        )}

        {success && (
          <div className="settings-message settings-success-message">
            {success}
            <button onClick={() => setSuccess(null)} className="settings-close">×</button>
          </div>
        )}

        {loading && (
          <div className="settings-loading">
            <div className="settings-spinner"></div>
            <span>Loading...</span>
          </div>
        )}

        {/* Appointment Types Tab */}
        {activeTab === 'appointment-types' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Appointment Form Settings</h2>
            <p className="settings-section-description">
              Configure which appointment types appear in the appointment request form and whether they allow new patients.
            </p>

            <div className="settings-table-container">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Pretty Name</th>
                    <th>Show in Form</th>
                    <th>New Patients Allowed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appointmentTypes.map((type) => (
                    <tr key={type.id}>
                      <td>{type.name}</td>
                      <td>
                        {editingAppointmentType?.id === type.id ? (
                          <input
                            type="text"
                            value={editingAppointmentType.prettyName}
                            onChange={(e) =>
                              setEditingAppointmentType({
                                ...editingAppointmentType,
                                prettyName: e.target.value,
                              })
                            }
                            className="settings-input"
                          />
                        ) : (
                          type.prettyName || type.name
                        )}
                      </td>
                      <td>
                        {editingAppointmentType?.id === type.id ? (
                          <input
                            type="checkbox"
                            checked={editingAppointmentType.showInApptRequestForm}
                            onChange={(e) =>
                              setEditingAppointmentType({
                                ...editingAppointmentType,
                                showInApptRequestForm: e.target.checked,
                              })
                            }
                          />
                        ) : (
                          type.showInApptRequestForm ? 'Yes' : 'No'
                        )}
                      </td>
                      <td>
                        {editingAppointmentType?.id === type.id ? (
                          <input
                            type="checkbox"
                            checked={editingAppointmentType.newPatientAllowed}
                            onChange={(e) =>
                              setEditingAppointmentType({
                                ...editingAppointmentType,
                                newPatientAllowed: e.target.checked,
                              })
                            }
                          />
                        ) : (
                          type.newPatientAllowed ? 'Yes' : 'No'
                        )}
                      </td>
                      <td>
                        {editingAppointmentType?.id === type.id ? (
                          <div className="settings-action-buttons">
                            <button
                              className="btn"
                              onClick={handleSaveAppointmentType}
                              disabled={saving}
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              className="btn secondary"
                              onClick={() => setEditingAppointmentType(null)}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn secondary"
                            onClick={() => setEditingAppointmentType(type)}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Employee Appointment Types Tab */}
        {activeTab === 'employee-types' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Appointment Types</h2>
            <p className="settings-section-description">
              Configure which appointment types each employee (doctor) can see and handle.
            </p>

            <div className="settings-form-group">
              <label className="settings-label">Select Employee</label>
              <select
                className="settings-select"
                value={selectedEmployee?.id || ''}
                onChange={(e) => {
                  const empId = Number(e.target.value);
                  if (empId) {
                    handleLoadEmployee(empId);
                  } else {
                    setSelectedEmployee(null);
                    setSelectedAppointmentTypeIds([]);
                  }
                }}
              >
                <option value="">-- Select an employee --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>

            {selectedEmployee && (
              <div className="settings-card">
                <h3 className="settings-card-title">
                  {selectedEmployee.firstName} {selectedEmployee.lastName}
                </h3>
                <p className="settings-card-subtitle">Select appointment types this employee can handle:</p>

                <div className="settings-checkbox-list">
                  {appointmentTypes.map((type) => (
                    <label key={type.id} className="settings-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedAppointmentTypeIds.includes(type.id)}
                        onChange={() => toggleAppointmentTypeSelection(type.id)}
                      />
                      <span>
                        {type.prettyName || type.name}
                        {!type.showInApptRequestForm && (
                          <span className="settings-muted"> (not shown in form)</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="settings-action-bar">
                  <button
                    className="btn"
                    onClick={handleSaveEmployeeAppointmentTypes}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Employee Zones Tab */}
        {activeTab === 'employee-zones' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Schedule Zones</h2>
            <p className="settings-section-description">
              Configure which zones each employee is available in and whether they accept new patients in each zone.
            </p>

            <div className="settings-form-group">
              <label className="settings-label">Select Employee</label>
              <select
                className="settings-select"
                value={selectedEmployeeForZones?.id || ''}
                onChange={(e) => {
                  const empId = Number(e.target.value);
                  if (empId) {
                    handleLoadEmployeeForZones(empId);
                  } else {
                    setSelectedEmployeeForZones(null);
                    setSelectedSchedule(null);
                    setZoneUpdates([]);
                  }
                }}
              >
                <option value="">-- Select an employee --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>

            {selectedEmployeeForZones && (
              <>
                {selectedEmployeeForZones.weeklySchedules && selectedEmployeeForZones.weeklySchedules.length > 0 && (
                  <div className="settings-form-group">
                    <label className="settings-label">Select Schedule</label>
                    <select
                      className="settings-select"
                      value={selectedSchedule ? `${selectedSchedule.dayOfWeek}` : ''}
                      onChange={(e) => {
                        const dayOfWeek = Number(e.target.value);
                        const schedule = selectedEmployeeForZones.weeklySchedules?.find(
                          (s) => s.dayOfWeek === dayOfWeek
                        );
                        if (schedule) {
                          setSelectedSchedule(schedule);
                          if (schedule.zones) {
                            setZoneUpdates(
                              schedule.zones.map((z) => ({
                                zoneId: z.zoneId,
                                acceptingNewPatients: z.acceptingNewPatients,
                              }))
                            );
                          } else {
                            setZoneUpdates([]);
                          }
                        }
                      }}
                    >
                      {selectedEmployeeForZones.weeklySchedules.map((schedule) => (
                        <option key={schedule.dayOfWeek} value={schedule.dayOfWeek}>
                          {dayNames[schedule.dayOfWeek]} {schedule.isWorkday ? '(Workday)' : '(Not a workday)'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedSchedule && (
                  <div className="settings-card">
                    <h3 className="settings-card-title">
                      {selectedEmployeeForZones.firstName} {selectedEmployeeForZones.lastName} -{' '}
                      {dayNames[selectedSchedule.dayOfWeek]}
                    </h3>
                    <p className="settings-card-subtitle">Configure zones and new patient acceptance:</p>

                    {selectedSchedule.zones && selectedSchedule.zones.length > 0 ? (
                      <div className="settings-zone-list">
                        {selectedSchedule.zones.map((zone) => {
                          const update = zoneUpdates.find((z) => z.zoneId === zone.zoneId);
                          const accepting = update?.acceptingNewPatients ?? zone.acceptingNewPatients;
                          return (
                            <div key={zone.zoneId} className="settings-zone-item">
                              <div className="settings-zone-info">
                                <strong>Zone {zone.zoneId}</strong>
                                {zone.zone?.name && <span className="settings-muted"> - {zone.zone.name}</span>}
                              </div>
                              <label className="settings-checkbox-item">
                                <input
                                  type="checkbox"
                                  checked={accepting}
                                  onChange={(e) =>
                                    updateZoneAcceptingNewPatients(zone.zoneId, e.target.checked)
                                  }
                                />
                                <span>Accepting New Patients</span>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="settings-muted">No zones configured for this schedule.</p>
                    )}

                    <div className="settings-action-bar">
                      <button
                        className="btn"
                        onClick={handleSaveEmployeeZones}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                )}

                {selectedEmployeeForZones.weeklySchedules?.length === 0 && (
                  <div className="settings-message settings-info-message">
                    This employee has no weekly schedules configured.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Employee Schedule Tab */}
        {activeTab === 'employee-schedule' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Schedule</h2>
            <p className="settings-section-description">
              Configure work hours, workdays, and depot locations for each day of the week.
            </p>

            <div className="settings-form-group">
              <label className="settings-label">Select Employee</label>
              <select
                className="settings-select"
                value={selectedEmployeeForSchedule?.id || ''}
                onChange={(e) => {
                  const empId = Number(e.target.value);
                  if (empId) {
                    handleLoadEmployeeForSchedule(empId);
                  } else {
                    setSelectedEmployeeForSchedule(null);
                    setScheduleUpdates(new Map());
                  }
                }}
              >
                <option value="">-- Select an employee --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>

            {selectedEmployeeForSchedule && (
              <div className="settings-card">
                <h3 className="settings-card-title">
                  {selectedEmployeeForSchedule.firstName} {selectedEmployeeForSchedule.lastName} - Weekly Schedule
                </h3>

                {selectedEmployeeForSchedule.weeklySchedules && selectedEmployeeForSchedule.weeklySchedules.length > 0 ? (
                  <div className="settings-schedule-list">
                    {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
                      const schedule = selectedEmployeeForSchedule.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
                      if (!schedule) {
                        return (
                          <div key={dayOfWeek} className="settings-schedule-item">
                            <div className="settings-schedule-header">
                              <strong>{dayNames[dayOfWeek]}</strong>
                              <span className="settings-muted">No schedule configured</span>
                            </div>
                          </div>
                        );
                      }

                      // Use composite key for updates map
                      const key = `${selectedEmployeeForSchedule.id}-${dayOfWeek}`;
                      const updates = scheduleUpdates.get(key) || {};
                      const isWorkday = updates.isWorkday !== undefined ? updates.isWorkday : schedule.isWorkday;
                      const workStartLocal = updates.workStartLocal !== undefined ? updates.workStartLocal : (schedule.workStartLocal || '');
                      const workEndLocal = updates.workEndLocal !== undefined ? updates.workEndLocal : (schedule.workEndLocal || '');
                      const startDepotLat = updates.startDepotLat !== undefined ? updates.startDepotLat : (schedule.startDepotLat || '');
                      const startDepotLon = updates.startDepotLon !== undefined ? updates.startDepotLon : (schedule.startDepotLon || '');
                      const endDepotLat = updates.endDepotLat !== undefined ? updates.endDepotLat : (schedule.endDepotLat || '');
                      const endDepotLon = updates.endDepotLon !== undefined ? updates.endDepotLon : (schedule.endDepotLon || '');

                      return (
                        <div key={dayOfWeek} className="settings-schedule-item">
                          <div className="settings-schedule-header">
                            <strong>{dayNames[dayOfWeek]}</strong>
                            <label className="settings-checkbox-item" style={{ margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={isWorkday}
                                onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'isWorkday', e.target.checked)}
                              />
                              <span>Workday</span>
                            </label>
                          </div>

                          {isWorkday && (
                            <div className="settings-schedule-fields">
                              <div className="settings-schedule-row">
                                <div className="settings-schedule-field">
                                  <label className="settings-label">Start Time</label>
                                  <input
                                    type="time"
                                    className="settings-input"
                                    value={workStartLocal}
                                    onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'workStartLocal', e.target.value)}
                                    placeholder="HH:mm"
                                  />
                                </div>
                                <div className="settings-schedule-field">
                                  <label className="settings-label">End Time</label>
                                  <input
                                    type="time"
                                    className="settings-input"
                                    value={workEndLocal}
                                    onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'workEndLocal', e.target.value)}
                                    placeholder="HH:mm"
                                  />
                                </div>
                              </div>

                              <div className="settings-schedule-section">
                                <h4 className="settings-schedule-subtitle">Start Depot Location</h4>
                                <div className="settings-schedule-row">
                                  <div className="settings-schedule-field">
                                    <label className="settings-label">Latitude</label>
                                    <input
                                      type="number"
                                      className="settings-input"
                                      value={startDepotLat}
                                      onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'startDepotLat', e.target.value ? parseFloat(e.target.value) : undefined)}
                                      placeholder="43.90065"
                                      step="any"
                                    />
                                  </div>
                                  <div className="settings-schedule-field">
                                    <label className="settings-label">Longitude</label>
                                    <input
                                      type="number"
                                      className="settings-input"
                                      value={startDepotLon}
                                      onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'startDepotLon', e.target.value ? parseFloat(e.target.value) : undefined)}
                                      placeholder="-70.058646"
                                      step="any"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="settings-schedule-section">
                                <h4 className="settings-schedule-subtitle">End Depot Location</h4>
                                <div className="settings-schedule-row">
                                  <div className="settings-schedule-field">
                                    <label className="settings-label">Latitude</label>
                                    <input
                                      type="number"
                                      className="settings-input"
                                      value={endDepotLat}
                                      onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'endDepotLat', e.target.value ? parseFloat(e.target.value) : undefined)}
                                      placeholder="43.90065"
                                      step="any"
                                    />
                                  </div>
                                  <div className="settings-schedule-field">
                                    <label className="settings-label">Longitude</label>
                                    <input
                                      type="number"
                                      className="settings-input"
                                      value={endDepotLon}
                                      onChange={(e) => updateScheduleField(selectedEmployeeForSchedule.id, dayOfWeek, 'endDepotLon', e.target.value ? parseFloat(e.target.value) : undefined)}
                                      placeholder="-70.058646"
                                      step="any"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {schedule.id == null && (
                            <div className="settings-message settings-info-message" style={{ marginTop: '12px' }}>
                              Note: This schedule does not have an ID. Updates may not be saved.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="settings-muted">No weekly schedules configured for this employee.</p>
                )}

                <div className="settings-action-bar">
                  <button
                    className="btn"
                    onClick={handleSaveEmployeeSchedule}
                    disabled={saving || scheduleUpdates.size === 0}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

