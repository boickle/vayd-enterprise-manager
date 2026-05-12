import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import { fetchAppointmentsRange } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { useAuth } from '../auth/useAuth';
import { isAnalyticsAdmin, normalizeAuthRoles } from '../utils/analyticsAccess';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import ScheduleTasksPanel from '../components/schedule/ScheduleTasksPanel';
import './ScheduleHomePage.css';

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientLabel(client: Appointment['client']): string | null {
  if (!client) return null;
  const name = [pickStr(client.firstName), pickStr(client.lastName)].filter(Boolean).join(' ').trim();
  return name || null;
}

function hometownLabel(client: Appointment['client']): string | null {
  if (!client) return null;
  const city = pickStr(client.city);
  const state = pickStr(client.state);
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}

function appointmentTypeLabel(a: Appointment): string | null {
  return pickStr(a.appointmentType?.prettyName) ?? pickStr(a.appointmentType?.name);
}

function isUpcomingFromNow(a: Appointment, nowPractice: DateTime): boolean {
  if (a.allDay) return true;
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  return start >= nowPractice;
}

export default function ScheduleHomePage() {
  const { token, doctorId, assignedDoctorIds, role } = useAuth() as {
    token: string | null;
    doctorId: string | null;
    assignedDoctorIds: string[];
    role: string | string[] | undefined;
  };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskRefresh, setTaskRefresh] = useState(0);

  const rolesLower = useMemo(() => normalizeAuthRoles(role), [role]);
  const isAdminLike = useMemo(() => isAnalyticsAdmin(rolesLower), [rolesLower]);

  const providerScopeIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const id of assignedDoctorIds ?? []) {
      const s = String(id).trim();
      if (s) ids.add(s);
    }
    if (doctorId?.trim()) ids.add(doctorId.trim());
    return ids;
  }, [assignedDoctorIds, doctorId]);

  const todayRange = useMemo(() => {
    const start = DateTime.now().setZone(PRACTICE_TZ).startOf('day');
    const end = start.endOf('day');
    return { startIso: start.toUTC().toISO()!, endIso: end.toUTC().toISO()! };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!isAdminLike && providerScopeIdSet.size === 0) {
        setAppts([]);
        return;
      }
      const singleProviderId =
        !isAdminLike && providerScopeIdSet.size === 1 ? [...providerScopeIdSet][0] : undefined;
      const list = await fetchAppointmentsRange({
        practiceId,
        start: todayRange.startIso,
        end: todayRange.endIso,
        ...(singleProviderId != null ? { primaryProviderId: singleProviderId } : {}),
      });
      const nowPractice = DateTime.now().setZone(PRACTICE_TZ);
      let next = [...list]
        .filter((a) => !a.isComplete)
        .filter((a) => isUpcomingFromNow(a, nowPractice))
        .sort(
          (a, b) => new Date(a.appointmentStart).getTime() - new Date(b.appointmentStart).getTime()
        );

      if (!isAdminLike && providerScopeIdSet.size > 0) {
        next = next.filter((a) => {
          const pid = a.primaryProvider?.id;
          return pid != null && providerScopeIdSet.has(String(pid));
        });
      }

      setAppts(next);
    } catch {
      setAppts([]);
    } finally {
      setLoading(false);
    }
  }, [practiceId, todayRange.startIso, todayRange.endIso, isAdminLike, providerScopeIdSet]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: PRACTICE_TZ,
      }),
    []
  );

  return (
    <div className="schedule-home">
      <div className="schedule-home__col schedule-home__col--today">
        <h2 className="schedule-home__h2">Today</h2>
        <section className="schedule-home__card">
          <h3 className="schedule-home__h3">Upcoming appointments</h3>
          {loading ? (
            <p className="schedule-home__muted">Loading…</p>
          ) : !isAdminLike && providerScopeIdSet.size === 0 ? (
            <p className="schedule-home__muted">
              No provider is linked to your account. Visits for your assigned doctor will appear here
              once an administrator links one.
            </p>
          ) : appts.length === 0 ? (
            <p className="schedule-home__muted">No upcoming appointments for you today.</p>
          ) : (
            <ul className="schedule-home__appts">
              {appts.slice(0, 12).map((a) => {
                const t = new Date(a.appointmentStart);
                const cl = clientLabel(a.client);
                const pet = pickStr(a.patient?.name);
                const home = hometownLabel(a.client);
                const typeStr = appointmentTypeLabel(a);
                const metaParts = [home, typeStr].filter(Boolean);
                return (
                  <li key={a.id} className="schedule-home__appt-row">
                    <span className="schedule-home__appt-time">
                      {a.allDay ? 'All day' : timeFmt.format(t)}
                    </span>
                    <div className="schedule-home__appt-detail">
                      <div className="schedule-home__appt-line1">
                        <span className="schedule-home__appt-client">{cl ?? '—'}</span>
                        <span className="schedule-home__appt-sep" aria-hidden="true">
                          {' '}
                          ·{' '}
                        </span>
                        <span className="schedule-home__appt-patient">{pet ?? '—'}</span>
                      </div>
                      {metaParts.length > 0 ? (
                        <div className="schedule-home__appt-line2">{metaParts.join(' · ')}</div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Link to="/schedule/scheduler" className="schedule-home__cta">
            View schedule
          </Link>
        </section>
        <section className="schedule-home__card">
          <h3 className="schedule-home__h3">Open items</h3>
          <ul className="schedule-home__open">
            <li>Refill requests — coming soon</li>
            <li>Pending SOAPs — coming soon</li>
            <li>Lab reviews — coming soon</li>
            <li>Pending checkout — coming soon</li>
          </ul>
        </section>
      </div>

      <div className="schedule-home__col schedule-home__col--spacer" aria-hidden="true" />

      <div className="schedule-home__col schedule-home__col--tasks">
        <ScheduleTasksPanel refreshKey={taskRefresh} />
        <p className="schedule-home__alerts-note">Alerts and notifications will appear here as they are wired to the API.</p>
        <button type="button" className="schedule-home__refresh-tasks" onClick={() => setTaskRefresh((k) => k + 1)}>
          Refresh tasks
        </button>
      </div>
    </div>
  );
}
