// src/pages/MembershipSignup.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  fetchClientPets,
  type Pet,
  fetchClientAppointments,
} from '../api/clientPortal';
import {
  PaymentIntent,
  type MembershipTransactionPayload,
  type MembershipTransactionAddOn,
  fetchSubscriptionPlanCatalog,
  type SubscriptionPlanCatalog,
  fetchFormattedSubscriptionPlans,
  type FormattedSubscriptionPlan,
} from '../api/payments';
import { useAuth } from '../auth/useAuth';

 type MembershipPlan = {
  id: string;
  apiPlanId?: string;
  name: string;
  tagLine: string;
  badge?: string;
  badgeColor?: string;
  pricing: Array<{
    species?: 'dog' | 'cat';
    ageRange?: string;
    monthly: number;
    annual?: number;
    suffix?: string;
  }>;
  includes: string[];
  billingNote?: string;
};

const MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    id: 'foundations',
    name: 'Foundations',
    tagLine: 'Annual Membership Plan',
    pricing: [
      { species: 'dog', monthly: 79, annual: 749 },
      { species: 'cat', monthly: 69, annual: 639 },
    ],
    includes: [
      'One Comprehensive Wellness Exam & Trip Fee',
      'Annual Vaccinations Recommended for Age and Lifestyle',
      'Annual "Basic" Lab Panel (CBC, Abbreviated Chemistry)',
      'Annual Fecal Test',
      'Heartworm/Tick Test (Dogs)',
      'FIV / FeLV / Heartworm test (Cats)',
      'After-hours Online Chat Support via VAYD Client Portal',
    ],
  },
  {
    id: 'golden',
    name: 'Golden',
    tagLine: 'Annual Membership Plan',
    badge: 'Most Popular!',
    badgeColor: '#facc15',
    pricing: [
      { species: 'dog', monthly: 109, annual: 1179 },
      { species: 'cat', monthly: 99, annual: 1069 },
    ],
    includes: [
      'Two Comprehensive Wellness Exams & Trip Fees',
      'Annual Vaccinations Recommended for Age and Lifestyle',
      'Annual "Advanced" Lab Panel (CBC, Chemistry, Thyroid, Urinalysis)',
      'Annual Fecal Test',
      'FeLV/FIV/Heartworm test (Cats)',
      'Pancreatitis Screening (Cats)',
      '"4dx" Heartworm/Tick test (Dogs)',
      'After-hours Online Chat Support via VAYD Client Portal',
    ],
  },
  {
    id: 'comfort-care',
    name: 'Comfort Care',
    tagLine: 'Month-to-Month',
    pricing: [{ monthly: 289 }],
    includes: [
      'One Comprehensive Exam & Trip Fee per month',
      'One office-hours tele-health consult via phone or video',
      'After-hours Online Chat Support via VAYD Client Portal',
      '15% off total euthanasia and after-care cost',
    ],
  },
  {
    id: 'plus-addon',
    name: 'PLUS Add-on',
    tagLine: 'Annual Membership Plan',
    badge: 'Ideal for Chronic Conditions!*',
    badgeColor: '#f9b938',
    pricing: [{ monthly: 49, annual: 529, suffix: 'additional' }],
    includes: [
      '50% off all Additional Exams',
      '10% off Everything We Offer (e.g. Lab Work, Services, Medications)',
      'One Free Nail Trim Per Year',
    ],
    billingNote:
      '* Examples include chronic kidney disease, hyperthyroidism, allergic skin disease, arthritis, cancer.',
  },
  {
    id: 'starter-addon',
    name: 'Puppy / Kitten Add-on',
    tagLine: 'For Puppies & Kittens',
    badge: 'New Pet Special!',
    badgeColor: '#a78bfa',
    pricing: [{ monthly: 29, annual: 309, suffix: 'additional' }],
    includes: [
      'Two additional exams (one doctor, one technician) and trip fees to complete the vaccine series.',
      'All boosters for full protection.',
      'Microchip scan & placement if needed.',
    ],
  },
];

const ADD_ON_PRICING: Record<string, { label: string; monthly: number; annual?: number }> = {
  'plus-addon': {
    label: 'PLUS Add-on',
    monthly: 49,
    annual: 529,
  },
  'starter-addon': {
    label: 'Puppy / Kitten Add-on',
    monthly: 29,
    annual: 309,
  },
};

const MEMBERSHIP_AGREEMENT_TEXT = [
  'By enrolling your pet in a Vet At Your Door Membership Plan, you agree to the following terms and conditions.',
  'Membership Plans',
  'Foundations: Includes one annual wellness exam and trip fee, recommended annual vaccines based on age and lifestyle, annual lab work, and after-hours tele-chat. Requires a 12-month commitment.',
  'Golden: Includes two wellness exams with trip fees, recommended annual vaccines based on age and lifestyle, annual lab work, and after-hours tele-chat. Requires a 12-month commitment.',
  'Comfort Care: A month-to-month plan that includes one visit with trip fee, one tele-health consult during business hours per month, after-hours tele-chat, and 15% off your pet\'s total euthanasia and after-care (if elected) bill.',
  'Plus Add-On: Provides ten percent off all services and medications and fifty percent off exams. There is one free nail trim per year. The term matches the main plan. A store discount code is issued after sign-up.',
  'Puppy / Kitten Add-On: Covers booster vaccine appointments during your pet\'s first year, including the required doctor and technician visits with trip fees that are specifically tied to administering recommended booster vaccines.',
  'After-Hours Telehealth',
  'Members may access our virtual triage chat after hours during these times: Monday through Friday from 5 pm to 9 pm, and Saturday through Sunday from 8 am to 5 pm. A Triage Technician will review your pet\'s history and may consult a veterinarian if needed. No house-call visits are made after hours. If urgent care is recommended, we will direct you to an appropriate emergency facility. Service is unavailable on listed holidays. Hours may change with 30 days of notice.',
  'VCPR Requirements and Limitations for New or Lapsed Patients',
  'A valid Veterinarian-Client-Patient Relationship requires an in-person exam within the past 365 days. If more than 12 months have passed since your pet\'s most recent in-person exam with us, the VCPR is considered expired.',
  'For pets we have not yet seen, or for pets whose VCPR has lapsed, the following services cannot be provided until a current VCPR is re-established through an in-person exam:',
  'Medical advice, tele-health consultation, triage guidance, or care recommendations from your One Team or other VAYD team member',
  'Prescription medications or refills of any kind',
  'Once the initial or renewal exam is completed, all membership benefits become fully active.',
  'Memberships do not automatically cancel when the VCPR expires. It is the client\'s responsibility to have their pet remain current.',
  'Membership Rules',
  'Benefits apply only to the enrolled pet and cannot be shared or transferred, including to another pet in the same household. Misuse may result in cancellation and repayment of discounts.',
  'Memberships bill monthly or annually, renew automatically, and may transition from Foundations to Golden when your pet reaches eight years of age for dogs or nine years of age for cats. We will email you twenty to thirty days before renewal with a recommendation. You may change your selection or cancel at that time.',
  'Foundations, Golden, Plus, and Puppy / Kitten plans require a twelve-month term. Comfort Care is month-to-month, as is Plus when selected with Comfort Care.',
  'If your pet passes away, moves, or transitions to Comfort Care, the value of used services will be deducted from the payments you have made. If the value of services used exceeds payments made, the remaining balance will be due before the plan is closed. No partial refunds are issued. Re-enrollment requires a new registration fee if charged.',
  'If the client moves, any refund will be issued only after we receive both a record request from a veterinary hospital outside our service area and a copy of the client\'s new lease or mortgage agreement.',
  'A one-time registration fee, if charged, supports our Angel Fund for pets in need.',
  'Scheduling and Availability',
  'Visits should be scheduled in advance for best availability. Specific appointment times cannot be guaranteed. Services are available only within our service area and during our regular appointment hours.',
  'We will make every reasonable effort for your pet\'s care to be provided by your dedicated One Team, especially for wellness visits and planned follow-up care. In situations where schedule constraints, urgent needs, staffing limitations, or routing requirements prevent your One Team from being available, another Vet At Your Door team may provide care to ensure your pet is seen in a timely manner.',
  'If we cannot accommodate an urgent case or a case that merits more than we can offer, we may refer you to another facility or veterinary team.',
  'Access and Technology Requirements',
  'Internet access and a compatible device are required for virtual chat and use of our online store. Instructions will be provided in the Welcome Email.',
  'Client Conduct',
  'We strive to provide compassionate and high-quality care and expect respectful communication in return. Disrespectful behavior may result in termination of membership without refund.',
  'Membership supports proactive and routine care. Membership does not guarantee emergency availability.',
].join('\n\n');

