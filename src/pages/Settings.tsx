// src/pages/Settings.tsx
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  fetchAllAppointmentTypes,
  fetchAllEmployees,
  fetchAllZones,
  fetchEmployee,
  updateEmployeeAppointmentTypes,
  updateEmployeeScheduleZones,
  updateAppointmentType,
  updateWeeklySchedule,
  type AppointmentType,
  type Employee,
  type EmployeeWeeklySchedule,
  type Zone,
} from '../api/appointmentSettings';
import './Settings.css';

// Helper function to format employee name with title and designation
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
  const [allZones, setAllZones] = useState<Zone[]>([]);
  const [selectedEmployeeForZones, setSelectedEmployeeForZones] = useState<Employee | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<EmployeeWeeklySchedule | null>(null);
  const [zoneUpdates, setZoneUpdates] = useState<Array<{ zoneId: number; isAssigned: boolean; acceptingNewPatients: boolean }>>([]);

  // Employee Schedule state
  const [selectedEmployeeForSchedule, setSelectedEmployeeForSchedule] = useState<Employee | null>(null);
  // Use composite key: `${employeeId}-${dayOfWeek}` since schedules might not have ids
  const [scheduleUpdates, setScheduleUpdates] = useState<Map<string, Partial<EmployeeWeeklySchedule>>>(new Map());

  // Normalize roles
  const roles = Array.isArray(role) ? role : role ? [String(role)] : [];
  const isAdmin = roles.some((r) => ['admin', 'superadmin'].includes(String(r).toLowerCase()));

  // Sort employees: providers first, then by name
  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      // First, sort by isProvider (providers first)
      const aIsProvider = a.isProvider === true ? 0 : 1;
      const bIsProvider = b.isProvider === true ? 0 : 1;
      if (aIsProvider !== bIsProvider) {
        return aIsProvider - bIsProvider;
      }
      // Then sort alphabetically by formatted name
      return formatEmployeeName(a).localeCompare(formatEmployeeName(b));
    });
  }, [employees]);

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
  }, [isAdmin]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [types, emps, zones] = await Promise.all([
        fetchAllAppointmentTypes(),
        fetchAllEmployees(),
        fetchAllZones(),
      ]);
      setAppointmentTypes(types);
      setEmployees(emps);
      setAllZones(zones);
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
        
        // Create a map of employee's current zones
        const employeeZonesMap = new Map<number, boolean>();
        if (firstSchedule.zones) {
          firstSchedule.zones.forEach((z) => {
            employeeZonesMap.set(z.zoneId, z.acceptingNewPatients);
          });
        }
        
        // Merge all zones with employee's zones
        // isAssigned: true if employee has this zone, false otherwise
        // acceptingNewPatients: employee's setting if assigned, false otherwise
        const allZoneUpdates = allZones.map((zone) => {
          const isAssigned = employeeZonesMap.has(zone.id);
          return {
            zoneId: zone.id,
            isAssigned,
            acceptingNewPatients: isAssigned ? (employeeZonesMap.get(zone.id) ?? false) : false,
          };
        });
        
        setZoneUpdates(allZoneUpdates);
      } else {
        // No schedules - show all zones as unassigned
        const allZoneUpdates = allZones.map((zone) => ({
          zoneId: zone.id,
          isAssigned: false,
          acceptingNewPatients: false,
        }));
        setSelectedSchedule(null);
        setZoneUpdates(allZoneUpdates);
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
      // Store the dayOfWeek of the currently selected schedule to preserve it after reload
      const savedDayOfWeek = selectedSchedule.dayOfWeek;
      
      // Only send zones that are assigned (isAssigned: true)
      // This allows adding new zones and removing existing ones
      const zonesToSave = zoneUpdates
        .filter((z) => z.isAssigned)
        .map((z) => ({
          zoneId: z.zoneId,
          acceptingNewPatients: z.acceptingNewPatients,
        }));
      await updateEmployeeScheduleZones(selectedSchedule.id, zonesToSave);
      setSuccess('Employee zones updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      
      // Reload employee data and preserve the selected schedule day
      setLoading(true);
      try {
        const employee = await fetchEmployee(selectedEmployeeForZones.id);
        setSelectedEmployeeForZones(employee);
        if (employee.weeklySchedules && employee.weeklySchedules.length > 0) {
          // Find the schedule with the same dayOfWeek that was just saved
          const scheduleToSelect = employee.weeklySchedules.find((s) => s.dayOfWeek === savedDayOfWeek) 
            || employee.weeklySchedules.find((s) => s.isWorkday) 
            || employee.weeklySchedules[0];
          setSelectedSchedule(scheduleToSelect);
          
          // Create a map of employee's current zones for the selected schedule
          const employeeZonesMap = new Map<number, boolean>();
          if (scheduleToSelect.zones) {
            scheduleToSelect.zones.forEach((z) => {
              employeeZonesMap.set(z.zoneId, z.acceptingNewPatients);
            });
          }
          
          // Merge all zones with employee's zones
          const allZoneUpdates = allZones.map((zone) => {
            const isAssigned = employeeZonesMap.has(zone.id);
            return {
              zoneId: zone.id,
              isAssigned,
              acceptingNewPatients: isAssigned ? (employeeZonesMap.get(zone.id) ?? false) : false,
            };
          });
          
          setZoneUpdates(allZoneUpdates);
        } else {
          setSelectedSchedule(null);
          const allZoneUpdates = allZones.map((zone) => ({
            zoneId: zone.id,
            isAssigned: false,
            acceptingNewPatients: false,
          }));
          setZoneUpdates(allZoneUpdates);
        }
      } catch (err: any) {
        setError(err?.response?.data?.message || err?.message || 'Failed to reload employee');
      } finally {
        setLoading(false);
      }
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
          // Convert null values to undefined and filter them out to match API expectations
          const cleanedUpdates: {
            isWorkday?: boolean;
            workStartLocal?: string;
            workEndLocal?: string;
            startDepotLat?: number;
            startDepotLon?: number;
            endDepotLat?: number;
            endDepotLon?: number;
          } = {};
          
          if (updates.isWorkday !== undefined) cleanedUpdates.isWorkday = updates.isWorkday;
          if (updates.workStartLocal !== undefined && updates.workStartLocal !== null) cleanedUpdates.workStartLocal = updates.workStartLocal;
          if (updates.workEndLocal !== undefined && updates.workEndLocal !== null) cleanedUpdates.workEndLocal = updates.workEndLocal;
          if (updates.startDepotLat !== undefined && updates.startDepotLat !== null) cleanedUpdates.startDepotLat = updates.startDepotLat;
          if (updates.startDepotLon !== undefined && updates.startDepotLon !== null) cleanedUpdates.startDepotLon = updates.startDepotLon;
          if (updates.endDepotLat !== undefined && updates.endDepotLat !== null) cleanedUpdates.endDepotLat = updates.endDepotLat;
          if (updates.endDepotLon !== undefined && updates.endDepotLon !== null) cleanedUpdates.endDepotLon = updates.endDepotLon;
          
          if (Object.keys(cleanedUpdates).length > 0) {
            updatePromises.push(updateWeeklySchedule(schedule.id, cleanedUpdates));
          }
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

  const toggleZoneAssignment = (zoneId: number, isAssigned: boolean) => {
    setZoneUpdates((prev) => {
      const existing = prev.find((z) => z.zoneId === zoneId);
      if (existing) {
        return prev.map((z) => 
          z.zoneId === zoneId 
            ? { ...z, isAssigned, acceptingNewPatients: isAssigned ? z.acceptingNewPatients : false }
            : z
        );
      } else {
        return [...prev, { zoneId, isAssigned, acceptingNewPatients: false }];
      }
    });
  };

  const updateZoneAcceptingNewPatients = (zoneId: number, accepting: boolean) => {
    setZoneUpdates((prev) => {
      const existing = prev.find((z) => z.zoneId === zoneId);
      if (existing) {
        return prev.map((z) => (z.zoneId === zoneId ? { ...z, acceptingNewPatients: accepting } : z));
      } else {
        return [...prev, { zoneId, isAssigned: true, acceptingNewPatients: accepting }];
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
              Configure which appointment types each employee can see and handle.
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
                {sortedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {formatEmployeeName(emp)}
                  </option>
                ))}
              </select>
            </div>

            {selectedEmployee && (
              <div className="settings-card">
                <h3 className="settings-card-title">
                  {formatEmployeeName(selectedEmployee)}
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
                {sortedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {formatEmployeeName(emp)}
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
                          
                          // Create a map of employee's current zones for this schedule
                          const employeeZonesMap = new Map<number, boolean>();
                          if (schedule.zones) {
                            schedule.zones.forEach((z) => {
                              employeeZonesMap.set(z.zoneId, z.acceptingNewPatients);
                            });
                          }
                          
                          // Merge all zones with employee's zones
                          // isAssigned: true if employee has this zone, false otherwise
                          // acceptingNewPatients: employee's setting if assigned, false otherwise
                          const allZoneUpdates = allZones.map((zone) => {
                            const isAssigned = employeeZonesMap.has(zone.id);
                            return {
                              zoneId: zone.id,
                              isAssigned,
                              acceptingNewPatients: isAssigned ? (employeeZonesMap.get(zone.id) ?? false) : false,
                            };
                          });
                          
                          setZoneUpdates(allZoneUpdates);
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
                      {formatEmployeeName(selectedEmployeeForZones)} -{' '}
                      {dayNames[selectedSchedule.dayOfWeek]}
                    </h3>
                    <p className="settings-card-subtitle">Configure zones and new patient acceptance:</p>

                    {zoneUpdates.length > 0 ? (
                      <div className="settings-zone-list">
                        {zoneUpdates.map((zoneUpdate) => {
                          const zone = allZones.find((z) => z.id === zoneUpdate.zoneId);
                          return (
                            <div key={zoneUpdate.zoneId} className="settings-zone-item">
                              <div className="settings-zone-info">
                                <strong>Zone {zoneUpdate.zoneId}</strong>
                                {zone?.name && <span className="settings-muted"> - {zone.name}</span>}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label className="settings-checkbox-item">
                                  <input
                                    type="checkbox"
                                    checked={zoneUpdate.isAssigned}
                                    onChange={(e) =>
                                      toggleZoneAssignment(zoneUpdate.zoneId, e.target.checked)
                                    }
                                  />
                                  <span>Assign Zone</span>
                                </label>
                                <label className="settings-checkbox-item" style={{ opacity: zoneUpdate.isAssigned ? 1 : 0.5 }}>
                                  <input
                                    type="checkbox"
                                    checked={zoneUpdate.acceptingNewPatients}
                                    disabled={!zoneUpdate.isAssigned}
                                    onChange={(e) =>
                                      updateZoneAcceptingNewPatients(zoneUpdate.zoneId, e.target.checked)
                                    }
                                  />
                                  <span>Accepting New Patients</span>
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="settings-muted">No zones available.</p>
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

                {!selectedSchedule && selectedEmployeeForZones.weeklySchedules?.length === 0 && (
                  <div className="settings-card">
                    <h3 className="settings-card-title">
                      {formatEmployeeName(selectedEmployeeForZones)}
                    </h3>
                    <p className="settings-card-subtitle">Configure zones and new patient acceptance:</p>
                    <div className="settings-message settings-info-message" style={{ marginBottom: '16px' }}>
                      This employee has no weekly schedules configured. Please create a schedule first in the Employee Schedule tab.
                    </div>
                    {zoneUpdates.length > 0 ? (
                      <div className="settings-zone-list">
                        {zoneUpdates.map((zoneUpdate) => {
                          const zone = allZones.find((z) => z.id === zoneUpdate.zoneId);
                          return (
                            <div key={zoneUpdate.zoneId} className="settings-zone-item">
                              <div className="settings-zone-info">
                                <strong>Zone {zoneUpdate.zoneId}</strong>
                                {zone?.name && <span className="settings-muted"> - {zone.name}</span>}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label className="settings-checkbox-item" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                                  <input
                                    type="checkbox"
                                    checked={zoneUpdate.isAssigned}
                                    disabled={true}
                                  />
                                  <span>Assign Zone</span>
                                </label>
                                <label className="settings-checkbox-item" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                                  <input
                                    type="checkbox"
                                    checked={zoneUpdate.acceptingNewPatients}
                                    disabled={true}
                                  />
                                  <span>Accepting New Patients</span>
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="settings-muted">No zones available.</p>
                    )}
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
                {sortedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {formatEmployeeName(emp)}
                  </option>
                ))}
              </select>
            </div>

            {selectedEmployeeForSchedule && (
              <div className="settings-card">
                <h3 className="settings-card-title">
                  {formatEmployeeName(selectedEmployeeForSchedule)} - Weekly Schedule
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
                      // Convert null to empty string for input fields (React inputs don't accept null)
                      const workStartLocal = updates.workStartLocal !== undefined 
                        ? (updates.workStartLocal ?? '') 
                        : (schedule.workStartLocal ?? '');
                      const workEndLocal = updates.workEndLocal !== undefined 
                        ? (updates.workEndLocal ?? '') 
                        : (schedule.workEndLocal ?? '');
                      const startDepotLat = updates.startDepotLat !== undefined 
                        ? (updates.startDepotLat ?? '') 
                        : (schedule.startDepotLat ?? '');
                      const startDepotLon = updates.startDepotLon !== undefined 
                        ? (updates.startDepotLon ?? '') 
                        : (schedule.startDepotLon ?? '');
                      const endDepotLat = updates.endDepotLat !== undefined 
                        ? (updates.endDepotLat ?? '') 
                        : (schedule.endDepotLat ?? '');
                      const endDepotLon = updates.endDepotLon !== undefined 
                        ? (updates.endDepotLon ?? '') 
                        : (schedule.endDepotLon ?? '');

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

