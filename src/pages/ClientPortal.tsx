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
  const { userEmail, userId, logout } = useAuth() as any;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pets, setPets] = useState<PetWithWellness[]>([]);
  const [appts, setAppts] = useState<ClientAppointment[]>([]);
  const [reminders, setReminders] = useState<ClientReminder[]>([]);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedPetReminders, setSelectedPetReminders] = useState<{
    pet: PetWithWellness;
    reminders: ClientReminder[];
  } | null>(null);

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

  // Get all reminders for a specific pet (not limited)
  const getAllPetReminders = (pet: PetWithWellness): ClientReminder[] => {
    const petId = pet.id;
    const petDbId = (pet as any).dbId;

    return reminders
      .filter((r) => {
        // Filter by patient ID
        const matchesPatient =
          r.patientId === petId ||
          r.patientId === petDbId ||
          String(r.patientId) === String(petId) ||
          String(r.patientId) === String(petDbId);

        if (!matchesPatient) return false;

        // Filter out completed reminders
        const done = (r.statusName || '').toLowerCase() === 'completed' || !!r.completedIso;
        if (done) return false;

        return true;
      })
      .sort((a, b) => {
        const ta = a.dueIso ? Date.parse(a.dueIso) : Number.POSITIVE_INFINITY;
        const tb = b.dueIso ? Date.parse(b.dueIso) : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
  };

  // Get reminders for display (max 3)
  const getPetReminders = (pet: PetWithWellness): ClientReminder[] => {
    return getAllPetReminders(pet).slice(0, 3);
  };

  const isReminderOverdue = (r: ClientReminder): boolean => {
    if (!r.dueIso) return false;
    const t = Date.parse(r.dueIso);
    return Number.isFinite(t) && t < Date.now();
  };

  const isReminderUpcoming = (r: ClientReminder): boolean => {
    if (!r.dueIso) return false;
    const t = Date.parse(r.dueIso);
    return Number.isFinite(t) && t >= Date.now();
  };

  // Check if any pet has an active plan (subscription, membership, or wellness plan)
  const hasAnyPetWithPlan = useMemo(() => {
    return pets.some((p) => {
      const hasSubscription = p.subscription?.status === 'active' || p.subscription?.status === 'pending';
      const hasMembership = p.membershipStatus === 'active' || p.membershipStatus === 'pending';
      const hasWellnessPlan = (p.wellnessPlans || []).length > 0;
      return hasSubscription || hasMembership || hasWellnessPlan;
    });
  }, [pets]);

  // Get primary provider name for email (format: first initial + last name, lowercase)
  const getProviderEmail = (providerName?: string | null): string => {
    if (!providerName) return 'support@vetatyourdoor.com';
    const parts = providerName.trim().split(/\s+/);
    if (parts.length === 0) return 'support@vetatyourdoor.com';
    if (parts.length === 1) return `${parts[0].toLowerCase()}@vetatyourdoor.com`;
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const emailName = `${firstName.charAt(0)}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${emailName}@vetatyourdoor.com`;
  };

  // Get the most common primary provider from pets, or use first one
  const primaryProviderEmail = useMemo(() => {
    const providers = pets.map(p => p.primaryProviderName).filter(Boolean) as string[];
    if (providers.length === 0) return 'support@vetatyourdoor.com';
    // Get the most common provider, or first one
    const providerCounts = new Map<string, number>();
    providers.forEach(p => providerCounts.set(p, (providerCounts.get(p) || 0) + 1));
    const sortedProviders = Array.from(providerCounts.entries()).sort((a, b) => b[1] - a[1]);
    const mostCommonProvider = sortedProviders[0]?.[0] || providers[0];
    return getProviderEmail(mostCommonProvider);
  }, [pets]);

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
    window.open('https://form.jotform.com/221585880190157', '_blank');
  }
  function handleContact() {
    // If pet has plan, use chat; otherwise use email
    if (hasAnyPetWithPlan) {
      window.open('https://direct.lc.chat/19087357/', '_blank');
    } else {
      window.location.assign(`mailto:${primaryProviderEmail}`);
    }
  }
  function handleCall() {
    window.location.assign('tel:207-536-8387');
  }
  function handleMessages() {
    window.location.assign('sms:207-536-8387');
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
        .cp-pet-card { display: grid; grid-template-rows: auto 1fr auto; height: 100%; }
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
          .cp-service-actions-mobile { display: block !important; }
          .cp-service-actions-desktop { display: none !important; }
        }

        /* Show desktop buttons on larger screens */
        @media (min-width: 640px) {
          .cp-service-actions-mobile { display: none !important; }
          .cp-service-actions-desktop { display: grid !important; }
        }
      `}</style>

      {/* HERO - Logo */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: '32px',
          marginTop: '16px',
          background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
          padding: '20px',
          borderRadius: '16px',
        }}
      >
        <img
          src="/final_thick_lines_cropped.jpeg"
          alt="Vet At Your Door logo"
          style={{
            width: 'min(320px, 60vw)',
            maxWidth: 360,
            height: 'auto',
            mixBlendMode: 'multiply',
          }}
        />
      </div>

      {/* NOTICES */}
      {loading && <div style={{ marginTop: 16 }}>Loading your information…</div>}
      {error && <div style={{ marginTop: 16, color: '#b00020' }}>{error}</div>}

      {!loading && !error && (
        <>
          {/* SERVICE ACTION BUTTONS */}
          <section className="cp-section" style={{ marginTop: 28 }}>
            {/* Mobile View - Card with List */}
            <div className="cp-service-actions-mobile" style={{ display: 'none' }}>
              <div className="cp-card" style={{ padding: 20, borderRadius: 14 }}>
                <div style={{ marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>
                    Vet At Your Door
                  </div>
                  <div style={{ fontSize: 14, color: '#6b7280' }}>
                    Open Now 8:00 AM – 5:00 PM
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <a
                    href="https://form.jotform.com/221585880190157"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 12px',
                      textDecoration: 'none',
                      color: '#111827',
                      borderBottom: '1px solid #e5e7eb',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Request An Appointment</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, color: '#9ca3af' }}>
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </a>
                  <a
                    href="tel:207-536-8387"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 12px',
                      textDecoration: 'none',
                      color: '#111827',
                      borderBottom: '1px solid #e5e7eb',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Call us</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, color: '#9ca3af' }}>
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </a>
                  <a
                    href="sms:207-536-8387"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 12px',
                      textDecoration: 'none',
                      color: '#111827',
                      borderBottom: '1px solid #e5e7eb',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Text us</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, color: '#9ca3af' }}>
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </a>
                  <a
                    href={`mailto:${primaryProviderEmail}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 12px',
                      textDecoration: 'none',
                      color: '#111827',
                      borderBottom: '1px solid #e5e7eb',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Email Us</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, color: '#9ca3af' }}>
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </a>
                  <a
                    href="https://www.vetatyourdoor.com/online-pharmacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 12px',
                      textDecoration: 'none',
                      color: '#111827',
                      borderBottom: '1px solid #e5e7eb',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <path d="M16 10a4 4 0 0 1-8 0"></path>
                      </svg>
                    </div>
                    <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Shop Our Online Pharmacy</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, color: '#9ca3af' }}>
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </a>
                  {hasAnyPetWithPlan && (
                    <a
                      href="https://direct.lc.chat/19087357/"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '14px 12px',
                        textDecoration: 'none',
                        color: '#111827',
                        gap: 12,
                      }}
                    >
                      <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                      </div>
                      <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Chat now</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, color: '#9ca3af' }}>
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Desktop View - Button Grid */}
            <div className="cp-service-actions-desktop" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <a
                href="https://form.jotform.com/221585880190157"
                target="_blank"
                rel="noopener noreferrer"
                className="cp-card"
                style={{
                  padding: '16px 20px',
                  textDecoration: 'none',
                  color: '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: 12,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <div style={{ fontSize: 20, color: '#3b82f6' }}>📅</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Request An Appointment</span>
              </a>
              <a
                href="tel:207-536-8387"
                className="cp-card"
                style={{
                  padding: '16px 20px',
                  textDecoration: 'none',
                  color: '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: 12,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <div style={{ fontSize: 20, color: '#10b981' }}>📞</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Call Us</span>
              </a>
              <a
                href="sms:207-536-8387"
                className="cp-card"
                style={{
                  padding: '16px 20px',
                  textDecoration: 'none',
                  color: '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: 12,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <div style={{ fontSize: 20, color: '#10b981' }}>💬</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Text Us</span>
              </a>
              <a
                href={`mailto:${primaryProviderEmail}`}
                className="cp-card"
                style={{
                  padding: '16px 20px',
                  textDecoration: 'none',
                  color: '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: 12,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <div style={{ fontSize: 20, color: '#a855f7' }}>✉️</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Email Us</span>
              </a>
              <a
                href="https://www.vetatyourdoor.com/online-pharmacy"
                target="_blank"
                rel="noopener noreferrer"
                className="cp-card"
                style={{
                  padding: '16px 20px',
                  textDecoration: 'none',
                  color: '#111827',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: 12,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <div style={{ fontSize: 20, color: '#3b82f6' }}>💊</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Shop Online Pharmacy</span>
              </a>
              {hasAnyPetWithPlan && (
                <a
                  href="https://direct.lc.chat/19087357/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cp-card"
                  style={{
                    padding: '16px 20px',
                    textDecoration: 'none',
                    color: '#111827',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    borderRadius: 12,
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  <div style={{ fontSize: 20, color: '#3b82f6' }}>💬</div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Chat Now</span>
                </a>
              )}
            </div>
          </section>

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
                  const membershipDisplayText = (() => {
                    const parts: string[] = [];
                    if (p.membershipPlanName) parts.push(p.membershipPlanName);
                    if (membershipPricingLabel) parts.push(membershipPricingLabel);
                    return parts.join(' • ');
                  })();
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
                      className="cp-card cp-pet-card"
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
                        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                          {showMembershipNotice && (
                            <div className="cp-muted" style={{ fontSize: 13 }}>
                              <strong style={{ fontWeight: 600 }}>Membership:</strong>{' '}
                              {membershipInfoLine}
                            </div>
                          )}
                          {p.subscription?.name && (
                            <div className="cp-muted" style={{ fontSize: 12 }}>
                              {p.subscription.name} ({p.subscription.status})
                            </div>
                          )}
                        </div>

                        {/* Reminders for this pet */}
                        {(() => {
                          const allPetReminders = getAllPetReminders(p);
                          const displayedReminders = allPetReminders.slice(0, 3);
                          const hasMore = allPetReminders.length > 3;

                          if (allPetReminders.length === 0) return null;

                          return (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#111827' }}>
                                Reminders
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {displayedReminders.map((r) => {
                                  const overdue = isReminderOverdue(r);
                                  const upcoming = isReminderUpcoming(r);
                                  return (
                                    <div
                                      key={r.id}
                                      style={{
                                        fontSize: 12,
                                        color: overdue ? '#dc2626' : '#374151',
                                        fontWeight: upcoming ? 700 : 400,
                                      }}
                                    >
                                      {fmtReminderDate(r)} — {r.description ?? r.kind ?? '—'}
                                    </div>
                                  );
                                })}
                                {hasMore && (
                                  <button
                                    onClick={() => {
                                      setSelectedPetReminders({ pet: p, reminders: allPetReminders });
                                      setShowReminderModal(true);
                                    }}
                                    style={{
                                      marginTop: 4,
                                      fontSize: 12,
                                      color: '#10b981',
                                      background: 'transparent',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: 0,
                                      textAlign: 'left',
                                      fontWeight: 600,
                                    }}
                                  >
                                    More...
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div style={{ padding: '0 12px 12px' }}>
                        {showMembershipButton && (
                          <button
                            onClick={() => handleEnrollMembership(p)}
                            style={{
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

          {/* Reminder Modal */}
          {showReminderModal && selectedPetReminders && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '20px',
              }}
              onClick={() => {
                setShowReminderModal(false);
                setSelectedPetReminders(null);
              }}
            >
              <div
                className="cp-card"
                style={{
                  maxWidth: '500px',
                  width: '100%',
                  maxHeight: '80vh',
                  overflowY: 'auto',
                  padding: '24px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h2 className="cp-h2" style={{ margin: 0 }}>
                    Reminders for {selectedPetReminders.pet.name}
                  </h2>
                  <button
                    onClick={() => {
                      setShowReminderModal(false);
                      setSelectedPetReminders(null);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      fontSize: 24,
                      cursor: 'pointer',
                      color: '#6b7280',
                      padding: '0 8px',
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {selectedPetReminders.reminders.map((r) => {
                    const overdue = isReminderOverdue(r);
                    const upcoming = isReminderUpcoming(r);
                    return (
                      <div
                        key={r.id}
                        style={{
                          padding: '12px',
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          backgroundColor: '#fff',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 14,
                            color: overdue ? '#dc2626' : '#374151',
                            fontWeight: upcoming ? 700 : 400,
                            marginBottom: 4,
                          }}
                        >
                          {fmtReminderDate(r)}
                        </div>
                        <div style={{ fontSize: 14, color: '#6b7280' }}>
                          {r.description ?? r.kind ?? '—'}
                        </div>
                        {r.statusName && (
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                            Status: {r.statusName}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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
