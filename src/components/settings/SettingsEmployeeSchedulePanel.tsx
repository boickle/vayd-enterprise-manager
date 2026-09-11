import { useEffect, useRef, useState } from 'react';
import {
  getEmployeeBranches,
  listPracticeBranches,
  type PracticeBranch,
} from '../../api/branchInventory';
import type {
  Employee,
  EmployeeWeeklySchedule,
  EmployeeWeeklyScheduleZone,
  Zone,
} from '../../api/appointmentSettings';
import { assignedWeekZones, type WeekZoneAssign } from '../../utils/employeeWeekZones';
import { WorkZonesMapModal } from '../WorkZonesMapModal';
import DepotBranchField from './DepotBranchField';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type Props = {
  employee: Employee;
  scheduleUpdates: Map<string, Partial<EmployeeWeeklySchedule>>;
  dayNames: string[];
  zones: Zone[];
  saving?: boolean;
  onOpenOverrides: () => void;
  onSave: () => void;
  onUpdateField: (
    employeeId: number,
    dayOfWeek: number,
    field: keyof EmployeeWeeklySchedule,
    value: unknown
  ) => void;
  onUpdateDepot: (
    employeeId: number,
    dayOfWeek: number,
    which: 'start' | 'end',
    lat?: number,
    lon?: number
  ) => void;
  resolveDepotCoords: (
    updates: Partial<EmployeeWeeklySchedule>,
    schedule: EmployeeWeeklySchedule,
    latKey: 'startDepotLat' | 'endDepotLat',
    lonKey: 'startDepotLon' | 'endDepotLon'
  ) => { lat?: number; lon?: number };
};

function zonesForRow(
  updates: Partial<EmployeeWeeklySchedule>,
  schedule: EmployeeWeeklySchedule
): WeekZoneAssign[] {
  if (updates.zones !== undefined) return assignedWeekZones(updates.zones);
  return assignedWeekZones(schedule.zones);
}

function withToggledZone(
  current: WeekZoneAssign[],
  zoneId: number,
  assigned: boolean,
  previous?: EmployeeWeeklyScheduleZone[]
): WeekZoneAssign[] {
  const next = current.filter((z) => z.zoneId !== zoneId);
  if (!assigned) return next;
  const prior = previous?.find((z) => Number(z.zoneId ?? z.zone?.id) === zoneId);
  next.push({
    zoneId,
    acceptingNewPatients: prior?.acceptingNewPatients === true,
    transitioningOutOfZone: prior?.transitioningOutOfZone === true,
  });
  return next;
}