function formatMoney(amount?: number | null): string {
  if (amount == null) return '—';
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatIncludesText(text: string): string {
  // Preserve special terms (case-insensitive matching) - order matters, longer terms first
  const specialTerms = ['Client Portal', 'VAYD', 'CBC', 'FeLV', 'FIV'];
  
  // Replace special terms with placeholders first (longest first to avoid partial matches)
  // Use a unique marker that won't be split
  const placeholders: Map<string, string> = new Map();
  let protectedText = text;
  let placeholderCounter = 0;
  
  specialTerms.forEach((term) => {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    protectedText = protectedText.replace(regex, (match) => {
      const placeholder = `__PLACEHOLDER_${placeholderCounter}__`;
      placeholders.set(placeholder, term);
      placeholderCounter++;
      return placeholder;
    });
  });
  
  // Now process the protected text word by word
  const words = protectedText.split(/(\s+)/);
  let result = '';
  let isFirstWord = true;
  
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    
    // Skip whitespace
    if (/^\s+$/.test(word)) {
      result += word;
      continue;
    }
    
    // Check if this word contains any placeholder(s) and replace all of them
    let foundPlaceholder = false;
    let processedWord = word;
    
    for (const [placeholder, term] of placeholders.entries()) {
      if (processedWord.includes(placeholder)) {
        // Replace all occurrences of this placeholder with the special term
        processedWord = processedWord.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), term);
        foundPlaceholder = true;
      }
    }
    
    if (foundPlaceholder) {
      result += processedWord;
      isFirstWord = false;
      continue;
    }
    
    // Process regular words
    if (isFirstWord) {
      // Capitalize first letter of first word, lowercase rest
      word = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      isFirstWord = false;
    } else {
      // Lowercase all other words
      word = word.toLowerCase();
    }
    
    result += word;
  }
  
  return result;
}

