// src/pages/ClientPortal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  fetchClientAppointments,
  fetchClientPets,
  enrollPetInPlan,
  type Pet,
  type ClientAppointment,
  fetchWellnessPlansForPatient,
  type WellnessPlan,
  fetchClientReminders,
  type ClientReminder,
} from '../api/clientPortal';

type PetWithWellness = Pet & {
  wellnessPlans?: Pick<WellnessPlan, 'id' | 'packageName' | 'name'>[];
};

/* ---------------------------
   Helpers
---------------------------- */
function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
function fmtDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtOnlyDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtReminderDate(r: ClientReminder): string {
  if (!r?.dueIso) return '—';
  const t = Date.parse(r.dueIso);
  if (!Number.isFinite(t)) return r.dueIso;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function heroImgUrl() {
  return 'https://images.unsplash.com/photo-1601758123927-196d1b1e6c3f?q=80&w=1600&auto=format&fit=crop';
}
function petImg(p: Pet) {
  const s = (p.species || '').toLowerCase();
  if (s.includes('canine') || s.includes('dog')) {
    return 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=80&w=800&auto=format&fit=crop';
  }
  if (s.includes('feline') || s.includes('cat')) {
    return 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?q=80&w=800&auto=format&fit=crop';
  }
  return 'https://images.unsplash.com/photo-1507146426996-ef05306b995a?q=80&w=800&auto=format&fit=crop';
}
function groupApptsByDay(appts: ClientAppointment[]) {
  const map = new Map<string, ClientAppointment[]>();
  for (const a of appts) {
    const key = new Date(a.startIso).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: fmtDate(items[0]?.startIso), items }));
}

