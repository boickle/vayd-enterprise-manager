// src/pages/Settings.tsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import ScheduleOverrideModal from '../components/ScheduleOverrideModal';
import {
  fetchAllAppointmentTypes,
  fetchAllEmployees,
  fetchAllZones,
  fetchEmployee,
  updateEmployeeAppointmentTypes,
  updateEmployeeScheduleZones,
  updateWeeklySchedule,
  uploadEmployeeImage,
  type AppointmentType,
  type Employee,
  type EmployeeAppointmentTypeAssignment,
  type EmployeeWeeklySchedule,
  type Zone,
} from '../api/appointmentSettings';
import { clearVeterinariansZoneLookupCache } from '../utils/veterinarianZoneLookup';
import {
  getPracticeSettings,
  updatePracticeSettings,
  settingsToForm,
  formToSettings,
  isOnlineStoreImplemented,
  parseOnlineStoreFulfillmentBranchId,
  parseOnlineStoreFulfillmentLocationId,
  ONLINE_STORE_IMPLEMENTED_KEY,
  ONLINE_STORE_FULFILLMENT_BRANCH_KEY,
  ONLINE_STORE_FULFILLMENT_LOCATION_KEY,
  type ReminderSettingsForm,
  type CadenceEntry,
} from '../api/practiceSettings';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import {
  getPracticeTaxSettings,
  patchPracticeTaxSettings,
  type PracticeTaxSettings,
} from '../api/taxes';
import dayjs from 'dayjs';
import { apiBaseUrl } from '../api/http';
import {
  fetchEmployeeGoals,
  updateEmployeeGoals,
  type EmployeeGoalsResponseDto,
  type DailyGoalOverride,
} from '../api/employeeGoals';
import {
  defaultAppointmentBookingsGoalsByDow,
  fetchAppointmentBookingsGoalsByDow,
  saveAppointmentBookingsGoalsByDow,
  type AppointmentBookingsGoalsByDow,
} from '../api/appointmentBookingsGoals';
import { DepotLocationField } from '../components/DepotLocationField';
import './Settings.css';
import SettingsEmployeeDirectory from '../components/settings/SettingsEmployeeDirectory';
import SettingsAppointmentTypes from '../components/settings/SettingsAppointmentTypes';
import SettingsRoleManualBooking from '../components/settings/SettingsRoleManualBooking';
import SettingsClSeatAssignment from '../components/settings/SettingsClSeatAssignment';
import SettingsGmailMailboxPermissions from '../components/settings/SettingsGmailMailboxPermissions';
import SettingsBranchesLocations from '../components/settings/SettingsBranchesLocations';
import SettingsPaymentTypes from '../components/settings/SettingsPaymentTypes';
import SettingsClientStatuses from '../components/settings/SettingsClientStatuses';
import SettingsMessageTemplates from '../components/settings/SettingsMessageTemplates';
import { appointmentTypeIsArchived } from '../utils/appointmentTypeSettings';

const SETTINGS_TAB_IDS = [
  'appointment-types',
  'role-manual-booking',
  'employee-types',
  'employee-zones',
  'employee-schedule',
  'branches-locations',
  'inventory',
  'employee-images',
  'employee-goals',
  'employee-directory',
  'cl-seat-assignment',
  'gmail-mailboxes',
  'reminders',
  'payment-types',
  'client-statuses',
  'message-templates',
] as const;
type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

function parseSettingsTabParam(tab: string | null): SettingsTabId {
  if (tab && (SETTINGS_TAB_IDS as readonly string[]).includes(tab)) {
    return tab as SettingsTabId;
  }
  return 'appointment-types';
}

/** Practice ID for reminder settings (default 1; override via env if needed) */
const REMINDERS_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

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

type EmployeeZoneEditorRow = {
  zoneId: number;
  isAssigned: boolean;
  acceptingNewPatients: boolean;
  transitioningOutOfZone: boolean;
};

function zoneEditorRowsFromSchedule(
  allZones: Zone[],
  scheduleZones?: EmployeeWeeklySchedule['zones']
): EmployeeZoneEditorRow[] {
  const assignedByZoneId = new Map<
    number,
    { acceptingNewPatients: boolean; transitioningOutOfZone: boolean }
  >();
  for (const z of scheduleZones ?? []) {
    assignedByZoneId.set(z.zoneId, {
      acceptingNewPatients: z.acceptingNewPatients === true,
      transitioningOutOfZone: z.transitioningOutOfZone === true,
    });
  }
  return allZones.map((zone) => {
    const assigned = assignedByZoneId.get(zone.id);
    const isAssigned = assigned != null;
    return {
      zoneId: zone.id,
      isAssigned,
      acceptingNewPatients: isAssigned ? assigned.acceptingNewPatients : false,
      transitioningOutOfZone: isAssigned ? assigned.transitioningOutOfZone : false,
    };
  });
}

