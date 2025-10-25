import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  fetchClientAppointments,
  fetchClientPets,
  enrollPetInPlan,
  type Pet,
  type ClientAppointment,
  // ⬇️ Uses your existing wellness-plans controller:
  fetchWellnessPlansForPatient,
  type WellnessPlan,
} from '../api/clientPortal';

/* Narrow helper type so we don’t rely on Pet having wellnessPlans baked in */
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

function heroImgUrl() {
  // Calming clinic / vet / animal vibe
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

  const [enrolling, setEnrolling] = useState<Record<string, boolean>>({});
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Load base pets + appointments
        const [pBase, a] = await Promise.all([fetchClientPets(), fetchClientAppointments()]);
        if (!alive) return;

        // IMPORTANT: fetch wellness plans using the INTERNAL DB id (p.dbId), never pimsId
        const petsWithWellness = await Promise.all(
          pBase.map(async (pet) => {
            try {
              const dbId = (pet as any).dbId as string | undefined;
              if (!dbId) {
                // no internal id available → don't call endpoint with pimsId
                return pet;
              }
              const plans = await fetchWellnessPlansForPatient(dbId); // <-- dbId, not pet.id
              const slim =
                plans?.map((pl) => ({
                  id: pl.id,
                  packageName: pl.package?.name ?? pl.packageName ?? null, // prefer package name
                  name: pl.name ?? null, // keep plan name as fallback
                })) ?? [];
              return { ...pet, wellnessPlans: slim };
            } catch {
              return pet;
            }
          })
        );

        setPets(petsWithWellness);

        const sorted = [...a].sort(
          (x, y) => new Date(x.startIso).getTime() - new Date(y.startIso).getTime()
        );
        setAppts(sorted);
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

  async function handleEnroll(pet: PetWithWellness) {
    try {
      setEnrollMsg(null);
      setEnrolling((s) => ({ ...s, [pet.id]: true }));
      const sub = await enrollPetInPlan(pet.id);
      setPets((list) =>
        list.map((p) =>
          p.id === pet.id ? { ...p, subscription: sub || { status: 'pending' as const } } : p
        )
      );
      setEnrollMsg(`Enrolled ${pet.name} successfully.`);
    } catch (e: any) {
      setEnrollMsg(e?.message || `Failed to enroll ${pet.name}.`);
    } finally {
      setEnrolling((s) => ({ ...s, [pet.id]: false }));
      setTimeout(() => setEnrollMsg(null), 3500);
    }
  }

  // brand helpers
  const brand = 'var(--brand, #0f766e)'; // teal-ish default if var not set
  const brandSoft = 'var(--brand-soft, #e6f7f5)';

  return (
    <div style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
      {/* HERO */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 16,
          background: `linear-gradient( to right, ${brandSoft}, #fff )`,
        }}
      >
        <img
          src={heroImgUrl()}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            objectFit: 'cover',
            filter: 'brightness(0.9) saturate(1.1)',
          }}
        />

        <div style={{ padding: '32px 28px', minHeight: 220 }}>
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
            <span className="muted" style={{ fontSize: 13 }}>
              You’re signed in as <strong style={{ color: 'inherit' }}>{userEmail}</strong>
            </span>
          </div>

          <h1 style={{ marginTop: 14, marginBottom: 6, fontSize: 32 }}>
            Welcome to your Client Portal
          </h1>
          <p className="muted" style={{ maxWidth: 640, margin: 0 }}>
            See your pets, manage subscriptions, and review upcoming visits—all in one place.
          </p>

          {/* Tiny stats */}
          <div
            style={{
              marginTop: 18,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div className="card" style={{ padding: '10px 14px', minWidth: 160 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Pets
              </div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{pets.length}</div>
            </div>
            <div className="card" style={{ padding: '10px 14px', minWidth: 220 }}>
              <div className="muted" style={{ fontSize: 12 }}>
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
      {loading && <div style={{ marginTop: 20 }}>Loading your information…</div>}
      {error && <div style={{ marginTop: 20, color: '#b00020' }}>{error}</div>}
      {enrollMsg && (
        <div
          style={{
            marginTop: 16,
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
          <section style={{ marginTop: 28 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <h2 style={{ margin: 0 }}>Your Pets</h2>
            </div>

            {pets.length === 0 ? (
              <div className="muted">No pets found yet.</div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 16,
                }}
              >
                {pets.map((p) => {
                  const subStatus = p.subscription?.status;
                  const isActive = subStatus === 'active';
                  const isPending = subStatus === 'pending';
                  const disabled = isActive || isPending || !!enrolling[p.id];

                  // Wellness package label(s)
                  const wellnessNames = (p.wellnessPlans || [])
                    .map((w) => w.packageName || w.name)
                    .filter(Boolean)
                    .join(', ');

                  return (
                    <article
                      key={p.id}
                      className="card"
                      style={{
                        borderRadius: 14,
                        overflow: 'hidden',
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        background: '#fff',
                      }}
                    >
                      <div style={{ position: 'relative', height: 140, overflow: 'hidden' }}>
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

                      <div style={{ padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong style={{ fontSize: 16 }}>{p.name}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {p.id}
                          </span>
                        </div>

                        <div className="muted" style={{ marginTop: 6, fontSize: 14 }}>
                          {p.species || p.breed
                            ? [p.species, p.breed].filter(Boolean).join(' • ')
                            : '—'}
                        </div>
                        {p.dob && (
                          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                            DOB: {new Date(p.dob).toLocaleDateString()}
                          </div>
                        )}

                        {/* ⬇️ Wellness package names */}
                        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                          <strong style={{ fontWeight: 600 }}>Wellness:</strong>{' '}
                          {wellnessNames || '—'}
                        </div>

                        <div
                          style={{
                            marginTop: 12,
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <button
                            className="btn"
                            onClick={() => handleEnroll(p)}
                            disabled={disabled}
                            style={{
                              opacity: disabled ? 0.7 : 1,
                              background: disabled ? undefined : brand,
                              borderColor: brand,
                            }}
                          >
                            {enrolling[p.id]
                              ? 'Enrolling…'
                              : isActive
                                ? 'Subscription Active'
                                : isPending
                                  ? 'Pending Activation'
                                  : 'Enroll in Membership'}
                          </button>
                          {p.subscription?.name && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              {p.subscription.name} ({p.subscription.status})
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* UPCOMING APPOINTMENTS */}
          <section style={{ marginTop: 36 }}>
            <h2 style={{ margin: '0 0 12px' }}>Upcoming Appointments</h2>

            {upcomingAppts.length === 0 ? (
              <div className="muted">No upcoming appointments.</div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {upcomingByDay.map(({ key, label, items }) => (
                  <div key={key} className="card" style={{ padding: 16 }}>
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
                      <h3 style={{ margin: 0 }}>{label}</h3>
                    </div>

                    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                      {items.map((a) => (
                        <div
                          key={a.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '160px 1fr 1fr 1fr 120px',
                            gap: 12,
                            alignItems: 'center',
                            padding: '10px 12px',
                            border: '1px solid rgba(0,0,0,0.06)',
                            borderRadius: 10,
                            background: '#fff',
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{fmtDateTime(a.startIso)}</div>
                          <div className="muted">{a.patientName ?? '—'}</div>
                          <div className="muted">
                            {a.appointmentTypeName ??
                              (typeof a.appointmentType === 'string'
                                ? a.appointmentType
                                : a.appointmentType?.name) ??
                              '—'}
                          </div>
                          <div className="muted">
                            {[a.address1, a.city, a.state, a.zip].filter(Boolean).join(', ') || '—'}
                          </div>
                          <div className="muted" style={{ textAlign: 'right' }}>
                            {a.statusName ?? '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* RECENT APPOINTMENTS */}
          <section style={{ marginTop: 32, marginBottom: 40 }}>
            <h3 style={{ margin: '0 0 8px' }}>Recent Appointments</h3>
            {pastAppts.length === 0 ? (
              <div className="muted">No recent appointments.</div>
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