/* ---------------------------
   Page
---------------------------- */
export default function ClientPortal() {
  const { userEmail } = useAuth() as any;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pets, setPets] = useState<PetWithWellness[]>([]);
  const [appts, setAppts] = useState<ClientAppointment[]>([]);
  const [reminders, setReminders] = useState<ClientReminder[]>([]);
  const [enrolling, setEnrolling] = useState<Record<string, boolean>>({});
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pBase, a, r] = await Promise.all([
          fetchClientPets(),
          fetchClientAppointments(),
          fetchClientReminders(),
        ]);
        if (!alive) return;

        const petsWithWellness = await Promise.all(
          pBase.map(async (pet) => {
            try {
              const dbId = (pet as any).dbId as string | undefined;
              if (!dbId) return pet;
              const plans = await fetchWellnessPlansForPatient(dbId);
              const slim =
                plans?.map((pl) => ({
                  id: pl.id,
                  packageName: pl.package?.name ?? pl.packageName ?? null,
                  name: pl.name ?? null,
                })) ?? [];
              return { ...pet, wellnessPlans: slim };
            } catch {
              return pet;
            }
          })
        );

        setPets(petsWithWellness);
        setAppts([...a].sort((x, y) => +new Date(x.startIso) - +new Date(y.startIso)));
        setReminders(
          [...r].sort((x, y) => Date.parse(x.dueIso ?? '') - Date.parse(y.dueIso ?? ''))
        );
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Failed to load your portal.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const upcomingAppts = useMemo(() => {
    const now = Date.now();
    return appts.filter((a) => new Date(a.startIso).getTime() >= now);
  }, [appts]);
  const upcomingByDay = useMemo(() => groupApptsByDay(upcomingAppts), [upcomingAppts]);
  const pastAppts = useMemo(() => {
    const now = Date.now();
    return appts
      .filter((a) => new Date(a.startIso).getTime() < now)
      .slice(-8)
      .reverse();
  }, [appts]);

  const { upcomingReminders, overdueReminders } = useMemo(() => {
    const now = Date.now();
    const up: ClientReminder[] = [];
    const over: ClientReminder[] = [];
    for (const r of reminders) {
      const t = r.dueIso ? Date.parse(r.dueIso) : NaN;
      const done = (r.statusName || '').toLowerCase() === 'completed' || !!r.completedIso;
      if (Number.isFinite(t) && t < now && !done) over.push(r);
      else up.push(r);
    }
    over.sort((a, b) => Date.parse(a.dueIso!) - Date.parse(b.dueIso!));
    up.sort((a, b) => Date.parse(a.dueIso!) - Date.parse(b.dueIso!));
    return { upcomingReminders: up.slice(0, 12), overdueReminders: over.slice(-12) };
  }, [reminders]);

  const brand = 'var(--brand, #0f766e)';
  const brandSoft = 'var(--brand-soft, #e6f7f5)';

  return (
    <div style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
      {/* Scoped responsive styles */}
      <style>{`
        .cp-card { border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; background: #fff; }
        .cp-muted { color: rgba(0,0,0,0.62); }
        .cp-grid-gap { display: grid; gap: 12px; }
        .cp-hero { position: relative; overflow: hidden; border-radius: 16px; }
        .cp-hero-img { position: absolute; inset: 0; object-fit: cover; filter: brightness(0.9) saturate(1.1); }
        .cp-hero-inner { padding: 28px 20px; min-height: 200px; }
        .cp-stat { padding: 10px 14px; min-width: 140px; }
        .cp-pets { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
        .cp-pet-img { height: 120px; }
        .cp-appt-row, .cp-rem-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
        }
        .cp-hide-xs { display: none; }
        .cp-section { margin-top: 28px; }
        h1.cp-title { margin: 12px 0 4px; font-size: 28px; }
        h2.cp-h2 { margin: 0 0 10px; font-size: 20px; }
        h3.cp-h3 { margin: 0 0 8px; font-size: 16px; }

        /* >= 480px */
        @media (min-width: 480px) {
          .cp-hero-inner { padding: 28px 24px; }
          .cp-pets { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
          .cp-pet-img { height: 130px; }
        }

        /* >= 640px (sm) */
        @media (min-width: 640px) {
          h1.cp-title { font-size: 32px; }
          .cp-hero-inner { padding: 32px 28px; min-height: 220px; }
          .cp-appt-row {
            grid-template-columns: 160px 1fr 1fr 1fr 120px; /* time | pet | type | addr | status */
          }
          .cp-rem-row {
            grid-template-columns: 140px 1fr 1fr 120px; /* date | pet | desc | status */
          }
          .cp-hide-xs { display: initial; }
          .cp-pet-img { height: 140px; }
        }

        /* >= 900px */
        @media (min-width: 900px) {
          .cp-pets { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
        }
      `}</style>

      {/* HERO */}
      <div
        className="cp-hero"
        style={{ background: `linear-gradient( to right, ${brandSoft}, #fff )` }}
      >
        <img src={heroImgUrl()} alt="" className="cp-hero-img" />
        <div className="cp-hero-inner">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.8)',
              borderRadius: 999,
              border: '1px solid rgba(0,0,0,0.05)',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 999,
                background: brand,
              }}
            />
            <span className="cp-muted" style={{ fontSize: 13 }}>
              You’re signed in as <strong style={{ color: 'inherit' }}>{userEmail}</strong>
            </span>
          </div>

          <h1 className="cp-title">Welcome to your Client Portal</h1>
          <p className="cp-muted" style={{ maxWidth: 640, margin: 0 }}>
            See your pets, manage subscriptions, and review upcoming visits—all in one place.
          </p>

          {/* Tiny stats */}
          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="cp-card cp-stat">
              <div className="cp-muted" style={{ fontSize: 12 }}>
                Pets
              </div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{pets.length}</div>
            </div>
            <div className="cp-card cp-stat" style={{ minWidth: 200 }}>
              <div className="cp-muted" style={{ fontSize: 12 }}>
                Next visit
              </div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>
                {upcomingAppts[0] ? fmtDateTime(upcomingAppts[0].startIso) : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NOTICES */}
      {loading && <div style={{ marginTop: 16 }}>Loading your information…</div>}
      {error && <div style={{ marginTop: 16, color: '#b00020' }}>{error}</div>}
      {enrollMsg && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            border: `1px solid ${brand}`,
            borderRadius: 8,
            color: brand,
            background: brandSoft,
          }}
        >
          {enrollMsg}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* PETS */}
          <section className="cp-section">
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <h2 className="cp-h2" style={{ margin: 0 }}>
                Your Pets
              </h2>
            </div>

            {pets.length === 0 ? (
              <div className="cp-muted">No pets found yet.</div>
            ) : (
              <div className="cp-pets">
                {pets.map((p) => {
                  const subStatus = p.subscription?.status;
                  const isActive = subStatus === 'active';
                  const isPending = subStatus === 'pending';

                  const wellnessNames = (p.wellnessPlans || [])
                    .map((w) => w.packageName || w.name)
                    .filter(Boolean)
                    .join(', ');

                  return (
                    <article
                      key={p.id}
                      className="cp-card"
                      style={{ borderRadius: 14, overflow: 'hidden' }}
                    >
                      <div
                        className="cp-pet-img"
                        style={{ position: 'relative', overflow: 'hidden' }}
                      >
                        <img
                          src={petImg(p)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        {isActive && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 10,
                              left: 10,
                              background: brand,
                              color: '#fff',
                              fontSize: 12,
                              padding: '4px 8px',
                              borderRadius: 999,
                            }}
                          >
                            Subscription Active
                          </span>
                        )}
                      </div>

                      <div style={{ padding: 12 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <strong
                            style={{
                              fontSize: 16,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {p.name}
                          </strong>
                          <span
                            className="cp-muted"
                            style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {p.id}
                          </span>
                        </div>

                        <div className="cp-muted" style={{ marginTop: 6, fontSize: 14 }}>
                          {p.species || p.breed
                            ? [p.species, p.breed].filter(Boolean).join(' • ')
                            : '—'}
                        </div>
                        {p.dob && (
                          <div className="cp-muted" style={{ marginTop: 4, fontSize: 12 }}>
                            DOB: {new Date(p.dob).toLocaleDateString()}
                          </div>
                        )}
                        <div className="cp-muted" style={{ marginTop: 8, fontSize: 13 }}>
                          <strong style={{ fontWeight: 600 }}>Wellness:</strong>{' '}
                          {wellnessNames || '—'}
                        </div>
                        {p.subscription?.name && (
                          <div className="cp-muted" style={{ marginTop: 10, fontSize: 12 }}>
                            {p.subscription.name} ({p.subscription.status})
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* UPCOMING APPOINTMENTS */}
          <section className="cp-section">
            <h2 className="cp-h2">Upcoming Appointments</h2>

            {upcomingAppts.length === 0 ? (
              <div className="cp-muted">No upcoming appointments.</div>
            ) : (
              <div className="cp-grid-gap">
                {upcomingByDay.map(({ key, label, items }) => (
                  <div key={key} className="cp-card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: brand,
                          flexShrink: 0,
                        }}
                      />
                      <h3 className="cp-h3" style={{ margin: 0 }}>
                        {label}
                      </h3>
                    </div>

                    <div className="cp-grid-gap" style={{ marginTop: 10 }}>
                      {items.map((a) => (
                        <div
                          key={a.id}
                          className="cp-card"
                          style={{ padding: 0, overflow: 'hidden' }}
                        >
                          <div className="cp-appt-row">
                            <div style={{ fontWeight: 600 }}>{fmtDateTime(a.startIso)}</div>
                            <div className="cp-muted">
                              <strong>{a.patientName ?? '—'}</strong>
                            </div>
                            <div className="cp-muted cp-hide-xs">
                              {a.appointmentTypeName ??
                                (typeof a.appointmentType === 'string'
                                  ? a.appointmentType
                                  : a.appointmentType?.name) ??
                                '—'}
                            </div>
                            <div
                              className="cp-muted cp-hide-xs"
                              style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {[a.address1, a.city, a.state, a.zip].filter(Boolean).join(', ') ||
                                '—'}
                            </div>
                            <div className="cp-muted cp-hide-xs" style={{ textAlign: 'right' }}>
                              {a.statusName ?? '—'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* UPCOMING REMINDERS */}
          <section className="cp-section">
            <h2 className="cp-h2">Upcoming Reminders</h2>
            {upcomingReminders.length === 0 ? (
              <div className="cp-muted">No upcoming reminders.</div>
            ) : (
              <div className="cp-grid-gap">
                {upcomingReminders.map((r) => (
                  <div key={r.id} className="cp-card">
                    <div className="cp-rem-row">
                      <div style={{ fontWeight: 600 }}>{fmtReminderDate(r)}</div>
                      <div className="cp-muted">
                        <strong>{r.patientName ?? '—'}</strong>
                      </div>
                      <div
                        className="cp-muted cp-hide-xs"
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {r.description ?? r.kind ?? '—'}
                      </div>
                      <div className="cp-muted cp-hide-xs" style={{ textAlign: 'right' }}>
                        {r.statusName ?? 'pending'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* OVERDUE / RECENT REMINDERS */}
          <section className="cp-section" style={{ marginBottom: 36 }}>
            <h3 className="cp-h3">Overdue / Recent Reminders</h3>
            {overdueReminders.length === 0 ? (
              <div className="cp-muted">No overdue or recent reminders.</div>
            ) : (
              <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                {overdueReminders.map((r) => (
                  <li key={r.id} style={{ marginBottom: 4 }}>
                    <strong>{r.patientName ?? '—'}</strong> — {r.description ?? r.kind ?? '—'} ·{' '}
                    {fmtOnlyDate(r.dueIso ?? r.dueDate)}{' '}
                    <span className="cp-muted">({r.statusName ?? 'pending'})</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* RECENT APPOINTMENTS */}
          <section className="cp-section" style={{ marginBottom: 36 }}>
            <h3 className="cp-h3">Recent Appointments</h3>
            {pastAppts.length === 0 ? (
              <div className="cp-muted">No recent appointments.</div>
            ) : (
              <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                {pastAppts.map((a) => (
                  <li key={a.id} style={{ marginBottom: 4 }}>
                    <strong>{a.patientName ?? '—'}</strong> — {fmtDateTime(a.startIso)} ·{' '}
                    {a.appointmentTypeName ??
                      (typeof a.appointmentType === 'string'
                        ? a.appointmentType
                        : a.appointmentType?.name) ??
                      '—'}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