export default function Settings() {
  const { role } = useAuth() as any;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(
    () => parseSettingsTabParam(searchParams.get('tab')),
    [searchParams]
  );
  const goToTab = useCallback(
    (tab: SettingsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'appointment-types') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Appointment Types state (shared with employee-types tab)
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);

  /** Types available for new bookings / admin pickers (excludes archived). */
  const activeAppointmentTypes = useMemo(
    () => appointmentTypes.filter((t) => t.isActive !== false && !appointmentTypeIsArchived(t)),
    [appointmentTypes]
  );

  // Employee Appointment Types state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [employeeApptTypeAssignments, setEmployeeApptTypeAssignments] = useState<
    EmployeeAppointmentTypeAssignment[]
  >([]);

  // Employee Zones state
  const [allZones, setAllZones] = useState<Zone[]>([]);
  const [selectedEmployeeForZones, setSelectedEmployeeForZones] = useState<Employee | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<EmployeeWeeklySchedule | null>(null);
  const [zoneUpdates, setZoneUpdates] = useState<EmployeeZoneEditorRow[]>([]);

  // Employee Schedule state
  const [selectedEmployeeForSchedule, setSelectedEmployeeForSchedule] = useState<Employee | null>(null);
  // Use composite key: `${employeeId}-${dayOfWeek}` since schedules might not have ids
  const [scheduleUpdates, setScheduleUpdates] = useState<Map<string, Partial<EmployeeWeeklySchedule>>>(new Map());

  // Inventory / online-store settings (practice-scoped)
  const [practiceId] = useState(1); // Default practice ID, could be made configurable

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideModalInitial, setOverrideModalInitial] = useState<{
    employeeId?: number;
    date?: string;
  }>({});

  // Employee Images state
  const [uploadingEmployeeId, setUploadingEmployeeId] = useState<number | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  /** Bump per employee after upload so img src changes and browser reloads the image */
  const [employeeImageVersion, setEmployeeImageVersion] = useState<Record<number, number>>({});

  // Employee Goals tab state
  const [selectedEmployeeForGoals, setSelectedEmployeeForGoals] = useState<Employee | null>(null);
  const [goalsForm, setGoalsForm] = useState<Partial<EmployeeGoalsResponseDto> & { dailyGoals?: DailyGoalOverride[] }>({});
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [goalsLoadError, setGoalsLoadError] = useState<string | null>(null);
  const [bookingsGoalsByDow, setBookingsGoalsByDow] = useState<AppointmentBookingsGoalsByDow>(
    defaultAppointmentBookingsGoalsByDow
  );
  const [bookingsGoalsLoading, setBookingsGoalsLoading] = useState(false);
  const [bookingsGoalsSaving, setBookingsGoalsSaving] = useState(false);
  const [bookingsGoalsLoadError, setBookingsGoalsLoadError] = useState<string | null>(null);

  // Reminders tab state
  const [reminderForm, setReminderForm] = useState<ReminderSettingsForm>({
    enableEmail: true,
    enableSms: false,
    appointmentWindowDays: 30,
    appointmentCadence: [],
    healthCadence: [],
    testRedirectEmail: '',
    testRedirectPhone: '',
    excludedNamePhrases: [],
    smsExcludedNamePhrases: [],
    includedReminderTypes: [],
  });
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderLoadError, setReminderLoadError] = useState<string | null>(null);

  // Inventory tab — company online-store capability + fulfillment source
  const [onlineStoreImplemented, setOnlineStoreImplemented] = useState(false);
  const [onlineStoreFulfillmentBranchId, setOnlineStoreFulfillmentBranchId] = useState<
    number | null
  >(null);
  const [onlineStoreFulfillmentLocationId, setOnlineStoreFulfillmentLocationId] = useState<
    number | null
  >(null);
  const [onlineStoreBranches, setOnlineStoreBranches] = useState<PracticeBranch[]>([]);
  const [onlineStoreLocations, setOnlineStoreLocations] = useState<InventoryBranchLocation[]>([]);
  const [onlineStoreSettingLoading, setOnlineStoreSettingLoading] = useState(false);
  const [onlineStoreSettingSaving, setOnlineStoreSettingSaving] = useState(false);
  const [onlineStoreSettingError, setOnlineStoreSettingError] = useState<string | null>(null);

  // Inventory tab — practice sales-tax levels (catalog item picker)
  const [taxSettingsDraft, setTaxSettingsDraft] = useState<PracticeTaxSettings | null>(null);
  const [taxSettingsLoading, setTaxSettingsLoading] = useState(false);
  const [taxSettingsSaving, setTaxSettingsSaving] = useState(false);
  const [taxSettingsError, setTaxSettingsError] = useState<string | null>(null);

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

  // Load reminder settings when Reminders tab is active
  useEffect(() => {
    if (!isAdmin || activeTab !== 'reminders') return;
    let cancelled = false;
    setReminderLoadError(null);
    setReminderLoading(true);
    getPracticeSettings(REMINDERS_PRACTICE_ID)
      .then((settings) => {
        if (!cancelled) setReminderForm(settingsToForm(settings));
      })
      .catch((err: any) => {
        if (!cancelled) {
          setReminderLoadError(err?.response?.data?.message || err?.message || 'Failed to load reminder settings');
        }
      })
      .finally(() => {
        if (!cancelled) setReminderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, activeTab]);

  // Load online-store company setting when Inventory tab is active
  useEffect(() => {
    if (!isAdmin || activeTab !== 'inventory') return;
    let cancelled = false;
    setOnlineStoreSettingError(null);
    setOnlineStoreSettingLoading(true);
    Promise.all([
      getPracticeSettings(REMINDERS_PRACTICE_ID),
      listPracticeBranches(REMINDERS_PRACTICE_ID),
    ])
      .then(async ([settings, branchList]) => {
        if (cancelled) return;
        setOnlineStoreImplemented(isOnlineStoreImplemented(settings));
        const activeBranches = branchList.filter((b) => b.isActive !== false);
        setOnlineStoreBranches(activeBranches);
        const branchId = parseOnlineStoreFulfillmentBranchId(settings);
        const locationId = parseOnlineStoreFulfillmentLocationId(settings);
        setOnlineStoreFulfillmentBranchId(branchId);
        setOnlineStoreFulfillmentLocationId(locationId);
        if (branchId != null) {
          try {
            const locs = await listInventoryBranchLocations(REMINDERS_PRACTICE_ID, branchId);
            if (!cancelled) setOnlineStoreLocations(locs.filter((l) => l.isActive !== false));
          } catch {
            if (!cancelled) setOnlineStoreLocations([]);
          }
        } else {
          setOnlineStoreLocations([]);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setOnlineStoreSettingError(
            err?.response?.data?.message || err?.message || 'Failed to load online store setting'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setOnlineStoreSettingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, activeTab]);

  // Load practice sales-tax settings when Inventory tab is active
  useEffect(() => {
    if (!isAdmin || activeTab !== 'inventory') return;
    let cancelled = false;
    setTaxSettingsError(null);
    setTaxSettingsLoading(true);
    getPracticeTaxSettings(REMINDERS_PRACTICE_ID)
      .then((settings) => {
        if (!cancelled) setTaxSettingsDraft(settings);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setTaxSettingsError(
            err?.response?.data?.message || err?.message || 'Failed to load sales tax settings'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTaxSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'inventory' || onlineStoreFulfillmentBranchId == null) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const locs = await listInventoryBranchLocations(
          REMINDERS_PRACTICE_ID,
          onlineStoreFulfillmentBranchId
        );
        if (cancelled) return;
        const active = locs.filter((l) => l.isActive !== false);
        setOnlineStoreLocations(active);
        setOnlineStoreFulfillmentLocationId((prev) => {
          if (prev != null && active.some((l) => l.id === prev)) return prev;
          return active.find((l) => l.isDefault)?.id ?? active[0]?.id ?? null;
        });
      } catch {
        if (!cancelled) setOnlineStoreLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, activeTab, onlineStoreFulfillmentBranchId]);
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [types, emps, zones] = await Promise.all([
        fetchAllAppointmentTypes(practiceId, { activeOnly: false }),
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
      setEmployeeApptTypeAssignments(
        employee.appointmentTypes && Array.isArray(employee.appointmentTypes)
          ? employee.appointmentTypes.map((at) => ({
              appointmentTypeId: at.id,
              allowOnlineBooking: at.allowOnlineBooking === true,
            }))
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
        
        // Merge all zones with employee's zones
        setZoneUpdates(zoneEditorRowsFromSchedule(allZones, firstSchedule.zones));
      } else {
        // No schedules - show all zones as unassigned
        setZoneUpdates(zoneEditorRowsFromSchedule(allZones));
        setSelectedSchedule(null);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load employee');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadEmployeeGoals = async (employeeId: number) => {
    setGoalsLoadError(null);
    setGoalsLoading(true);
    try {
      const goals = await fetchEmployeeGoals(employeeId);
      setGoalsForm({
        ...goals,
        dailyGoals: goals.dailyGoals ? [...goals.dailyGoals] : [],
      });
    } catch (err: any) {
      setGoalsLoadError(err?.response?.data?.message || err?.message || 'Failed to load goals');
      setGoalsForm({});
    } finally {
      setGoalsLoading(false);
    }
  };

  const handleLoadAppointmentBookingsGoals = useCallback(async () => {
    setBookingsGoalsLoadError(null);
    setBookingsGoalsLoading(true);
    try {
      const goals = await fetchAppointmentBookingsGoalsByDow(REMINDERS_PRACTICE_ID);
      setBookingsGoalsByDow(goals);
    } catch (err: any) {
      setBookingsGoalsLoadError(
        err?.response?.data?.message || err?.message || 'Failed to load appointment bookings goals'
      );
      setBookingsGoalsByDow(defaultAppointmentBookingsGoalsByDow());
    } finally {
      setBookingsGoalsLoading(false);
    }
  }, []);

  const handleSaveAppointmentBookingsGoals = async () => {
    setBookingsGoalsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await saveAppointmentBookingsGoalsByDow(REMINDERS_PRACTICE_ID, bookingsGoalsByDow);
      setBookingsGoalsByDow(saved);
      setSuccess('Appointment bookings goals updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update appointment bookings goals');
    } finally {
      setBookingsGoalsSaving(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || activeTab !== 'employee-goals') return;
    void handleLoadAppointmentBookingsGoals();
  }, [isAdmin, activeTab, handleLoadAppointmentBookingsGoals]);

  const handleSaveEmployeeGoals = async () => {
    if (!selectedEmployeeForGoals) return;
    setGoalsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Parameters<typeof updateEmployeeGoals>[1] = {};
      if (goalsForm.defaultWorkStartLocal !== undefined) payload.defaultWorkStartLocal = goalsForm.defaultWorkStartLocal || undefined;
      if (goalsForm.defaultWorkEndLocal !== undefined) payload.defaultWorkEndLocal = goalsForm.defaultWorkEndLocal || undefined;
      if (goalsForm.defaultStartDepotLat !== undefined) payload.defaultStartDepotLat = goalsForm.defaultStartDepotLat;
      if (goalsForm.defaultStartDepotLon !== undefined) payload.defaultStartDepotLon = goalsForm.defaultStartDepotLon;
      if (goalsForm.defaultEndDepotLat !== undefined) payload.defaultEndDepotLat = goalsForm.defaultEndDepotLat;
      if (goalsForm.defaultEndDepotLon !== undefined) payload.defaultEndDepotLon = goalsForm.defaultEndDepotLon;
      if (goalsForm.dailyRevenueGoal !== undefined) payload.dailyRevenueGoal = goalsForm.dailyRevenueGoal;
      if (goalsForm.bonusRevenueGoal !== undefined) payload.bonusRevenueGoal = goalsForm.bonusRevenueGoal;
      if (goalsForm.dailyPointGoal !== undefined) payload.dailyPointGoal = goalsForm.dailyPointGoal;
      if (goalsForm.weeklyPointGoal !== undefined) payload.weeklyPointGoal = goalsForm.weeklyPointGoal;
      if (goalsForm.maxVariableVsdPerPoint !== undefined) {
        payload.maxVariableVsdPerPoint = goalsForm.maxVariableVsdPerPoint;
      }
      if (goalsForm.minVariableVsdPerPoint !== undefined) {
        payload.minVariableVsdPerPoint = goalsForm.minVariableVsdPerPoint;
      }
      if (goalsForm.dailyGoals !== undefined) {
        payload.dailyGoals = goalsForm.dailyGoals.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          dailyPointGoal: d.dailyPointGoal,
          dailyRevenueGoal: d.dailyRevenueGoal,
        }));
      }
      const updated = await updateEmployeeGoals(selectedEmployeeForGoals.id, payload);
      setGoalsForm({ ...updated, dailyGoals: updated.dailyGoals ? [...updated.dailyGoals] : [] });
      setSuccess('Employee goals updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update goals');
    } finally {
      setGoalsSaving(false);
    }
  };

  const handleSaveEmployeeAppointmentTypes = async () => {
    if (!selectedEmployee) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateEmployeeAppointmentTypes(selectedEmployee.id, employeeApptTypeAssignments);
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
          transitioningOutOfZone: z.transitioningOutOfZone,
        }));
      await updateEmployeeScheduleZones(selectedSchedule.id, zonesToSave);
      clearVeterinariansZoneLookupCache();
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
          
          setZoneUpdates(zoneEditorRowsFromSchedule(allZones, scheduleToSelect.zones));
        } else {
          setSelectedSchedule(null);
          setZoneUpdates(zoneEditorRowsFromSchedule(allZones));
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

  const updateScheduleDepot = (
    employeeId: number,
    dayOfWeek: number,
    which: 'start' | 'end',
    lat?: number,
    lon?: number
  ) => {
    setScheduleUpdates((prev) => {
      const newMap = new Map(prev);
      const key = `${employeeId}-${dayOfWeek}`;
      const current = newMap.get(key) || {};
      if (which === 'start') {
        newMap.set(key, { ...current, startDepotLat: lat, startDepotLon: lon });
      } else {
        newMap.set(key, { ...current, endDepotLat: lat, endDepotLon: lon });
      }
      return newMap;
    });
  };

  const resolveDepotCoords = (
    updates: Partial<EmployeeWeeklySchedule>,
    schedule: EmployeeWeeklySchedule,
    latKey: 'startDepotLat' | 'endDepotLat',
    lonKey: 'startDepotLon' | 'endDepotLon'
  ): { lat?: number; lon?: number } => {
    const rawLat = updates[latKey] !== undefined ? updates[latKey] : schedule[latKey];
    const rawLon = updates[lonKey] !== undefined ? updates[lonKey] : schedule[lonKey];
    if (rawLat == null || rawLon == null) return {};
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
    return { lat, lon };
  };

  const handleOpenOverrideCalendar = () => {
    setOverrideModalInitial({
      employeeId:
        selectedEmployeeForSchedule?.id ?? sortedEmployees.find((e) => e.isProvider)?.id ?? undefined,
    });
    setOverrideModalOpen(true);
  };

  const scheduleOverrideDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAdmin || employees.length === 0) return;
    const open = searchParams.get('openScheduleOverride') === '1';
    const empRaw = searchParams.get('overrideEmployeeId');
    const dateStr = searchParams.get('overrideDate');
    if (!open || !empRaw || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    const empId = Number(empRaw);
    if (!Number.isFinite(empId) || !employees.some((e) => e.id === empId)) return;

    const sig = `${empId}:${dateStr}`;
    if (scheduleOverrideDeepLinkRef.current === sig) return;
    scheduleOverrideDeepLinkRef.current = sig;

    if (activeTab !== 'employee-schedule') {
      goToTab('employee-schedule');
    }
    setOverrideModalInitial({ employeeId: empId, date: dateStr });
    setOverrideModalOpen(true);
    void handleLoadEmployeeForSchedule(empId);

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('openScheduleOverride');
        next.delete('overrideEmployeeId');
        next.delete('overrideDate');
        return next;
      },
      { replace: true }
    );
  }, [isAdmin, employees, searchParams, activeTab, goToTab, setSearchParams]);

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

  const isEmployeeAppointmentTypeAssigned = (typeId: number) =>
    employeeApptTypeAssignments.some((a) => a.appointmentTypeId === typeId);

  const toggleAppointmentTypeSelection = (typeId: number) => {
    setEmployeeApptTypeAssignments((prev) => {
      if (prev.some((a) => a.appointmentTypeId === typeId)) {
        return prev.filter((a) => a.appointmentTypeId !== typeId);
      }
      return [...prev, { appointmentTypeId: typeId, allowOnlineBooking: false }];
    });
  };

  const toggleEmployeeAppointmentTypeOnlineBooking = (typeId: number, allowOnlineBooking: boolean) => {
    setEmployeeApptTypeAssignments((prev) =>
      prev.map((a) =>
        a.appointmentTypeId === typeId ? { ...a, allowOnlineBooking } : a
      )
    );
  };

  const selectAllEmployeeAppointmentTypes = () => {
    const activeIds = activeAppointmentTypes.map((t) => t.id);
    const archivedKept = employeeApptTypeAssignments.filter(
      (a) => !activeIds.includes(a.appointmentTypeId)
    );
    const activeAssignments = activeIds.map((id) => {
      const existing = employeeApptTypeAssignments.find((a) => a.appointmentTypeId === id);
      return existing ?? { appointmentTypeId: id, allowOnlineBooking: false };
    });
    setEmployeeApptTypeAssignments([...activeAssignments, ...archivedKept]);
  };

  const unselectAllEmployeeAppointmentTypes = () => {
    setEmployeeApptTypeAssignments([]);
  };

  const toggleZoneAssignment = (zoneId: number, isAssigned: boolean) => {
    setZoneUpdates((prev) => {
      const existing = prev.find((z) => z.zoneId === zoneId);
      if (existing) {
        return prev.map((z) => 
          z.zoneId === zoneId 
            ? {
                ...z,
                isAssigned,
                acceptingNewPatients: isAssigned ? z.acceptingNewPatients : false,
                transitioningOutOfZone: isAssigned ? z.transitioningOutOfZone : false,
              }
            : z
        );
      } else {
        return [
          ...prev,
          { zoneId, isAssigned, acceptingNewPatients: false, transitioningOutOfZone: false },
        ];
      }
    });
  };

  const updateZoneAcceptingNewPatients = (zoneId: number, accepting: boolean) => {
    setZoneUpdates((prev) => {
      const existing = prev.find((z) => z.zoneId === zoneId);
      if (existing) {
        return prev.map((z) => (z.zoneId === zoneId ? { ...z, acceptingNewPatients: accepting } : z));
      } else {
        return [
          ...prev,
          { zoneId, isAssigned: true, acceptingNewPatients: accepting, transitioningOutOfZone: false },
        ];
      }
    });
  };

  const updateZoneTransitioningOut = (zoneId: number, transitioning: boolean) => {
    setZoneUpdates((prev) => {
      const existing = prev.find((z) => z.zoneId === zoneId);
      if (existing) {
        return prev.map((z) =>
          z.zoneId === zoneId ? { ...z, transitioningOutOfZone: transitioning } : z
        );
      } else {
        return [
          ...prev,
          {
            zoneId,
            isAssigned: true,
            acceptingNewPatients: false,
            transitioningOutOfZone: transitioning,
          },
        ];
      }
    });
  };

  const handleSaveReminders = async () => {
    setReminderSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updatePracticeSettings(REMINDERS_PRACTICE_ID, formToSettings(reminderForm));
      setSuccess('Reminder settings updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update reminder settings');
    } finally {
      setReminderSaving(false);
    }
  };

  const handleSaveOnlineStoreImplemented = async () => {
    setOnlineStoreSettingSaving(true);
    setOnlineStoreSettingError(null);
    setError(null);
    setSuccess(null);
    try {
      if (
        onlineStoreImplemented &&
        (onlineStoreFulfillmentBranchId == null || onlineStoreFulfillmentLocationId == null)
      ) {
        setOnlineStoreSettingError(
          'Choose a fulfillment branch and location for online store orders.'
        );
        return;
      }
      await updatePracticeSettings(REMINDERS_PRACTICE_ID, {
        [ONLINE_STORE_IMPLEMENTED_KEY]: onlineStoreImplemented ? 'true' : 'false',
        [ONLINE_STORE_FULFILLMENT_BRANCH_KEY]:
          onlineStoreImplemented && onlineStoreFulfillmentBranchId != null
            ? String(onlineStoreFulfillmentBranchId)
            : '',
        [ONLINE_STORE_FULFILLMENT_LOCATION_KEY]:
          onlineStoreImplemented && onlineStoreFulfillmentLocationId != null
            ? String(onlineStoreFulfillmentLocationId)
            : '',
      });
      setSuccess('Online store setting saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setOnlineStoreSettingError(
        err?.response?.data?.message || err?.message || 'Failed to save online store setting'
      );
    } finally {
      setOnlineStoreSettingSaving(false);
    }
  };

  const handleSaveTaxSettings = async () => {
    if (!taxSettingsDraft) return;
    setTaxSettingsSaving(true);
    setTaxSettingsError(null);
    setError(null);
    setSuccess(null);
    try {
      const saved = await patchPracticeTaxSettings(REMINDERS_PRACTICE_ID, {
        taxLevel1Name: taxSettingsDraft.taxLevel1Name,
        taxLevel1Rate: Number(taxSettingsDraft.taxLevel1Rate) || 0,
        showTaxLevel2: taxSettingsDraft.showTaxLevel2,
        taxLevel2Name: taxSettingsDraft.taxLevel2Name,
        taxLevel2Rate: Number(taxSettingsDraft.taxLevel2Rate) || 0,
        showTaxLevel3: taxSettingsDraft.showTaxLevel3,
        taxLevel3Name: taxSettingsDraft.taxLevel3Name,
        taxLevel3Rate: Number(taxSettingsDraft.taxLevel3Rate) || 0,
        showAccumulativeTax: taxSettingsDraft.showAccumulativeTax,
      });
      setTaxSettingsDraft(saved);
      setSuccess('Sales tax settings saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setTaxSettingsError(
        err?.response?.data?.message || err?.message || 'Failed to save sales tax settings'
      );
    } finally {
      setTaxSettingsSaving(false);
    }
  };

  const updateAppointmentCadenceEntry = (index: number, update: Partial<CadenceEntry>) => {
    setReminderForm((prev) => {
      const next = [...prev.appointmentCadence];
      next[index] = { ...next[index], ...update };
      return { ...prev, appointmentCadence: next };
    });
  };

  const updateHealthCadenceEntry = (index: number, update: Partial<CadenceEntry>) => {
    setReminderForm((prev) => {
      const next = [...prev.healthCadence];
      next[index] = { ...next[index], ...update };
      return { ...prev, healthCadence: next };
    });
  };

  const addAppointmentCadenceEntry = () => {
    setReminderForm((prev) => ({
      ...prev,
      appointmentCadence: [...prev.appointmentCadence, { days: 1, channels: ['sms'], smsFallback: 'email' }],
    }));
  };

  const addHealthCadenceEntry = () => {
    setReminderForm((prev) => ({
      ...prev,
      healthCadence: [...prev.healthCadence, { days: 30, channels: ['email'], smsFallback: 'none' }],
    }));
  };

  const removeAppointmentCadenceEntry = (index: number) => {
    setReminderForm((prev) => ({
      ...prev,
      appointmentCadence: prev.appointmentCadence.filter((_, i) => i !== index),
    }));
  };

  const removeHealthCadenceEntry = (index: number) => {
    setReminderForm((prev) => ({
      ...prev,
      healthCadence: prev.healthCadence.filter((_, i) => i !== index),
    }));
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
            onClick={() => goToTab('appointment-types')}
          >
            Appointment Types
          </button>
          <button
            className={`settings-tab ${activeTab === 'role-manual-booking' ? 'active' : ''}`}
            onClick={() => goToTab('role-manual-booking')}
          >
            Role Manual Booking
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-types' ? 'active' : ''}`}
            onClick={() => goToTab('employee-types')}
          >
            Employee Appointment Types
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-zones' ? 'active' : ''}`}
            onClick={() => goToTab('employee-zones')}
          >
            Employee Zones
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-schedule' ? 'active' : ''}`}
            onClick={() => goToTab('employee-schedule')}
          >
            Employee Schedule
          </button>
          <button
            className={`settings-tab ${activeTab === 'branches-locations' ? 'active' : ''}`}
            onClick={() => goToTab('branches-locations')}
          >
            Branches &amp; Locations
          </button>
          <button
            className={`settings-tab ${activeTab === 'inventory' ? 'active' : ''}`}
            onClick={() => goToTab('inventory')}
          >
            Inventory
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-images' ? 'active' : ''}`}
            onClick={() => goToTab('employee-images')}
          >
            Employee Images
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-goals' ? 'active' : ''}`}
            onClick={() => goToTab('employee-goals')}
          >
            Employee Goals
          </button>
          <button
            className={`settings-tab ${activeTab === 'employee-directory' ? 'active' : ''}`}
            onClick={() => goToTab('employee-directory')}
          >
            Employees
          </button>
          <button
            className={`settings-tab ${activeTab === 'cl-seat-assignment' ? 'active' : ''}`}
            onClick={() => goToTab('cl-seat-assignment')}
          >
            CL Seat Assignment
          </button>
          <button
            className={`settings-tab ${activeTab === 'gmail-mailboxes' ? 'active' : ''}`}
            onClick={() => goToTab('gmail-mailboxes')}
          >
            Gmail Mailboxes
          </button>
          <button
            className={`settings-tab ${activeTab === 'reminders' ? 'active' : ''}`}
            onClick={() => goToTab('reminders')}
          >
            Reminders
          </button>
          <button
            className={`settings-tab ${activeTab === 'payment-types' ? 'active' : ''}`}
            onClick={() => goToTab('payment-types')}
          >
            Payment Types
          </button>
          <button
            className={`settings-tab ${activeTab === 'client-statuses' ? 'active' : ''}`}
            onClick={() => goToTab('client-statuses')}
          >
            Client Discounts
          </button>
          <button
            className={`settings-tab ${activeTab === 'message-templates' ? 'active' : ''}`}
            onClick={() => goToTab('message-templates')}
          >
            Email &amp; Text Templates
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
            <h2 className="settings-section-title">Appointment Types</h2>
            <p className="settings-section-description">
              Manage display names, scheduler colors, arrival windows, and appointment request form options for each
              appointment type. Add new types or archive existing ones to hide them from new bookings.
            </p>
            <SettingsAppointmentTypes
              types={appointmentTypes}
              practiceId={practiceId}
              onTypesChange={setAppointmentTypes}
              onMessage={(msg, kind) => {
                if (kind === 'success') {
                  setSuccess(msg);
                  setError(null);
                  window.setTimeout(() => setSuccess(null), 4000);
                } else {
                  setError(msg);
                  setSuccess(null);
                }
              }}
            />
          </div>
        )}

        {activeTab === 'role-manual-booking' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Role manual booking</h2>
            <p className="settings-section-description">
              Configure which appointment types each employee role may book manually from the
              scheduler calendar. Choose a role by name (for example, Business Manager or
              Receptionist). Routing booking is not restricted by these settings.
            </p>
            <SettingsRoleManualBooking
              appointmentTypes={activeAppointmentTypes}
              allAppointmentTypes={appointmentTypes}
              onMessage={(msg, kind) => {
                if (kind === 'success') {
                  setSuccess(msg);
                  setError(null);
                  window.setTimeout(() => setSuccess(null), 4000);
                } else {
                  setError(msg);
                  setSuccess(null);
                }
              }}
            />
          </div>
        )}

        {/* Employee Appointment Types Tab */}
        {activeTab === 'employee-types' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Appointment Types</h2>
            <p className="settings-section-description">
              Configure which appointment types each employee can see and handle, and whether clients may
              book each type online through the appointment request form.
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
                    setEmployeeApptTypeAssignments([]);
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
                <p className="settings-card-subtitle">
                  Select appointment types this employee can handle. When enabled, online booking lets
                  clients pick an available slot on the appointment request form for that doctor and type.
                </p>

                {activeAppointmentTypes.length > 0 ? (
                  <div className="settings-checkbox-bulk-actions">
                    <button
                      type="button"
                      className="settings-checkbox-bulk-action"
                      onClick={selectAllEmployeeAppointmentTypes}
                    >
                      Select all
                    </button>
                    <span className="settings-checkbox-bulk-sep" aria-hidden>
                      ·
                    </span>
                    <button
                      type="button"
                      className="settings-checkbox-bulk-action"
                      onClick={unselectAllEmployeeAppointmentTypes}
                    >
                      Unselect all
                    </button>
                  </div>
                ) : null}

                <div className="settings-checkbox-list">
                  {activeAppointmentTypes.map((type) => {
                    const assigned = isEmployeeAppointmentTypeAssigned(type.id);
                    const allowOnline =
                      employeeApptTypeAssignments.find((a) => a.appointmentTypeId === type.id)
                        ?.allowOnlineBooking === true;
                    return (
                      <div key={type.id} className="settings-checkbox-item settings-checkbox-item--stacked">
                        <label className="settings-checkbox-item">
                          <input
                            type="checkbox"
                            checked={assigned}
                            onChange={() => toggleAppointmentTypeSelection(type.id)}
                          />
                          <span>
                            {type.name}
                            {!type.showInApptRequestForm && (
                              <span className="settings-muted"> (not shown in form)</span>
                            )}
                          </span>
                        </label>
                        {assigned && (
                          <label
                            className="settings-checkbox-item settings-checkbox-item--nested"
                            style={{ marginLeft: '1.75rem', marginTop: '4px' }}
                          >
                            <input
                              type="checkbox"
                              checked={allowOnline}
                              onChange={(e) =>
                                toggleEmployeeAppointmentTypeOnlineBooking(type.id, e.target.checked)
                              }
                            />
                            <span>Allow online booking on appointment request form</span>
                          </label>
                        )}
                      </div>
                    );
                  })}
                  {appointmentTypes
                    .filter((t) => appointmentTypeIsArchived(t) && isEmployeeAppointmentTypeAssigned(t.id))
                    .map((type) => (
                      <label key={type.id} className="settings-checkbox-item settings-checkbox-item--disabled">
                        <input type="checkbox" checked disabled readOnly />
                        <span>
                          {type.name}
                          <span className="settings-appt-type-archived-badge">Archived</span>
                          <span className="settings-muted"> — remove from employee or restore the type</span>
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
                          setZoneUpdates(zoneEditorRowsFromSchedule(allZones, schedule.zones));
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
                                <strong>{zone?.name?.trim() || 'Unknown zone'}</strong>
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
                                <label
                                  className="settings-checkbox-item"
                                  style={{ opacity: zoneUpdate.isAssigned ? 1 : 0.5 }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={zoneUpdate.transitioningOutOfZone}
                                    disabled={!zoneUpdate.isAssigned}
                                    onChange={(e) =>
                                      updateZoneTransitioningOut(zoneUpdate.zoneId, e.target.checked)
                                    }
                                  />
                                  <span>Transitioning Out of Zone</span>
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
                                <strong>{zone?.name?.trim() || 'Unknown zone'}</strong>
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
                                <label className="settings-checkbox-item" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                                  <input
                                    type="checkbox"
                                    checked={zoneUpdate.transitioningOutOfZone}
                                    disabled={true}
                                  />
                                  <span>Transitioning Out of Zone</span>
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

        {/* Employee Goals Tab */}
        {activeTab === 'employee-goals' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employee Goals</h2>
            <p className="settings-section-description">
              Set default work times, depot locations, and revenue/point goals per employee. Use per-day overrides to set different daily goals by day of week (e.g. higher goals on weekdays).
            </p>

            <div className="settings-card" style={{ marginBottom: 20 }}>
              <h3 className="settings-card-title">Practice appointment bookings goals</h3>
              <p className="settings-muted" style={{ marginBottom: 12 }}>
                Total appointments the practice needs booked each day of the week (Routing Analytics).
                Previously hardcoded at 37.
              </p>
              {bookingsGoalsLoadError && (
                <div className="settings-message settings-error-message">
                  {bookingsGoalsLoadError}
                  <button onClick={() => setBookingsGoalsLoadError(null)} className="settings-close">×</button>
                </div>
              )}
              {bookingsGoalsLoading ? (
                <div className="settings-loading">
                  <div className="settings-spinner"></div>
                  <span>Loading bookings goals...</span>
                </div>
              ) : (
                <>
                  <div
                    className="settings-form-group"
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}
                  >
                    {dayNames.map((name, dow) => (
                      <div key={dow}>
                        <label className="settings-label">{name}</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={bookingsGoalsByDow[dow] ?? ''}
                          onChange={(e) => {
                            const next =
                              e.target.value === ''
                                ? 0
                                : Number(e.target.value);
                            setBookingsGoalsByDow((prev) => ({
                              ...prev,
                              [dow]: Number.isFinite(next) && next >= 0 ? next : 0,
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="settings-btn settings-btn-primary"
                    disabled={bookingsGoalsSaving}
                    onClick={() => void handleSaveAppointmentBookingsGoals()}
                    style={{ marginTop: 12 }}
                  >
                    {bookingsGoalsSaving ? 'Saving...' : 'Save bookings goals'}
                  </button>
                </>
              )}
            </div>

            <div className="settings-form-group">
              <label className="settings-label">Select Employee</label>
              <select
                className="settings-select"
                value={selectedEmployeeForGoals?.id || ''}
                onChange={(e) => {
                  const empId = Number(e.target.value);
                  if (empId) {
                    const emp = sortedEmployees.find((em) => em.id === empId) ?? null;
                    setSelectedEmployeeForGoals(emp);
                    handleLoadEmployeeGoals(empId);
                  } else {
                    setSelectedEmployeeForGoals(null);
                    setGoalsForm({});
                    setGoalsLoadError(null);
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

            {goalsLoadError && (
              <div className="settings-message settings-error-message">
                {goalsLoadError}
                <button onClick={() => setGoalsLoadError(null)} className="settings-close">×</button>
              </div>
            )}

            {selectedEmployeeForGoals && (
              <>
                {goalsLoading ? (
                  <div className="settings-loading">
                    <div className="settings-spinner"></div>
                    <span>Loading goals...</span>
                  </div>
                ) : (
                  <div className="settings-card">
                    <h3 className="settings-card-title">{formatEmployeeName(selectedEmployeeForGoals)}</h3>

                    <h4 className="settings-card-title" style={{ marginTop: '16px', fontSize: '16px' }}>Goals</h4>
                    <div className="settings-form-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
                      <div>
                        <label className="settings-label">Daily revenue goal</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={goalsForm.dailyRevenueGoal ?? ''}
                          onChange={(e) => setGoalsForm((f) => ({ ...f, dailyRevenueGoal: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <label className="settings-label">Bonus revenue goal</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={goalsForm.bonusRevenueGoal ?? ''}
                          onChange={(e) => setGoalsForm((f) => ({ ...f, bonusRevenueGoal: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <label className="settings-label">Daily point goal</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={goalsForm.dailyPointGoal ?? ''}
                          onChange={(e) => setGoalsForm((f) => ({ ...f, dailyPointGoal: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <label className="settings-label">Weekly point goal</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={goalsForm.weeklyPointGoal ?? ''}
                          onChange={(e) => setGoalsForm((f) => ({ ...f, weeklyPointGoal: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        />
                      </div>
                      <div>
                        <label className="settings-label">Min variable VSD / pt (baseline)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={goalsForm.minVariableVsdPerPoint ?? ''}
                          onChange={(e) =>
                            setGoalsForm((f) => ({
                              ...f,
                              minVariableVsdPerPoint:
                                e.target.value === '' ? null : Number(e.target.value),
                            }))
                          }
                          title="Floor for calendar VSD/pt on busy days (revenue goal ÷ scheduled points). Leave blank for no baseline."
                        />
                        <p className="settings-muted" style={{ marginTop: 4, fontSize: 12 }}>
                          Floor on busy days. Blank = no baseline.
                        </p>
                      </div>
                      <div>
                        <label className="settings-label">Max variable VSD / pt</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="settings-input"
                          value={goalsForm.maxVariableVsdPerPoint ?? ''}
                          onChange={(e) =>
                            setGoalsForm((f) => ({
                              ...f,
                              maxVariableVsdPerPoint:
                                e.target.value === '' ? null : Number(e.target.value),
                            }))
                          }
                          title="Caps the calendar VSD/pt target (revenue goal ÷ scheduled points). Leave blank for no cap."
                        />
                        <p className="settings-muted" style={{ marginTop: 4, fontSize: 12 }}>
                          Caps calendar VSD/pt. Blank = no cap.
                        </p>
                      </div>
                    </div>

                    <h4 className="settings-card-title" style={{ marginTop: '16px', fontSize: '16px' }}>Per-day overrides</h4>
                    <p className="settings-muted" style={{ marginBottom: '8px' }}>
                      Override daily point and revenue goals for specific days (0=Sunday … 6=Saturday). When set, these override the default goals above for that day.
                    </p>
                    <div className="settings-table-container">
                      <table className="settings-table">
                        <thead>
                          <tr>
                            <th>Day</th>
                            <th>Daily point goal</th>
                            <th>Daily revenue goal</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(goalsForm.dailyGoals ?? []).map((row, idx) => (
                            <tr key={`${row.dayOfWeek}-${idx}`}>
                              <td>
                                <select
                                  className="settings-select"
                                  value={row.dayOfWeek}
                                  onChange={(e) => {
                                    const day = Number(e.target.value);
                                    setGoalsForm((f) => ({
                                      ...f,
                                      dailyGoals: (f.dailyGoals ?? []).map((r, i) => (i === idx ? { ...r, dayOfWeek: day } : r)),
                                    }));
                                  }}
                                >
                                  {dayNames.map((name, d) => (
                                    <option key={d} value={d}>{name}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  style={{ width: '100px' }}
                                  value={row.dailyPointGoal ?? ''}
                                  onChange={(e) =>
                                    setGoalsForm((f) => ({
                                      ...f,
                                      dailyGoals: (f.dailyGoals ?? []).map((r, i) =>
                                        i === idx ? { ...r, dailyPointGoal: e.target.value === '' ? undefined : Number(e.target.value) } : r
                                      ),
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  style={{ width: '100px' }}
                                  value={row.dailyRevenueGoal ?? ''}
                                  onChange={(e) =>
                                    setGoalsForm((f) => ({
                                      ...f,
                                      dailyGoals: (f.dailyGoals ?? []).map((r, i) =>
                                        i === idx ? { ...r, dailyRevenueGoal: e.target.value === '' ? undefined : Number(e.target.value) } : r
                                      ),
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  onClick={() =>
                                    setGoalsForm((f) => ({
                                      ...f,
                                      dailyGoals: (f.dailyGoals ?? []).filter((_, i) => i !== idx),
                                    }))
                                  }
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: '8px' }}>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={(goalsForm.dailyGoals ?? []).length >= 7}
                        onClick={() => {
                          const used = new Set((goalsForm.dailyGoals ?? []).map((d) => d.dayOfWeek));
                          const nextDay = [0, 1, 2, 3, 4, 5, 6].find((d) => !used.has(d));
                          if (nextDay === undefined) return;
                          setGoalsForm((f) => ({
                            ...f,
                            dailyGoals: [...(f.dailyGoals ?? []), { dayOfWeek: nextDay, dailyPointGoal: undefined, dailyRevenueGoal: undefined }],
                          }));
                        }}
                      >
                        Add day override
                      </button>
                    </div>

                    <div className="settings-action-bar" style={{ marginTop: '24px' }}>
                      <button
                        className="btn"
                        onClick={handleSaveEmployeeGoals}
                        disabled={goalsSaving}
                      >
                        {goalsSaving ? 'Saving...' : 'Save Goals'}
                      </button>
                    </div>
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
                      const startDepot = resolveDepotCoords(updates, schedule, 'startDepotLat', 'startDepotLon');
                      const endDepot = resolveDepotCoords(updates, schedule, 'endDepotLat', 'endDepotLon');

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
                                <DepotLocationField
                                  id={`start-depot-${selectedEmployeeForSchedule.id}-${dayOfWeek}`}
                                  lat={startDepot.lat}
                                  lon={startDepot.lon}
                                  onChange={(lat, lon) =>
                                    updateScheduleDepot(selectedEmployeeForSchedule.id, dayOfWeek, 'start', lat, lon)
                                  }
                                  placeholder="Start typing start depot address"
                                />
                              </div>

                              <div className="settings-schedule-section">
                                <h4 className="settings-schedule-subtitle">End Depot Location</h4>
                                <DepotLocationField
                                  id={`end-depot-${selectedEmployeeForSchedule.id}-${dayOfWeek}`}
                                  lat={endDepot.lat}
                                  lon={endDepot.lon}
                                  onChange={(lat, lon) =>
                                    updateScheduleDepot(selectedEmployeeForSchedule.id, dayOfWeek, 'end', lat, lon)
                                  }
                                  placeholder="Start typing end depot address"
                                />
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

        <ScheduleOverrideModal
          open={overrideModalOpen}
          onClose={() => setOverrideModalOpen(false)}
          initialEmployeeId={overrideModalInitial.employeeId}
          initialDate={overrideModalInitial.date}
        />

        {activeTab === 'branches-locations' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Branches &amp; Locations</h2>
            <p className="settings-section-description">
              Set up practice offices (branches) and their inventory location buckets (main, vehicle,
              staging, etc.). Stock transfers and receiving under Inventory use these buckets.
            </p>
            <SettingsBranchesLocations
              practiceId={Number(import.meta.env.VITE_PRACTICE_ID) || practiceId}
              onMessage={(msg, kind) => {
                if (kind === 'success') {
                  setSuccess(msg);
                  setError(null);
                  window.setTimeout(() => setSuccess(null), 4000);
                } else {
                  setError(msg);
                  setSuccess(null);
                }
              }}
            />
          </div>
        )}

        {/* Inventory Tab */}
        {activeTab === 'inventory' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Inventory</h2>
            <p className="settings-section-description">
              Company storefront capability. Manage catalog items, labs, procedures, and quantity
              price tiers under Catalog.
            </p>

            <div className="settings-card" style={{ marginBottom: 24 }}>
              <h3 className="settings-card-title">Online store</h3>
              <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                When Yes, Online Store appears as a price target next to branches when editing
                inventory prices. Per-SKU listing is still controlled on each item.
              </p>
              {onlineStoreSettingLoading ? (
                <p className="settings-muted">Loading…</p>
              ) : (
                <>
                  <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
                    <legend className="settings-label" style={{ marginBottom: 8 }}>
                      Online store implemented?
                    </legend>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        marginRight: 16,
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                    >
                      <input
                        type="radio"
                        name="onlineStoreImplemented"
                        checked={onlineStoreImplemented}
                        onChange={() => setOnlineStoreImplemented(true)}
                        disabled={onlineStoreSettingSaving}
                      />
                      Yes
                    </label>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                    >
                      <input
                        type="radio"
                        name="onlineStoreImplemented"
                        checked={!onlineStoreImplemented}
                        onChange={() => setOnlineStoreImplemented(false)}
                        disabled={onlineStoreSettingSaving}
                      />
                      No
                    </label>
                  </fieldset>
                  {onlineStoreImplemented && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <label className="settings-label">
                        Fulfillment branch
                        <select
                          className="settings-input"
                          value={onlineStoreFulfillmentBranchId ?? ''}
                          disabled={onlineStoreSettingSaving}
                          onChange={(e) => {
                            const v =
                              e.target.value === '' ? null : Number(e.target.value);
                            setOnlineStoreFulfillmentBranchId(
                              v != null && Number.isFinite(v) ? v : null
                            );
                            setOnlineStoreFulfillmentLocationId(null);
                          }}
                        >
                          <option value="">Select branch…</option>
                          {onlineStoreBranches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="settings-label">
                        Fulfillment location
                        <select
                          className="settings-input"
                          value={onlineStoreFulfillmentLocationId ?? ''}
                          disabled={
                            onlineStoreSettingSaving || onlineStoreFulfillmentBranchId == null
                          }
                          onChange={(e) => {
                            const v =
                              e.target.value === '' ? null : Number(e.target.value);
                            setOnlineStoreFulfillmentLocationId(
                              v != null && Number.isFinite(v) ? v : null
                            );
                          }}
                        >
                          <option value="">Select location…</option>
                          {onlineStoreLocations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                              {loc.isDefault ? ' (default)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p
                        className="settings-muted"
                        style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12 }}
                      >
                        Online orders draw stock from this branch and location when fulfilled.
                      </p>
                    </div>
                  )}
                  {onlineStoreSettingError && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
                      {onlineStoreSettingError}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn primary"
                    disabled={onlineStoreSettingSaving}
                    onClick={() => void handleSaveOnlineStoreImplemented()}
                  >
                    {onlineStoreSettingSaving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </div>

            <div className="settings-card" style={{ marginBottom: 24 }}>
              <h3 className="settings-card-title">Sales tax</h3>
              <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                Level 1 is your practice sales tax. Enable level 2 or 3 only if your practice uses
                additional tax tiers — they appear on catalog item Sales Tax dropdowns.
              </p>
              {taxSettingsLoading ? (
                <p className="settings-muted">Loading…</p>
              ) : taxSettingsDraft ? (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <label className="settings-label">
                      Level 1 name
                      <input
                        className="settings-input"
                        value={taxSettingsDraft.taxLevel1Name}
                        disabled={taxSettingsSaving}
                        onChange={(e) =>
                          setTaxSettingsDraft((d) =>
                            d ? { ...d, taxLevel1Name: e.target.value } : d
                          )
                        }
                      />
                    </label>
                    <label className="settings-label">
                      Level 1 rate (%)
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="settings-input"
                        value={taxSettingsDraft.taxLevel1Rate}
                        disabled={taxSettingsSaving}
                        onChange={(e) =>
                          setTaxSettingsDraft((d) =>
                            d
                              ? { ...d, taxLevel1Rate: Number(e.target.value) || 0 }
                              : d
                          )
                        }
                      />
                    </label>
                  </div>
                  <label className="settings-checkbox-item" style={{ marginBottom: 12 }}>
                    <input
                      type="checkbox"
                      checked={taxSettingsDraft.showTaxLevel2}
                      disabled={taxSettingsSaving}
                      onChange={(e) =>
                        setTaxSettingsDraft((d) =>
                          d ? { ...d, showTaxLevel2: e.target.checked } : d
                        )
                      }
                    />
                    <span>Show tax level 2</span>
                  </label>
                  {taxSettingsDraft.showTaxLevel2 && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <label className="settings-label">
                        Level 2 name
                        <input
                          className="settings-input"
                          value={taxSettingsDraft.taxLevel2Name}
                          disabled={taxSettingsSaving}
                          onChange={(e) =>
                            setTaxSettingsDraft((d) =>
                              d ? { ...d, taxLevel2Name: e.target.value } : d
                            )
                          }
                        />
                      </label>
                      <label className="settings-label">
                        Level 2 rate (%)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="settings-input"
                          value={taxSettingsDraft.taxLevel2Rate}
                          disabled={taxSettingsSaving}
                          onChange={(e) =>
                            setTaxSettingsDraft((d) =>
                              d
                                ? { ...d, taxLevel2Rate: Number(e.target.value) || 0 }
                                : d
                            )
                          }
                        />
                      </label>
                    </div>
                  )}
                  <label className="settings-checkbox-item" style={{ marginBottom: 12 }}>
                    <input
                      type="checkbox"
                      checked={taxSettingsDraft.showTaxLevel3}
                      disabled={taxSettingsSaving}
                      onChange={(e) =>
                        setTaxSettingsDraft((d) =>
                          d ? { ...d, showTaxLevel3: e.target.checked } : d
                        )
                      }
                    />
                    <span>Show tax level 3</span>
                  </label>
                  {taxSettingsDraft.showTaxLevel3 && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <label className="settings-label">
                        Level 3 name
                        <input
                          className="settings-input"
                          value={taxSettingsDraft.taxLevel3Name}
                          disabled={taxSettingsSaving}
                          onChange={(e) =>
                            setTaxSettingsDraft((d) =>
                              d ? { ...d, taxLevel3Name: e.target.value } : d
                            )
                          }
                        />
                      </label>
                      <label className="settings-label">
                        Level 3 rate (%)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="settings-input"
                          value={taxSettingsDraft.taxLevel3Rate}
                          disabled={taxSettingsSaving}
                          onChange={(e) =>
                            setTaxSettingsDraft((d) =>
                              d
                                ? { ...d, taxLevel3Rate: Number(e.target.value) || 0 }
                                : d
                            )
                          }
                        />
                      </label>
                    </div>
                  )}
                  {taxSettingsError && (
                    <div
                      className="settings-message settings-error-message"
                      style={{ marginBottom: 8 }}
                    >
                      {taxSettingsError}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn primary"
                    disabled={taxSettingsSaving}
                    onClick={() => void handleSaveTaxSettings()}
                  >
                    {taxSettingsSaving ? 'Saving…' : 'Save sales tax'}
                  </button>
                </>
              ) : (
                <p className="settings-muted">
                  {taxSettingsError || 'Could not load sales tax settings.'}
                </p>
              )}
            </div>

            <p className="settings-muted" style={{ marginTop: 8 }}>
              To add or edit products, labs, procedures, and quantity price breaks, open{' '}
              <a href="/schedule/catalog">Catalog</a>.
            </p>
          </div>
        )}

        {/* Employees directory (CRUD via POST /employees, upsert, DELETE) */}
        {activeTab === 'employee-directory' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Employees</h2>
            <p className="settings-section-description">
              View staff, assign employee roles (for manual booking permissions), and edit VAYD-managed bios.
              Click an employee name to edit roles, or use <strong>Edit bio</strong> for profile copy.
            </p>
            <SettingsEmployeeDirectory
              onMessage={(msg, kind) => {
                if (kind === 'success') {
                  setSuccess(msg);
                  setError(null);
                  window.setTimeout(() => setSuccess(null), 4000);
                } else {
                  setError(msg);
                  setSuccess(null);
                }
              }}
            />
          </div>
        )}

        {/* Shared Gmail mailbox ACL — which staff see info@ / field@ */}
        {activeTab === 'gmail-mailboxes' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Gmail Mailboxes</h2>
            <p className="settings-section-description">
              Choose which shared practice mailboxes each staff member can open in Scout Email.
              <strong> Show</strong> controls the mailbox tab; <strong>Send</strong> allows composing
              from that address. Personal mailboxes are still connected by each user via OAuth.
            </p>
            <SettingsGmailMailboxPermissions
              onMessage={(msg, kind) => {
                if (kind === 'success') {
                  setSuccess(msg);
                  setError(null);
                  window.setTimeout(() => setSuccess(null), 4000);
                } else {
                  setError(msg);
                  setSuccess(null);
                }
              }}
            />
          </div>
        )}

        {/* CL Seat Assignment — weekly Phones / Outreach / Email rotation + par */}
        {activeTab === 'cl-seat-assignment' && (
          <div className="settings-section">
            <h2 className="settings-section-title">CL Seat Assignment</h2>
            <p className="settings-section-description">
              Assign each Client Liaison to Phones, Outreach, or Email for the week, set weekly seat par
              targets, and add day overrides (OFF / one-day seat swaps) used by Analytics → CL Performance
              (normalized score = points ÷ prorated par).
            </p>
            <SettingsClSeatAssignment
              practiceId={REMINDERS_PRACTICE_ID}
              onMessage={(msg, kind) => {
                if (kind === 'success') {
                  setSuccess(msg);
                  setError(null);
                  window.setTimeout(() => setSuccess(null), 4000);
                } else {
                  setError(msg);
                  setSuccess(null);
                }
              }}
            />
          </div>
        )}

        {/* Reminders Tab */}
        {activeTab === 'reminders' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Reminder Settings</h2>
            <p className="settings-section-description">
              Configure when and how appointment and health reminders are sent (email and SMS). Each cadence entry specifies days before/after, channels (email, SMS), and SMS fallback when only SMS is used.
            </p>

            {reminderLoadError && (
              <div className="settings-message settings-error-message">
                {reminderLoadError}
                <button onClick={() => setReminderLoadError(null)} className="settings-close">×</button>
              </div>
            )}

            {reminderLoading ? (
              <div className="settings-loading">
                <div className="settings-spinner"></div>
                <span>Loading reminder settings...</span>
              </div>
            ) : (
              <div className="settings-card">
                <h3 className="settings-card-title">Channels</h3>
                <div className="settings-form-group">
                  <label className="settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={reminderForm.enableEmail}
                      onChange={(e) =>
                        setReminderForm((prev) => ({ ...prev, enableEmail: e.target.checked }))
                      }
                    />
                    <span>Enable email reminders</span>
                  </label>
                </div>
                <div className="settings-form-group">
                  <label className="settings-checkbox-item">
                    <input
                      type="checkbox"
                      checked={reminderForm.enableSms}
                      onChange={(e) =>
                        setReminderForm((prev) => ({ ...prev, enableSms: e.target.checked }))
                      }
                    />
                    <span>Enable SMS reminders</span>
                  </label>
                </div>

                <h3 className="settings-card-title" style={{ marginTop: '24px' }}>Appointment reminders</h3>
                <div className="settings-form-group">
                  <label className="settings-label">Appointment cadence</label>
                  <span className="settings-muted" style={{ display: 'block', marginBottom: '8px' }}>
                    Days before appointment (positive). Each row: days, channels (email/SMS), and SMS fallback when only SMS is used.
                  </span>
                  <div className="settings-cadence-list">
                    {reminderForm.appointmentCadence.map((entry, index) => (
                      <div key={index} className="settings-cadence-row">
                        <input
                          type="number"
                          className="settings-input"
                          value={entry.days}
                          onChange={(e) =>
                            updateAppointmentCadenceEntry(index, {
                              days: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          placeholder="Days"
                          style={{ width: '80px' }}
                        />
                        <label className="settings-checkbox-item" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={entry.channels.includes('email')}
                            onChange={(e) => {
                              const channels = e.target.checked
                                ? ([...entry.channels.filter((c) => c !== 'email'), 'email'] as ('email' | 'sms')[]).sort()
                                : (entry.channels.filter((c) => c !== 'email') as ('email' | 'sms')[]);
                              const next: ('email' | 'sms')[] = channels.length ? channels : ['sms'];
                              updateAppointmentCadenceEntry(index, {
                                channels: next,
                                smsFallback: next.length === 1 && next[0] === 'sms' ? (entry.smsFallback ?? 'email') : undefined,
                              });
                            }}
                          />
                          <span>Email</span>
                        </label>
                        <label className="settings-checkbox-item" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={entry.channels.includes('sms')}
                            onChange={(e) => {
                              const channels = e.target.checked
                                ? ([...entry.channels.filter((c) => c !== 'sms'), 'sms'] as ('email' | 'sms')[]).sort()
                                : (entry.channels.filter((c) => c !== 'sms') as ('email' | 'sms')[]);
                              updateAppointmentCadenceEntry(index, {
                                channels: channels.length ? (channels as ('email' | 'sms')[]) : ['email'],
                                smsFallback: channels.length && channels.includes('sms') && channels.length === 1 ? (entry.smsFallback ?? 'email') : undefined,
                              });
                            }}
                          />
                          <span>SMS</span>
                        </label>
                        {entry.channels.length === 1 && entry.channels[0] === 'sms' && (
                          <select
                            className="settings-select"
                            value={entry.smsFallback ?? 'email'}
                            onChange={(e) =>
                              updateAppointmentCadenceEntry(index, {
                                smsFallback: e.target.value as 'email' | 'none',
                              })
                            }
                            style={{ width: '150px' }}
                          >
                            <option value="email">Fallback: email</option>
                            <option value="none">Fallback: none</option>
                          </select>
                        )}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => removeAppointmentCadenceEntry(index)}
                          aria-label="Remove entry"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn secondary" onClick={addAppointmentCadenceEntry} style={{ marginTop: '8px' }}>
                    Add appointment cadence entry
                  </button>
                </div>

                <h3 className="settings-card-title" style={{ marginTop: '24px' }}>Health reminders</h3>
                <div className="settings-form-group">
                  <label className="settings-label">Health cadence</label>
                  <span className="settings-muted" style={{ display: 'block', marginBottom: '8px' }}>
                    Days before (positive) or after (negative) due date. Each row: days, channels, and SMS fallback when only SMS is used.
                  </span>
                  <div className="settings-cadence-list">
                    {reminderForm.healthCadence.map((entry, index) => (
                      <div key={index} className="settings-cadence-row">
                        <input
                          type="number"
                          className="settings-input"
                          value={entry.days}
                          onChange={(e) =>
                            updateHealthCadenceEntry(index, {
                              days: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          placeholder="Days"
                          style={{ width: '80px' }}
                        />
                        <label className="settings-checkbox-item" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={entry.channels.includes('email')}
                            onChange={(e) => {
                              const channels = e.target.checked
                                ? ([...entry.channels.filter((c) => c !== 'email'), 'email'] as ('email' | 'sms')[]).sort()
                                : (entry.channels.filter((c) => c !== 'email') as ('email' | 'sms')[]);
                              const next: ('email' | 'sms')[] = channels.length ? channels : ['sms'];
                              updateHealthCadenceEntry(index, {
                                channels: next,
                                smsFallback: next.length === 1 && next[0] === 'sms' ? (entry.smsFallback ?? 'email') : undefined,
                              });
                            }}
                          />
                          <span>Email</span>
                        </label>
                        <label className="settings-checkbox-item" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={entry.channels.includes('sms')}
                            onChange={(e) => {
                              const channels = e.target.checked
                                ? ([...entry.channels.filter((c) => c !== 'sms'), 'sms'] as ('email' | 'sms')[]).sort()
                                : (entry.channels.filter((c) => c !== 'sms') as ('email' | 'sms')[]);
                              updateHealthCadenceEntry(index, {
                                channels: channels.length ? (channels as ('email' | 'sms')[]) : ['email'],
                                smsFallback: channels.length && channels.includes('sms') && channels.length === 1 ? (entry.smsFallback ?? 'email') : undefined,
                              });
                            }}
                          />
                          <span>SMS</span>
                        </label>
                        {entry.channels.length === 1 && entry.channels[0] === 'sms' && (
                          <select
                            className="settings-select"
                            value={entry.smsFallback ?? 'email'}
                            onChange={(e) =>
                              updateHealthCadenceEntry(index, {
                                smsFallback: e.target.value as 'email' | 'none',
                              })
                            }
                            style={{ width: '150px' }}
                          >
                            <option value="email">Fallback: email</option>
                            <option value="none">Fallback: none</option>
                          </select>
                        )}
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => removeHealthCadenceEntry(index)}
                          aria-label="Remove entry"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn secondary" onClick={addHealthCadenceEntry} style={{ marginTop: '8px' }}>
                    Add health cadence entry
                  </button>
                </div>
                <div className="settings-form-group">
                  <label className="settings-label">Appointment window (days)</label>
                  <input
                    type="number"
                    className="settings-input"
                    value={reminderForm.appointmentWindowDays}
                    onChange={(e) =>
                      setReminderForm((prev) => ({
                        ...prev,
                        appointmentWindowDays: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    min={0}
                    style={{ maxWidth: '120px' }}
                  />
                  <span className="settings-muted">Do not send health reminders if the patient has an appointment within this many days.</span>
                </div>

                <h3 className="settings-card-title" style={{ marginTop: '24px' }}>Exclude reminders by name</h3>
                <div className="settings-form-group">
                  <label className="settings-label">Excluded words or phrases</label>
                  <span className="settings-muted" style={{ display: 'block', marginBottom: '8px' }}>
                    Reminders whose name contains any of these (one per line) will be excluded from being sent.
                  </span>
                  <textarea
                    className="settings-input"
                    value={reminderForm.excludedNamePhrases.join('\n')}
                    onChange={(e) =>
                      setReminderForm((prev) => ({
                        ...prev,
                        excludedNamePhrases: e.target.value
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }))
                    }
                    rows={4}
                    style={{ resize: 'vertical', minHeight: '80px' }}
                  />
                </div>

                <h3 className="settings-card-title" style={{ marginTop: '24px' }}>Exclude from SMS only (by name)</h3>
                <div className="settings-form-group">
                  <label className="settings-label">SMS-excluded words or phrases</label>
                  <span className="settings-muted" style={{ display: 'block', marginBottom: '8px' }}>
                    Reminders whose name contains any of these (one per line) will not be sent via SMS; email is still sent if enabled.
                  </span>
                  <textarea
                    className="settings-input"
                    value={reminderForm.smsExcludedNamePhrases.join('\n')}
                    onChange={(e) =>
                      setReminderForm((prev) => ({
                        ...prev,
                        smsExcludedNamePhrases: e.target.value
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }))
                    }
                    rows={4}
                    style={{ resize: 'vertical', minHeight: '80px' }}
                  />
                </div>

                <h3 className="settings-card-title" style={{ marginTop: '24px' }}>Include reminder types</h3>
                <div className="settings-form-group">
                  <label className="settings-label">Included reminder types</label>
                  <span className="settings-muted" style={{ display: 'block', marginBottom: '8px' }}>
                    Only send reminders whose type is in this list (one type name per line). Leave empty to include all types.
                  </span>
                  <textarea
                    className="settings-input"
                    value={reminderForm.includedReminderTypes.join('\n')}
                    onChange={(e) =>
                      setReminderForm((prev) => ({
                        ...prev,
                        includedReminderTypes: e.target.value
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }))
                    }
                    placeholder={'e.g. vaccination\nannual exam\nwellness'}
                    rows={4}
                    style={{ resize: 'vertical', minHeight: '80px' }}
                  />
                </div>

                <h3 className="settings-card-title" style={{ marginTop: '24px' }}>Test redirects (non-production)</h3>
                <div className="settings-form-group">
                  <label className="settings-label">Test redirect email</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={reminderForm.testRedirectEmail}
                    onChange={(e) =>
                      setReminderForm((prev) => ({ ...prev, testRedirectEmail: e.target.value }))
                    }
                    placeholder="email@example.com"
                  />
                </div>
                <div className="settings-form-group">
                  <label className="settings-label">Test redirect phone</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={reminderForm.testRedirectPhone}
                    onChange={(e) =>
                      setReminderForm((prev) => ({ ...prev, testRedirectPhone: e.target.value }))
                    }
                    placeholder="2078440442"
                  />
                </div>

                <div className="settings-action-bar">
                  <button
                    className="btn"
                    onClick={handleSaveReminders}
                    disabled={reminderSaving}
                  >
                    {reminderSaving ? 'Saving...' : 'Save reminder settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'payment-types' && (
          <div className="settings-section">
            <SettingsPaymentTypes
              onMessage={(msg, kind) => {
                if (kind === 'error') setError(msg);
                else setSuccess(msg);
              }}
            />
          </div>
        )}

        {activeTab === 'client-statuses' && (
          <div className="settings-section">
            <SettingsClientStatuses
              onMessage={(msg, kind) => {
                if (kind === 'error') setError(msg);
                else setSuccess(msg);
              }}
            />
          </div>
        )}

        {activeTab === 'message-templates' && (
          <div className="settings-section">
            <SettingsMessageTemplates
              onMessage={(msg, kind) => {
                if (kind === 'error') setError(msg);
                else setSuccess(msg);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