function encodeSvgData(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DOG_PLACEHOLDER = `${import.meta.env.BASE_URL ?? '/'}doggy.png`;

const CAT_PLACEHOLDER = `${import.meta.env.BASE_URL ?? '/'}catty.png`;

function petImg(pet: Pet | null): string {
  if (!pet) return DOG_PLACEHOLDER;
  // Check for uploaded photo first
  if (pet.photoUrl) {
    return pet.photoUrl;
  }
  // Fallback to species-based placeholders
  const species = (pet.species ?? pet.breed ?? '').toLowerCase();
  if (species.includes('dog') || species.includes('canine')) return DOG_PLACEHOLDER;
  if (species.includes('cat') || species.includes('feline')) return CAT_PLACEHOLDER;
  return CAT_PLACEHOLDER;
}

type PlanCombination = 'base' | 'plus' | 'starter' | 'plusStarter';
type BillingCadence = 'monthly' | 'annual';

type PlanEntry = {
  planId: string;
  planVariationId: string;
};

function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function catalogHasCadence(
  catalog: SubscriptionPlanCatalog | null,
  planKey: string,
  species: 'cat' | 'dog' | null,
  cadence: BillingCadence,
): boolean {
  if (!catalog || !planKey) return false;
  const planNode = catalog[planKey];
  if (!planNode) return false;
  const nodes: any[] = [];
  
  // Comfort-care has a "general" wrapper in the catalog structure
  if (planKey === 'comfort-care') {
    const generalNode = (planNode as any)['general'] || planNode;
    if (generalNode && generalNode[cadence]) {
      nodes.push(generalNode[cadence]);
    }
    return nodes.some(
      (node) => node && Object.values(node as Record<string, any>).some(Boolean),
    );
  }
  
  if (species && (planNode as any)[species]) {
    const speciesNode = (planNode as any)[species];
    if (speciesNode && speciesNode[cadence]) nodes.push(speciesNode[cadence]);
  }
  if ((planNode as any)[cadence]) {
    nodes.push((planNode as any)[cadence]);
  }
  return nodes.some(
    (node) => node && Object.values(node as Record<string, any>).some(Boolean),
  );
}

function lookupCatalogEntry(
  catalog: SubscriptionPlanCatalog | null,
  planKey: string,
  species: 'cat' | 'dog' | null,
  cadence: BillingCadence,
  combination: PlanCombination,
  comfortPlus: boolean,
): PlanEntry | undefined {
  if (!catalog) {
    console.error('Catalog lookup: catalog is null');
    return undefined;
  }
  const planNode = catalog[planKey];
  if (!planNode) {
    console.error('Catalog lookup: plan node not found', {
      planKey,
      availablePlans: Object.keys(catalog),
    });
    return undefined;
  }

  const extractEntry = (target: any, combo: PlanCombination): PlanEntry | undefined => {
    if (!target) return undefined;
    const entry = target[combo];
    if (entry && entry.planId && entry.planVariationId) {
      return entry as PlanEntry;
    }
    return undefined;
  };

  if (planKey === 'comfort-care') {
    // Comfort-care has a "general" wrapper in the catalog structure
    const generalNode = (planNode as any)['general'] || planNode;
    const cadenceNode = generalNode[cadence];
    if (!cadenceNode) {
      console.error('Comfort-care lookup: cadence node not found', {
        planKey,
        cadence,
        planNode,
        generalNode,
        availableCadences: generalNode ? Object.keys(generalNode) : [],
      });
      return undefined;
    }
    const combo = comfortPlus ? 'plus' : 'base';
    const entry = extractEntry(cadenceNode, combo as PlanCombination);
    if (!entry) {
      console.error('Comfort-care lookup: entry not found', {
        planKey,
        cadence,
        combo,
        cadenceNode,
        availableCombos: cadenceNode ? Object.keys(cadenceNode) : [],
      });
    }
    return entry;
  }

  if (species && (planNode as any)[species]) {
    const speciesNode = (planNode as any)[species];
    const cadenceNode = speciesNode?.[cadence];
    const entry = extractEntry(cadenceNode, combination);
    if (entry) return entry;
  }

  const fallbackCadence = (planNode as any)[cadence];
  if (fallbackCadence) {
    const entry = extractEntry(fallbackCadence, combination);
    if (entry) return entry;
  }

  return undefined;
}

export default function MembershipSignup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: authUserId } = useAuth() as any;

  const petId = (location.state as any)?.petId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pet, setPet] = useState<Pet | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedPlanExplicit, setSelectedPlanExplicit] = useState<string | null>(null);
  const [plusExplicit, setPlusExplicit] = useState(false);
  const [starterAnswer, setStarterAnswer] = useState<'yes' | 'no' | null>(null);
  const [starterExplicit, setStarterExplicit] = useState(false);
  const [comfortAnswer, setComfortAnswer] = useState<'yes' | 'no' | null>(null);
  const [billingPreference, setBillingPreference] = useState<'monthly' | 'annual'>('monthly');
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(false);
  const [hasAnyAppointments, setHasAnyAppointments] = useState(false);
  const [hasPastAppointment, setHasPastAppointment] = useState(false);
  const [hasUpcomingAppointment, setHasUpcomingAppointment] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementSignature, setAgreementSignature] = useState('');
  const [planCatalog, setPlanCatalog] = useState<SubscriptionPlanCatalog | null>(null);
  const [planCatalogError, setPlanCatalogError] = useState<string | null>(null);
  const [planCatalogLoading, setPlanCatalogLoading] = useState(true);
  const [formattedPlans, setFormattedPlans] = useState<FormattedSubscriptionPlan[]>([]);
  const [formattedPlansLoading, setFormattedPlansLoading] = useState(true);
  const [formattedPlansError, setFormattedPlansError] = useState<string | null>(null);

  const brand = 'var(--brand, #0f766e)';
  const brandSoft = 'var(--brand-soft, #e6f7f5)';

  // Build plans with dynamic pricing from API
  const plans = useMemo(() => {
    if (!planCatalog || !formattedPlans.length) {
      return MEMBERSHIP_PLANS;
    }

    // Helper to get price from formatted plans using catalog IDs
    const getPriceFromCatalogIds = (
      planKey: string,
      species: 'cat' | 'dog' | null,
      cadence: 'monthly' | 'annual',
      combination: 'base' | 'plus' | 'starter' | 'plusStarter' = 'base',
    ): { monthly?: number; annual?: number } | null => {
      // Get catalog entry
      const catalogEntry = lookupCatalogEntry(
        planCatalog,
        planKey,
        species,
        cadence,
        combination,
        false,
      );

      if (!catalogEntry?.planId || !catalogEntry?.planVariationId) return null;

      // Find the plan in formatted plans
      const plan = formattedPlans.find((p) => p.planId === catalogEntry.planId);
      if (!plan) return null;

      // Find the variation
      const variation = plan.variations?.find(
        (v) => v.variationId === catalogEntry.planVariationId,
      );
      if (!variation) return null;

      // Extract price from phases or price field
      let monthly: number | undefined;
      let annual: number | undefined;

      if (variation.phases && variation.phases.length > 0) {
        for (const phase of variation.phases) {
          if (!phase) continue;
          const phaseCadence = (phase.cadence || '').toLowerCase();
          const amount = phase.pricing?.amount ?? variation.price?.amount;
          if (amount && amount > 0) {
            if (phaseCadence === 'monthly') {
              monthly = Math.round(amount / 100);
            } else if (phaseCadence === 'annual') {
              annual = Math.round(amount / 100);
            }
          }
        }
      } else if (variation.price?.amount) {
        const amount = variation.price.amount;
        const varName = (variation.name || '').toLowerCase();
        if (varName.includes('monthly') || !varName.includes('annual')) {
          monthly = Math.round(amount / 100);
        }
        if (varName.includes('annual')) {
          annual = Math.round(amount / 100);
        }
      }

      return monthly !== undefined || annual !== undefined ? { monthly, annual } : null;
    };

    // Map each plan with API prices
    return MEMBERSHIP_PLANS.map((plan) => {
      const updatedPricing = plan.pricing.map((tier) => {
        const species = tier.species || null;

        // Get monthly price
        const monthlyPrice = getPriceFromCatalogIds(plan.id, species, 'monthly', 'base');
        const monthly = monthlyPrice?.monthly ?? tier.monthly;

        // Get annual price
        const annualPrice = getPriceFromCatalogIds(plan.id, species, 'annual', 'base');
        const annual = annualPrice?.annual ?? tier.annual;

        return {
          ...tier,
          monthly,
          annual,
        };
      });

      return {
        ...plan,
        pricing: updatedPricing,
      };
    });
  }, [planCatalog, formattedPlans]);

  useEffect(() => {
    if (!petId) {
      setError('No pet selected. Please go back and select a pet.');
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setAppointmentsLoaded(false);
      try {
        const pets = await fetchClientPets();
        const selectedPet = pets.find((p) => p.id === petId);
        if (!selectedPet) {
          if (alive) {
            setError('Pet not found.');
            setLoading(false);
          }
          return;
        }
        if (alive) setPet(selectedPet);

        try {
          const appts = await fetchClientAppointments();
          if (alive) {
            const relevant = appts.filter(
              (appt) =>
                (appt.patientPimsId && String(appt.patientPimsId) === selectedPet.id) ||
                appt.patientName?.toLowerCase() === selectedPet.name.toLowerCase()
            );
            const now = Date.now();
            const any = relevant.length > 0;
            const past = relevant.some((appt) => new Date(appt.startIso).getTime() < now);
            const upcoming = relevant.some((appt) => new Date(appt.startIso).getTime() >= now);
            setHasAnyAppointments(any);
            setHasPastAppointment(past);
            setHasUpcomingAppointment(upcoming);
            setAppointmentsLoaded(true);
          }
        } catch {
          if (alive) {
            setHasAnyAppointments(false);
            setHasPastAppointment(false);
            setHasUpcomingAppointment(false);
            setAppointmentsLoaded(true);
          }
        }
      } catch (e: any) {
        if (alive) setError(e?.message || 'Failed to load membership information.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [petId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setPlanCatalogLoading(true);
      setPlanCatalogError(null);
      try {
        const catalog = await fetchSubscriptionPlanCatalog();
        if (alive) setPlanCatalog(catalog);
      } catch (e: any) {
        if (alive) {
          setPlanCatalogError(e?.message || 'Unable to load membership catalog.');
        }
      } finally {
        if (alive) setPlanCatalogLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Fetch formatted subscription plans from Square
  useEffect(() => {
    let alive = true;
    (async () => {
      setFormattedPlansLoading(true);
      setFormattedPlansError(null);
      try {
        const plans = await fetchFormattedSubscriptionPlans();
        if (alive) setFormattedPlans(plans);
      } catch (e: any) {
        if (alive) {
          setFormattedPlansError(e?.message || 'Unable to load subscription plans.');
        }
      } finally {
        if (alive) setFormattedPlansLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const petDetails = useMemo(() => {
    if (!pet) return { kind: null as null | 'dog' | 'cat', ageYears: null as number | null };
    const speciesSource = (pet.species ?? pet.breed ?? '').toLowerCase();
    const kind: 'dog' | 'cat' | null = speciesSource.includes('dog') || speciesSource.includes('canine')
      ? 'dog'
      : speciesSource.includes('cat') || speciesSource.includes('feline')
        ? 'cat'
        : null;
    let ageYears: number | null = null;
    if (pet.dob) {
      const dob = new Date(pet.dob);
      if (!Number.isNaN(dob.getTime())) {
        const diff = Date.now() - dob.getTime();
        ageYears = Math.max(0, diff / (1000 * 60 * 60 * 24 * 365.25));
      }
    }
    return { kind, ageYears };
  }, [pet]);

  const meetsGolden = useMemo(() => {
    if (!petDetails.kind || petDetails.ageYears == null) return false;
    return petDetails.ageYears >= 9;
  }, [petDetails]);

  const combinedError = error ?? planCatalogError;

  const recommendedPlanId = meetsGolden ? 'golden' : null;
  const isNewPatient = !hasPastAppointment;

  // Get the primary plan name that should be selected
  const primaryPlanName = useMemo(() => {
    if (comfortAnswer === 'yes') return 'Comfort Care';
    if (comfortAnswer === 'no' && meetsGolden) {
      // User is eligible for Golden (recommended) or Foundations
      return 'Golden'; // Recommend Golden since they meet the criteria
    }
    if (comfortAnswer === 'no') return 'Foundations';
    // If comfortAnswer is null, default to Foundations
    return 'Foundations';
  }, [comfortAnswer, meetsGolden]);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const shouldAskStarter =
    isNewPatient && petDetails.ageYears != null && petDetails.ageYears <= 1.5 && !!petDetails.kind;
  const showPreVisitNote = hasUpcomingAppointment && !hasPastAppointment;

  const recommendationCopy = useMemo(() => {
    if (!pet || !meetsGolden) return null;
    const name = pet.name || 'your pet';
    return (
      <div
        className="cp-card"
        style={{
          padding: 20,
          borderLeft: '4px solid #4FB128',
          background: brandSoft,
          marginBottom: 16,
        }}
      >
        <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
          We recommend the Golden Plan for {name}.
        </strong>
        <p className="cp-muted" style={{ margin: '0 0 8px' }}>
          It's designed for seniors and includes two visits plus advanced labs. If you prefer something lighter, Foundations includes one visit with an abbreviated lab panel.
        </p>
        <p className="cp-muted" style={{ margin: 0 }}>
          For added support with chronic conditions or closer monitoring, you can add PLUS to either plan. Please note: Upgrading to Plus later isn't available, so choose it now if {name} may need the extra support.
        </p>
      </div>
    );
  }, [pet, meetsGolden, brand, brandSoft]);

  useEffect(() => {
    if (comfortAnswer === 'yes') {
      setSelectedPlanExplicit(null);
      setSelectedPlanId('comfort-care');
      setBillingPreference('monthly');
      setPlusExplicit(false);
    }
    if (comfortAnswer === 'no') {
      setSelectedPlanExplicit(null);
      setSelectedPlanId(null);
      setPlusExplicit(false);
    }
    if (comfortAnswer == null) {
      setSelectedPlanExplicit(null);
      setSelectedPlanId(null);
      setPlusExplicit(false);
    }
    setAgreementAccepted(false);
    setAgreementSignature('');
  }, [comfortAnswer]);

  useEffect(() => {
    if (!shouldAskStarter) {
      setStarterAnswer(null);
      setStarterExplicit(false);
    } else {
      setStarterExplicit(false);
    }
  }, [shouldAskStarter]);

  useEffect(() => {
    if (!selectedPlanExplicit || selectedPlanExplicit === 'comfort-care') {
      setBillingPreference('monthly');
    }
  }, [selectedPlanExplicit]);

  const costSummary = useMemo(() => {
    if (!selectedPlanExplicit) return null;
    const items: { label: string; monthly?: number | null; annual?: number | null }[] = [];

    const plan = plans.find((p) => p.id === selectedPlanExplicit);
    if (plan) {
      const tiers = plan.pricing ?? [];
      let matched: typeof tiers[number] | undefined;
      if (petDetails.kind) matched = tiers.find((tier) => tier.species === petDetails.kind);
      if (!matched && tiers.length) matched = tiers[0];
      if (matched) {
        const isComfort = selectedPlanExplicit === 'comfort-care';
        items.push({
          label: plan.name,
          monthly: matched.monthly ?? null,
          annual: isComfort ? null : matched.annual ?? null,
        });
      }
    }

    if (plusExplicit) {
      items.push({ label: 'PLUS Add-on', monthly: 49, annual: selectedPlanExplicit === 'comfort-care' ? null : 529 });
    }
    if (starterExplicit) {
      items.push({ label: 'Puppy / Kitten Add-on', monthly: 29, annual: selectedPlanExplicit === 'comfort-care' ? null : 309 });
    }

    if (!items.length) return null;

    const totalMonthly = items.reduce((acc, row) => acc + (row.monthly ?? 0), 0);
    const annualItems = items.filter((row) => row.annual != null);
    const totalAnnual = annualItems.length
      ? annualItems.reduce((acc, row) => acc + (row.annual ?? 0), 0)
      : null;

    return { items, totalMonthly, totalAnnual };
  }, [selectedPlanExplicit, plans, petDetails.kind, plusExplicit, starterExplicit]);

  const annualAvailable = costSummary?.items.some((row) => row.annual != null) ?? false;

  function handleProceedToPayment() {
    if (!pet || !selectedPlanExplicit || !costSummary) {
      setError('Please add a plan to your cart.');
      return;
    }

    const chosenPlan = plans.find((p) => p.id === selectedPlanExplicit) ?? null;

    const amountBase =
      billingPreference === 'annual' && costSummary.totalAnnual != null
        ? costSummary.totalAnnual
        : costSummary.totalMonthly;

    if (!amountBase) {
      setError('Unable to determine the total for this membership.');
      return;
    }

    const amountCents = Math.round(amountBase * 100);
    const addOns: string[] = [];
    const includeStarter = starterExplicit && selectedPlanExplicit !== 'comfort-care';
    if (plusExplicit) addOns.push('plus-addon');
    if (includeStarter) addOns.push('starter-addon');

    if (!planCatalog) {
      setError('Membership catalog is unavailable. Please try again later.');
      return;
    }

    const speciesKey =
      selectedPlanExplicit === 'comfort-care'
        ? null
        : petDetails.kind === 'dog'
          ? 'dog'
          : petDetails.kind === 'cat'
            ? 'cat'
            : null;

    const hasAnnualOption = catalogHasCadence(
      planCatalog,
      selectedPlanExplicit,
      speciesKey,
      'annual',
    );
    const billingKey: BillingCadence =
      billingPreference === 'annual' && hasAnnualOption ? 'annual' : 'monthly';

    const combination: PlanCombination =
      plusExplicit && includeStarter
        ? 'plusStarter'
        : plusExplicit
          ? 'plus'
          : includeStarter
            ? 'starter'
            : 'base';

    const catalogEntry = lookupCatalogEntry(
      planCatalog,
      selectedPlanExplicit,
      speciesKey,
      billingKey,
      combination,
      plusExplicit,
    );

    const subscriptionPlanId = catalogEntry?.planId;
    const subscriptionPlanVariationId = catalogEntry?.planVariationId;

    if (!subscriptionPlanId || !subscriptionPlanVariationId) {
      // Debug logging to help identify the issue
      console.error('Catalog lookup failed:', {
        selectedPlanExplicit,
        speciesKey,
        billingKey,
        combination,
        plusExplicit,
        catalogEntry,
        comfortCareNode: selectedPlanExplicit === 'comfort-care' ? planCatalog?.['comfort-care'] : undefined,
      });
      setError('This membership combination is not yet configured for automated billing. Please contact support.');
      return;
    }

    const matchedTier =
      chosenPlan?.pricing?.find((tier) => (petDetails.kind ? tier.species === petDetails.kind : false)) ??
      chosenPlan?.pricing?.[0];

    const baseMonthlyPrice =
      selectedPlanExplicit === 'comfort-care'
        ? chosenPlan?.pricing?.[0]?.monthly ?? null
        : matchedTier?.monthly ?? null;
    const baseAnnualPrice =
      selectedPlanExplicit === 'comfort-care'
        ? null
        : matchedTier?.annual ?? null;

    const planPrice =
      billingKey === 'annual' && baseAnnualPrice != null ? baseAnnualPrice : baseMonthlyPrice;

    if (planPrice == null) {
      setError('Unable to determine pricing for this membership selection.');
      return;
    }

    const agreementSignedAt = new Date().toISOString();

    const addOnDetails: MembershipTransactionAddOn[] = addOns
      .map((slug) => {
        // Get price from API using catalog IDs
        let price: number | null = null;
        if (planCatalog && formattedPlans.length > 0) {
          const catalogEntry = lookupCatalogEntry(
            planCatalog,
            slug,
            null,
            billingKey,
            'base',
            false,
          );
          if (catalogEntry?.planId && catalogEntry?.planVariationId) {
            const apiPlan = formattedPlans.find((p) => p.planId === catalogEntry.planId);
            if (apiPlan) {
              const variation = apiPlan.variations?.find(
                (v) => v.variationId === catalogEntry.planVariationId,
              );
              if (variation) {
                if (variation.phases && variation.phases.length > 0) {
                  for (const phase of variation.phases) {
                    if (!phase) continue;
                    const phaseCadence = (phase.cadence || '').toLowerCase();
                    const amount = phase.pricing?.amount ?? variation.price?.amount;
                    if (amount && amount > 0) {
                      if ((billingKey === 'monthly' && phaseCadence === 'monthly') ||
                          (billingKey === 'annual' && phaseCadence === 'annual')) {
                        price = Math.round(amount / 100);
                        break;
                      }
                    }
                  }
                } else if (variation.price?.amount) {
                  price = Math.round(variation.price.amount / 100);
                }
              }
            }
          }
        }
        
        // Fallback to hardcoded pricing
        if (price == null) {
          const config = ADD_ON_PRICING[slug];
          if (!config) return null;
          price =
            billingKey === 'annual' &&
            config.annual != null &&
            selectedPlanExplicit !== 'comfort-care'
              ? config.annual
              : config.monthly;
        }

        const config = ADD_ON_PRICING[slug];
        return {
          id: slug,
          name: config?.label || slug,
          price: price ?? 0,
          pricingOption: billingKey,
        };
      })
      .filter(Boolean) as MembershipTransactionAddOn[];

    const rawClientId =
      (pet as any)?.clientId ??
      (pet as any)?.client?.id ??
      (pet as any)?.ownerId ??
      (pet as any)?.owner?.id ??
      authUserId ??
      null;
    const clientIdNumber = toNumber(rawClientId);
    const clientIdValue =
      clientIdNumber != null
        ? clientIdNumber
        : rawClientId != null
          ? String(rawClientId)
          : undefined;
    const patientId = toNumber(pet.dbId ?? (pet as any).patientId ?? pet.id);
    const practiceId = toNumber(
      (pet as any).practiceId ?? (pet as any).practice?.id ?? (pet as any).location?.practiceId,
    );

    const effectiveBillingPreference = hasAnnualOption ? billingPreference : 'monthly';

    const membershipTransaction: MembershipTransactionPayload = {
      agreementSignedAt,
      agreementText: MEMBERSHIP_AGREEMENT_TEXT,
      plansSelected: [
        {
          planId: subscriptionPlanId,
          planName: chosenPlan?.name ?? selectedPlanExplicit,
          pricingOption: billingKey,
          price: planPrice,
          quantity: 1,
          addOns: addOnDetails,
        },
      ],
      metadata: (() => {
        const meta: Record<string, any> = {
          petId: pet.id,
          agreementSignature: agreementSignature.trim(),
          billingPreference: billingKey,
          addOns,
        };
        if (clientIdValue != null) meta.clientId = clientIdValue;
        return meta;
      })(),
    };

    if (clientIdValue != null) membershipTransaction.clientId = clientIdValue;
    if (patientId != null) membershipTransaction.patientId = patientId;
    if (practiceId != null) membershipTransaction.practiceId = practiceId;

    const enrollmentPayload: Record<string, any> = {};
    if (chosenPlan?.apiPlanId) enrollmentPayload.planId = chosenPlan.apiPlanId;
    else if (chosenPlan) enrollmentPayload.planId = chosenPlan.id;
    if (addOns.length) enrollmentPayload.addOns = addOns;
    if (selectedPlanExplicit === 'comfort-care') enrollmentPayload.comfortCare = true;

    const note = `Membership for ${pet.name} - ${chosenPlan?.name ?? selectedPlanExplicit} (${effectiveBillingPreference})`;

    const metadata = (() => {
      const meta: Record<string, any> = {
        petId: pet.id,
        planName: chosenPlan?.name ?? selectedPlanExplicit,
        billingPreference: effectiveBillingPreference,
        addOns,
        agreementSignature: agreementSignature.trim(),
        agreementSignedAt,
      };
      if (clientIdValue != null) meta.clientId = clientIdValue;
      return meta;
    })();

    // Construct full plan name with add-ons and billing preference
    const basePlanName = chosenPlan?.name ?? selectedPlanExplicit;
    const addOnLabels = addOns
      .map((slug) => {
        if (slug === 'plus-addon') return 'Plus';
        if (slug === 'starter-addon') return 'Puppy / Kitten';
        return slug;
      })
      .filter(Boolean);
    const billingLabel = effectiveBillingPreference === 'annual' ? 'ANNUALLY' : 'MONTHLY';
    const fullPlanName = addOnLabels.length > 0
      ? `${basePlanName} ${addOnLabels.join(', ')} - ${billingLabel}`
      : `${basePlanName} - ${billingLabel}`;

    const paymentState = {
      petId: pet.id,
      petName: pet.name,
      selectedPlanId: selectedPlanExplicit,
      planName: fullPlanName,
      billingPreference: effectiveBillingPreference,
      amountCents,
      currency: 'USD' as const,
      costSummary,
      addOns,
      enrollmentPayload,
      note,
      agreementSignature,
      intent: PaymentIntent.SUBSCRIPTION,
      subscriptionPlanId,
      subscriptionPlanVariationId,
      metadata,
      membershipTransaction,
    };

    setError(null);
    navigate('/client-portal/membership-payment', { state: paymentState });
  }

  if (loading || planCatalogLoading || formattedPlansLoading) {
    return (
      <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="cp-muted">Loading membership information…</div>
        </div>
      </div>
    );
  }

  if (combinedError && !pet) {
    return (
      <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
        <div className="card" style={{ maxWidth: 600, margin: '30px auto' }}>
          <h2 style={{ marginTop: 0, color: '#e11d48' }}>Error</h2>
          <p className="muted">{combinedError}</p>
          <button className="btn" onClick={() => navigate('/client-portal')} style={{ marginTop: 16, background: '#4FB128', color: '#fff' }}>
            Back to Portal
          </button>
        </div>
      </div>
    );
  }

  if (!loading && pet && appointmentsLoaded && !hasAnyAppointments) {
    return (
      <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
        <button
          onClick={() => navigate('/client-portal')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#4FB128',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back to Portal
        </button>
        <div className="cp-card" style={{ padding: 24, borderLeft: '4px solid #4FB128', background: brandSoft }}>
          <h2 style={{ margin: '0 0 12px' }}>Schedule an Appointment First</h2>
          <p className="cp-muted" style={{ lineHeight: 1.6 }}>
            Since we haven't booked an appointment for {pet.name} yet, we advise contacting us first by calling
            {' '}
            <a href="tel:12075368387" style={{ color: '#4FB128', fontWeight: 600 }}>(207) 536-8387</a>, emailing
            {' '}<a href="mailto:info@vetatyourdoor.com" style={{ color: '#4FB128', fontWeight: 600 }}>info@vetatyourdoor.com</a>,
            {' '}or filling out our appointment request form online. Once your appointment is scheduled, you will be able to
            begin your membership with timing that coincides with your start date with us. We can’t wait to meet you!
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn secondary" onClick={() => navigate('/client-portal')}>
              Back to Portal
            </button>
            <a
              className="btn"
              href="https://form.jotform.com/221585880190157"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', background: '#4FB128', color: '#fff' }}
            >
              Request an Appointment
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
      <style>{`
        .cp-card { border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; background: #fff; }
        .cp-muted { color: rgba(0,0,0,0.62); }
        .cp-section { margin-top: 28px; }
        h1.cp-title { margin: 12px 0 4px; font-size: 28px; }
        h2.cp-h2 { margin: 0 0 10px; font-size: 20px; }
        .cp-plan-grid {
          width: 100%;
          overflow-x: auto;
        }
        @media (max-width: 640px) {
          .cp-plan-grid {
            grid-template-columns: 1fr !important;
          }
        }
        .cp-plan-card {
          border: 2px solid transparent;
          cursor: default;
          transition: transform 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 100%;
          position: relative;
          overflow: hidden;
          padding-bottom: 20px;
          width: 100%;
          box-sizing: border-box;
          max-width: 100%;
        }
        .cp-plan-card:hover {
          border-color: ${brand};
          box-shadow: 0 6px 16px rgba(15, 118, 110, 0.15);
        }
        .cp-plan-card.selected {
          border-color: ${brand};
          background: ${brandSoft};
          transform: translateY(-6px) scale(1.01);
          box-shadow: 0 14px 32px rgba(15, 118, 110, 0.22);
        }
        @media (max-width: 768px) {
          .cp-plan-card.selected {
            transform: translateY(-4px) scale(1.005);
          }
        }
        .cp-plan-card.selected::before,
        .cp-plan-card.selected::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          pointer-events: none;
          z-index: 0;
        }
        .cp-plan-card.selected::before {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 70%);
          transform: translate(-50%, -50%) scale(0.2);
          animation: cp-firework 0.85s ease-out forwards;
        }
        .cp-plan-card.selected::after {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: transparent;
          transform: translate(-50%, -50%) scale(0.2);
          animation: cp-spark 0.85s ease-out forwards;
        }
        .cp-card-upper {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cp-card-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex: 1;
        }
        .cp-card-head {
          text-align: center;
          border-radius: 14px;
          padding: 14px;
          background: linear-gradient(180deg, #1f2937 0%, #0f172a 100%);
          color: #fff;
          position: relative;
          z-index: 1;
          min-height: 96px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .cp-card-head h3 {
          margin: 0;
          font-size: 22px;
          letter-spacing: 0.3px;
        }
        .cp-card-head .cp-card-sub {
          margin-top: 6px;
          font-size: 14px;
          font-weight: 500;
          color: rgba(255,255,255,0.85);
        }
        .cp-card-price {
          background: #fff7ed;
          border-radius: 12px;
          border: 1px solid rgba(251, 191, 36, 0.4);
          padding: 16px;
          text-align: center;
          margin-top: 16px;
          position: relative;
          z-index: 1;
          min-height: 94px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 10px;
        }
        .cp-card-price-main {
          font-size: 28px;
          font-weight: 800;
          color: #111827;
        }
        .cp-card-price-main span {
          font-size: 18px;
          font-weight: 600;
        }
        .cp-card-price-note {
          margin-top: 4px;
          font-size: 13px;
          color: rgba(17,24,39,0.7);
        }
        .cp-card-includes {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
          flex: 1;
        }
        .cp-card-includes ul {
          margin: 0;
          padding-left: 0;
          list-style: none;
          font-size: 14px;
          line-height: 1.6;
        }
        .cp-billing-toggle {
          display: inline-flex;
          gap: 6px;
          padding: 6px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.05);
          margin: 8px 0 18px;
        }
        .cp-billing-toggle button {
          border: none;
          background: transparent;
          padding: 10px 18px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          color: rgba(17,24,39,0.7);
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
        }
        .cp-billing-toggle button:hover:not(:disabled) {
          background: rgba(15, 118, 110, 0.12);
          color: #0f172a;
        }
        .cp-billing-toggle button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .cp-billing-toggle button.active {
          background: #4FB128;
          color: #fff;
          box-shadow: 0 4px 12px rgba(79, 177, 40, 0.25);
        }
        .cp-cost-wrapper {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }
        .cp-cost-primary {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
        }
        .cp-cost-secondary {
          font-size: 12px;
          font-weight: 500;
          color: rgba(17,24,39,0.6);
        }
        .cp-recommended-badge {
          position: absolute;
          top: 12px;
          left: 18px;
          padding: 6px 16px;
          border-radius: 999px;
          background: #4FB128;
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          box-shadow: 0 4px 12px rgba(79, 177, 40, 0.25);
          pointer-events: none;
          z-index: 3;
        }
        .cp-added-badge {
          position: absolute;
          top: 18px;
          right: -44px;
          width: 170px;
          padding: 8px 0;
          transform: rotate(36deg);
          background: linear-gradient(135deg, #f87171 0%, #dc2626 90%);
          color: #fff;
          text-align: center;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.7px;
          box-shadow: 0 5px 14px rgba(220, 38, 38, 0.32);
          pointer-events: none;
          z-index: 4;
        }
        @keyframes cp-firework {
          0% {
            opacity: 0.95;
            transform: translate(-50%, -50%) scale(0.1);
            box-shadow:
              0 0 0 rgba(255, 255, 255, 0.9),
              0 0 0 rgba(252, 211, 77, 0.85),
              0 0 0 rgba(253, 186, 116, 0.8),
              0 0 0 rgba(248, 113, 113, 0.75),
              0 0 0 rgba(232, 121, 249, 0.7),
              0 0 0 rgba(156, 163, 255, 0.65);
          }
          60% {
            opacity: 0.7;
            transform: translate(-50%, -50%) scale(3.8);
            box-shadow:
              0 -36px 0 rgba(252, 211, 77, 0.7),
              36px 0 0 rgba(253, 186, 116, 0.6),
              0 36px 0 rgba(248, 113, 113, 0.5),
              -36px 0 0 rgba(232, 121, 249, 0.45),
              26px -26px 0 rgba(96, 165, 250, 0.4),
              -26px 26px 0 rgba(52, 211, 153, 0.35);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(5.8);
            box-shadow:
              0 -54px 0 rgba(252, 211, 77, 0),
              54px 0 0 rgba(253, 186, 116, 0),
              0 54px 0 rgba(248, 113, 113, 0),
              -54px 0 0 rgba(232, 121, 249, 0),
              38px -38px 0 rgba(96, 165, 250, 0),
              -38px 38px 0 rgba(52, 211, 153, 0);
          }
        }
        @keyframes cp-spark {
          0% {
            opacity: 0.9;
            transform: translate(-50%, -50%) scale(0.2);
            box-shadow:
              0 0 0 rgba(255, 255, 255, 0.95),
              0 0 0 rgba(59, 130, 246, 0.8),
              0 0 0 rgba(16, 185, 129, 0.75);
          }
          55% {
            opacity: 0.6;
            transform: translate(-50%, -50%) scale(4.2);
            box-shadow:
              0 -44px 0 rgba(59, 130, 246, 0.6),
              44px 0 0 rgba(16, 185, 129, 0.55),
              -44px 0 0 rgba(236, 72, 153, 0.5),
              30px 30px 0 rgba(250, 204, 21, 0.45);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(6);
            box-shadow:
              0 -60px 0 rgba(59, 130, 246, 0),
              60px 0 0 rgba(16, 185, 129, 0),
              -60px 0 0 rgba(236, 72, 153, 0),
              42px 42px 0 rgba(250, 204, 21, 0);
          }
        }
      `}</style>

      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate('/client-portal')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#4FB128',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back to Portal
        </button>
        <h1 className="cp-title">Membership Signup</h1>
        <p className="cp-muted">Choose the plan that fits your pet’s care needs.</p>
      </div>

      {pet && (
        <>
          {showPreVisitNote && (
            <div
              className="cp-card"
              style={{
                padding: 20,
                borderLeft: '4px solid #4FB128',
                background: brandSoft,
                marginBottom: 16,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 8 }}>Welcome!</strong>
              <p className="cp-muted" style={{ margin: 0, lineHeight: 1.6 }}>
                We're so excited to have you sign up. Our membership plans are one of the best ways to get proactive, personalized care from your One Team, and we're thrilled you're joining the community. Before your first visit, just a quick note: we aren't able to dispense medications, offer after-hours online chat support, or provide medical advice until we meet {pet.name} and establish a Veterinary Client Patient Relationship (VCPR). Once we've done that at your appointment, your One Team will be able to support you fully.
              </p>
            </div>
          )}

          <section className="cp-section">
            <h2 className="cp-h2">Pet Information</h2>
            <div className="cp-card" style={{ display: 'flex', gap: 20, padding: 20 }}>
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 12,
                  flexShrink: 0,
                  overflow: 'hidden',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundImage: `url(${petImg(pet)})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center',
                  backgroundSize: 'contain',
                }}
              >
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 20 }}>{pet.name}</h3>
                <div className="cp-muted" style={{ marginBottom: 4 }}>
                  <strong>Primary Provider:</strong> {pet.primaryProviderName || '—'}
                </div>
                {pet.species || pet.breed ? (
                  <div className="cp-muted" style={{ marginBottom: 4 }}>
                    <strong>Species/Breed:</strong> {[pet.species, pet.breed].filter(Boolean).join(' • ')}
                  </div>
                ) : null}
                {pet.dob && (
                  <div className="cp-muted" style={{ marginBottom: 4 }}>
                    <strong>Date of Birth:</strong> {fmtDate(pet.dob)}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      <section className="cp-section">
        <h2 className="cp-h2">Available Membership Plans</h2>

        {pet && (
          <div className="cp-card" style={{ padding: 20, marginBottom: 16 }}>
            <p className="cp-muted" style={{ margin: '0 0 12px' }}>
              Is {pet.name} in need of ongoing comfort care or support for a serious illness?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setComfortAnswer('no');
                  setSelectedPlanExplicit(null);
                  setSelectedPlanId(null);
                  setPlusExplicit(false);
                  setBillingPreference('monthly');
                }}
                style={{
                  background: comfortAnswer === 'no' ? '#4FB128' : '#4FB128',
                  color: '#fff',
                  opacity: comfortAnswer === 'no' ? 1 : 0.5,
                  border: 'none',
                }}
              >
                No
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setComfortAnswer('yes');
                  setSelectedPlanExplicit(null);
                  setSelectedPlanId('comfort-care');
                  setPlusExplicit(false);
                  setBillingPreference('monthly');
                }}
                style={{
                  background: comfortAnswer === 'yes' ? '#4FB128' : '#4FB128',
                  color: '#fff',
                  opacity: comfortAnswer === 'yes' ? 1 : 0.5,
                  border: 'none',
                }}
              >
                Yes, show Comfort Care
              </button>
            </div>
          </div>
        )}

        {shouldAskStarter && pet && comfortAnswer !== 'yes' && (
          <div className="cp-card" style={{ padding: 20, marginBottom: 16 }}>
            <p className="cp-muted" style={{ margin: '0 0 12px' }}>
              Has {pet.name} received more than one round of their core vaccines (like distemper)?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setStarterAnswer('yes');
                  setStarterExplicit(false);
                }}
                style={{
                  background: starterAnswer === 'yes' ? '#4FB128' : '#4FB128',
                  color: '#fff',
                  opacity: starterAnswer === 'yes' ? 1 : 0.5,
                  border: 'none',
                }}
              >
                Yes
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setStarterAnswer('no');
                  setStarterExplicit(false);
                }}
                style={{
                  background: starterAnswer === 'no' ? '#4FB128' : '#4FB128',
                  color: '#fff',
                  opacity: starterAnswer === 'no' ? 1 : 0.5,
                  border: 'none',
                }}
              >
                No
              </button>
            </div>
          </div>
        )}

        {comfortAnswer === 'no' && meetsGolden && recommendationCopy}

        {comfortAnswer === 'no' && !meetsGolden && pet && (
          <div
            className="cp-card"
            style={{
              padding: 20,
              borderLeft: '4px solid #4FB128',
              background: brandSoft,
              marginBottom: 16,
            }}
          >
            <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
              We recommend the Foundations Membership Plan for {pet.name}.
            </strong>
            <p className="cp-muted" style={{ margin: '0 0 8px' }}>
              It includes one annual visit and an abbreviated early detection lab panel, which is great for young, healthy pets who don't need intensive monitoring.
            </p>
            <p className="cp-muted" style={{ margin: 0 }}>
              If {pet.name} has any chronic conditions, needs more frequent check-ins, or would benefit from additional support, you can add PLUS to Foundations. Please note: Upgrading to Plus later isn't available, so choose it now if {pet.name} may need the extra support.
            </p>
          </div>
        )}

        {comfortAnswer === 'yes' && pet && (
          <div
            className="cp-card"
            style={{
              padding: 20,
              borderLeft: '4px solid #4FB128',
              background: brandSoft,
              marginBottom: 16,
            }}
          >
            <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
              We recommend the Comfort Care Plan for {pet.name}.
            </strong>
            <p className="cp-muted" style={{ margin: '0 0 8px' }}>
              It's a month-to-month hospice plan designed to support pets in their final stage of life with one in-person visit per month and compassionate, ongoing guidance.
            </p>
            <p className="cp-muted" style={{ margin: 0 }}>
              You can also add PLUS if you'd like additional support or anticipate needing more frequent touch-points. Please note: PLUS can't be added later, so choose it at sign-up if you think {pet.name} may benefit.
            </p>
          </div>
        )}

        {combinedError && (
          <div
            style={{
              padding: '12px 16px',
              border: '1px solid #e11d48',
              borderRadius: 8,
              color: '#e11d48',
              background: '#fee',
              marginBottom: 16,
            }}
          >
            {combinedError}
          </div>
        )}

        {toast && (
          <div
            style={{
              position: 'fixed',
              top: '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '16px 24px',
              border: '1px solid #4FB128',
              borderRadius: 8,
              color: '#fff',
              background: '#4FB128',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1000,
              fontSize: '14px',
              fontWeight: 600,
              maxWidth: '90%',
              textAlign: 'center',
            }}
          >
            {toast}
          </div>
        )}

        {(() => {
          // Show membership options only if:
          // - comfortAnswer is answered, AND
          // - if shouldAskStarter is true, then starterAnswer must also be answered
          //   (unless comfortAnswer is 'yes', in which case the starter question is hidden)
          const canShowPlans = comfortAnswer != null && (comfortAnswer === 'yes' || !shouldAskStarter || starterAnswer != null);
          
          if (!canShowPlans) {
            return (
              <div className="cp-card" style={{ padding: 20, textAlign: 'center' }}>
                <p className="cp-muted">
                  {shouldAskStarter && starterAnswer == null
                    ? 'Please answer both questions above to see recommended membership options.'
                    : 'Answer the comfort care question above to see recommended membership options.'}
                </p>
              </div>
            );
          }
          
          return (
            <div
              className="cp-plan-grid"
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
            {(() => {
              const filteredPlans = plans
                .filter((plan) => {
                  if (plan.id === 'comfort-care') return comfortAnswer === 'yes';
                  if (plan.id === 'golden') return comfortAnswer === 'no' && meetsGolden;
                  if (plan.id === 'foundations') return comfortAnswer === 'no';
                  return false;
                })
                .sort((a, b) => {
                  if (comfortAnswer === 'no' && meetsGolden) {
                    if (a.id === 'foundations') return -1;
                    if (b.id === 'foundations') return 1;
                    if (a.id === 'golden') return 1;
                    if (b.id === 'golden') return -1;
                  }
                  return 0;
                });

              const shouldShowStarterAddon = starterAnswer === 'no' && comfortAnswer !== 'yes';
              
              return filteredPlans.flatMap((plan, index) => {
                const planElements = [];
                const isRecommended = 
                  (comfortAnswer === 'no' && (
                    plan.id === recommendedPlanId || 
                    (!meetsGolden && plan.id === 'foundations')
                  )) ||
                  (comfortAnswer === 'yes' && plan.id === 'comfort-care');
                const tiers = (() => {
                  if (!petDetails.kind) return plan.pricing;
                  const filtered = plan.pricing.filter((tier) => !tier.species || tier.species === petDetails.kind);
                  return filtered.length > 0 ? filtered : plan.pricing;
                })();
                const isSelected = selectedPlanExplicit === plan.id;
                
                // Add the plan element
                planElements.push(
                  <article
                    key={plan.id}
                    className={`cp-card cp-plan-card ${isSelected ? 'selected' : ''}`}
                    style={{ padding: 24, position: 'relative' }}
                  >
                    {isSelected && <span className="cp-added-badge">Added to Cart</span>}
                    {isRecommended && <span className="cp-recommended-badge">Recommended</span>}

                    <div className="cp-card-upper">
                      <div className="cp-card-head">
                        <h3>{plan.name}</h3>
                        <div className="cp-card-sub">{plan.tagLine}</div>
                      </div>

                      {tiers.length > 0 && (
                        <div className="cp-card-price">
                          {tiers.map((tier, idx) => (
                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div className="cp-card-price-main">
                                ${tier.monthly}
                                <span>/month</span>
                              </div>
                              {tier.annual ? (
                                <div className="cp-card-price-note">
                                  or ${tier.annual} annually (10% discount!) {tier.suffix ? `(${tier.suffix})` : ''}
                                </div>
                              ) : tier.suffix ? (
                                <div className="cp-card-price-note">{tier.suffix}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="cp-card-body">
                      {plan.id === 'foundations' && meetsGolden && (
                        <div
                          className="cp-muted"
                          style={{ fontSize: 13, borderTop: '1px solid rgba(15,118,110,0.12)', paddingTop: 12 }}
                        >
                          Foundations is still available if you'd prefer a lighter option—one visit with an abbreviated lab
                          panel.
                        </div>
                      )}

                      <div className="cp-card-includes">
                        <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Includes:</strong>
                        <ul>
                          {plan.includes.map((item, idx) => (
                            <li key={idx} style={{ marginBottom: 4 }}>
                              <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                                ⭐
                              </span>
                              <span className="cp-muted">{formatIncludesText(item)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          setSelectedPlanExplicit((prev) => {
                            const next = prev === plan.id ? null : plan.id;
                            setSelectedPlanId(next);
                            if (!next) {
                              setPlusExplicit(false);
                              setStarterExplicit(false);
                            }
                            if (next !== prev) {
                              setAgreementAccepted(false);
                              setAgreementSignature('');
                            }
                            return next;
                          });
                        }}
                        style={{ alignSelf: 'flex-end', marginTop: 'auto', background: '#4FB128', color: '#fff' }}
                      >
                        {isSelected ? 'Remove from Cart' : 'Add to Cart'}
                      </button>
                    </div>
                  </article>
                );

                // Insert puppy/kitten add-on after the first plan
                if (index === 0 && shouldShowStarterAddon) {
                  planElements.push(
                    <article
                      key="starter-addon"
                      className={`cp-card cp-plan-card ${starterExplicit ? 'selected' : ''}`}
                      style={{ padding: 24, position: 'relative' }}
                    >
                      {starterExplicit && <span className="cp-added-badge">Added to Cart</span>}
                      <span className="cp-recommended-badge">Recommended</span>
                      <div className="cp-card-upper">
                        <div className="cp-card-head">
                          <h3>Puppy / Kitten Add-on</h3>
                          <div className="cp-card-sub">Annual Membership Plan</div>
                        </div>
                        <div className="cp-card-price">
                          <div className="cp-card-price-main">
                            $29<span>/month</span>
                          </div>
                          <div className="cp-card-price-note">or {formatMoney(309)} annually (10% discount!)</div>
                        </div>
                      </div>
                      <div className="cp-card-body">
                        <div className="cp-card-includes">
                          <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Includes:</strong>
                          <ul>
                            {MEMBERSHIP_PLANS.find(p => p.id === 'starter-addon')?.includes.map((item, idx) => (
                              <li key={idx} className="cp-muted" style={{ marginBottom: 4 }}>
                                <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                                  ⭐
                                </span>
                                {formatIncludesText(item)}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            if (!selectedPlanExplicit) {
                              setToast(`Please select ${primaryPlanName} first`);
                              return;
                            }
                            setStarterExplicit((prev) => !prev);
                          }}
                          style={{ alignSelf: 'flex-end', marginTop: 'auto', background: '#4FB128', color: '#fff' }}
                        >
                          {starterExplicit ? 'Remove from Cart' : 'Add to Cart'}
                        </button>
                      </div>
                    </article>
                  );
                }

                return planElements;
              });
            })()}

            {comfortAnswer && (
              <article
                className={`cp-card cp-plan-card ${plusExplicit ? 'selected' : ''}`}
                style={{ padding: 24, position: 'relative' }}
              >
                {plusExplicit && <span className="cp-added-badge">Added to Cart</span>}
                <div className="cp-card-upper">
                  <div className="cp-card-head">
                    <h3>PLUS Add-on</h3>
                    <div className="cp-card-sub">Annual Membership Plan (unless part of Comfort Care)</div>
                  </div>
                  <div className="cp-card-price">
                    <div className="cp-card-price-main">
                      $49<span>/month</span>
                    </div>
                    {comfortAnswer !== 'yes' && (
                      <div className="cp-card-price-note">or $529 annually (10% discount!)</div>
                    )}
                  </div>
                </div>
                <div className="cp-card-body">
                  <div className="cp-card-includes">
                    <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Includes:</strong>
                    <ul>
                      {MEMBERSHIP_PLANS.find(p => p.id === 'plus-addon')?.includes.map((item, idx) => (
                        <li key={idx} className="cp-muted" style={{ marginBottom: 4 }}>
                          <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                            ⭐
                          </span>
                          {formatIncludesText(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      if (!selectedPlanExplicit) {
                        setToast(`Please select ${primaryPlanName} first`);
                        return;
                      }
                      setPlusExplicit((prev) => !prev);
                    }}
                    style={{ alignSelf: 'flex-end', marginTop: 'auto', background: '#4FB128', color: '#fff' }}
                  >
                    {plusExplicit ? 'Remove from Cart' : 'Add to Cart'}
                  </button>
                </div>
              </article>
            )}
            </div>
          );
        })()}
      </section>

      {selectedPlanExplicit && costSummary && costSummary.items.length > 0 && (
        <section className="cp-section" style={{ marginTop: 16 }}>
          <div className="cp-card" style={{ padding: 20 }}>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Cost Summary</h3>

            <div className="cp-billing-toggle">
              <button
                type="button"
                className={billingPreference === 'monthly' ? 'active' : ''}
                onClick={() => setBillingPreference('monthly')}
              >
                Pay Monthly
              </button>
              <button
                type="button"
                className={billingPreference === 'annual' ? 'active' : ''}
                onClick={() => {
                  if (annualAvailable) setBillingPreference('annual');
                }}
                disabled={!annualAvailable}
              >
                Pay Annually
              </button>
            </div>

            <p className="cp-muted" style={{ margin: '-6px 0 14px', fontSize: 13 }}>
              {annualAvailable
                ? 'Pay annually to unlock a 10% discount on every membership item.'
                : 'Comfort Care is billed month-to-month for ongoing support.'}
            </p>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {costSummary.items.map((row) => (
                <li
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid rgba(0,0,0,0.08)',
                    paddingBottom: 6,
                  }}
                >
                  <span>{row.label}</span>
                  {(() => {
                    const annualText =
                      row.annual != null ? `${formatMoney(row.annual)} annually (10% discount!)` : null;
                    const monthlyText = row.monthly != null ? `${formatMoney(row.monthly)}/month` : null;
                    const preferAnnual = billingPreference === 'annual' && annualText !== null;
                    const primary = preferAnnual ? annualText! : monthlyText ?? annualText ?? '$0';
                    const secondary = preferAnnual ? monthlyText : annualText;
                    return (
                      <span className="cp-cost-wrapper">
                        <span className="cp-cost-primary">{primary}</span>
                        {secondary ? <span className="cp-cost-secondary">or {secondary}</span> : null}
                      </span>
                    );
                  })()}
                </li>
              ))}
            </ul>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 16,
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              <span>Total</span>
              {(() => {
                const annualText =
                  costSummary.totalAnnual != null
                    ? `${formatMoney(costSummary.totalAnnual)} annually (10% discount!)`
                    : null;
                const monthlyText = `${formatMoney(costSummary.totalMonthly)}/month`;
                const preferAnnual = billingPreference === 'annual' && annualText !== null;
                const primary = preferAnnual ? annualText! : monthlyText;
                const secondary = preferAnnual ? monthlyText : annualText;
                return (
                  <span className="cp-cost-wrapper">
                    <span className="cp-cost-primary">{primary}</span>
                    {secondary ? <span className="cp-cost-secondary">or {secondary}</span> : null}
                  </span>
                );
              })()}
            </div>
          </div>
        </section>
      )}

      {selectedPlanExplicit && (
        <AgreementSection
          agreementAccepted={agreementAccepted}
          setAgreementAccepted={setAgreementAccepted}
          agreementSignature={agreementSignature}
          setAgreementSignature={setAgreementSignature}
          brand={brand}
        />
      )}

      <section className="cp-section" style={{ marginTop: 32, marginBottom: 48 }}>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button className="btn secondary" onClick={() => navigate('/client-portal')} style={{ background: '#4FB128', color: '#fff', border: 'none' }}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={handleProceedToPayment}
            disabled={
              !selectedPlanExplicit ||
              !agreementAccepted ||
              !agreementSignature.trim() ||
              planCatalogLoading ||
              !planCatalog
            }
            style={{
              minWidth: 200,
              background: '#4FB128',
              color: '#fff',
              opacity:
                !selectedPlanExplicit ||
                !agreementAccepted ||
                !agreementSignature.trim() ||
                planCatalogLoading ||
                formattedPlansLoading ||
                !planCatalog ||
                formattedPlans.length === 0
                  ? 0.5
                  : 1,
              cursor:
                !selectedPlanExplicit ||
                !agreementAccepted ||
                !agreementSignature.trim() ||
                planCatalogLoading ||
                formattedPlansLoading ||
                !planCatalog ||
                formattedPlans.length === 0
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            Continue to Payment
          </button>
        </div>
        <div style={{ textAlign: 'right', marginTop: 8, fontSize: 14 }}>
          {!selectedPlanExplicit && (
            <p className="cp-muted" style={{ marginBottom: 4 }}>
              Please select a plan above
            </p>
          )}
          {(planCatalogLoading || formattedPlansLoading) && (
            <p className="cp-muted" style={{ color: '#b91c1c' }}>
              Loading membership plans…
            </p>
          )}
          {!planCatalogLoading && !formattedPlansLoading && (!planCatalog || formattedPlans.length === 0) && (
            <p className="cp-muted" style={{ color: '#b91c1c' }}>
              Membership plans unavailable. Please try again later.
            </p>
          )}
          {selectedPlanExplicit && (!agreementAccepted || !agreementSignature.trim()) && (
            <p className="cp-muted" style={{ color: '#b91c1c' }}>
              Please review the membership agreement, check the box, and sign to continue.
            </p>
          )}
        </div>
      </section>

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
    </div>
  );
}

function AgreementSection({
  agreementAccepted,
  setAgreementAccepted,
  agreementSignature,
  setAgreementSignature,
  brand: _brand,
}: {
  agreementAccepted: boolean;
  setAgreementAccepted: (val: boolean) => void;
  agreementSignature: string;
  setAgreementSignature: (val: string) => void;
  brand: string;
}) {
  return (
    <section className="cp-section" style={{ marginTop: 16 }}>
      <div className="cp-card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Membership Agreement</h3>
        <div
          style={{
            maxHeight: 240,
            overflowY: 'auto',
            padding: '12px 16px',
            border: '1px solid rgba(15,118,110,0.15)',
            borderRadius: 10,
            background: '#f8fafc',
            lineHeight: 1.55,
            fontSize: 14,
          }}
        >
          <p><strong>By enrolling your pet in a Vet At Your Door Membership Plan, you agree to the following terms and conditions.</strong></p>
          <p><strong>Membership Plans</strong></p>
          <p><strong>Foundations:</strong> Includes one annual wellness exam and trip fee, recommended annual vaccines based on age and lifestyle, annual lab work, and after-hours tele-chat. Requires a 12-month commitment.</p>
          <p><strong>Golden:</strong> Includes two wellness exams with trip fees, recommended annual vaccines based on age and lifestyle, annual lab work, and after-hours tele-chat. Requires a 12-month commitment.</p>
          <p><strong>Comfort Care:</strong> A month-to-month plan that includes one visit with trip fee, one tele-chat consult during business hours per month, after-hours tele-chat, and a one hundred dollar credit toward euthanasia.</p>
          <p><strong>Plus Add-On:</strong> Provides ten percent off all services and medications and fifty percent off exams. There is one free nail trim per year. The term matches the main plan. A store discount code is issued after sign-up.</p>
          <p><strong>Puppy / Kitten Add-On:</strong> Covers booster vaccine appointments during your pet's first year, including the required doctor and technician visits with trip fees that are specifically tied to administering recommended booster vaccines.</p>
          <p><strong>After-Hours Telehealth</strong></p>
          <p>Members may access our virtual triage chat after hours during these times: Monday through Friday from 5 pm to 9 pm, and Saturday through Sunday from 8 am to 5 pm. A Triage Technician will review your pet's history and may consult a veterinarian if needed. No house-call visits are made after hours. If urgent care is recommended, we will direct you to an appropriate emergency facility. Service is unavailable on listed holidays. Hours may change with 30 days of notice.</p>
          <p><strong>VCPR Requirements and Limitations for New or Lapsed Patients</strong></p>
          <p>A valid Veterinarian-Client-Patient Relationship requires an in-person exam within the past 365 days. If more than 12 months have passed since your pet's most recent in-person exam with us, the VCPR is considered expired.</p>
          <p>For pets we have not yet seen, or for pets whose VCPR has lapsed, the following services cannot be provided until a current VCPR is re-established through an in-person exam:</p>
          <ul style={{ paddingLeft: 20 }}>
            <li>After-hours telehealth</li>
            <li>Medical advice, triage guidance, or care recommendations from your One Team</li>
            <li>Prescription medications or refills of any kind</li>
          </ul>
          <p>Once the initial or renewal exam is completed, all membership benefits become fully active.</p>
          <p>Memberships do not automatically cancel when the VCPR expires. It is the client's responsibility to have their pet remain current.</p>
          <p><strong>Membership Rules</strong></p>
          <p>Benefits apply only to the enrolled pet and cannot be shared or transferred, including to another pet in the same household. Misuse may result in cancellation and repayment of discounts.</p>
          <p>Memberships bill monthly or annually, renew automatically, and may transition from Foundations to Golden when your pet reaches eight years of age for dogs or nine years of age for cats. We will email you twenty to thirty days before renewal with a recommendation. You may change your selection or cancel at that time.</p>
          <p>Foundations, Golden, Plus, and Puppy / Kitten plans require a twelve-month term. Comfort Care is month-to-month, as is Plus when selected with Comfort Care.</p>
          <p>If your pet passes away, moves, or transitions to Comfort Care, the value of used services will be deducted from the payments you have made. If the value of services used exceeds payments made, the remaining balance will be due before the plan is closed. No partial refunds are issued. Re-enrollment requires a new registration fee if charged.</p>
          <p>If the client moves, any refund will be issued only after we receive both a record request from a veterinary hospital outside our service area and a copy of the client's new lease or mortgage agreement.</p>
          <p>A one-time registration fee, if charged, supports our Angel Fund for pets in need.</p>
          <p><strong>Scheduling and Availability</strong></p>
          <p>Visits should be scheduled in advance for best availability. Specific appointment times cannot be guaranteed. Services are available only within our service area and during our regular appointment hours.</p>
          <p>We will make every reasonable effort for your pet's care to be provided by your dedicated One Team, especially for wellness visits and planned follow-up care. In situations where schedule constraints, urgent needs, staffing limitations, or routing requirements prevent your One Team from being available, another Vet At Your Door team may provide care to ensure your pet is seen in a timely manner.</p>
          <p>If we cannot accommodate an urgent case, we may refer you to another facility or veterinary team.</p>
          <p><strong>Access and Technology Requirements</strong></p>
          <p>Internet access and a compatible device are required for virtual chat and use of our online store. Instructions will be provided in the Welcome Email.</p>
          <p><strong>Client Conduct</strong></p>
          <p>We strive to provide compassionate and high-quality care and expect respectful communication in return. Disrespectful behavior may result in termination of membership without refund.</p>
          <p>Membership supports proactive and routine care. Membership does not guarantee emergency availability.</p>
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16 }}>
          <input
            type="checkbox"
            checked={agreementAccepted}
            onChange={(e) => setAgreementAccepted(e.target.checked)}
            style={{ marginTop: 4 }}
          />
          <span style={{ fontSize: 14 }}>
            I have read and agree to the Vet At Your Door Membership Plan terms and conditions. I understand that upon early termination of the agreement that I am responsible for services due if it is more than the monthly payments made.
          </span>
        </label>

        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Typed Signature</label>
          <input
            type="text"
            value={agreementSignature}
            onChange={(e) => setAgreementSignature(e.target.value)}
            placeholder="Type your full name"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${agreementSignature.trim() ? 'rgba(15,118,110,0.4)' : 'rgba(220,38,38,0.4)'}`,
              fontSize: 14,
            }}
          />
          <p className="cp-muted" style={{ fontSize: 12, marginTop: 6 }}>
            This acts as your electronic signature. Please type your legal name.
          </p>
        </div>
      </div>
    </section>
  );
}

