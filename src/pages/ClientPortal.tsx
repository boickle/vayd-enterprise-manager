// src/pages/ClientPortal.tsx — pet-first client portal
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  fetchClientAppointments,
  fetchClientPets,
  fetchWellnessPlansForPatient,
  fetchClientReminders,
  fetchClientChronicMeds,
  fetchClientInfo,
  fetchPortalProviders,
  fetchMyRememberedPets,
  togglePetLove,
  updateMyPetProfile,
  getClientRoomLoaderPdfHref,
  getClientRoomLoaderFormPath,
  type ClientAppointment,
  type ClientReminder,
  type PetPortalProfilePatch,
  type PortalProvider,
  type RememberedPet,
} from '../api/clientPortal';
import { formatDeclinedDate, type DeclinedTreatmentItem } from '../api/declinedTreatments';
import { fetchClientChatHoursOfOperation } from '../api/chatHoursOfOperation';
import { defaultChatHoursOfOperation, formatChatHoursSchedule, isChatOpen, type ChatHoursOfOperation } from '../utils/chatHours';
import { listMembershipTransactions } from '../api/membershipTransactions';
import { http } from '../api/http';
import PatientPhotoGalleryModal from '../components/pims/PatientPhotoGalleryModal';
import VaccinationCertificateModal from '../components/VaccinationCertificateModal';
import { trackEvent } from '../utils/analytics';
import { appAlert } from '../utils/appDialog';
import { publicStoreProducts } from '../api/onlineStore';
import { addToStoreCart, rememberStorePortalReturn } from './store/storeCartState';
import type { PatientPrescription } from '../api/visitWorkflow';
import { currentPracticeId } from '../utils/practiceIdFromToken';

import './clientPortal/ClientPortal.css';
import { CardHead, Icon, Toast } from './clientPortal/PortalPrimitives';
import PetHero, { type HeroStat } from './clientPortal/PetHero';
import PetAboutCard from './clientPortal/PetAboutCard';
import PetSpotlightConsentCard from './clientPortal/PetSpotlightConsentCard';
import CommunitySnapshotsCard from './clientPortal/CommunitySnapshotsCard';
import ProviderBioModal from './clientPortal/ProviderBioModal';
import EmailCertificateModal from './clientPortal/EmailCertificateModal';
import ReferralModal from './clientPortal/ReferralModal';
import PreferencesModal from './clientPortal/PreferencesModal';
import AutoshipManageModal from './clientPortal/AutoshipManageModal';
import RememberedPetsCard from './clientPortal/RememberedPetsCard';
import RenewalBanner from './clientPortal/RenewalBanner';
import MembershipBenefitsModal, { membershipPerkLines } from './clientPortal/MembershipBenefitsModal';
import { PortalModal } from './clientPortal/PortalPrimitives';
import {
  APPOINTMENT_REQUEST_URL,
  LIVE_CHAT_URL,
  LOGO_SRC,
  PRACTICE_INFO_EMAIL,
  PRACTICE_PHONE_DISPLAY,
  PRACTICE_PHONE_SMS,
  PRACTICE_PHONE_TEL,
  apptAddress,
  apptMatchesPet,
  apptTypeLabel,
  computeMembershipView,
  daysUntil,
  fmtReminderDate,
  fmtShortDate,
  fmtTime,
  groupApptsByDay,
  petImg,
  petMatchesId,
  planIsActive,
  possessive,
  providerEmailFromName,
  relativeDay,
  type PetWithWellness,
} from './clientPortal/portalShared';

const STORE_PRACTICE_ID = currentPracticeId();

