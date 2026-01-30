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
import {
  searchItems,
  getItemWithPriceBreaks,
  createQuantityPriceBreak,
  updateQuantityPriceBreak,
  deleteQuantityPriceBreak,
  type SearchResultItem,
  type ItemWithPriceBreaks,
  type QuantityPriceBreak,
  type ItemType,
} from '../api/quantityPriceBreaks';
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
  const [activeTab, setActiveTab] = useState<'appointment-types' | 'employee-types' | 'employee-zones' | 'employee-schedule' | 'inventory'>('appointment-types');
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

  // Inventory state
  const [practiceId] = useState(1); // Default practice ID, could be made configurable
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithPriceBreaks | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [editingPriceBreak, setEditingPriceBreak] = useState<QuantityPriceBreak | null>(null);
  const [newPriceBreak, setNewPriceBreak] = useState<{
    price: string;
    markup: string;
    lowQuantity: string;
    highQuantity: string;
    isActive: boolean;
  } | null>(null);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);

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

  // Inventory handlers - type-ahead search with debouncing
  useEffect(() => {
    if (activeTab !== 'inventory') return;
    
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    // Debounce search - wait 300ms after user stops typing
    const timeoutId = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const results = await searchItems(trimmedQuery, practiceId);
        setSearchResults(results);
      } catch (err: any) {
        setError(err?.response?.data?.message || err?.message || 'Failed to search items');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [searchQuery, practiceId, activeTab]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const results = await searchItems(searchQuery.trim(), practiceId);
      setSearchResults(results);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to search items');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectItem = async (itemType: ItemType, itemId: number) => {
    if (!itemId || itemId === 0) {
      setError('Invalid item ID');
      return;
    }
    setLoadingItem(true);
    setError(null);
    setSuccess(null);
    setEditingPriceBreak(null);
    setNewPriceBreak(null);
    setSelectedItem(null); // Clear previous selection
    try {
      const item = await getItemWithPriceBreaks(itemType, itemId, practiceId);
      // Ensure the response has the expected structure
      if (item && item.item && item.itemType) {
        // Ensure priceBreaks is always an array
        if (!Array.isArray(item.priceBreaks)) {
          item.priceBreaks = [];
        }
        setSelectedItem(item);
      } else {
        throw new Error('Invalid response structure from server');
      }
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err?.message || 'Failed to load item details';
      setError(errorMessage);
      setSelectedItem(null);
    } finally {
      setLoadingItem(false);
    }
  };

  const handleSavePriceBreak = async (id: number) => {
    if (!editingPriceBreak) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateQuantityPriceBreak(id, {
        price: editingPriceBreak.price,
        markup: editingPriceBreak.markup,
        lowQuantity: editingPriceBreak.lowQuantity,
        highQuantity: editingPriceBreak.highQuantity,
        isActive: editingPriceBreak.isActive,
      });
      setSuccess('Price break updated successfully');
      setTimeout(() => setSuccess(null), 3000);
      setEditingPriceBreak(null);
      // Reload item details
      if (selectedItem) {
        const item = await getItemWithPriceBreaks(
          selectedItem.itemType,
          selectedItem.item.id,
          practiceId
        );
        setSelectedItem(item);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to update price break');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePriceBreak = async () => {
    if (!newPriceBreak || !selectedItem) {
      setError('Missing required data');
      return;
    }
    
    // Validate required fields
    const price = newPriceBreak.price?.trim();
    const lowQty = newPriceBreak.lowQuantity?.trim();
    const highQty = newPriceBreak.highQuantity?.trim();
    
    if (!price || !lowQty || !highQty) {
      setError('Please fill in all required fields (Price, Low Quantity, High Quantity)');
      return;
    }
    
    const priceNum = Number(price);
    const lowQtyNum = Number(lowQty);
    const highQtyNum = Number(highQty);
    
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Price must be a valid number >= 0');
      return;
    }
    
    if (isNaN(lowQtyNum) || lowQtyNum < 1) {
      setError('Low Quantity must be >= 1');
      return;
    }
    
    if (isNaN(highQtyNum) || highQtyNum < 1) {
      setError('High Quantity must be >= 1');
      return;
    }
    
    if (lowQtyNum > highQtyNum) {
      setError('Low Quantity must be <= High Quantity');
      return;
    }
    
    const markupValue = newPriceBreak.markup?.trim() ? Number(newPriceBreak.markup) : null;
    
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await createQuantityPriceBreak(
        selectedItem.itemType,
        selectedItem.item.id,
        practiceId,
        priceNum,
        lowQtyNum,
        highQtyNum,
        markupValue,
        newPriceBreak.isActive
      );
      setSuccess('Price break created successfully');
      setTimeout(() => setSuccess(null), 3000);
      setNewPriceBreak(null);
      // Reload item details
      const item = await getItemWithPriceBreaks(
        selectedItem.itemType,
        selectedItem.item.id,
        practiceId
      );
      setSelectedItem(item);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err?.message || 'Failed to create price break';
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePriceBreak = async (id: number) => {
    if (!confirm('Are you sure you want to delete this price break?')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteQuantityPriceBreak(id);
      setSuccess('Price break deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
      // Reload item details
      if (selectedItem) {
        const item = await getItemWithPriceBreaks(
          selectedItem.itemType,
          selectedItem.item.id,
          practiceId
        );
        setSelectedItem(item);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to delete price break');
    } finally {
      setSaving(false);
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
            className={`settings-tab ${activeTab === 'inventory' ? 'active' : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            Inventory
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

        {/* Inventory Tab */}
        {activeTab === 'inventory' && (
          <div className="settings-section">
            <h2 className="settings-section-title">Inventory Management</h2>
            <p className="settings-section-description">
              Search for inventory items, labs, and procedures to manage quantity price breaks.
            </p>

            <div className="settings-form-group">
              <label className="settings-label">Search Items</label>
              <div style={{ position: 'relative', marginBottom: '16px' }}>
                <input
                  type="text"
                  className="settings-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type to search for items..."
                  style={{ width: '100%', maxWidth: '100%', paddingRight: searching ? '40px' : '12px' }}
                />
                {searching && (
                  <div style={{ 
                    position: 'absolute', 
                    right: '12px', 
                    top: '50%', 
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    <div className="settings-spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
                  </div>
                )}
              </div>
              {searchQuery.trim() && (
                <p className="settings-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                  {searching ? 'Searching...' : searchResults.length > 0 ? `Found ${searchResults.length} result${searchResults.length === 1 ? '' : 's'}` : 'No results found'}
                </p>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="settings-card" style={{ marginBottom: '24px' }}>
                <h3 className="settings-card-title">Search Results</h3>
                <div className="settings-table-container">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Code</th>
                        <th>Price</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.map((item, index) => {
                        // Extract the correct item ID based on itemType
                        const itemId = item.itemType === 'inventory' 
                          ? item.inventoryItem?.id 
                          : item.itemType === 'lab' 
                          ? item.lab?.id 
                          : item.procedure?.id;
                        
                        return (
                          <tr key={`${item.itemType}-${itemId}-${index}`}>
                            <td style={{ textTransform: 'capitalize' }}>{item.itemType}</td>
                            <td>{item.name}</td>
                            <td>{item.code || '—'}</td>
                            <td>${Number(item.price).toFixed(2)}</td>
                            <td>
                              <button
                                className="btn secondary"
                                onClick={() => {
                                  if (itemId) {
                                    handleSelectItem(item.itemType, itemId);
                                  } else {
                                    setError('Item ID not found');
                                  }
                                }}
                                disabled={loadingItem || !itemId}
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!searching && searchQuery.trim() && searchResults.length === 0 && (
              <div className="settings-card" style={{ marginBottom: '24px' }}>
                <p className="settings-muted">No items found matching "{searchQuery}".</p>
              </div>
            )}

            {loadingItem && !selectedItem && (
              <div className="settings-loading">
                <div className="settings-spinner"></div>
                <span>Loading item details...</span>
              </div>
            )}

            {/* Inventory Item Details Modal */}
            {selectedItem && selectedItem.item && (
              <div
                role="dialog"
                aria-modal="true"
                onClick={() => {
                  setSelectedItem(null);
                  setEditingPriceBreak(null);
                  setNewPriceBreak(null);
                }}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 10000,
                  padding: 16,
                }}
              >
                <div
                  className="settings-card"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 'min(900px, 90vw)',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    padding: '24px',
                    borderRadius: '12px',
                    background: '#fff',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <h2 className="settings-card-title" style={{ margin: 0, fontSize: '24px' }}>
                      {selectedItem.item.name}
                    </h2>
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setSelectedItem(null);
                        setEditingPriceBreak(null);
                        setNewPriceBreak(null);
                        setError(null);
                        setSuccess(null);
                      }}
                      style={{ fontSize: '14px', padding: '8px 16px' }}
                    >
                      × Close
                    </button>
                  </div>
                  <p className="settings-card-subtitle">
                    Type: <strong style={{ textTransform: 'capitalize' }}>{selectedItem.itemType}</strong>
                    {' | '}
                    Code: <strong>{selectedItem.item.code || 'N/A'}</strong>
                    {' | '}
                    Cost: <strong>${Number(selectedItem.item.cost || 0).toFixed(2)}</strong>
                    {' | '}
                    Price: <strong>${Number(selectedItem.item.price).toFixed(2)}</strong>
                  </p>

                  {/* Error/Success messages inside modal */}
                  {error && (
                    <div className="settings-message settings-error-message" style={{ marginBottom: '16px' }}>
                      {error}
                      <button onClick={() => setError(null)} className="settings-close">×</button>
                    </div>
                  )}

                  {success && (
                    <div className="settings-message settings-success-message" style={{ marginBottom: '16px' }}>
                      {success}
                      <button onClick={() => setSuccess(null)} className="settings-close">×</button>
                    </div>
                  )}

                <div style={{ marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
                    Quantity Price Breaks
                  </h4>
                  {selectedItem.priceBreaks.length > 0 ? (
                    <div className="settings-table-container">
                      <table className="settings-table">
                        <thead>
                          <tr>
                            <th>Low Qty</th>
                            <th>High Qty</th>
                            <th>Price</th>
                            <th>Markup %</th>
                            <th>Active</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedItem.priceBreaks
                            .sort((a, b) => a.lowQuantity - b.lowQuantity)
                            .map((priceBreak) => (
                              <tr key={priceBreak.id}>
                                {editingPriceBreak?.id === priceBreak.id ? (
                                  <>
                                    <td>
                                      <input
                                        type="number"
                                        className="settings-input"
                                        value={editingPriceBreak.lowQuantity}
                                        onChange={(e) =>
                                          setEditingPriceBreak({
                                            ...editingPriceBreak,
                                            lowQuantity: Number(e.target.value),
                                          })
                                        }
                                        min="1"
                                        style={{ width: '80px' }}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="settings-input"
                                        value={editingPriceBreak.highQuantity}
                                        onChange={(e) =>
                                          setEditingPriceBreak({
                                            ...editingPriceBreak,
                                            highQuantity: Number(e.target.value),
                                          })
                                        }
                                        min="1"
                                        style={{ width: '80px' }}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="settings-input"
                                        value={editingPriceBreak.price}
                                        onChange={(e) => {
                                          setEditingPriceBreak({
                                            ...editingPriceBreak,
                                            price: Number(e.target.value),
                                          });
                                        }}
                                        min="0"
                                        step="0.01"
                                        style={{ width: '100px' }}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="settings-input"
                                        value={editingPriceBreak.markup ?? ''}
                                        onChange={(e) => {
                                          const markupValue = e.target.value === '' ? null : Number(e.target.value);
                                          const updated = {
                                            ...editingPriceBreak,
                                            markup: markupValue,
                                          };
                                          // Auto-calculate price if markup is entered, using cost as base, rounded to nearest cent
                                          if (markupValue !== null && selectedItem?.item?.cost) {
                                            const baseCost = Number(selectedItem.item.cost);
                                            if (!isNaN(baseCost) && !isNaN(markupValue)) {
                                              updated.price = Math.round(baseCost * (1 + markupValue / 100) * 100) / 100;
                                            }
                                          }
                                          setEditingPriceBreak(updated);
                                        }}
                                        step="0.1"
                                        style={{ width: '100px' }}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="checkbox"
                                        checked={editingPriceBreak.isActive}
                                        onChange={(e) =>
                                          setEditingPriceBreak({
                                            ...editingPriceBreak,
                                            isActive: e.target.checked,
                                          })
                                        }
                                      />
                                    </td>
                                    <td>
                                      <div className="settings-action-buttons">
                                        <button
                                          className="btn"
                                          onClick={() => handleSavePriceBreak(priceBreak.id)}
                                          disabled={saving}
                                        >
                                          {saving ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                          className="btn secondary"
                                          onClick={() => setEditingPriceBreak(null)}
                                          disabled={saving}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td>{priceBreak.lowQuantity}</td>
                                    <td>{priceBreak.highQuantity === 999 ? '∞' : priceBreak.highQuantity}</td>
                                    <td>${Number(priceBreak.price).toFixed(2)}</td>
                                    <td>{priceBreak.markup ? `${Number(priceBreak.markup).toFixed(1)}%` : '—'}</td>
                                    <td>{priceBreak.isActive ? 'Yes' : 'No'}</td>
                                    <td>
                                      <div className="settings-action-buttons">
                                        <button
                                          className="btn secondary"
                                          onClick={() => setEditingPriceBreak(priceBreak)}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          className="btn secondary"
                                          onClick={() => handleDeletePriceBreak(priceBreak.id)}
                                          disabled={saving}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="settings-muted">No price breaks configured for this item.</p>
                  )}
                </div>

                {!newPriceBreak && !editingPriceBreak && (
                  <div className="settings-action-bar">
                    <button
                      className="btn"
                      onClick={() => {
                        setPriceManuallyEdited(false);
                        setNewPriceBreak({
                          price: '',
                          markup: '',
                          lowQuantity: '',
                          highQuantity: '',
                          isActive: true,
                        });
                      }}
                    >
                      Add Price Break
                    </button>
                  </div>
                )}

                {newPriceBreak && (
                  <div className="settings-card" style={{ marginTop: '24px', background: '#f8fdfa' }}>
                    <h4 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
                      New Price Break
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                      <div>
                        <label className="settings-label">Low Quantity</label>
                        <input
                          type="number"
                          className="settings-input"
                          value={newPriceBreak.lowQuantity}
                          onChange={(e) =>
                            setNewPriceBreak({
                              ...newPriceBreak,
                              lowQuantity: e.target.value,
                            })
                          }
                          min="1"
                          placeholder="1"
                        />
                      </div>
                      <div>
                        <label className="settings-label">High Quantity</label>
                        <input
                          type="number"
                          className="settings-input"
                          value={newPriceBreak.highQuantity}
                          onChange={(e) =>
                            setNewPriceBreak({
                              ...newPriceBreak,
                              highQuantity: e.target.value,
                            })
                          }
                          min="1"
                          placeholder="999"
                        />
                      </div>
                      <div>
                        <label className="settings-label">Price</label>
                        <input
                          type="number"
                          className="settings-input"
                          value={newPriceBreak.price}
                          onChange={(e) => {
                            setPriceManuallyEdited(true);
                            setNewPriceBreak({
                              ...newPriceBreak,
                              price: e.target.value,
                            });
                          }}
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="settings-label">Markup % (optional)</label>
                        <input
                          type="number"
                          className="settings-input"
                          value={newPriceBreak.markup}
                          onChange={(e) => {
                            const markupValue = e.target.value;
                            setNewPriceBreak({
                              ...newPriceBreak,
                              markup: markupValue,
                            });
                            // Auto-calculate price if markup is entered and price hasn't been manually edited, using cost as base, rounded to nearest cent
                            if (markupValue && selectedItem?.item?.cost && !priceManuallyEdited) {
                              const baseCost = Number(selectedItem.item.cost);
                              const markupPercent = Number(markupValue);
                              if (!isNaN(baseCost) && !isNaN(markupPercent)) {
                                const calculatedPrice = Math.round(baseCost * (1 + markupPercent / 100) * 100) / 100;
                                setNewPriceBreak((prev) => ({
                                  ...(prev || {
                                    price: '',
                                    markup: '',
                                    lowQuantity: '',
                                    highQuantity: '',
                                    isActive: true,
                                  }),
                                  markup: markupValue,
                                  price: calculatedPrice.toFixed(2),
                                }));
                              }
                            }
                          }}
                          step="0.1"
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <label className="settings-checkbox-item">
                        <input
                          type="checkbox"
                          checked={newPriceBreak.isActive}
                          onChange={(e) =>
                            setNewPriceBreak({
                              ...newPriceBreak,
                              isActive: e.target.checked,
                            })
                          }
                        />
                        <span>Active</span>
                      </label>
                    </div>
                    <div className="settings-action-bar">
                      <button
                        type="button"
                        className="btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (saving) {
                            return;
                          }
                          if (!newPriceBreak.price || !newPriceBreak.lowQuantity || !newPriceBreak.highQuantity) {
                            setError('Please fill in all required fields (Price, Low Quantity, High Quantity)');
                            return;
                          }
                          handleCreatePriceBreak();
                        }}
                        style={{ 
                          cursor: (saving || !newPriceBreak.price || !newPriceBreak.lowQuantity || !newPriceBreak.highQuantity) ? 'not-allowed' : 'pointer',
                          opacity: (saving || !newPriceBreak.price || !newPriceBreak.lowQuantity || !newPriceBreak.highQuantity) ? 0.5 : 1
                        }}
                      >
                        {saving ? 'Creating...' : 'Create Price Break'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setNewPriceBreak(null);
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

