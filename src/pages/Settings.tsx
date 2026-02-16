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
  uploadEmployeeImage,
  fetchScheduleOverrides,
  fetchScheduleOverrideByDate,
  createScheduleOverride,
  updateScheduleOverride,
  deleteScheduleOverride,
  type AppointmentType,
  type Employee,
  type EmployeeWeeklySchedule,
  type ScheduleOverride,
  type Zone,
} from '../api/appointmentSettings';
import dayjs from 'dayjs';
import { apiBaseUrl } from '../api/http';
import './Settings.css';

/** Placeholder when GET /employees/:id/image returns 404 or fails */
const EMPLOYEE_IMAGE_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#e4efe9"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#4b7c6a" font-size="11">No photo</text></svg>'
  );

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
  const [activeTab, setActiveTab] = useState<'appointment-types' | 'employee-types' | 'employee-zones' | 'employee-schedule' | 'employee-images'>('appointment-types');
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

  // Schedule overrides calendar (per-date overrides for routing)
  const [showOverrideCalendar, setShowOverrideCalendar] = useState(false);
  const [overrideCalendarEmployeeId, setOverrideCalendarEmployeeId] = useState<number | null>(null);
  const [overrideCalendarMonth, setOverrideCalendarMonth] = useState(() => dayjs().startOf('month'));
  const [overridesInRange, setOverridesInRange] = useState<ScheduleOverride[]>([]);
  const [selectedOverrideDate, setSelectedOverrideDate] = useState<string | null>(null);
  const [overrideForm, setOverrideForm] = useState<ScheduleOverride | Partial<ScheduleOverride> & { date: string } | null>(null);
  const [overrideFormLoading, setOverrideFormLoading] = useState(false);
  const [overrideFormSaving, setOverrideFormSaving] = useState(false);

  // Employee Images state
  const [uploadingEmployeeId, setUploadingEmployeeId] = useState<number | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  /** Bump per employee after upload so img src changes and browser reloads the image */
  const [employeeImageVersion, setEmployeeImageVersion] = useState<Record<number, number>>({});

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

  // Sort appointment types: first by showInApptRequestForm (true first), then by formListOrder
  const sortedAppointmentTypes = useMemo(() => {
    return [...appointmentTypes].sort((a, b) => {
      // First, sort by showInApptRequestForm (true first)
      const aShowInForm = a.showInApptRequestForm === true ? 0 : 1;
      const bShowInForm = b.showInApptRequestForm === true ? 0 : 1;
      if (aShowInForm !== bShowInForm) {
        return aShowInForm - bShowInForm;
      }
      // Then sort by formListOrder (ascending, null values at the end)
      const aOrder = a.formListOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.formListOrder ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  }, [appointmentTypes]);

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
        formListOrder: editingAppointmentType.formListOrder ?? null,
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

  // Load overrides for the calendar month when modal is open and employee/month change
  useEffect(() => {
    if (!showOverrideCalendar || !overrideCalendarEmployeeId) {
      setOverridesInRange([]);
      return;
    }
    const start = overrideCalendarMonth.format('YYYY-MM-DD');
    const end = overrideCalendarMonth.endOf('month').format('YYYY-MM-DD');
    fetchScheduleOverrides(overrideCalendarEmployeeId, { startDate: start, endDate: end })
      .then(setOverridesInRange)
      .catch(() => setOverridesInRange([]));
  }, [showOverrideCalendar, overrideCalendarEmployeeId, overrideCalendarMonth]);

  const handleOpenOverrideCalendar = () => {
    setOverrideCalendarEmployeeId(selectedEmployeeForSchedule?.id ?? sortedEmployees.find((e) => e.isProvider)?.id ?? null);
    setOverrideCalendarMonth(dayjs().startOf('month'));
    setSelectedOverrideDate(null);
    setOverrideForm(null);
    setShowOverrideCalendar(true);
  };

  const handleOverrideDayClick = async (dateStr: string) => {
    if (!overrideCalendarEmployeeId) return;
    setSelectedOverrideDate(dateStr);
    setOverrideFormLoading(true);
    setOverrideForm(null);
    try {
      const [existing, employee] = await Promise.all([
        fetchScheduleOverrideByDate(overrideCalendarEmployeeId, dateStr),
        fetchEmployee(overrideCalendarEmployeeId),
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
        setOverrideForm({
          ...existing,
          startDepotLat: existing.startDepotLat ?? defaultLatLon.startDepotLat,
          startDepotLon: existing.startDepotLon ?? defaultLatLon.startDepotLon,
          endDepotLat: existing.endDepotLat ?? defaultLatLon.endDepotLat,
          endDepotLon: existing.endDepotLon ?? defaultLatLon.endDepotLon,
        });
      } else {
        setOverrideForm({
          date: dateStr,
          workStartLocal: defaultSchedule?.workStartLocal ?? '',
          workEndLocal: defaultSchedule?.workEndLocal ?? '',
          ...defaultLatLon,
        });
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load override');
    } finally {
      setOverrideFormLoading(false);
    }
  };

  const handleOverrideSave = async () => {
    if (!overrideCalendarEmployeeId || !overrideForm?.date) return;
    setOverrideFormSaving(true);
    setError(null);
    try {
      const payload = {
        workStartLocal: overrideForm.workStartLocal || undefined,
        workEndLocal: overrideForm.workEndLocal || undefined,
        startDepotLat: overrideForm.startDepotLat ?? undefined,
        startDepotLon: overrideForm.startDepotLon ?? undefined,
        endDepotLat: overrideForm.endDepotLat ?? undefined,
        endDepotLon: overrideForm.endDepotLon ?? undefined,
      };
      if ('id' in overrideForm && overrideForm.id) {
        await updateScheduleOverride(overrideCalendarEmployeeId, overrideForm.id, payload);
      } else {
        await createScheduleOverride(overrideCalendarEmployeeId, {
          date: overrideForm.date,
          ...payload,
        });
      }
      setSuccess('Schedule override saved');
      setTimeout(() => setSuccess(null), 3000);
      const start = overrideCalendarMonth.format('YYYY-MM-DD');
      const end = overrideCalendarMonth.endOf('month').format('YYYY-MM-DD');
      const list = await fetchScheduleOverrides(overrideCalendarEmployeeId, { startDate: start, endDate: end });
      setOverridesInRange(list);
      const updated = list.find((o) => o.date === overrideForm.date) ?? { ...overrideForm, date: overrideForm.date };
      setOverrideForm(updated as ScheduleOverride);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to save override');
    } finally {
      setOverrideFormSaving(false);
    }
  };

  const handleOverrideRemove = async () => {
    if (!overrideCalendarEmployeeId || !overrideForm || !('id' in overrideForm) || !overrideForm.id) return;
    setOverrideFormSaving(true);
    setError(null);
    try {
      await deleteScheduleOverride(overrideCalendarEmployeeId, overrideForm.id);
      setSuccess('Override removed; default schedule will be used for that day');
      setTimeout(() => setSuccess(null), 3000);
      const start = overrideCalendarMonth.format('YYYY-MM-DD');
      const end = overrideCalendarMonth.endOf('month').format('YYYY-MM-DD');
      const list = await fetchScheduleOverrides(overrideCalendarEmployeeId, { startDate: start, endDate: end });
      setOverridesInRange(list);
      const employee = await fetchEmployee(overrideCalendarEmployeeId);
      const dayOfWeek = dayjs(overrideForm.date).day();
      const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
      setOverrideForm({
        date: overrideForm.date,
        workStartLocal: defaultSchedule?.workStartLocal ?? '',
        workEndLocal: defaultSchedule?.workEndLocal ?? '',
        startDepotLat: defaultSchedule?.startDepotLat ?? undefined,
        startDepotLon: defaultSchedule?.startDepotLon ?? undefined,
        endDepotLat: defaultSchedule?.endDepotLat ?? undefined,
        endDepotLon: defaultSchedule?.endDepotLon ?? undefined,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to remove override');
    } finally {
      setOverrideFormSaving(false);
    }
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

  const handleUploadEmployeeImage = async (employeeId: number, file: File | null) => {
    if (!file) return;
    setUploadingEmployeeId(employeeId);
    setImageUploadError(null);
    try {
      await uploadEmployeeImage(employeeId, file);
      setEmployeeImageVersion((prev) => ({ ...prev, [employeeId]: Date.now() }));
      setSuccess('Image updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setImageUploadError(err?.response?.data?.message ?? err?.message ?? 'Failed to upload image');
    } finally {
      setUploadingEmployeeId(null);
    }
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
          <button
            className={`settings-tab ${activeTab === 'employee-images' ? 'active' : ''}`}
            onClick={() => setActiveTab('employee-images')}
          >
            Employee Images
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
                    <th>Form List Order</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAppointmentTypes.map((type) => (
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
                          <input
                            type="number"
                            value={editingAppointmentType.formListOrder ?? ''}
                            onChange={(e) =>
                              setEditingAppointmentType({
                                ...editingAppointmentType,
                                formListOrder: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="settings-input"
                            placeholder="Order (1 = top)"
                            min="1"
                            style={{ width: '100px' }}
                          />
                        ) : (
                          type.formListOrder ?? '—'
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

        {/* Employee Images Tab */}
        {activeTab === 'employee-images' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Images</h2>
            <p className="settings-section-description">
              View and update profile images for each employee. These images can appear in the post-appointment survey and elsewhere. Allowed: JPEG, PNG, GIF, WebP. Max 5MB.
            </p>

            {imageUploadError && (
              <div className="settings-message settings-error-message">
                {imageUploadError}
                <button onClick={() => setImageUploadError(null)} className="settings-close">×</button>
              </div>
            )}

            <div className="settings-employee-images-list">
              {sortedEmployees.map((emp) => (
                <div key={emp.id} className="settings-employee-image-row">
                  <div className="settings-employee-image-preview">
                    <img
                      src={`${apiBaseUrl}/employees/${emp.id}/image?t=${employeeImageVersion[emp.id] ?? 0}`}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = EMPLOYEE_IMAGE_PLACEHOLDER;
                      }}
                    />
                  </div>
                  <div className="settings-employee-image-info">
                    <strong>{formatEmployeeName(emp)}</strong>
                  </div>
                  <div className="settings-employee-image-upload">
                    <label className={`settings-file-label ${uploadingEmployeeId === emp.id ? 'uploading' : ''}`}>
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp"
                        className="settings-file-input"
                        disabled={uploadingEmployeeId === emp.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleUploadEmployeeImage(emp.id, file);
                          }
                          e.target.value = '';
                        }}
                      />
                      <span className="btn secondary">
                        {uploadingEmployeeId === emp.id ? 'Uploading…' : 'Change image'}
                      </span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Employee Schedule Tab */}
        {activeTab === 'employee-schedule' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Schedule</h2>
            <p className="settings-section-description">
              Configure work hours, workdays, and depot locations for each day of the week.
            </p>
            <p className="settings-section-description" style={{ marginTop: '-16px' }}>
              To set different start/end times or depot locations for specific dates (used by routing), use the calendar below.
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
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={handleOpenOverrideCalendar}
                  >
                    Set schedule overrides (calendar)
                  </button>
                </div>
              </div>
            )}

            {!selectedEmployeeForSchedule && (
              <div className="settings-action-bar" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={handleOpenOverrideCalendar}
                >
                  Set schedule overrides (calendar)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Schedule overrides calendar modal */}
        {showOverrideCalendar && (
          <div
            className="settings-modal-overlay"
            onClick={(e) => e.target === e.currentTarget && setShowOverrideCalendar(false)}
          >
            <div className="settings-modal settings-modal-wide">
              <div className="settings-modal-header">
                <h3>Schedule overrides by day</h3>
                <button
                  type="button"
                  className="settings-modal-close"
                  onClick={() => setShowOverrideCalendar(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="settings-modal-body">
                <div className="settings-form-group">
                  <label className="settings-label">Employee (doctor)</label>
                  <select
                    className="settings-select"
                    value={overrideCalendarEmployeeId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      setOverrideCalendarEmployeeId(id);
                      setSelectedOverrideDate(null);
                      setOverrideForm(null);
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

                {!overrideCalendarEmployeeId ? (
                  <p className="settings-muted" style={{ marginTop: 16 }}>
                    Please select a provider above to view and set schedule overrides by day.
                  </p>
                ) : (
                  <>
                    <div className="settings-override-calendar-nav">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setOverrideCalendarMonth((m) => m.subtract(1, 'month'))}
                      >
                        ← Prev
                      </button>
                      <span className="settings-override-calendar-month">
                        {overrideCalendarMonth.format('MMMM YYYY')}
                      </span>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setOverrideCalendarMonth((m) => m.add(1, 'month'))}
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
                        const start = overrideCalendarMonth.startOf('month');
                        const end = overrideCalendarMonth.endOf('month');
                        const startDay = start.day();
                        const daysInMonth = end.date();
                        const cells: React.ReactNode[] = [];
                        for (let i = 0; i < startDay; i++) {
                          cells.push(<div key={`pad-${i}`} className="settings-override-calendar-day settings-override-calendar-day-pad" />);
                        }
                        const overrideDates = new Set(overridesInRange.map((o) => o.date));
                        for (let d = 1; d <= daysInMonth; d++) {
                          const date = start.date(d);
                          const dateStr = date.format('YYYY-MM-DD');
                          const hasOverride = overrideDates.has(dateStr);
                          const isSelected = selectedOverrideDate === dateStr;
                          cells.push(
                            <button
                              key={dateStr}
                              type="button"
                              className={`settings-override-calendar-day ${hasOverride ? 'settings-override-calendar-day-has-override' : ''} ${isSelected ? 'settings-override-calendar-day-selected' : ''}`}
                              onClick={() => handleOverrideDayClick(dateStr)}
                            >
                              {d}
                            </button>
                          );
                        }
                        return cells;
                      })()}
                    </div>

                    {overrideFormLoading && (
                      <div className="settings-loading" style={{ padding: 24 }}>
                        <span className="settings-spinner" />
                        <span>Loading day…</span>
                      </div>
                    )}

                    {!overrideFormLoading && overrideForm && (
                      <div className="settings-override-form">
                        <h4 className="settings-schedule-subtitle">
                          {overrideForm.date} {dayjs(overrideForm.date).format('dddd')}
                        </h4>
                        <p className="settings-muted" style={{ marginBottom: 12 }}>
                          Set start/end time and depot locations for this day. Routing will use these values instead of the weekly schedule.
                        </p>
                        <div className="settings-schedule-row">
                          <div className="settings-schedule-field">
                            <label className="settings-label">Start time</label>
                            <input
                              type="time"
                              className="settings-input"
                              value={overrideForm.workStartLocal ?? ''}
                              onChange={(e) => setOverrideForm((f) => (f ? { ...f, workStartLocal: e.target.value } : null))}
                            />
                          </div>
                          <div className="settings-schedule-field">
                            <label className="settings-label">End time</label>
                            <input
                              type="time"
                              className="settings-input"
                              value={overrideForm.workEndLocal ?? ''}
                              onChange={(e) => setOverrideForm((f) => (f ? { ...f, workEndLocal: e.target.value } : null))}
                            />
                          </div>
                        </div>
                        <div className="settings-schedule-section">
                          <h4 className="settings-schedule-subtitle">Start depot</h4>
                          <div className="settings-schedule-row">
                            <div className="settings-schedule-field">
                              <label className="settings-label">Latitude</label>
                              <input
                                type="number"
                                className="settings-input"
                                value={overrideForm.startDepotLat ?? ''}
                                onChange={(e) => setOverrideForm((f) => (f ? { ...f, startDepotLat: e.target.value ? parseFloat(e.target.value) : undefined } : null))}
                                step="any"
                              />
                            </div>
                            <div className="settings-schedule-field">
                              <label className="settings-label">Longitude</label>
                              <input
                                type="number"
                                className="settings-input"
                                value={overrideForm.startDepotLon ?? ''}
                                onChange={(e) => setOverrideForm((f) => (f ? { ...f, startDepotLon: e.target.value ? parseFloat(e.target.value) : undefined } : null))}
                                step="any"
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
                                type="number"
                                className="settings-input"
                                value={overrideForm.endDepotLat ?? ''}
                                onChange={(e) => setOverrideForm((f) => (f ? { ...f, endDepotLat: e.target.value ? parseFloat(e.target.value) : undefined } : null))}
                                step="any"
                              />
                            </div>
                            <div className="settings-schedule-field">
                              <label className="settings-label">Longitude</label>
                              <input
                                type="number"
                                className="settings-input"
                                value={overrideForm.endDepotLon ?? ''}
                                onChange={(e) => setOverrideForm((f) => (f ? { ...f, endDepotLon: e.target.value ? parseFloat(e.target.value) : undefined } : null))}
                                step="any"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="settings-action-bar" style={{ marginTop: 16 }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={handleOverrideSave}
                            disabled={overrideFormSaving}
                          >
                            {overrideFormSaving ? 'Saving…' : 'Save override'}
                          </button>
                          {'id' in overrideForm && overrideForm.id && (
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={handleOverrideRemove}
                              disabled={overrideFormSaving}
                            >
                              Remove override (use default)
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

