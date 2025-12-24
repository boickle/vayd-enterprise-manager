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
  fetchPracticeInfo,
  type Vaccination,
} from '../api/clientPortal';
import { listMembershipTransactions } from '../api/membershipTransactions';
import { http } from '../api/http';
import { uploadPetImage } from '../api/patients';
import VaccinationCertificateModal from '../components/VaccinationCertificateModal';

type PetWithWellness = Pet & {
  wellnessPlans?: WellnessPlan[];
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

  // Check if plan is deleted - if so, it's not active
  const isDeleted = (plan as any)?.isDeleted;
  if (isDeleted === true || String(isDeleted).toLowerCase() === 'true') {
    return false;
  }

  // Check expiration date - if expired, it's not active
  const expirationDate = (plan as any)?.expirationDate;
  if (expirationDate) {
    const expDate = new Date(expirationDate);
    if (!isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
      return false;
    }
  }

  // Check isActive field
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

const DOG_PLACEHOLDER = `${import.meta.env.BASE_URL ?? '/'}doggy.png`;

const CAT_PLACEHOLDER = `${import.meta.env.BASE_URL ?? '/'}catty.png`;

function petImg(p: Pet) {
  // Check for uploaded photo first
  if (p.photoUrl) {
    return p.photoUrl;
  }
  // Fallback to species-based placeholders
  const s = (p.species || p.breed || '').toLowerCase();
  if (s.includes('canine') || s.includes('dog')) {
    return DOG_PLACEHOLDER;
  }
  if (s.includes('feline') || s.includes('cat')) {
    return CAT_PLACEHOLDER;
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

function cleanMembershipDisplayText(text: string): string {
  if (!text) return text;
  
  // Check if text contains "Add-ons:" pattern
  if (text.includes('Add-ons:')) {
    // Match pattern like "Foundations (Add-ons: PLUS Add-on, Puppy / Kitten Add-on)"
    const match = text.match(/^([^(]+)\s*\(Add-ons:\s*([^)]+)\)/);
    if (match) {
      const basePlan = match[1].trim();
      const addOnsText = match[2].trim();
      
      // Split add-ons by comma and clean each one
      const addOns = addOnsText
        .split(',')
        .map(addon => addon.trim().replace(/\s+Add-on$/i, '').trim())
        .filter(Boolean);
      
      // Combine: base plan + cleaned add-ons
      if (addOns.length > 0) {
        return `${basePlan} ${addOns.join(', ')}`;
      }
      return basePlan;
    }
  }
  
  // If no pattern match, just remove any standalone " Add-on" suffixes
  return text.replace(/\s+Add-on\b/gi, '');
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
  const [rawApptsData, setRawApptsData] = useState<any[]>([]); // Store raw appointment data for client info
  const [reminders, setReminders] = useState<ClientReminder[]>([]);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedPetReminders, setSelectedPetReminders] = useState<{
    pet: PetWithWellness;
    reminders: ClientReminder[];
  } | null>(null);
  const [chatHours, setChatHours] = useState<any>(null);
  const [uploadingPetId, setUploadingPetId] = useState<string | null>(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);
  const [showVaccinationModal, setShowVaccinationModal] = useState(false);
  const [selectedPetForVaccination, setSelectedPetForVaccination] = useState<PetWithWellness | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pBase, a, r, practiceInfo] = await Promise.all([
          fetchClientPets(),
          fetchClientAppointments(),
          fetchClientReminders(),
          fetchPracticeInfo(),
        ]);
        
        // Store raw appointment data for client info lookup
        // We need to fetch the raw data separately to get full client object with secondEmail
        try {
          const { data: rawApptsResponse } = await http.get('/appointments/client');
          const rawAppts = Array.isArray(rawApptsResponse) ? rawApptsResponse : (rawApptsResponse?.appointments ?? rawApptsResponse ?? []);
          if (alive) setRawApptsData(rawAppts);
        } catch (err) {
          console.warn('Failed to fetch raw appointment data for client info:', err);
        }
        
        if (practiceInfo?.chatHoursOfOperation) {
          setChatHours(practiceInfo.chatHoursOfOperation);
        }
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
                  // Keep full plan data so planIsActive can check all fields
                  return plans ?? [];
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
            // Extract pricingOption from plansSelected if available
            const plansSelected = (membershipInfo as any)?.plansSelected;
            const pricingFromPlansSelected = Array.isArray(plansSelected) && plansSelected.length > 0
              ? plansSelected[0]?.pricingOption
              : null;
            const membershipPricingOption =
              membershipInfo?.pricingOption ??
              pricingFromPlansSelected ??
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

  const clientFirstName = useMemo(() => {
    if (!userEmail) return null;
    
    // Check if userEmail matches secondEmail in raw appointment data
    // The raw appointment data has the full client object with secondEmail, secondFirstName, etc.
    for (const rawAppt of rawApptsData) {
      const client = rawAppt?.client;
      
      // Check if secondEmail matches the logged-in user's email
      if (client?.secondEmail && client.secondEmail.toLowerCase() === userEmail.toLowerCase()) {
        // Use secondFirstName if secondEmail matches
        if (client.secondFirstName) {
          return client.secondFirstName;
        }
      }
    }
    
    // Also check pets for client information (pets might have client data)
    for (const pet of pets) {
      const rawPet = pet as any;
      const client = rawPet?.client || rawPet?.clientData || rawPet?.owner;
      
      if (client?.secondEmail && client.secondEmail.toLowerCase() === userEmail.toLowerCase()) {
        if (client.secondFirstName) {
          return client.secondFirstName;
        }
      }
    }
    
    // Get client first name from first appointment's clientName
    // This comes from: a?.clientName ?? [a.client.firstName, a.client.lastName].join(' ')
    // So it's the PRIMARY client's name (firstName + lastName)
    // Currently showing "Deirdre" because it extracts the first word from "Deirdre Frey"
    const firstAppt = appts[0];
    if (firstAppt?.clientName) {
      // Extract first name from full name
      const firstName = firstAppt.clientName.split(' ')[0];
      return firstName;
    }
    
    // Fallback: use email username part if no client name found
    const emailPart = userEmail.split('@')[0];
    return emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
  }, [appts, userEmail, pets, rawApptsData]);

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

  // Enrich pets with provider names from appointments if missing
  const petsWithProvider = useMemo(() => {
    return pets.map((pet) => {
      // If pet already has a provider name, keep it
      if (pet.primaryProviderName) {
        return pet;
      }

      // Try to find provider from appointments for this pet
      const petAppts = appts.filter((a) => {
        const apptPetId = a.patientPimsId ? String(a.patientPimsId) : null;
        const petId = pet.id;
        const petDbId = (pet as any).dbId;
        return (
          apptPetId === petId ||
          apptPetId === petDbId ||
          String(apptPetId) === String(petId) ||
          String(apptPetId) === String(petDbId)
        );
      });

      // Look for provider in appointment data - check multiple possible field structures
      for (const appt of petAppts) {
        const apptAny = appt as any;
        // Try various nested structures
        const providerName = 
          apptAny?.doctor?.name ||
          apptAny?.doctor?.fullName ||
          apptAny?.doctor?.displayName ||
          apptAny?.doctorName ||
          apptAny?.provider?.name ||
          apptAny?.provider?.fullName ||
          apptAny?.providerName ||
          apptAny?.primaryProvider?.name ||
          apptAny?.primaryProvider?.fullName ||
          apptAny?.primaryProviderName ||
          apptAny?.primaryVet?.name ||
          apptAny?.primaryVetName ||
          apptAny?.primaryDoctor?.name ||
          // Try constructing from first/last name
          (apptAny?.doctor?.firstName && apptAny?.doctor?.lastName
            ? `${apptAny.doctor.firstName} ${apptAny.doctor.lastName}`.trim()
            : null) ||
          (apptAny?.provider?.firstName && apptAny?.provider?.lastName
            ? `${apptAny.provider.firstName} ${apptAny.provider.lastName}`.trim()
            : null) ||
          (apptAny?.primaryProvider?.firstName && apptAny?.primaryProvider?.lastName
            ? `${apptAny.primaryProvider.firstName} ${apptAny.primaryProvider.lastName}`.trim()
            : null);

        if (providerName && typeof providerName === 'string' && providerName.trim()) {
          return { ...pet, primaryProviderName: providerName.trim() };
        }
      }

      return pet;
    });
  }, [pets, appts]);

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
    const providers = petsWithProvider.map(p => p.primaryProviderName).filter(Boolean) as string[];
    if (providers.length === 0) return 'support@vetatyourdoor.com';
    // Get the most common provider, or first one
    const providerCounts = new Map<string, number>();
    providers.forEach(p => providerCounts.set(p, (providerCounts.get(p) || 0) + 1));
    const sortedProviders = Array.from(providerCounts.entries()).sort((a, b) => b[1] - a[1]);
    const mostCommonProvider = sortedProviders[0]?.[0] || providers[0];
    return getProviderEmail(mostCommonProvider);
  }, [pets]);

  async function handlePetImageUpload(pet: PetWithWellness, file: File) {
    if (!pet.dbId) {
      setErrorModalMessage('Unable to upload image: Pet ID not found.');
      setShowErrorModal(true);
      return;
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setErrorModalMessage('Please select a valid image file (JPEG, PNG, GIF, or WebP).');
      setShowErrorModal(true);
      return;
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      setErrorModalMessage('Image file is too large. Maximum size is 5MB.');
      setShowErrorModal(true);
      return;
    }

    setUploadingPetId(pet.id);
    setError(null);

    try {
      const result = await uploadPetImage(pet.dbId, file);
      
      // Update the pet's photoUrl in the pets array
      setPets((prevPets) =>
        prevPets.map((p) =>
          p.id === pet.id ? { ...p, photoUrl: result.imageUrl } : p
        )
      );
    } catch (err: any) {
      let errorMessage = 'Failed to upload image. Please try again.';
      
      // Handle different types of errors more gracefully
      if (err?.response) {
        const status = err.response.status;
        const serverMessage = err.response.data?.message || err.response.data?.error;
        
        if (status === 413) {
          errorMessage = 'Image file is too large. Please choose a smaller image (max 5MB).';
        } else if (status === 400) {
          errorMessage = serverMessage || 'Invalid image file. Please choose a valid image format (JPEG, PNG, GIF, or WebP).';
        } else if (status === 401 || status === 403) {
          errorMessage = 'You do not have permission to upload images. Please contact support if this issue persists.';
        } else if (status === 500) {
          errorMessage = 'Server error occurred. Please try again in a few moments.';
        } else if (serverMessage) {
          errorMessage = serverMessage;
        } else {
          errorMessage = `Upload failed (${status}). Please try again.`;
        }
      } else if (err?.message) {
        if (err.message.includes('Network') || err.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (err.message.includes('timeout')) {
          errorMessage = 'Upload timed out. Please try again with a smaller image.';
        } else {
          errorMessage = err.message;
        }
      }
      
      setErrorModalMessage(errorMessage);
      setShowErrorModal(true);
    } finally {
      setUploadingPetId(null);
    }
  }

  function handleEnrollMembership(pet: PetWithWellness) {
    if (!pet.id) {
      return;
    }
    navigate('/client-portal/membership-signup', { state: { petId: pet.id } });
  }

  function handleUpgradeMembership(pet: PetWithWellness) {
    if (!pet.id || !pet.dbId) {
      return;
    }
    navigate('/client-portal/membership-upgrade', { 
      state: { 
        petId: pet.id,
        patientId: pet.dbId,
        petName: pet.name,
        currentPlanName: pet.membershipPlanName,
        petSpecies: pet.species,
      } 
    });
  }

  function canUpgradeMembership(pet: PetWithWellness): boolean {
    // Only show upgrade button if they have a base plan that can be upgraded
    // Don't show if they already have Plus or Puppy/Kitten add-ons
    // Check BOTH membership transactions AND wellness plans
    
    // Don't show upgrade button if membership is processing/pending
    const membershipStatus = (pet.membershipStatus || '').toLowerCase();
    if (membershipStatus === 'pending' || membershipStatus === 'processing') {
      console.log('[canUpgradeMembership] Membership is processing/pending, hiding upgrade button:', pet.name, membershipStatus);
      return false;
    }
    
    // Also check if they have membership but no active wellness plan (processing state)
    const allWellnessPlans = pet.wellnessPlans || [];
    const activeWellnessPlans = allWellnessPlans.filter((plan) => planIsActive(plan));
    const hasMembership = pet.membershipPlanName != null;
    if (hasMembership && activeWellnessPlans.length === 0) {
      console.log('[canUpgradeMembership] Membership is processing (no active wellness plan), hiding upgrade button:', pet.name);
      return false;
    }
    
    const membershipPlanName = (pet.membershipPlanName || '').toLowerCase();
    
    // Check if they have Puppy/Kitten plan
    const hasPuppyKittenInMembership = membershipPlanName.includes('puppy') || membershipPlanName.includes('kitten');
    let hasPuppyKittenInWellness = false;
    for (const plan of allWellnessPlans) {
      const packageName = (plan.packageName || '').toLowerCase();
      const planName = (plan.name || '').toLowerCase();
      if (packageName.includes('puppy') || packageName.includes('kitten') ||
          planName.includes('puppy') || planName.includes('kitten')) {
        hasPuppyKittenInWellness = true;
        break;
      }
    }
    
    const hasPuppyKitten = hasPuppyKittenInMembership || hasPuppyKittenInWellness;
    
    // Helper function to check if pet is eligible for Puppy/Kitten upgrade
    const isEligibleForPuppyKittenUpgrade = (): boolean => {
      // Check if pet is less than 1 year old
      let isLessThanOneYear = false;
      if (pet.dob) {
        const birthDate = new Date(pet.dob);
        const today = new Date();
        const oneYearAgo = new Date(today);
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        isLessThanOneYear = birthDate > oneYearAgo;
      }
      
      // Check if patient has had any appointments yesterday or before
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 59, 999); // End of yesterday
      
      const hasPastAppointments = appts.some((apt) => {
        // Check if appointment is for this pet
        // Match by PIMS ID or name
        const matchesPet = 
          apt.patientPimsId === pet.id ||
          String(apt.patientPimsId) === String(pet.id) ||
          apt.patientName?.toLowerCase() === pet.name?.toLowerCase();
        
        if (!matchesPet) return false;
        
        // Check if appointment is yesterday or before
        if (apt.startIso) {
          const aptDate = new Date(apt.startIso);
          return aptDate <= yesterday;
        }
        return false;
      });
      
      return isLessThanOneYear && !hasPastAppointments;
    };
    
    // If they have Puppy/Kitten, check if they can upgrade to Foundations/Foundations Plus
    if (hasPuppyKitten) {
      const eligible = isEligibleForPuppyKittenUpgrade();
      if (eligible) {
        console.log('[canUpgradeMembership] Puppy/Kitten can upgrade to Foundations:', pet.name, {
          dob: pet.dob,
        });
        return true;
      } else {
        console.log('[canUpgradeMembership] Puppy/Kitten cannot upgrade:', pet.name, {
          dob: pet.dob,
        });
        return false;
      }
    }
    
    // Check if they have Foundations/Foundations Plus (but not Puppy/Kitten)
    const hasFoundations = membershipPlanName.includes('foundations') || membershipPlanName.includes('foundation');
    let hasFoundationsInWellness = false;
    for (const plan of allWellnessPlans) {
      const packageName = (plan.packageName || '').toLowerCase();
      const planName = (plan.name || '').toLowerCase();
      if (packageName.includes('foundations') || packageName.includes('foundation') ||
          planName.includes('foundations') || planName.includes('foundation')) {
        hasFoundationsInWellness = true;
        break;
      }
    }
    
    const hasFoundationsPlan = hasFoundations || hasFoundationsInWellness;
    
    // If they have Foundations/Foundations Plus (but not Puppy/Kitten), check if they can upgrade to Puppy/Kitten
    if (hasFoundationsPlan && !hasPuppyKitten) {
      const eligible = isEligibleForPuppyKittenUpgrade();
      if (eligible) {
        console.log('[canUpgradeMembership] Foundations/Foundations Plus can upgrade to Puppy/Kitten:', pet.name, {
          membershipPlanName,
          dob: pet.dob,
        });
        return true;
      }
    }
    
    // Check if they already have Plus in membership transaction (but only if they don't have Foundations)
    if (membershipPlanName.includes('plus') && !hasFoundationsPlan) {
      console.log('[canUpgradeMembership] Pet has Plus in membership (non-Foundations):', pet.name, membershipPlanName);
      return false; // Already has Plus upgrade (and it's not Foundations Plus)
    }
    
    // Check ALL wellness plans (active and inactive) for Plus (but only if they don't have Foundations)
    if (!hasFoundationsPlan) {
      for (const plan of allWellnessPlans) {
        const packageName = (plan.packageName || '').toLowerCase();
        const planName = (plan.name || '').toLowerCase();
        
        // Check if any wellness plan has Plus (but not Foundations)
        if ((packageName.includes('plus') || planName.includes('plus')) &&
            !packageName.includes('foundations') && !planName.includes('foundations') &&
            !packageName.includes('foundation') && !planName.includes('foundation')) {
          console.log('[canUpgradeMembership] Pet has Plus in wellness plan (non-Foundations):', pet.name, packageName, planName);
          return false; // Already has Plus upgrade (and it's not Foundations Plus)
        }
      }
    }
    
    // Base plans that can be upgraded: Foundations, Golden, Comfort Care
    const basePlans = ['foundations', 'golden', 'comfort', 'comfort-care'];
    
    // Check if membership transaction has a base plan
    const hasBasePlanInMembership = basePlans.some((basePlan) => membershipPlanName.includes(basePlan));
    
    // Check if any wellness plan has a base plan
    let hasBasePlanInWellness = false;
    for (const plan of allWellnessPlans) {
      const packageName = (plan.packageName || '').toLowerCase();
      const planName = (plan.name || '').toLowerCase();
      if (basePlans.some((basePlan) => packageName.includes(basePlan) || planName.includes(basePlan))) {
        hasBasePlanInWellness = true;
        console.log('[canUpgradeMembership] Found base plan in wellness:', pet.name, packageName, planName);
        break;
      }
    }
    
    const canUpgrade = hasBasePlanInMembership || hasBasePlanInWellness;
    console.log('[canUpgradeMembership]', pet.name, {
      membershipPlanName,
      hasBasePlanInMembership,
      hasBasePlanInWellness,
      canUpgrade,
      wellnessPlansCount: allWellnessPlans.length,
    });
    
    // Show upgrade button if they have a base plan in EITHER membership transaction OR wellness plans
    // AND they don't already have Plus or Puppy/Kitten in either
    return canUpgrade;
  }

  const brand = 'var(--brand, #0f766e)';
  const brandSoft = 'var(--brand-soft, #e6f7f5)';

  // Helper function to parse time string (HH:MM format) to minutes since midnight
  function parseTimeToMinutes(timeStr: string): number {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      return hours * 60 + minutes;
    }
    return 0;
  }

  // Helper function to convert 24-hour time (HH:MM) to 12-hour time (h:MM AM/PM)
  function formatTo12Hour(timeStr: string): string {
    if (!timeStr) return timeStr;
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!match) return timeStr;
    
    let hours = parseInt(match[1]);
    const minutes = match[2];
    
    // Handle times past midnight (e.g., "27:00" = 3:00 AM)
    if (hours >= 24) {
      hours = hours - 24;
    }
    
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    
    return `${hours12}:${minutes} ${period}`;
  }

  // Check if chat hours are currently open based on chatHoursOfOperation
  const isChatHoursOpen = useMemo(() => {
    if (!chatHours) {
      // If no chat hours data, default to hiding the button (assume closed)
      return false;
    }

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight

    // Map day index to lowercase day name
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayName = dayNames[currentDay];
    
    // Get today's chat hours
    const todayChatHours = chatHours[todayName];

    if (!todayChatHours || !todayChatHours.open || !todayChatHours.close) {
      return false; // Closed if no chat hours for today
    }

    const openMinutes = parseTimeToMinutes(todayChatHours.open);
    let closeMinutes = parseTimeToMinutes(todayChatHours.close);
    
    // Handle case where close time is after midnight (e.g., "27:00" = 3:00 AM next day)
    if (closeMinutes < openMinutes) {
      closeMinutes += 24 * 60; // Add 24 hours
    }

    // Check if current time is within chat hours
    const isOpen = currentTimeMinutes >= openMinutes && currentTimeMinutes < closeMinutes;
    
    return isOpen;
  }, [chatHours]);

  // Format chat hours for display in tooltip
  const formattedChatHours = useMemo(() => {
    if (!chatHours) return null;

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    return dayNames.map((dayName, index) => {
      const hours = chatHours[dayName];
      if (!hours || !hours.open || !hours.close) {
        return { day: dayLabels[index], hours: 'Closed' };
      }
      
      // Convert to 12-hour format
      const openTime12 = formatTo12Hour(hours.open);
      const closeTime12 = formatTo12Hour(hours.close);
      
      return { day: dayLabels[index], hours: `${openTime12} - ${closeTime12}` };
    });
  }, [chatHours]);

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
        .cp-pet-img { height: 120px; border-radius: 16px; border: 1px solid rgba(0, 0, 0, 0.06); }
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
          .cp-pet-img { height: 130px; border-radius: 16px; border: 1px solid rgba(0, 0, 0, 0.06); }
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
          .cp-pet-img { height: 140px; border-radius: 16px; border: 1px solid rgba(0, 0, 0, 0.06); }
        }

        /* >= 900px */
        @media (min-width: 900px) {
          .cp-pets { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
        }

        /* Show bottom nav & add bottom padding on small screens only */
        @media (max-width: 639px) {
          .cp-bottom-nav { display: block; }
          .cp-wrap { padding-bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 12px); }
          /* Hide top service action buttons when bottom nav is showing */
          .cp-service-actions-section { display: none !important; }
        .cp-service-actions-mobile { display: block !important; }
        .cp-service-actions-desktop { display: none !important; }
      }

      /* Show desktop buttons on larger screens */
      @media (min-width: 640px) {
        .cp-service-actions-mobile { display: none !important; }
        .cp-service-actions-desktop { display: grid !important; }
      }

      /* Chat hours tooltip */
      .chat-hours-tooltip {
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
      }
      `}</style>

      {/* HERO - Logo */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          marginBottom: '32px',
          marginTop: '16px',
          background: 'radial-gradient(1000px 600px at 20% -10%, #ecfff8 0%, transparent 60%), #f6fbf9',
          padding: '20px',
          borderRadius: '16px',
        }}
      >
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
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
        {clientFirstName && (
          <h1 style={{ 
            margin: 0, 
            fontSize: '24px', 
            fontWeight: 600, 
            color: '#111827',
            textAlign: 'center',
            width: '100%'
          }}>
            Welcome, {clientFirstName} to your VAYD Client Portal!
          </h1>
        )}
      </div>

      {/* NOTICES */}
      {loading && <div style={{ marginTop: 16 }}>Loading your information…</div>}
      {error && <div style={{ marginTop: 16, color: '#b00020' }}>{error}</div>}

      {!loading && !error && (
        <>
          {/* SERVICE ACTION BUTTONS */}
          <section className="cp-section cp-service-actions-section" style={{ marginTop: 28 }}>
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

            {petsWithProvider.length === 0 ? (
              <div className="cp-muted">No pets found yet.</div>
            ) : (
              <div className="cp-pets">
                {petsWithProvider.map((p) => {
                  const subStatus = p.subscription?.status;
                  const isActive = subStatus === 'active';
                  const isPending = subStatus === 'pending';
                  const hasSubscription = isActive || isPending;

                  // Get active wellness plans - filter to only active ones
                  const activeWellnessPlans = (p.wellnessPlans || []).filter((plan) =>
                    planIsActive(plan)
                  );
                  const hasActiveWellnessPlan = activeWellnessPlans.length > 0;
                  const hasWellnessPlans = (p.wellnessPlans || []).length > 0;
                  
                  // Get membership info
                  const membershipStatusRaw = p.membershipStatus ?? null;
                  const membershipStatusNormalized = membershipStatusRaw
                    ? String(membershipStatusRaw).toLowerCase()
                    : null;
                  const membershipIsActive = membershipStatusNormalized === 'active';
                  const membershipIsPending = membershipStatusNormalized === 'pending';
                  const hasMembership = p.membershipPlanName != null;
                  
                  // Check if membership was created within last 7 days
                  const membershipUpdatedAt = p.membershipUpdatedAt;
                  const membershipIsRecent = membershipUpdatedAt
                    ? (Date.now() - new Date(membershipUpdatedAt).getTime()) / (1000 * 60 * 60 * 24) <= 7
                    : false;
                  
                  // Determine what to display for membership/wellness
                  let membershipDisplayText: string | null = null;
                  let showMembershipNotice = false;
                  
                  if (hasActiveWellnessPlan) {
                    // Use the first active wellness plan and display its package name
                    // Don't show billing preference for active plans - only show in processing state
                    const firstActivePlan = activeWellnessPlans[0];
                    // Prioritize packageName, fallback to name, then default text
                    membershipDisplayText = 
                      firstActivePlan.packageName || 
                      firstActivePlan.name || 
                      'Wellness Plan';
                    showMembershipNotice = true;
                  } else if (hasMembership && !hasWellnessPlans) {
                    // No wellness plans but has membership - show with PROCESSING
                    let planName = p.membershipPlanName || 'Membership';
                    // Clean the plan name first (removes "Add-ons:" pattern)
                    planName = cleanMembershipDisplayText(planName);
                    // Check if planName already includes billing preference
                    const planNameLower = planName.toLowerCase();
                    const alreadyHasMonthly = planNameLower.includes('monthly');
                    const alreadyHasAnnually = planNameLower.includes('annually') || planNameLower.includes('annual');
                    
                    // Format billing preference as "Annual" or "Monthly" (title case)
                    const membershipPricingLabel = !alreadyHasMonthly && !alreadyHasAnnually && p.membershipPricingOption
                      ? String(p.membershipPricingOption).toLowerCase() === 'annual'
                        ? 'Annual'
                        : String(p.membershipPricingOption).toLowerCase() === 'monthly'
                        ? 'Monthly'
                        : titleCase(
                            String(p.membershipPricingOption)
                              .replace(/[_-]+/g, ' ')
                              .trim()
                          )
                      : null;
                    
                    // Debug logging
                    console.log('[ClientPortal] Processing membership display:', {
                      membershipPlanName: p.membershipPlanName,
                      cleanedPlanName: planName,
                      membershipPricingOption: p.membershipPricingOption,
                      membershipPricingLabel,
                      alreadyHasMonthly,
                      alreadyHasAnnually,
                    });
                    
                    membershipDisplayText = membershipPricingLabel
                      ? `${planName} ${membershipPricingLabel}`
                      : planName;
                    showMembershipNotice = true;
                  } else if (hasMembership && hasWellnessPlans && !hasActiveWellnessPlan) {
                    // Has membership and wellness plans but none are active
                    if (membershipIsRecent) {
                      // Show membership with PROCESSING if created within 7 days
                      let planName = p.membershipPlanName || 'Membership';
                      // Clean the plan name first (removes "Add-ons:" pattern)
                      planName = cleanMembershipDisplayText(planName);
                      // Check if planName already includes billing preference
                      const planNameLower = planName.toLowerCase();
                      const alreadyHasMonthly = planNameLower.includes('monthly');
                      const alreadyHasAnnually = planNameLower.includes('annually') || planNameLower.includes('annual');
                      
                      // Format billing preference as "Annual" or "Monthly" (title case)
                      const membershipPricingLabel = !alreadyHasMonthly && !alreadyHasAnnually && p.membershipPricingOption
                        ? String(p.membershipPricingOption).toLowerCase() === 'annual'
                          ? 'Annual'
                          : String(p.membershipPricingOption).toLowerCase() === 'monthly'
                          ? 'Monthly'
                          : titleCase(
                              String(p.membershipPricingOption)
                                .replace(/[_-]+/g, ' ')
                                .trim()
                            )
                        : null;
                      
                      // Debug logging
                      console.log('[ClientPortal] Processing membership display (recent):', {
                        membershipPlanName: p.membershipPlanName,
                        cleanedPlanName: planName,
                        membershipPricingOption: p.membershipPricingOption,
                        membershipPricingLabel,
                        alreadyHasMonthly,
                        alreadyHasAnnually,
                      });
                      
                      membershipDisplayText = membershipPricingLabel
                        ? `${planName} ${membershipPricingLabel}`
                        : planName;
                      showMembershipNotice = true;
                    } else {
                      // Don't show anything if older than 7 days
                      showMembershipNotice = false;
                    }
                  }
                  
                  // Show signup button if no active wellness plan and no membership (or membership is old)
                  const showMembershipButton =
                    !hasActiveWellnessPlan &&
                    (!hasMembership || (hasMembership && hasWellnessPlans && !hasActiveWellnessPlan && !membershipIsRecent));

                  // Determine if membership is processing (has membership but no active wellness plan)
                  const isMembershipProcessing = hasMembership && !hasActiveWellnessPlan && showMembershipNotice;
                  
                  const badgeLabel = isActive
                    ? 'Subscription Active'
                    : isPending
                    ? 'Subscription Pending'
                    : hasActiveWellnessPlan
                    ? 'Membership Active'
                    : isMembershipProcessing
                    ? 'Membership Processing'
                    : membershipIsPending
                    ? 'Membership Pending'
                    : null;
                  
                  // Colors based on badge label: Membership Active = green, Membership Processing = orange
                  let badgeColor = '#f97316'; // Default orange
                  if (badgeLabel === 'Subscription Active' || badgeLabel === 'Membership Active') {
                    badgeColor = '#4FB128'; // Green
                  } else if (badgeLabel === 'Membership Processing') {
                    badgeColor = '#f97316'; // Orange
                  } else {
                    badgeColor = '#f97316'; // Orange for pending
                  }

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
                          borderRadius: '16px',
                          border: '1px solid rgba(0, 0, 0, 0.06)',
                        }}
                      >
                        {badgeLabel && (
                          <span
                            style={{
                              position: 'absolute',
                              top: 10,
                              left: 10,
                              background: badgeColor === '#4FB128' 
                                ? '#E8F5E9' 
                                : '#FFF4E6',
                              color: badgeColor,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 10px',
                              borderRadius: 4,
                              border: `1px solid ${badgeColor}`,
                              boxShadow: 'none',
                            }}
                          >
                            {badgeLabel}
                          </span>
                        )}
                        {p.dbId && (
                          <label
                            style={{
                              position: 'absolute',
                              top: 10,
                              right: 10,
                              background: 'rgba(255, 255, 255, 0.9)',
                              border: '1px solid rgba(0, 0, 0, 0.1)',
                              borderRadius: '50%',
                              width: 32,
                              height: 32,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: uploadingPetId === p.id ? 'wait' : 'pointer',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                              transition: 'all 0.2s ease',
                            }}
                            title="Upload pet image"
                            onMouseEnter={(e) => {
                              if (uploadingPetId !== p.id) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 1)';
                                e.currentTarget.style.transform = 'scale(1.1)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)';
                              e.currentTarget.style.transform = 'scale(1)';
                            }}
                          >
                            <input
                              type="file"
                              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                              style={{ display: 'none' }}
                              disabled={uploadingPetId === p.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handlePetImageUpload(p, file);
                                }
                                // Reset input so same file can be selected again
                                e.target.value = '';
                              }}
                            />
                            {uploadingPetId === p.id ? (
                              <span style={{ fontSize: 14, color: '#666' }}>⏳</span>
                            ) : (
                              <span style={{ fontSize: 16 }}>📷</span>
                            )}
                          </label>
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
                        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                          {showMembershipNotice && membershipDisplayText && (
                            <div className="cp-muted" style={{ fontSize: 13 }}>
                              <strong style={{ fontWeight: 600 }}>Membership:</strong>{' '}
                              {membershipDisplayText}
                              {!hasActiveWellnessPlan && (
                                <span style={{ color: '#fbbf24', fontWeight: 600 }}> - PROCESSING</span>
                              )}
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

                        {/* Vaccination Certificate Link */}
                        {p.vaccinations && p.vaccinations.length > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                            <button
                              onClick={() => {
                                setSelectedPetForVaccination(p);
                                setShowVaccinationModal(true);
                              }}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                backgroundColor: 'transparent',
                                color: '#0f766e',
                                border: '1px solid #0f766e',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                transition: 'all 0.2s',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#f0fdfa';
                                e.currentTarget.style.borderColor = '#0d9488';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.borderColor = '#0f766e';
                              }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                style={{ width: 16, height: 16 }}
                              >
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                              </svg>
                              Print Vaccination Certificate
                            </button>
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {hasActiveWellnessPlan && (
                          <div style={{ position: 'relative', width: '100%' }}>
                            {isChatHoursOpen ? (
                              <a
                                href="https://direct.lc.chat/19087357/"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  width: '100%',
                                  padding: '8px 12px',
                                  backgroundColor: '#3b82f6',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 8,
                                  fontSize: 14,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  textDecoration: 'none',
                                  textAlign: 'center',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 8,
                                  transition: 'opacity 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.opacity = '0.9';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.opacity = '1';
                                }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                                After-hours Chat
                              </a>
                            ) : (
                              <div
                                style={{
                                  width: '100%',
                                  padding: '8px 12px',
                                  backgroundColor: '#9ca3af',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 8,
                                  fontSize: 14,
                                  fontWeight: 600,
                                  cursor: 'not-allowed',
                                  textAlign: 'center',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 8,
                                  position: 'relative',
                                }}
                                onMouseEnter={(e) => {
                                  const tooltip = e.currentTarget.querySelector('.chat-hours-tooltip') as HTMLElement;
                                  if (tooltip) tooltip.style.opacity = '1';
                                }}
                                onMouseLeave={(e) => {
                                  const tooltip = e.currentTarget.querySelector('.chat-hours-tooltip') as HTMLElement;
                                  if (tooltip) tooltip.style.opacity = '0';
                                }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                                After-hours Chat
                                {formattedChatHours && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: '100%',
                                      left: '50%',
                                      transform: 'translateX(-50%)',
                                      marginBottom: '8px',
                                      padding: '12px 16px',
                                      backgroundColor: '#1f2937',
                                      color: '#fff',
                                      borderRadius: 8,
                                      fontSize: 13,
                                      lineHeight: 1.6,
                                      whiteSpace: 'pre-line',
                                      textAlign: 'left',
                                      minWidth: '240px',
                                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                                      opacity: 0,
                                      pointerEvents: 'none',
                                      transition: 'opacity 0.2s',
                                      zIndex: 1000,
                                    }}
                                    className="chat-hours-tooltip"
                                  >
                                    <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                                      Chat is only available during the hours the practice allows:
                                    </div>
                                    <div style={{ display: 'grid', gap: '4px' }}>
                                      {formattedChatHours.map((f) => (
                                        <div key={f.day} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ fontWeight: 500 }}>{f.day}:</span>
                                          <span style={{ marginLeft: '12px' }}>{f.hours}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {false && (() => {
                          const canUpgrade = canUpgradeMembership(p);
                          // canUpgradeMembership already checks for base plans in both membership and wellness plans
                          // So if it returns true, we know they have a base plan somewhere
                          if (canUpgrade) {
                            console.log('[Upgrade Button] Showing upgrade button for:', p.name, {
                              membershipPlanName: p.membershipPlanName,
                              wellnessPlansCount: (p.wellnessPlans || []).length,
                              hasMembership,
                              hasActiveWellnessPlan,
                            });
                          }
                          return canUpgrade;
                        })() && (
                          <button
                            onClick={() => handleUpgradeMembership(p)}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              backgroundColor: '#0f766e',
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
                            Upgrade My Plan
                          </button>
                        )}
                        {showMembershipButton && (
                          <button
                            onClick={() => handleEnrollMembership(p)}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              backgroundColor: '#4FB128',
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

          {/* Error Modal */}
          {showErrorModal && errorModalMessage && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '20px',
              }}
              onClick={() => {
                setShowErrorModal(false);
                setErrorModalMessage(null);
              }}
            >
              <div
                className="cp-card"
                style={{
                  maxWidth: '500px',
                  width: '100%',
                  padding: '24px',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h2 className="cp-h2" style={{ margin: 0, color: '#b00020' }}>
                    Upload Error
                  </h2>
                  <button
                    onClick={() => {
                      setShowErrorModal(false);
                      setErrorModalMessage(null);
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
                <div style={{ color: '#374151', lineHeight: 1.6, marginBottom: 24 }}>
                  {errorModalMessage}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setShowErrorModal(false);
                      setErrorModalMessage(null);
                    }}
                    style={{
                      background: '#4FB128',
                      color: '#fff',
                      border: 'none',
                      padding: '10px 24px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}

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
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #e5e7eb' }}>
                  <a
                    href="https://form.jotform.com/221585880190157"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cp-card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      textDecoration: 'none',
                      color: '#111827',
                      borderRadius: 8,
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
                </div>
              </div>
            </div>
          )}

          {/* Vaccination Certificate Modal */}
          {showVaccinationModal && selectedPetForVaccination && selectedPetForVaccination.vaccinations && (
            <VaccinationCertificateModal
              pet={selectedPetForVaccination}
              vaccinations={selectedPetForVaccination.vaccinations}
              onClose={() => {
                setShowVaccinationModal(false);
                setSelectedPetForVaccination(null);
              }}
            />
          )}

        </>
      )}

      {/* ---------------------------
          Footer
      ---------------------------- */}
      <footer
        style={{
          marginTop: '48px',
          padding: '32px 16px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
              Vet At Your Door
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              Providing quality veterinary care at your doorstep.
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '24px',
              marginBottom: '16px',
            }}
          >
            <a
              href="tel:207-536-8387"
              style={{ fontSize: '14px', color: '#4FB128', textDecoration: 'none' }}
            >
              (207) 536-8387
            </a>
            <a
              href="mailto:info@vetatyourdoor.com"
              style={{ fontSize: '14px', color: '#4FB128', textDecoration: 'none' }}
            >
              info@vetatyourdoor.com
            </a>
            <a
              href="https://www.vetatyourdoor.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '14px', color: '#4FB128', textDecoration: 'none' }}
            >
              www.vetatyourdoor.com
            </a>
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '16px' }}>
            © {new Date().getFullYear()} Vet At Your Door. All rights reserved.
          </div>
        </div>
      </footer>

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