function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function ClientPortal() {
  const { userEmail, userId, logout, clientInfo, token } = useAuth() as any;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ---------------- data ---------------- */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pets, setPets] = useState<PetWithWellness[]>([]);
  const [rememberedPets, setRememberedPets] = useState<RememberedPet[]>([]);
  const [chronicByPet, setChronicByPet] = useState<Record<string, PatientPrescription[]>>({});
  const [appts, setAppts] = useState<ClientAppointment[]>([]);
  const [rawApptsData, setRawApptsData] = useState<any[]>([]);
  const [reminders, setReminders] = useState<ClientReminder[]>([]);
  const [declinedItems, setDeclinedItems] = useState<DeclinedTreatmentItem[]>([]);
  const [chatHours, setChatHours] = useState<ChatHoursOfOperation>(defaultChatHoursOfOperation());
  const [localClientInfo, setLocalClientInfo] = useState<any | null>(null);
  const [providers, setProviders] = useState<PortalProvider[]>([]);
  /** Inventory items sold in the online store; null until loaded (or if the store can't be reached). */
  const [storeItemIds, setStoreItemIds] = useState<Set<number> | null>(null);

  useEffect(() => {
    let alive = true;
    publicStoreProducts(STORE_PRACTICE_ID)
      .then((listings) => {
        if (!alive) return;
        const ids = new Set<number>();
        for (const l of listings) for (const v of l.variants ?? []) if (v.inventoryItemId) ids.add(Number(v.inventoryItemId));
        setStoreItemIds(ids);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------- ui state ---------------- */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [showPreferences, setShowPreferences] = useState(searchParams.get('preferences') === '1');
  const [showProviderBio, setShowProviderBio] = useState(false);
  const [remindersModalPet, setRemindersModalPet] = useState<PetWithWellness | null>(null);
  const [certificatePet, setCertificatePet] = useState<PetWithWellness | null>(null);
  const [emailCertPet, setEmailCertPet] = useState<PetWithWellness | null>(null);
  const [galleryPet, setGalleryPet] = useState<PetWithWellness | null>(null);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const [autoOpenPhotos, setAutoOpenPhotos] = useState(searchParams.get('photos') === '1');
  const [showAllPetsAppts, setShowAllPetsAppts] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nicknameEditRequest, setNicknameEditRequest] = useState(0);
  const [benefitsPet, setBenefitsPet] = useState<PetWithWellness | null>(null);
  const [autoshipRx, setAutoshipRx] = useState<{ pet: PetWithWellness; rx: PatientPrescription } | null>(null);

  const aboutRef = useRef<HTMLDivElement>(null);
  const remindersRef = useRef<HTMLDivElement>(null);
  const medsRef = useRef<HTMLDivElement>(null);
  const apptsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pageTopRef = useRef<HTMLDivElement>(null);

  // Clear one-shot query params (preferences / photos) after reading them.
  useEffect(() => {
    if (!searchParams.has('preferences') && !searchParams.has('photos')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('preferences');
    next.delete('photos');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Fetch client info if not available in auth context
  useEffect(() => {
    if (!clientInfo && userId && token) {
      fetchClientInfo(userId)
        .then((info) => {
          if (info) {
            setLocalClientInfo(info);
            try {
              localStorage.setItem('vayd_clientInfo', JSON.stringify(info));
            } catch {}
          }
        })
        .catch((err) => console.warn('Failed to fetch client info:', err));
    }
  }, [clientInfo, userId, token]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pBase, a, r, loadedChatHours, provs] = await Promise.all([
          fetchClientPets(),
          fetchClientAppointments(),
          fetchClientReminders(),
          fetchClientChatHoursOfOperation(),
          fetchPortalProviders().catch(() => [] as PortalProvider[]),
        ]);

        try {
          const { data: rawApptsResponse } = await http.get('/appointments/client');
          const rawAppts = Array.isArray(rawApptsResponse)
            ? rawApptsResponse
            : (rawApptsResponse?.appointments ?? rawApptsResponse ?? []);
          if (alive) setRawApptsData(rawAppts);
        } catch (err) {
          console.warn('Failed to fetch raw appointment data for client info:', err);
        }

        if (!alive) return;
        setChatHours(loadedChatHours);
        setProviders(provs);

        const clientIdForTransactions =
          typeof userId === 'string' && userId.trim().length ? userId : userId != null ? String(userId) : undefined;

        const petsWithWellness = await Promise.all(
          pBase.map(async (pet) => {
            const dbId = pet.dbId;
            const [wellnessPlans, membershipInfo] = await Promise.all([
              (async () => {
                try {
                  if (!dbId) return null;
                  return (await fetchWellnessPlansForPatient(dbId)) ?? [];
                } catch {
                  return null;
                }
              })(),
              (async () => {
                try {
                  const patientIdentifier = dbId ?? pet.id;
                  const patientNumeric = Number(patientIdentifier);
                  if (!Number.isFinite(patientNumeric)) return null;
                  const txns = await listMembershipTransactions({
                    patientId: patientNumeric,
                    clientId: clientIdForTransactions ?? (pet as any)?.clientId ?? undefined,
                  });
                  if (!Array.isArray(txns) || txns.length === 0) return null;
                  return (
                    txns.slice().sort((x, y) => {
                      const xt = Date.parse(x.updatedAt ?? x.createdAt ?? '');
                      const yt = Date.parse(y.updatedAt ?? y.createdAt ?? '');
                      if (Number.isFinite(yt) && Number.isFinite(xt)) return yt - xt;
                      return (y.id ?? 0) - (x.id ?? 0);
                    })[0] ?? null
                  );
                } catch {
                  return null;
                }
              })(),
            ]);

            const plansSelected = (membershipInfo as any)?.plansSelected;
            const pricingFromPlansSelected =
              Array.isArray(plansSelected) && plansSelected.length > 0 ? plansSelected[0]?.pricingOption : null;

            return {
              ...pet,
              wellnessPlans: wellnessPlans ?? pet.wellnessPlans,
              membershipStatus: membershipInfo?.status ?? membershipInfo?.metadata?.status ?? null,
              membershipPlanName: membershipInfo?.planName ?? membershipInfo?.metadata?.planName ?? null,
              membershipPricingOption:
                membershipInfo?.pricingOption ?? pricingFromPlansSelected ?? membershipInfo?.metadata?.billingPreference ?? null,
              membershipUpdatedAt: membershipInfo?.updatedAt ?? membershipInfo?.createdAt ?? null,
            } as PetWithWellness;
          }),
        );

        if (!alive) return;
        setPets(petsWithWellness);

        // Pets the family has lost — shown in a quiet remembrance section. Best-effort.
        void fetchMyRememberedPets()
          .then((rows) => {
            if (alive) setRememberedPets(rows);
          })
          .catch(() => undefined);

        const chronicEntries = await Promise.all(
          petsWithWellness.map(async (pet) => {
            const id = Number(pet.dbId);
            if (!Number.isFinite(id)) return [pet.id, []] as const;
            try {
              return [pet.id, await fetchClientChronicMeds(id)] as const;
            } catch {
              return [pet.id, []] as const;
            }
          }),
        );
        if (!alive) return;
        setChronicByPet(Object.fromEntries(chronicEntries));
        setAppts([...a].sort((x, y) => +new Date(x.startIso) - +new Date(y.startIso)));
        setReminders([...r.reminders].sort((x, y) => Date.parse(x.dueIso ?? '') - Date.parse(y.dueIso ?? '')));
        setDeclinedItems(r.declinedItems);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- derived ---------------- */
  const clientFirstName = useMemo(() => {
    const info = clientInfo || localClientInfo;
    const emailLower = (userEmail || '').toLowerCase();
    if (info) {
      if (info.secondEmail && info.secondEmail.toLowerCase() === emailLower && info.secondFirstName) return info.secondFirstName;
      const primaryEmail = info.email || info.primaryEmail;
      if (primaryEmail && primaryEmail.toLowerCase() === emailLower && info.firstName) return info.firstName;
      if (info.firstName) return info.firstName;
      if (info.secondFirstName) return info.secondFirstName;
    }
    for (const rawAppt of rawApptsData) {
      const client = rawAppt?.client;
      if (client?.secondEmail && client.secondEmail.toLowerCase() === emailLower && client.secondFirstName) {
        return client.secondFirstName;
      }
    }
    const firstAppt = appts[0];
    if (firstAppt?.clientName) return firstAppt.clientName.split(' ')[0];
    if (!userEmail) return null;
    const emailPart = userEmail.split('@')[0];
    return emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
  }, [clientInfo, localClientInfo, appts, userEmail, rawApptsData]);

  // Enrich pets with provider names from appointments if missing
  const petsWithProvider = useMemo(() => {
    return pets.map((pet) => {
      if (pet.primaryProviderName) return pet;
      for (const appt of appts.filter((a) => apptMatchesPet(a, pet))) {
        const x = appt as any;
        const providerName =
          x?.patientPrimaryProvider?.name ||
          x?.patient?.primaryProvider?.name ||
          x?.doctor?.name ||
          x?.doctorName ||
          x?.provider?.name ||
          x?.providerName ||
          (x?.doctor?.firstName && x?.doctor?.lastName ? `${x.doctor.firstName} ${x.doctor.lastName}` : null);
        if (typeof providerName === 'string' && providerName.trim()) return { ...pet, primaryProviderName: providerName.trim() };
      }
      return pet;
    });
  }, [pets, appts]);

  // Selected pet (from ?pet= deep link, else first).
  useEffect(() => {
    if (petsWithProvider.length === 0) return;
    if (selectedKey && petsWithProvider.some((p) => p.id === selectedKey)) return;
    const wanted = searchParams.get('pet');
    const match = wanted ? petsWithProvider.find((p) => petMatchesId(p, wanted)) : null;
    setSelectedKey((match ?? petsWithProvider[0]).id);
  }, [petsWithProvider, selectedKey, searchParams]);

  const selectedPet = useMemo(
    () => petsWithProvider.find((p) => p.id === selectedKey) ?? petsWithProvider[0] ?? null,
    [petsWithProvider, selectedKey],
  );

  const membership = useMemo(() => (selectedPet ? computeMembershipView(selectedPet) : null), [selectedPet]);

  const selectedProvider = useMemo<PortalProvider | null>(() => {
    if (!selectedPet) return null;
    const pid = selectedPet.primaryProviderId;
    if (pid != null) {
      const byId = providers.find((p) => String(p.id) === String(pid));
      if (byId) return byId;
    }
    const nm = (selectedPet.primaryProviderName || '').trim().toLowerCase();
    if (nm) {
      const byName = providers.find((p) => {
        const full = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim().toLowerCase();
        return p.name.toLowerCase() === nm || (full && full === nm) || (p.lastName && nm.endsWith(p.lastName.toLowerCase()));
      });
      if (byName) return byName;
    }
    return null;
  }, [selectedPet, providers]);

  const isChatHoursOpen = useMemo(() => isChatOpen(chatHours), [chatHours]);
  const chatHoursLines = useMemo(() => formatChatHoursSchedule(chatHours), [chatHours]);
  /** Compact text like "Sat–Sun 8:00 AM – 5:00 PM · Mon–Fri Closed" (merges consecutive days with equal hours). */
  const formattedChatHours = useMemo(() => {
    // Start the week on Monday so weekend hours collapse to "Sat–Sun".
    const lines =
      chatHoursLines.length > 0 && /^sun/i.test(chatHoursLines[0].day)
        ? [...chatHoursLines.slice(1), chatHoursLines[0]]
        : chatHoursLines;
    const groups: { from: string; to: string; hours: string }[] = [];
    for (const line of lines) {
      const last = groups[groups.length - 1];
      if (last && last.hours === line.hours) last.to = line.day;
      else groups.push({ from: line.day, to: line.day, hours: line.hours });
    }
    const open = groups.filter((g) => g.hours !== 'Closed');
    const src = open.length > 0 ? open : groups;
    return src.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.hours}`).join(' · ');
  }, [chatHoursLines]);

  const getAllPetReminders = useCallback(
    (pet: PetWithWellness): ClientReminder[] =>
      reminders
        .filter((r) => {
          if (!petMatchesId(pet, r.patientId)) return false;
          const done = (r.statusName || '').toLowerCase() === 'completed' || !!r.completedIso;
          return !done;
        })
        .sort((a, b) => {
          const ta = a.dueIso ? Date.parse(a.dueIso) : Number.POSITIVE_INFINITY;
          const tb = b.dueIso ? Date.parse(b.dueIso) : Number.POSITIVE_INFINITY;
          return ta - tb;
        }),
    [reminders],
  );

  const petDeclined = useCallback(
    (pet: PetWithWellness) =>
      declinedItems.filter((item) => item.patientId == null || petMatchesId(pet, item.patientId)),
    [declinedItems],
  );

  const upcomingAppts = useMemo(() => {
    const now = Date.now();
    return appts.filter((a) => new Date(a.startIso).getTime() >= now);
  }, [appts]);

  const selectedUpcoming = useMemo(() => {
    if (!selectedPet) return [];
    return upcomingAppts.filter((a) => apptMatchesPet(a, selectedPet));
  }, [upcomingAppts, selectedPet]);

  const apptsToShow = showAllPetsAppts || petsWithProvider.length <= 1 ? upcomingAppts : selectedUpcoming;
  const apptsByDay = useMemo(() => groupApptsByDay(apptsToShow), [apptsToShow]);

  const hasAnyPetWithPlan = useMemo(
    () =>
      pets.some((p) => {
        const hasSubscription = p.subscription?.status === 'active' || p.subscription?.status === 'pending';
        const hasMembership = p.membershipStatus === 'active' || p.membershipStatus === 'pending';
        return hasSubscription || hasMembership || (p.wellnessPlans || []).length > 0;
      }),
    [pets],
  );

  const showMultiPetCredit =
    petsWithProvider.length > 1 &&
    !petsWithProvider.every((p) => {
      const status = (p.membershipStatus || '').toLowerCase();
      return p.membershipPlanName != null && (status === 'active' || status === 'pending');
    });

  const primaryProviderEmail = useMemo(() => {
    if (selectedProvider?.email) return selectedProvider.email;
    return providerEmailFromName(selectedPet?.primaryProviderName);
  }, [selectedProvider, selectedPet]);

  /* ---------------- actions ---------------- */
  function goRequestVisit() {
    if (APPOINTMENT_REQUEST_URL.startsWith('/')) navigate(APPOINTMENT_REQUEST_URL);
    else window.location.href = APPOINTMENT_REQUEST_URL;
  }

  function handleChat() {
    if (!isChatHoursOpen) {
      void appAlert({ title: 'Chat is closed right now', message: `Our chat hours are:\n${formattedChatHours}` });
      return;
    }
    if (membership?.hasActiveWellnessPlan || hasAnyPetWithPlan) {
      window.open(LIVE_CHAT_URL, '_blank', 'noopener,noreferrer');
    } else {
      void appAlert({
        title: 'Members only',
        message: 'After-hours chat is only available to members. Please sign up for a membership plan to access this feature.',
      });
    }
  }

  function handleEnrollMembership(pet: PetWithWellness) {
    if (!pet.id) return;
    trackEvent('membership_explore_clicked', {
      pet_id: pet.id,
      pet_name: pet.name || 'Unknown',
      pet_species: pet.species || pet.breed || 'Unknown',
      pet_age_years: pet.dob ? ((Date.now() - new Date(pet.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1) : null,
      has_membership: Boolean(pet.membershipStatus),
      membership_status: pet.membershipStatus || 'none',
    });
    navigate('/client-portal/membership-signup', { state: { petId: pet.id } });
  }

  /** Remember we're sending them to the store from here so the store can offer "Back to portal". */
  function rememberPortalForStore(pet: PetWithWellness | null | undefined = selectedPet) {
    rememberStorePortalReturn({ petId: pet?.dbId ?? null, petName: pet?.name ?? null });
  }
  function goToStore(path = '/store') {
    rememberPortalForStore();
    navigate(path);
  }

  async function orderChronicForPet(pet: PetWithWellness, rx: PatientPrescription) {
    rememberPortalForStore(pet);
    if (!rx.inventoryItemId) {
      navigate('/store');
      return;
    }
    const listings = await publicStoreProducts(STORE_PRACTICE_ID);
    const listing = listings.find((row) => row.variants.some((v) => v.inventoryItemId === rx.inventoryItemId));
    const variant = listing?.variants.find((row) => row.inventoryItemId === rx.inventoryItemId);
    addToStoreCart({
      inventoryItemId: rx.inventoryItemId,
      name: variant?.name || rx.name,
      quantity: 1,
      unitPrice: Number(variant?.onlineStorePrice ?? listing?.priceFrom ?? 0),
      autoshipFrequency: listing?.recommendedFrequency || 'monthly',
      recommendedFrequency: listing?.recommendedFrequency || null,
      listingId: listing?.listingId,
      storeProductId: listing?.storeProductId ?? null,
      hasImage: Boolean(variant?.hasImage || listing?.hasImage),
      approvalTag: listing?.approvalTag,
      patientIds: pet.dbId && Number.isFinite(Number(pet.dbId)) ? [Number(pet.dbId)] : [],
    });
    navigate('/store/cart', { state: { highlightItemId: rx.inventoryItemId } });
  }

  const toggleLove = useCallback(async (pet: PetWithWellness) => {
    if (!pet.dbId) return;
    const before = pet.loves ?? { count: 0, mine: false };
    const next = !before.mine;
    setPets((prev) =>
      prev.map((p) =>
        p.id === pet.id
          ? { ...p, loves: { mine: next, count: Math.max(0, before.count + (next ? 1 : -1)) } }
          : p,
      ),
    );
    try {
      const loves = await togglePetLove(pet.dbId, next);
      setPets((prev) => prev.map((p) => (p.id === pet.id ? { ...p, loves } : p)));
      if (next) setToast(`${pet.name} feels the love ❤️`);
    } catch {
      setPets((prev) => prev.map((p) => (p.id === pet.id ? { ...p, loves: before } : p)));
      setToast("Couldn't save that — try again.");
    }
  }, []);

  const saveProfile = useCallback(async (pet: PetWithWellness, patch: PetPortalProfilePatch) => {
    if (!pet.dbId) throw new Error('Missing pet id');
    const updated = await updateMyPetProfile(pet.dbId, patch);
    setPets((prev) => prev.map((p) => (p.id === pet.id ? { ...p, portalProfile: updated ?? p.portalProfile } : p)));
    if ('socialMediaConsent' in patch) {
      setToast(patch.socialMediaConsent ? `${pet.name} is ready for the spotlight! 🌟` : `Got it — we won't share ${pet.name}.`);
    } else {
      setToast('Saved! 🐾');
    }
  }, []);

  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function scrollToTop() {
    // The app shell scrolls <main>, not the window.
    pageTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- hero stats ---------------- */
  const overdueCountFor = useCallback(
    (pet: PetWithWellness) => getAllPetReminders(pet).filter((r) => (daysUntil(r.dueIso) ?? 1) < 0).length,
    [getAllPetReminders]
  );

  /** After the owner changes an auto-ship, re-pull that pet's meds so the "Auto-ship" line stays honest. */
  async function refreshChronicFor(pet: PetWithWellness) {
    const id = Number(pet.dbId);
    if (!Number.isFinite(id)) return;
    try {
      const meds = await fetchClientChronicMeds(id);
      setChronicByPet((prev) => ({ ...prev, [pet.id]: meds }));
    } catch {
      /* keep what we have */
    }
  }

  const heroStats: HeroStat[] = useMemo(() => {
    if (!selectedPet) return [];
    const rems = getAllPetReminders(selectedPet);
    const overdue = rems.filter((r) => (daysUntil(r.dueIso) ?? 1) < 0).length;
    const next = selectedUpcoming[0];
    const meds = chronicByPet[selectedPet.id] ?? [];
    const out: HeroStat[] = [];
    out.push({
      icon: overdue > 0 ? '⏰' : rems.length > 0 ? '🗓️' : '✅',
      k: rems.length === 0 ? 'All caught up' : overdue > 0 ? `${overdue} overdue` : `${rems.length} due soon`,
      l: rems.length === 0 ? 'Preventive care' : 'Care reminders',
      tone: overdue > 0 ? 'danger' : rems.length > 0 ? 'warn' : undefined,
      onClick: () => scrollTo(remindersRef),
    });
    out.push({
      icon: '🏡',
      k: next ? `${relativeDay(next.startIso) || fmtShortDate(next.startIso)}` : 'None booked',
      l: next ? `Next visit · ${fmtTime(next.startIso)}` : 'Next visit',
      onClick: next ? () => scrollTo(apptsRef) : goRequestVisit,
    });
    if (meds.length > 0) {
      out.push({ icon: '💊', k: `${meds.length} med${meds.length === 1 ? '' : 's'}`, l: 'Easy reorder', onClick: () => scrollTo(medsRef) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPet, getAllPetReminders, selectedUpcoming, chronicByPet]);

  /* ---------------- render ---------------- */
  const greet = greetingWord();

  return (
    <div className="pp-root">
      <div className="pp-page">
        <div ref={pageTopRef} aria-hidden />
        {/* ---------- top bar ---------- */}
        <header className="pp-topbar">
          <div className="pp-brand">
            <img src={LOGO_SRC} alt="Vet At Your Door" />
            <div className="pp-greeting">
              <div className="pp-greeting-hi">{greet},</div>
              <div className="pp-greeting-name">{clientFirstName || 'friend'} 👋</div>
            </div>
          </div>
          <div className="pp-topbar-actions">
            <button
              type="button"
              className="pp-btn pp-btn--green pp-btn--sm pp-btn--refer"
              onClick={() => setShowReferral(true)}
              aria-label="Refer a friend"
              title="Refer a friend"
            >
              <Icon name="gift" /> <span className="pp-btn-label">Refer a friend</span>
            </button>
            <div className="pp-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="pp-btn pp-btn--icon"
                aria-label="Menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Icon name="menu" size={20} />
              </button>
              {menuOpen ? (
                <div className="pp-menu pp-pop" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowPreferences(true);
                    }}
                  >
                    <Icon name="settings" size={16} /> Communication preferences
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      goToStore();
                    }}
                  >
                    <Icon name="cart" size={16} /> Online store
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      setMenuOpen(false);
                      await logout();
                      navigate('/login');
                    }}
                  >
                    <Icon name="logout" size={16} /> Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {error ? <div className="pp-error">{error}</div> : null}

        {!loading ? <RenewalBanner /> : null}

        {loading ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <div className="pp-skeleton" style={{ height: 90 }} />
            <div className="pp-skeleton" style={{ height: 420, borderRadius: 22 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
              <div className="pp-skeleton" style={{ height: 240, borderRadius: 22 }} />
              <div className="pp-skeleton" style={{ height: 240, borderRadius: 22 }} />
              <div className="pp-skeleton" style={{ height: 240, borderRadius: 22 }} />
            </div>
          </div>
        ) : !selectedPet || !membership ? (
          <section className="pp-card pp-card--tint" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 56 }}>🐾</div>
            <h2 style={{ margin: '8px 0 4px', fontFamily: "'Libre Baskerville', serif" }}>No pets on your account yet</h2>
            <p className="pp-muted">Request a visit and we&apos;ll get your furry family set up.</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="pp-btn pp-btn--primary" onClick={goRequestVisit}>
                <Icon name="calendar" /> Request a visit
              </button>
              <a className="pp-btn pp-btn--ghost" href={PRACTICE_PHONE_TEL}>
                <Icon name="phone" /> {PRACTICE_PHONE_DISPLAY}
              </a>
            </div>
          </section>
        ) : (
          <>
            {/* ---------- pet switcher ---------- */}
            {petsWithProvider.length > 1 ? (
              <nav className="pp-switcher" aria-label="Your pets">
                {petsWithProvider.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`pp-switch${p.id === selectedPet.id ? ' pp-switch--active' : ''}`}
                    onClick={() => {
                      setSelectedKey(p.id);
                      setShowAllPetsAppts(false);
                      setNicknameEditRequest(0);
                    }}
                    aria-pressed={p.id === selectedPet.id}
                  >
                    {(() => {
                      const overdue = overdueCountFor(p);
                      return (
                        <span className="pp-switch-avatar-wrap">
                          <img className="pp-switch-avatar" src={petImg(p)} alt="" />
                          {overdue > 0 ? (
                            <span
                              className="pp-switch-badge"
                              aria-label={`${overdue} overdue reminder${overdue === 1 ? '' : 's'}`}
                              title={`${overdue} overdue reminder${overdue === 1 ? '' : 's'}`}
                            >
                              {overdue > 9 ? '9+' : overdue}
                            </span>
                          ) : null}
                        </span>
                      );
                    })()}
                    <span className="pp-switch-name">{p.name}</span>
                  </button>
                ))}
              </nav>
            ) : null}

            {/* ---------- hero ---------- */}
            <PetHero
              key={selectedPet.id}
              pet={selectedPet}
              membership={membership}
              provider={selectedProvider}
              stats={heroStats}
              chatOpen={isChatHoursOpen}
              chatIsMember={membership.hasActiveWellnessPlan || hasAnyPetWithPlan}
              onRequestVisit={goRequestVisit}
              onChat={handleChat}
              onCertificate={() => setCertificatePet(selectedPet)}
              onShop={() => goToStore()}
              onExploreMembership={membership.state === 'none' ? () => handleEnrollMembership(selectedPet) : undefined}
              onLove={() => void toggleLove(selectedPet)}
              onProviderBio={() => setShowProviderBio(true)}
              onEditNickname={() => {
                setNicknameEditRequest((n) => n + 1);
                scrollTo(aboutRef);
              }}
              onOpenGalleryManager={() => setGalleryPet(selectedPet)}
              onPrimaryPhotoChange={(url) =>
                setPets((prev) => prev.map((p) => (p.id === selectedPet.id ? { ...p, photoUrl: url || p.photoUrl } : p)))
              }
              autoOpenPhotos={autoOpenPhotos}
              onAutoOpenHandled={() => setAutoOpenPhotos(false)}
              galleryRefreshKey={galleryRefreshKey}
            />

            {showMultiPetCredit ? (
              <div className="pp-notice">
                <span className="pp-notice-emoji" aria-hidden>
                  🎉
                </span>
                <div>
                  <strong>Multi-pet bonus:</strong> enroll more than one pet in a membership and receive a <strong>$75 credit</strong> for each
                  additional pet — good at any future Vet At Your Door visit.
                </div>
              </div>
            ) : null}

            {/* ---------- cards ---------- */}
            <div className="pp-grid">
              <div className="pp-col-7" ref={aboutRef} style={{ scrollMarginTop: 16 }}>
                <PetAboutCard
                  key={`${selectedPet.id}-${nicknameEditRequest}`}
                  pet={selectedPet}
                  onSave={saveProfile}
                  autoEdit={nicknameEditRequest > 0 ? 'nickname' : null}
                />
              </div>
              <div className="pp-col-5 pp-stack">
                <PetSpotlightConsentCard pet={selectedPet} onSave={saveProfile} />
                <CommunitySnapshotsCard
                  pet={selectedPet}
                  onToast={setToast}
                  onPetLoves={(dbId, loves) =>
                    setPets((prev) => prev.map((p) => (Number(p.dbId) === dbId ? { ...p, loves } : p)))
                  }
                />
              </div>

              {/* Membership */}
              <section className="pp-card pp-col-4" aria-label="Membership">
                <CardHead
                  icon="💚"
                  tone="green"
                  title={membership.state === 'active' ? 'Membership' : membership.state === 'processing' ? 'Membership' : 'Become a member'}
                  sub={
                    membership.state === 'active'
                      ? `${selectedPet.name} is covered`
                      : membership.state === 'processing'
                      ? "We're setting things up"
                      : `Care that fits ${possessive(selectedPet.name)} life`
                  }
                />
                {membership.state === 'active' && membership.planText ? (
                  <>
                    <div className="pp-member-plan">
                      <span className="pp-member-plan-icon" aria-hidden>
                        🏅
                      </span>
                      <div>
                        <div className="pp-member-plan-name">{membership.planText}</div>
                        <div className="pp-muted pp-small">Active membership</div>
                      </div>
                    </div>
                    <ul className="pp-perks">
                      {membershipPerkLines(null)
                        .slice(0, 3)
                        .map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      <li>Wellness exams, vaccines & labs included in your plan</li>
                    </ul>
                    <div className="pp-member-actions">
                      <button type="button" className="pp-btn pp-btn--soft" onClick={() => setBenefitsPet(selectedPet)}>
                        <Icon name="check" /> What&apos;s included & what&apos;s left
                      </button>
                    </div>
                  </>
                ) : membership.state === 'processing' || membership.state === 'pending' ? (
                  <>
                    <div className="pp-member-plan">
                      <span className="pp-member-plan-icon" aria-hidden>
                        ⏳
                      </span>
                      <div>
                        <div className="pp-member-plan-name">{membership.planText || 'Membership'}</div>
                        <span className="pp-tag pp-tag--processing">Processing</span>
                      </div>
                    </div>
                    <p className="pp-muted pp-small" style={{ margin: 0 }}>
                      Thanks for joining! Your plan is being activated — perks unlock as soon as it&apos;s live. Questions?{' '}
                      <a href={`mailto:${PRACTICE_INFO_EMAIL}`}>Email us</a>.
                    </p>
                  </>
                ) : (
                  <>
                    <ul className="pp-perks">
                      <li>Annual wellness exam, vaccines & labs included</li>
                      <li>50% off exam fees on every other visit</li>
                      <li>10% member pricing in our online store</li>
                      <li>After-hours chat & priority scheduling with your One-Team</li>
                      <li>Spread the cost of care — monthly or annual</li>
                    </ul>
                    <button type="button" className="pp-btn pp-btn--sun" onClick={() => handleEnrollMembership(selectedPet)}>
                      Explore plans for {selectedPet.name} <Icon name="arrow" />
                    </button>
                  </>
                )}
              </section>

              {/* Reminders */}
              <section className="pp-card pp-col-4" aria-label="Care reminders" ref={remindersRef} style={{ scrollMarginTop: 16 }}>
                {(() => {
                  const all = getAllPetReminders(selectedPet);
                  const declined = petDeclined(selectedPet);
                  const shown = all.slice(0, 4);
                  return (
                    <>
                      <CardHead
                        icon="🗓️"
                        tone="sun"
                        title="Care reminders"
                        sub={all.length === 0 ? `${selectedPet.name} is all caught up!` : `${all.length} item${all.length === 1 ? '' : 's'} on the list`}
                        action={
                          all.length > shown.length || declined.length > 0 ? (
                            <button type="button" className="pp-link-btn" onClick={() => setRemindersModalPet(selectedPet)}>
                              See all
                            </button>
                          ) : null
                        }
                      />
                      {all.length === 0 && declined.length === 0 ? (
                        <div className="pp-empty">🎉 Nothing due. We&apos;ll let you know when something comes up.</div>
                      ) : (
                        <div className="pp-rows">
                          {shown.map((r) => {
                            const d = daysUntil(r.dueIso);
                            const overdue = d != null && d < 0;
                            const soon = d != null && d >= 0 && d <= 30;
                            return (
                              <div key={r.id} className={`pp-row${overdue ? ' pp-row--overdue' : soon ? ' pp-row--soon' : ''}`}>
                                <div className="pp-row-main">
                                  <div className="pp-row-title">{r.description ?? r.kind ?? '—'}</div>
                                  <div className="pp-row-sub">
                                    {overdue ? 'Was due ' : 'Due '}
                                    {fmtReminderDate(r)}
                                  </div>
                                </div>
                                <span className={`pp-tag ${overdue ? 'pp-tag--overdue' : soon ? 'pp-tag--soon' : 'pp-tag--ok'}`}>
                                  {overdue ? 'Overdue' : soon ? relativeDay(r.dueIso) || 'Soon' : 'Upcoming'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {all.length > 0 ? (
                        <button type="button" className="pp-btn pp-btn--soft pp-btn--sm" onClick={goRequestVisit} style={{ alignSelf: 'flex-start' }}>
                          <Icon name="calendar" /> Book these in one visit
                        </button>
                      ) : null}
                    </>
                  );
                })()}
              </section>

              {/* Chronic meds */}
              <section className="pp-card pp-col-4" aria-label="Medications" ref={medsRef} style={{ scrollMarginTop: 16 }}>
                {(() => {
                  const meds = chronicByPet[selectedPet.id] ?? [];
                  return (
                    <>
                      <CardHead
                        icon="💊"
                        tone="sky"
                        title="Medications"
                        sub={meds.length === 0 ? 'Ongoing prescriptions appear here' : 'Reorder in a tap · delivered to your door'}
                      />
                      {meds.length === 0 ? (
                        <>
                          <div className="pp-empty">No ongoing medications on file for {selectedPet.name}.</div>
                          <Link
                            className="pp-btn pp-btn--ghost pp-btn--sm"
                            to="/store"
                            style={{ alignSelf: 'flex-start' }}
                            onClick={() => rememberPortalForStore()}
                          >
                            <Icon name="cart" /> Browse flea, tick & heartworm
                          </Link>
                        </>
                      ) : (
                        <div className="pp-rows">
                          {meds.map((rx) => {
                            const notInStore =
                              storeItemIds != null &&
                              (!rx.inventoryItemId || !storeItemIds.has(Number(rx.inventoryItemId)));
                            return (
                            <div key={rx.id} className="pp-med">
                              <div className="pp-med-icon" aria-hidden>
                                💊
                              </div>
                              <div className="pp-row-main">
                                <div className="pp-row-title">
                                  {rx.name}
                                  {rx.strength ? <span className="pp-muted"> · {rx.strength}</span> : null}
                                </div>
                                <div className="pp-row-sub">
                                  {rx.refill != null ? `${rx.refill} refill${rx.refill === 1 ? '' : 's'} left` : 'Chronic medication'}
                                  {rx.autoshipStartedAt ? (
                                    <>
                                      {' · '}
                                      <span className="pp-tag pp-tag--autoship">Auto-ship</span>
                                    </>
                                  ) : null}
                                </div>
                                {notInStore && !rx.autoshipStartedAt ? (
                                  <div className="pp-med-note">
                                    Not sold in our online store —{' '}
                                    <a href={PRACTICE_PHONE_SMS}>text us</a> or ask at your next visit to refill.
                                  </div>
                                ) : null}
                              </div>
                              {notInStore && !rx.autoshipStartedAt ? null : rx.autoshipStartedAt && rx.inventoryItemId ? (
                                <button
                                  type="button"
                                  className="pp-btn pp-btn--xs pp-btn--soft"
                                  onClick={() => setAutoshipRx({ pet: selectedPet, rx })}
                                >
                                  <Icon name="settings" size={13} /> Manage
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={`pp-btn pp-btn--xs ${rx.inventoryItemId ? 'pp-btn--primary' : 'pp-btn--ghost'}`}
                                  onClick={() => void orderChronicForPet(selectedPet, rx)}
                                >
                                  <Icon name="refresh" size={13} /> {rx.inventoryItemId ? 'Reorder' : 'Shop'}
                                </button>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>

              {/* Appointments */}
              <section className="pp-card pp-col-7" aria-label="Upcoming visits" ref={apptsRef} style={{ scrollMarginTop: 16 }}>
                <CardHead
                  icon="🏡"
                  title="Upcoming visits"
                  sub={
                    apptsToShow.length === 0
                      ? petsWithProvider.length > 1 && !showAllPetsAppts
                        ? `Nothing on the calendar for ${selectedPet.name}`
                        : 'Nothing on the calendar yet'
                      : `${apptsToShow.length} visit${apptsToShow.length === 1 ? '' : 's'} scheduled`
                  }
                  action={
                    petsWithProvider.length > 1 ? (
                      <button type="button" className="pp-link-btn" onClick={() => setShowAllPetsAppts((v) => !v)}>
                        {showAllPetsAppts ? `Only ${selectedPet.name}` : 'All pets'}
                      </button>
                    ) : null
                  }
                />
                {apptsToShow.length === 0 ? (
                  <>
                    <div className="pp-empty">We come to you — no car rides, no waiting room, no stress.</div>
                    <button type="button" className="pp-btn pp-btn--primary" onClick={goRequestVisit} style={{ alignSelf: 'flex-start' }}>
                      <Icon name="calendar" /> Request a visit for {selectedPet.name}
                    </button>
                  </>
                ) : (
                  <div className="pp-appts">
                    {apptsByDay.map(({ key, items }) => {
                      const d = new Date(items[0].startIso);
                      return (
                        <div key={key} className="pp-appt-day">
                          <div className="pp-appt-date">
                            <div className="pp-appt-date-dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                            <div className="pp-appt-date-day">{d.getDate()}</div>
                            <div className="pp-appt-date-mon">{d.toLocaleDateString(undefined, { month: 'short' })}</div>
                          </div>
                          <div className="pp-appt-items">
                            {items.map((a) => {
                              const apptPet = petsWithProvider.find((p) => apptMatchesPet(a, p));
                              const token = (a.roomLoaderPublicToken ?? '').trim();
                              const checkinDone = (a.roomLoaderSentStatus ?? '').toLowerCase() === 'completed';
                              return (
                                <div key={a.id} className="pp-appt">
                                  <div className="pp-appt-main">
                                    <img className="pp-appt-pet" src={apptPet ? petImg(apptPet) : petImg(selectedPet)} alt="" />
                                    <div className="pp-appt-info">
                                      <div className="pp-appt-time">
                                        {fmtTime(a.startIso)}
                                        {relativeDay(a.startIso) ? <span className="pp-muted"> · {relativeDay(a.startIso)}</span> : null}
                                      </div>
                                      <div className="pp-appt-type">
                                        {a.patientName ?? apptPet?.name ?? ''}
                                        {a.patientName || apptPet ? ' · ' : ''}
                                        {apptTypeLabel(a)}
                                      </div>
                                      {apptAddress(a) ? <div className="pp-appt-addr">📍 {apptAddress(a)}</div> : null}
                                    </div>
                                    {a.statusName ? <span className="pp-tag pp-tag--ok">{a.statusName}</span> : null}
                                  </div>
                                  {token ? (
                                    <div className={`pp-appt-checkin${checkinDone ? ' pp-appt-checkin--done' : ''}`}>
                                      <span>
                                        {checkinDone
                                          ? '✅ Pre-visit check-in complete. Download a copy for your records.'
                                          : '📝 Please complete your pre-visit check-in before we arrive.'}
                                      </span>
                                      {checkinDone ? (
                                        <a
                                          className="pp-btn pp-btn--ghost pp-btn--xs"
                                          href={getClientRoomLoaderPdfHref(token)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <Icon name="download" size={13} /> Download PDF
                                        </a>
                                      ) : (
                                        <Link
                                          className="pp-btn pp-btn--primary pp-btn--xs"
                                          to={getClientRoomLoaderFormPath(token)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          Open check-in form <Icon name="arrow" size={13} />
                                        </Link>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Need us? */}
              <section className="pp-card pp-col-5" aria-label="Contact us">
                <CardHead icon="💬" tone="sky" title="Need us?" sub="We're a tap away" />
                <div className="pp-rows">
                  <button
                    type="button"
                    className="pp-row"
                    onClick={handleChat}
                    style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid var(--pp-border)' }}
                  >
                    <div className="pp-row-main">
                      <div className="pp-row-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`pp-chat-dot${isChatHoursOpen ? ' pp-chat-dot--open' : ''}`} />
                        After-hours chat {isChatHoursOpen ? '· open now' : '· closed'}
                      </div>
                      <div className="pp-row-sub">
                        {membership.hasActiveWellnessPlan || hasAnyPetWithPlan ? 'Member perk — chat with our team' : 'A member perk'}
                      </div>
                      <div className="pp-chat-hours" style={{ marginTop: 4 }}>
                        {formattedChatHours}
                      </div>
                    </div>
                    <Icon name="arrow" size={16} />
                  </button>
                  <a className="pp-row" href={PRACTICE_PHONE_TEL} style={{ color: 'inherit' }}>
                    <div className="pp-row-main">
                      <div className="pp-row-title">📞 Call {PRACTICE_PHONE_DISPLAY}</div>
                      <div className="pp-row-sub">Scheduling, questions, anything</div>
                    </div>
                    <Icon name="arrow" size={16} />
                  </a>
                  <a className="pp-row" href={PRACTICE_PHONE_SMS} style={{ color: 'inherit' }}>
                    <div className="pp-row-main">
                      <div className="pp-row-title">💬 Text us</div>
                      <div className="pp-row-sub">Quick questions & photos welcome</div>
                    </div>
                    <Icon name="arrow" size={16} />
                  </a>
                  <a className="pp-row" href={`mailto:${primaryProviderEmail}`} style={{ color: 'inherit' }}>
                    <div className="pp-row-main">
                      <div className="pp-row-title">✉️ Email {possessive(selectedPet.name)} vet</div>
                      <div className="pp-row-sub">{primaryProviderEmail}</div>
                    </div>
                    <Icon name="arrow" size={16} />
                  </a>
                </div>
              </section>
            </div>

            {/* ---------- promos ---------- */}
            <div className="pp-promos">
              <button type="button" className="pp-promo pp-promo--teal" onClick={goRequestVisit}>
                <span className="pp-promo-emoji" aria-hidden>
                  📅
                </span>
                <h3>Book online, any time</h3>
                <p>Pick a day that works for you and we&apos;ll bring the clinic to your living room. No phone tag required.</p>
                <span className="pp-btn pp-btn--sm">
                  Request a visit <Icon name="arrow" size={14} />
                </span>
              </button>
              <Link className="pp-promo pp-promo--green" to="/store" onClick={() => rememberPortalForStore()}>
                <span className="pp-promo-emoji" aria-hidden>
                  📦
                </span>
                <h3>Online pharmacy & store</h3>
                <p>Vet-approved food, flea & tick, and {possessive(selectedPet.name)} meds — set up auto-ship and never run out.</p>
                <span className="pp-btn pp-btn--sm">
                  Shop now <Icon name="cart" size={14} />
                </span>
              </Link>
              {membership.state === 'none' ? (
                <button type="button" className="pp-promo pp-promo--sun" onClick={() => handleEnrollMembership(selectedPet)}>
                  <span className="pp-promo-emoji" aria-hidden>
                    💚
                  </span>
                  <h3>Membership for {selectedPet.name}</h3>
                  <p>Predictable pricing, after-hours chat, and a plan built around {possessive(selectedPet.name)} life stage.</p>
                  <span className="pp-btn pp-btn--sm">
                    See plans <Icon name="arrow" size={14} />
                  </span>
                </button>
              ) : (
                <button type="button" className="pp-promo pp-promo--violet" onClick={() => setShowReferral(true)}>
                  <span className="pp-promo-emoji" aria-hidden>
                    🎁
                  </span>
                  <h3>Share the love</h3>
                  <p>Know a pet who&apos;d love a house call? Refer a friend and their first trip fee is on us.</p>
                  <span className="pp-btn pp-btn--sm">
                    Refer a friend <Icon name="gift" size={14} />
                  </span>
                </button>
              )}
            </div>
          </>
        )}

        {/* ---------- pets we remember ---------- */}
        {!loading && rememberedPets.length > 0 ? (
          <RememberedPetsCard
            pets={rememberedPets}
            onLoves={(id, loves) =>
              setRememberedPets((prev) => prev.map((p) => (p.id === id ? { ...p, loves } : p)))
            }
            onToast={setToast}
          />
        ) : null}

        {/* ---------- footer ---------- */}
        <footer className="pp-footer">
          <div className="pp-footer-brand">Vet At Your Door</div>
          <div>Fear-free veterinary care, delivered to your doorstep.</div>
          <div className="pp-footer-links">
            <a href={PRACTICE_PHONE_TEL}>{PRACTICE_PHONE_DISPLAY}</a>
            <a href={`mailto:${PRACTICE_INFO_EMAIL}`}>{PRACTICE_INFO_EMAIL}</a>
            <a href="https://www.vetatyourdoor.com" target="_blank" rel="noopener noreferrer">
              www.vetatyourdoor.com
            </a>
          </div>
          <div className="pp-footer-copy">© {new Date().getFullYear()} Vet At Your Door. All rights reserved.</div>
        </footer>
      </div>

      {/* ---------- mobile bottom nav ---------- */}
      <nav className="pp-bottom-nav" aria-label="Primary">
        <div className="pp-bottom-inner">
          <button type="button" className="pp-bottom--primary" onClick={scrollToTop}>
            <Icon name="home" /> Home
          </button>
          <button type="button" onClick={goRequestVisit}>
            <Icon name="calendar" /> Book
          </button>
          <button type="button" onClick={handleChat}>
            <Icon name="chat" /> Chat
          </button>
          <button type="button" onClick={() => goToStore()}>
            <Icon name="cart" /> Shop
          </button>
          <button type="button" onClick={() => window.location.assign(PRACTICE_PHONE_TEL)}>
            <Icon name="phone" /> Call
          </button>
        </div>
      </nav>

      {/* ---------- modals ---------- */}
      {showReferral ? <ReferralModal onClose={() => setShowReferral(false)} /> : null}
      {showPreferences ? (
        <PreferencesModal
          onClose={() => setShowPreferences(false)}
          fallbackInfo={clientInfo || localClientInfo}
          onSaved={() => setToast('Preferences saved')}
        />
      ) : null}
      {showProviderBio && selectedPet ? (
        <ProviderBioModal
          provider={selectedProvider}
          fallbackName={selectedPet.primaryProviderName ?? null}
          petName={selectedPet.name}
          onClose={() => setShowProviderBio(false)}
          onRequestVisit={() => {
            setShowProviderBio(false);
            goRequestVisit();
          }}
        />
      ) : null}
      {remindersModalPet ? (
        <PortalModal title={`${possessive(remindersModalPet.name)} care list`} onClose={() => setRemindersModalPet(null)} labelledBy="pp-rem-title">
          {(() => {
            const all = getAllPetReminders(remindersModalPet);
            const declined = petDeclined(remindersModalPet);
            return (
              <>
                {all.length > 0 ? (
                  <div className="pp-rows">
                    {all.map((r) => {
                      const d = daysUntil(r.dueIso);
                      const overdue = d != null && d < 0;
                      return (
                        <div key={r.id} className={`pp-row${overdue ? ' pp-row--overdue' : ''}`}>
                          <div className="pp-row-main">
                            <div className="pp-row-title">{r.description ?? r.kind ?? '—'}</div>
                            <div className="pp-row-sub">
                              {overdue ? 'Was due ' : 'Due '}
                              {fmtReminderDate(r)}
                            </div>
                          </div>
                          <span className={`pp-tag ${overdue ? 'pp-tag--overdue' : 'pp-tag--ok'}`}>{overdue ? 'Overdue' : 'Upcoming'}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="pp-empty">No open reminders.</div>
                )}
                {declined.length > 0 ? (
                  <div>
                    <div className="pp-small" style={{ fontWeight: 800, margin: '6px 0' }}>
                      Previously declined
                    </div>
                    <div className="pp-rows">
                      {declined.map((item) => (
                        <div key={item.id} className="pp-row">
                          <div className="pp-row-main">
                            <div className="pp-row-title">{item.label}</div>
                            {item.declinedAt ? <div className="pp-row-sub">Declined {formatDeclinedDate(item.declinedAt)}</div> : null}
                          </div>
                          <span className="pp-tag pp-tag--declined">Declined</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="pp-modal-foot">
                  <button
                    type="button"
                    className="pp-btn pp-btn--primary"
                    onClick={() => {
                      setRemindersModalPet(null);
                      goRequestVisit();
                    }}
                  >
                    <Icon name="calendar" /> Request a visit
                  </button>
                </div>
              </>
            );
          })()}
        </PortalModal>
      ) : null}
      {certificatePet ? (
        certificatePet.vaccinations && certificatePet.vaccinations.length > 0 ? (
          <VaccinationCertificateModal
            pet={certificatePet}
            vaccinations={certificatePet.vaccinations}
            onClose={() => setCertificatePet(null)}
            onEmail={() => {
              setEmailCertPet(certificatePet);
              setCertificatePet(null);
            }}
          />
        ) : (
          <PortalModal title="No vaccinations on file" onClose={() => setCertificatePet(null)} labelledBy="pp-novacc">
            <p className="pp-muted pp-small" style={{ margin: 0, lineHeight: 1.55 }}>
              We don&apos;t have any vaccinations recorded for {certificatePet.name} yet. Once we do, you&apos;ll be able to print or email an
              official certificate from here.
            </p>
            <div className="pp-modal-foot">
              <button type="button" className="pp-btn pp-btn--ghost" onClick={() => setCertificatePet(null)}>
                Close
              </button>
              <button
                type="button"
                className="pp-btn pp-btn--primary"
                onClick={() => {
                  setCertificatePet(null);
                  goRequestVisit();
                }}
              >
                Book a wellness visit
              </button>
            </div>
          </PortalModal>
        )
      ) : null}
      {emailCertPet ? (
        <EmailCertificateModal
          pet={emailCertPet}
          defaultTo={userEmail ?? null}
          onClose={() => setEmailCertPet(null)}
          onSent={(to) => setToast(`Certificate sent to ${to} ✉️`)}
        />
      ) : null}
      {galleryPet?.dbId ? (
        <PatientPhotoGalleryModal
          open
          patientId={galleryPet.dbId}
          patientName={galleryPet.name || 'Pet'}
          onClose={() => {
            setGalleryPet(null);
            setGalleryRefreshKey((k) => k + 1);
          }}
          onPrimaryChange={(imageUrl) => {
            const petKey = galleryPet.id;
            setPets((prev) => prev.map((p) => (p.id === petKey ? { ...p, photoUrl: imageUrl || null } : p)));
          }}
        />
      ) : null}
      {benefitsPet ? (
        <MembershipBenefitsModal
          pet={benefitsPet}
          membership={computeMembershipView(benefitsPet)}
          onClose={() => setBenefitsPet(null)}
        />
      ) : null}

      {autoshipRx ? (
        <AutoshipManageModal
          pet={autoshipRx.pet}
          rx={autoshipRx.rx}
          practiceId={STORE_PRACTICE_ID}
          onClose={() => setAutoshipRx(null)}
          onOrderNow={() => {
            const { pet, rx } = autoshipRx;
            setAutoshipRx(null);
            void orderChronicForPet(pet, rx);
          }}
          onChanged={() => void refreshChronicFor(autoshipRx.pet)}
          onToast={(text) => setToast(text)}
        />
      ) : null}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
