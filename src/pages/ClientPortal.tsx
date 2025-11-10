// src/pages/ClientPortal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import {
  fetchClientAppointments,
  fetchClientPets,
  type Pet,
  type ClientAppointment,
  fetchWellnessPlansForPatient,
  type WellnessPlan,
  fetchClientReminders,
  type ClientReminder,
} from '../api/clientPortal';
import { listMembershipTransactions } from '../api/membershipTransactions';

type PetWithWellness = Pet & {
  wellnessPlans?: Pick<WellnessPlan, 'id' | 'packageName' | 'name'>[];
  membershipStatus?: string | null;
  membershipPlanName?: string | null;
  membershipPricingOption?: string | null;
  membershipUpdatedAt?: string | null;
};

/* ---------------------------
   App Constants (edit me)
---------------------------- */
const CONTACT_PHONE = '+1-555-555-5555'; // TODO: set your real phone number
const CONTACT_EMAIL = 'support@yourpractice.com'; // TODO: set your real email
const BOOKING_PATH = '/booking'; // TODO: update if you use a different route
const CONTACT_PATH = '/contact'; // optional route if you have one

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

function planIsActive(plan: Pick<WellnessPlan, 'isActive' | 'status'> | null | undefined): boolean {
  if (!plan) return false;

  const direct =
    plan.isActive === true ||
    String(plan.isActive).toLowerCase() === 'true' ||
    String(plan.isActive) === '1';
  if (direct) return true;

  if (typeof (plan as any)?.active === 'boolean' && (plan as any).active) return true;
  if (typeof (plan as any)?.active === 'string') {
    const activeStr = String((plan as any).active).toLowerCase();
    if (activeStr === 'true' || activeStr === '1' || activeStr === 'active') return true;
  }

  const status = typeof plan.status === 'string' ? plan.status.toLowerCase() : undefined;
  return status === 'active';
}
function heroImgUrl() {
  return 'https://images.unsplash.com/photo-1601758123927-196d1b1e6c3f?q=80&w=1600&auto=format&fit=crop';
}
function encodeSvgData(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DOG_PLACEHOLDER = `${import.meta.env.BASE_URL ?? '/'}dog.png`;

const CAT_PLACEHOLDER = `${import.meta.env.BASE_URL ?? '/'}cat.jpg`;

function petImg(p: Pet) {
  const s = (p.species || p.breed || '').toLowerCase();
  if (s.includes('canine') || s.includes('dog')) {
    return DOG_PLACEHOLDER;
  }
  if (s.includes('feline') || s.includes('cat')) {
    return CAT_PLACEHOLDER;
  }
  if ('photoUrl' in p && (p as any).photoUrl) {
    return (p as any).photoUrl as string;
  }
  return CAT_PLACEHOLDER;
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
function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/* ---------------------------
   Page
---------------------------- */
export default function ClientPortal() {
  const { userEmail, userId } = useAuth() as any;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pets, setPets] = useState<PetWithWellness[]>([]);
  const [appts, setAppts] = useState<ClientAppointment[]>([]);
  const [reminders, setReminders] = useState<ClientReminder[]>([]);

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

        const clientIdForTransactions =
          typeof userId === 'string' && userId.trim().length
            ? userId
            : userId != null
            ? String(userId)
            : undefined;

        const petsWithWellness = await Promise.all(
          pBase.map(async (pet) => {
            const dbId = (pet as any).dbId as string | undefined;

            const [wellnessPlans, membershipInfo] = await Promise.all([
              (async () => {
                try {
                  if (!dbId) return null;
                  const plans = await fetchWellnessPlansForPatient(dbId);
                  const activePlans = plans?.filter((pl) => planIsActive(pl)) ?? [];
                  return (
                    activePlans.map((pl) => ({
                      id: pl.id,
                      packageName: pl.package?.name ?? pl.packageName ?? null,
                      name: pl.name ?? null,
                    })) ?? []
                  );
                } catch {
                  return null;
                }
              })(),
              (async () => {
                try {
                  const patientIdentifier = dbId ?? pet.id;
                  if (!patientIdentifier) return null;
                  const patientNumeric = Number(patientIdentifier);
                  if (!Number.isFinite(patientNumeric)) return null;

                  const queryClientId =
                    clientIdForTransactions ?? (pet as any)?.clientId ?? undefined;

                  const txns = await listMembershipTransactions({
                    patientId: patientNumeric,
                    clientId: queryClientId,
                  });
                  if (!Array.isArray(txns) || txns.length === 0) return null;
                  const sorted = txns
                    .slice()
                    .sort((a, b) => {
                      const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '');
                      const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '');
                      if (Number.isFinite(bTime) && Number.isFinite(aTime)) {
                        return bTime - aTime;
                      }
                      return (b.id ?? 0) - (a.id ?? 0);
                    });
                  return sorted[0] ?? null;
                } catch {
                  return null;
                }
              })(),
            ]);

            const membershipStatus = membershipInfo?.status ?? membershipInfo?.metadata?.status ?? null;
            const membershipPlanName =
              membershipInfo?.planName ??
              membershipInfo?.metadata?.planName ??
              null;
            const membershipPricingOption =
              membershipInfo?.pricingOption ??
              membershipInfo?.metadata?.billingPreference ??
              null;
            const membershipUpdatedAt =
              membershipInfo?.updatedAt ??
              membershipInfo?.createdAt ??
              null;

            return {
              ...pet,
              wellnessPlans: wellnessPlans ?? pet.wellnessPlans,
              membershipStatus,
              membershipPlanName,
              membershipPricingOption,
              membershipUpdatedAt,
            };
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

  function handleEnrollMembership(pet: PetWithWellness) {
    if (!pet.id) {
      return;
    }
    navigate('/client-portal/membership-signup', { state: { petId: pet.id } });
  }

  const brand = 'var(--brand, #0f766e)';
  const brandSoft = 'var(--brand-soft, #e6f7f5)';

  /* ---------------------------
     Bottom Nav Handlers
  ---------------------------- */
  function handleBook() {
    if (BOOKING_PATH) {
      window.location.assign(BOOKING_PATH);
    }
  }
  function handleContact() {
    if (CONTACT_PATH) {
      window.location.assign(CONTACT_PATH);
    } else {
      window.location.assign(`mailto:${CONTACT_EMAIL}`);
    }
  }
  function handleCall() {
    window.location.assign(`tel:${CONTACT_PHONE}`);
  }
  function handleMessages() {
    // If you have a /messages route or in-app inbox, navigate there:
    window.location.assign('/messages'); // TODO: update or remove if not used
  }

  return (
    <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
      {/* Scoped responsive styles */}
      <style>{`
        :root {
          --bottom-nav-h: 68px;
        }
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

        /* Bottom nav (hidden by default; shown on small screens) */
        .cp-bottom-nav {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          height: var(--bottom-nav-h);
          display: none;
          background: rgba(255,255,255,0.98);
          backdrop-filter: saturate(150%) blur(8px);
          border-top: 1px solid rgba(0,0,0,0.08);
          z-index: 1000;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .cp-bottom-inner {
          height: 100%;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          align-items: center;
          gap: 4px;
          max-width: 1120px;
          margin: 0 auto;
          padding: 0 8px;
        }
        .cp-tab {
          height: calc(var(--bottom-nav-h) - 10px - env(safe-area-inset-bottom));
          border: none;
          background: transparent;
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          font-size: 12px;
          color: #111;
          text-decoration: none;
        }
        .cp-tab:active { background: rgba(15, 118, 110, 0.08); }
        .cp-tab svg { width: 22px; height: 22px; }

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

        /* Show bottom nav & add bottom padding on small screens only */
        @media (max-width: 639px) {
          .cp-bottom-nav { display: block; }
          .cp-wrap { padding-bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 12px); }
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
                  const hasMembership = isActive || isPending;

                  const membershipStatusRaw = p.membershipStatus ?? null;
                  const membershipStatusNormalized = membershipStatusRaw
                    ? String(membershipStatusRaw).toLowerCase()
                    : null;
                  const membershipIsActive = membershipStatusNormalized === 'active';
                  const membershipIsPending = membershipStatusNormalized === 'pending';
                  const membershipPricingLabel = p.membershipPricingOption
                    ? titleCase(
                        String(p.membershipPricingOption)
                          .replace(/[_-]+/g, ' ')
                          .trim()
                      )
                    : null;
                  const membershipDisplayText = [
                    p.membershipPlanName ?? null,
                    membershipPricingLabel,
                  ]
                    .filter(Boolean)
                    .join(' • ');
                  const membershipStatusTitle = membershipStatusRaw
                    ? titleCase(String(membershipStatusRaw))
                    : null;
                  const membershipInfoLine =
                    membershipStatusTitle || membershipDisplayText
                      ? [
                          membershipDisplayText || 'Membership',
                          membershipStatusTitle ? `Status: ${membershipStatusTitle}` : null,
                        ]
                          .filter(Boolean)
                          .join(' • ')
                      : null;
                  const showMembershipNotice = membershipInfoLine != null;
                  
                  const wellnessNames = (p.wellnessPlans || [])
                    .map((w) => w.packageName || w.name)
                    .filter(Boolean)
                    .join(', ');
                  
                  const hasWellnessPlans = (p.wellnessPlans || []).length > 0;
                  const showMembershipButton =
                    !hasMembership && !hasWellnessPlans && !membershipIsActive;

                  const badgeLabel = isActive
                    ? 'Subscription Active'
                    : isPending
                    ? 'Subscription Pending'
                    : membershipIsActive
                    ? 'Membership Active'
                    : membershipIsPending
                    ? 'Membership Pending'
                    : null;
                  const badgeColor =
                    isActive || membershipIsActive
                      ? brand
                      : '#f97316';

                  return (
                    <article
                      key={p.id}
                      className="cp-card"
                      style={{ borderRadius: 14, overflow: 'hidden' }}
                    >
                      <div
                        className="cp-pet-img"
                        style={{
                          position: 'relative',
                          overflow: 'hidden',
                          background: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundImage: `url(${petImg(p)})`,
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: 'center',
                          backgroundSize: 'contain',
                        }}
                      >
                        {badgeLabel && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 10,
                              left: 10,
                              background: badgeColor,
                              color: '#fff',
                              fontSize: 12,
                              padding: '4px 8px',
                              borderRadius: 999,
                            }}
                          >
                            {badgeLabel}
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

                        <div className="cp-muted" style={{ marginTop: 4, fontSize: 12 }}>
                          <strong style={{ fontWeight: 600 }}>Primary Provider:</strong>{' '}
                          {p.primaryProviderName || '—'}
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
                        {showMembershipNotice && (
                          <div className="cp-muted" style={{ marginTop: 6, fontSize: 13 }}>
                            <strong style={{ fontWeight: 600 }}>Membership:</strong>{' '}
                            {membershipInfoLine}
                          </div>
                        )}
                        {p.subscription?.name && (
                          <div className="cp-muted" style={{ marginTop: 10, fontSize: 12 }}>
                            {p.subscription.name} ({p.subscription.status})
                          </div>
                        )}
                        
                        {showMembershipButton && (
                          <button
                            onClick={() => handleEnrollMembership(p)}
                            style={{
                              marginTop: 12,
                              width: '100%',
                              padding: '8px 12px',
                              backgroundColor: brand,
                              color: '#fff',
                              border: 'none',
                              borderRadius: 8,
                              fontSize: 14,
                              fontWeight: 600,
                              cursor: 'pointer',
                              transition: 'opacity 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.opacity = '0.9';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.opacity = '1';
                            }}
                          >
                            Sign up for Membership
                          </button>
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

      {/* ---------------------------
          Mobile Bottom Navigation
          (shows only under 640px)
      ---------------------------- */}
      <nav className="cp-bottom-nav" aria-label="Primary">
        <div className="cp-bottom-inner">
          <button className="cp-tab" onClick={handleBook} aria-label="Book an appointment">
            {/* calendar-plus icon (inline svg) */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="20" />
              <line x1="9" y1="17" x2="15" y2="17" />
            </svg>
            <span>Book</span>
          </button>

          <button className="cp-tab" onClick={handleContact} aria-label="Contact us">
            {/* chat-bubble */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
            <span>Contact</span>
          </button>

          <button className="cp-tab" onClick={handleCall} aria-label="Call us">
            {/* phone */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.77.59 2.6a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.48-1.11a2 2 0 0 1 2.11-.45c.83.27 1.7.47 2.6.59A2 2 0 0 1 22 16.92z" />
            </svg>
            <span>Call</span>
          </button>

          <button className="cp-tab" onClick={handleMessages} aria-label="Messages">
            {/* inbox */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5 7h14l3 5v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-6l3-5z" />
            </svg>
            <span>Messages</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