export default function SettingsEmployeeSchedulePanel({
  employee,
  scheduleUpdates,
  dayNames,
  zones,
  saving,
  onOpenOverrides,
  onSave,
  onUpdateField,
  onUpdateDepot,
  resolveDepotCoords,
}: Props) {
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [defaultBranchId, setDefaultBranchId] = useState<number | null>(null);
  const [workZonesMapOpen, setWorkZonesMapOpen] = useState(false);
  const appliedDefaultFor = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [offices, assignments] = await Promise.all([
        listPracticeBranches(PRACTICE_ID).catch(() => []),
        getEmployeeBranches(PRACTICE_ID, employee.id).catch(() => []),
      ]);
      if (cancelled) return;
      const active = offices.filter((b) => b.isActive !== false);
      setBranches(active);
      const primary = assignments.find((a) => a.isPrimary)?.branchId ?? assignments[0]?.branchId;
      setDefaultBranchId(
        primary ?? active.find((b) => b.isDefault)?.id ?? active[0]?.id ?? null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  useEffect(() => {
    if (appliedDefaultFor.current === employee.id) return;
    if (defaultBranchId == null || branches.length === 0) return;
    const branch = branches.find((b) => b.id === defaultBranchId);
    const lat = branch?.latitude != null ? Number(branch.latitude) : NaN;
    const lon = branch?.longitude != null ? Number(branch.longitude) : NaN;
    appliedDefaultFor.current = employee.id;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    for (const schedule of employee.weeklySchedules ?? []) {
      if (!schedule.isWorkday) continue;
      const key = `${employee.id}-${schedule.dayOfWeek}`;
      const updates = scheduleUpdates.get(key) || {};
      const start = resolveDepotCoords(updates, schedule, 'startDepotLat', 'startDepotLon');
      const end = resolveDepotCoords(updates, schedule, 'endDepotLat', 'endDepotLon');
      if (start.lat == null || start.lon == null) {
        onUpdateDepot(employee.id, schedule.dayOfWeek, 'start', lat, lon);
      }
      if (end.lat == null || end.lon == null) {
        onUpdateDepot(employee.id, schedule.dayOfWeek, 'end', lat, lon);
      }
    }
  }, [branches, defaultBranchId, employee, onUpdateDepot, resolveDepotCoords, scheduleUpdates]);

  const copyZonesToAllDays = (sourceDay: number) => {
    const schedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === sourceDay);
    if (!schedule) return;
    const key = `${employee.id}-${sourceDay}`;
    const source = zonesForRow(scheduleUpdates.get(key) || {}, schedule);
    for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
      onUpdateField(employee.id, dayOfWeek, 'zones', source);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-schedule-toolbar">
        <div>
          <h3 className="settings-card-title" style={{ marginBottom: 4 }}>
            Weekly schedule
          </h3>
          <p className="settings-card-subtitle" style={{ margin: 0 }}>
            Hours, start/end office, and zones for each day. Unchecked zones stay
            unchecked. Off days are ignored by routing.
          </p>
        </div>
        <div className="settings-schedule-toolbar-actions">
          <button type="button" className="btn secondary" onClick={() => setWorkZonesMapOpen(true)}>
            Work Zones Map
          </button>
          <button type="button" className="btn secondary" onClick={onOpenOverrides}>
            Date overrides
          </button>
        </div>
      </div>
      {workZonesMapOpen ? <WorkZonesMapModal onClose={() => setWorkZonesMapOpen(false)} /> : null}

      <div className="settings-schedule-table-wrap">
        <table className="settings-schedule-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>On</th>
              <th>Hours</th>
              <th>Start from</th>
              <th>End at</th>
              <th>Zones</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
              const schedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
              if (!schedule) {
                return (
                  <tr key={dayOfWeek}>
                    <td>
                      <strong>{dayNames[dayOfWeek]}</strong>
                    </td>
                    <td colSpan={5} className="settings-muted">
                      No schedule row
                    </td>
                  </tr>
                );
              }
              const key = `${employee.id}-${dayOfWeek}`;
              const updates = scheduleUpdates.get(key) || {};
              const isWorkday =
                updates.isWorkday !== undefined ? updates.isWorkday : schedule.isWorkday;
              const workStartLocal =
                updates.workStartLocal !== undefined
                  ? (updates.workStartLocal ?? '')
                  : (schedule.workStartLocal ?? '');
              const workEndLocal =
                updates.workEndLocal !== undefined
                  ? (updates.workEndLocal ?? '')
                  : (schedule.workEndLocal ?? '');
              const startDepot = resolveDepotCoords(
                updates,
                schedule,
                'startDepotLat',
                'startDepotLon'
              );
              const endDepot = resolveDepotCoords(updates, schedule, 'endDepotLat', 'endDepotLon');
              const dayZones = zonesForRow(updates, schedule);
              const assignedIds = new Set(dayZones.map((z) => z.zoneId));
              return (
                <tr key={dayOfWeek} className={isWorkday ? 'is-workday' : 'is-off'}>
                  <td>
                    <strong>{dayNames[dayOfWeek]}</strong>
                  </td>
                  <td>
                    <label className="settings-schedule-on">
                      <input
                        type="checkbox"
                        checked={Boolean(isWorkday)}
                        onChange={(e) =>
                          onUpdateField(employee.id, dayOfWeek, 'isWorkday', e.target.checked)
                        }
                      />
                    </label>
                  </td>
                  {isWorkday ? (
                    <>
                      <td>
                        <div className="settings-schedule-hours">
                          <input
                            type="time"
                            className="settings-input"
                            value={workStartLocal}
                            onChange={(e) =>
                              onUpdateField(employee.id, dayOfWeek, 'workStartLocal', e.target.value)
                            }
                          />
                          <span className="settings-muted">–</span>
                          <input
                            type="time"
                            className="settings-input"
                            value={workEndLocal}
                            onChange={(e) =>
                              onUpdateField(employee.id, dayOfWeek, 'workEndLocal', e.target.value)
                            }
                          />
                        </div>
                      </td>
                      <td>
                        <DepotBranchField
                          id={`hub-start-depot-${employee.id}-${dayOfWeek}`}
                          branches={branches}
                          defaultBranchId={defaultBranchId}
                          lat={startDepot.lat}
                          lon={startDepot.lon}
                          onChange={(lat, lon) =>
                            onUpdateDepot(employee.id, dayOfWeek, 'start', lat, lon)
                          }
                        />
                      </td>
                      <td>
                        <DepotBranchField
                          id={`hub-end-depot-${employee.id}-${dayOfWeek}`}
                          branches={branches}
                          defaultBranchId={defaultBranchId}
                          lat={endDepot.lat}
                          lon={endDepot.lon}
                          onChange={(lat, lon) =>
                            onUpdateDepot(employee.id, dayOfWeek, 'end', lat, lon)
                          }
                        />
                      </td>
                      <td>
                        <div className="settings-week-zones">
                          {zones.map((zone) => {
                            const on = assignedIds.has(zone.id);
                            return (
                              <label
                                key={zone.id}
                                className={`settings-week-zone${on ? ' is-on' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  aria-label={`${zone.name} on ${dayNames[dayOfWeek]}`}
                                  onChange={(e) =>
                                    onUpdateField(
                                      employee.id,
                                      dayOfWeek,
                                      'zones',
                                      withToggledZone(
                                        dayZones,
                                        zone.id,
                                        e.target.checked,
                                        schedule.zones
                                      )
                                    )
                                  }
                                />
                                {zone.name?.trim() || `Zone ${zone.id}`}
                              </label>
                            );
                          })}
                          {zones.length > 0 ? (
                            <button
                              type="button"
                              className="settings-week-zones-copy"
                              onClick={() => copyZonesToAllDays(dayOfWeek)}
                            >
                              Use every day
                            </button>
                          ) : (
                            <span className="settings-muted">No zones</span>
                          )}
                        </div>
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="settings-schedule-off-summary">
                      Off
                      {assignedIds.size > 0
                        ? ` · ${zones
                            .filter((zone) => assignedIds.has(zone.id))
                            .map((zone) => zone.name?.trim() || `Zone ${zone.id}`)
                            .join(', ')}`
                        : ''}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="settings-action-bar">
        <button className="btn" onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save schedule'}
        </button>
      </div>
    </div>
  );
}
