// src/pages/MembershipSignup.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  fetchClientPets,
  type Pet,
  fetchClientAppointments,
} from '../api/clientPortal';
import { PaymentIntent } from '../api/payments';

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
      { species: 'dog', monthly: 79, annual: 849 },
      { species: 'cat', monthly: 69, annual: 749 },
    ],
    includes: [
      'One Comprehensive Exam & Trip Fee',
      'One Office-Hours Tele-health Consult',
      'Annual Core Vaccinations',
      'Annual "Basic" Lab Panel (CBC, Chemistry)',
      'Annual Fecal Test',
      'After-hours Tele-chat Support',
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
      'Two Comprehensive Exams & Trip Fees',
      'Two Office-Hours Tele-health Consults',
      'Annual Core Vaccinations',
      'Annual "Advanced" Lab Panel (CBC, Chemistry, Thyroid, Urinalysis)',
      'Annual Fecal Test',
      'FeLV/FIV/Heartworm test (Cats)',
      'Pancreatitis Screening (Cats)',
      '"4dx" Heartworm/Tick test (Dogs)',
      'After-hours Tele-chat Support',
    ],
  },
  {
    id: 'comfort-care',
    name: 'Comfort Care',
    tagLine: 'Month-to-Month',
    pricing: [{ monthly: 349 }],
    includes: [
      'One Comprehensive Exam & Trip Fee per month',
      'One office-hours tele-health consult',
      'After-hours Tele-chat Support',
      '$100 Credit towards euthanasia',
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
      'Guaranteed two-hour response time during business hours from your Dedicated One Team',
      '50% off all Additional Exams',
      '10% off Everything We Offer (e.g. Lab Work, Services, Medications)',
    ],
    billingNote:
      '* Examples include chronic kidney disease, hyperthyroidism, allergic skin disease, arthritis, cancer.',
  },
  {
    id: 'starter-addon',
    name: 'Starter Wellness Add-On',
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

function encodeSvgData(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DOG_PLACEHOLDER = encodeSvgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#ffffff" />
  <g fill="none" stroke="#0f172a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 44V26c0-10 8-18 18-18h18c22 0 38 16 38 38v20" />
    <path d="M30 40L16 30" />
    <path d="M100 42l16-14" />
    <path d="M40 70h52c16 0 28 12 28 26s-12 26-28 26H48c-18 0-30-10-30-24s12-28 30-28z" />
    <path d="M46 44c0 10 8 18 18 18s18-8 18-18" />
  </g>
</svg>`);

const CAT_PLACEHOLDER = encodeSvgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#ffffff" />
  <g fill="none" stroke="#0f172a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 32V14l18 12 18-12v18" />
    <path d="M34 62c0-18 12-34 30-34s30 16 30 34" />
    <path d="M94 62c0 32-18 50-30 50S34 94 34 62" />
    <path d="M34 104c-8 6-12 14-12 22" />
    <path d="M94 82c12 4 20 14 18 26" />
    <path d="M54 58h4" />
    <path d="M78 58h4" />
    <path d="M56 72c6 4 12 4 16 0" />
  </g>
</svg>`);

function petImg(pet: Pet | null): string {
  if (!pet) return DOG_PLACEHOLDER;
  const species = (pet.species ?? pet.breed ?? '').toLowerCase();
  if (species.includes('dog') || species.includes('canine')) return DOG_PLACEHOLDER;
  if (species.includes('cat') || species.includes('feline')) return CAT_PLACEHOLDER;
  if ('photoUrl' in pet && (pet as any).photoUrl) return (pet as any).photoUrl as string;
  return CAT_PLACEHOLDER;
}

type PlanCombination = 'base' | 'plus' | 'starter' | 'plusStarter';
type BillingCadence = 'monthly' | 'annual';

const SQUARE_SUBSCRIPTION_PLAN_IDS: Record<
  string,
  any
> = {
  foundations: {
    cat: {
      monthly: {
        base: 'ZTZRCAHSSLO3BIYJWIPP2AD3',
        plus: 'IY7OIPSM25VK6YQNR3DLVPLR',
        starter: 'GNNHHFBFEGQCTOLOEJPZQWCF',
        plusStarter: 'LIPFFGRYE5YEUIKICTBRPJTY',
      },
      annual: {
        base: 'AVIQJIB6WYAAZY7DC264HI64',
        plus: 'KCAWAG2JG7IYEXV7M6CCNLZT',
        starter: 'JUUIIJH4NR7DXMBUUXQ3J5UU',
        plusStarter: '6FYYF6C7IQ3QU6Y6PWEE4BRD',
      },
    },
    dog: {
      monthly: {
        base: '5I54A473HZT7CUGZ6IEHO7OA',
        plus: 'FES67HTK6SRQBNIQ5GUYRNE6',
        starter: 'O4P22UD2DA5GXYLF27J73BGS',
        plusStarter: 'N63NY2IXZHNG4U4JAHSLLNYZ',
      },
      annual: {
        base: 'FRGJHQQPGDW5H7WHBI6VFRTF',
        plus: 'DT4QBXAQV2YJODKRNHUW34O3',
        starter: '4SV2DLCVFMS7UYWKJI5IFCEU',
        plusStarter: 'BZEFGHT366NGDNTDCKMB44DO',
      },
    },
  },
  golden: {
    cat: {
      monthly: {
        base: '44LEPDCQSGQM2ZOE4YQIJ2ZW',
        plus: 'BGZF6NNIGDAWWJGIZZRZRSGM',
        starter: 'LZLYJLD5QFRNJHZXRXDJW5XR',
        plusStarter: 'XFX6JOPHKV44POIISSMEUPPR',
      },
      annual: {
        base: 'FKLUTV45LTFZ3MLW5OWUFRNP',
        plus: '2J267W6GZGSJ7KUPJGTJEMKJ',
        starter: 'X7NEDWOA5WMUR7OX2GJHS7PR',
        plusStarter: 'CGDSN7XIM5CAUUZKILLFY2Z6',
      },
    },
    dog: {
      monthly: {
        base: 'RXZFOC3QLTUVGQAFWE3YJZEK',
        plus: 'IYMGNS73D5EH6M2FDX5FDXZD',
        starter: 'XVUSVIW2KEMPSSBAHJDOL3D7',
        plusStarter: 'AUAFEG2QNQDT6VVLTD7Z2JHB',
      },
      annual: {
        base: 'FNUCYA75WYS32UA5XOOWDXQY',
        plus: 'EJATWGRASOTLDZ3NHDRPG3PV',
        starter: 'VFY4ATUXNNIS6C5FEHE53FAN',
        plusStarter: '2QERSUEGX7OWW34UKVCWRTVB',
      },
    },
  },
  'comfort-care': {
    monthly: {
      base: 'K2BNHCOEPC3LZRXV52CTGHZP',
      plus: 'LJO3SITA4J3HRJIXLVNYWDET',
    },
  },
};

export default function MembershipSignup() {
  const navigate = useNavigate();
  const location = useLocation();

  const petId = (location.state as any)?.petId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const brand = 'var(--brand, #0f766e)';
  const brandSoft = 'var(--brand-soft, #e6f7f5)';

  const plans = useMemo(() => MEMBERSHIP_PLANS, []);

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

  const recommendedPlanId = meetsGolden ? 'golden' : null;
  const isNewPatient = !hasPastAppointment;
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
          borderLeft: `4px solid ${brand}`,
          background: brandSoft,
          marginBottom: 16,
        }}
      >
        <strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>
          We recommend the Golden Membership Plan for {name}.
        </strong>
        <p className="cp-muted" style={{ margin: '0 0 8px' }}>
          It’s built for senior pets and includes two visits plus advanced labs to catch issues early.
        </p>
        <p className="cp-muted" style={{ margin: 0 }}>
          If you’d prefer a lighter option, Foundations offers one visit with an abbreviated lab panel.
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
      items.push({ label: 'Starter Wellness Add-On', monthly: 29, annual: selectedPlanExplicit === 'comfort-care' ? null : 309 });
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

    const speciesKey =
      selectedPlanExplicit === 'comfort-care' ? null : petDetails.kind === 'dog' ? 'dog' : petDetails.kind === 'cat' ? 'cat' : null;

    const hasAnnualOption =
      selectedPlanExplicit === 'comfort-care'
        ? false
        : !!SQUARE_SUBSCRIPTION_PLAN_IDS[selectedPlanExplicit]?.[speciesKey ?? '']?.annual;
    const billingKey: BillingCadence = billingPreference === 'annual' && hasAnnualOption ? 'annual' : 'monthly';

    const combination: PlanCombination = plusExplicit && includeStarter ? 'plusStarter' : plusExplicit ? 'plus' : includeStarter ? 'starter' : 'base';

    let subscriptionPlanId: string | undefined;
    if (selectedPlanExplicit === 'comfort-care') {
      subscriptionPlanId = SQUARE_SUBSCRIPTION_PLAN_IDS['comfort-care']?.[billingKey]?.[
        plusExplicit ? 'plus' : 'base'
      ];
    } else if (speciesKey) {
      subscriptionPlanId = SQUARE_SUBSCRIPTION_PLAN_IDS[selectedPlanExplicit]?.[speciesKey]?.[billingKey]?.[
        combination
      ];
    }

    if (!subscriptionPlanId) {
      setError('This membership combination is not yet configured for automated billing. Please contact support.');
      return;
    }

    const enrollmentPayload: Record<string, any> = {};
    if (chosenPlan?.apiPlanId) enrollmentPayload.planId = chosenPlan.apiPlanId;
    else if (chosenPlan) enrollmentPayload.planId = chosenPlan.id;
    if (addOns.length) enrollmentPayload.addOns = addOns;
    if (selectedPlanExplicit === 'comfort-care') enrollmentPayload.comfortCare = true;

    const note = `Membership for ${pet.name} - ${chosenPlan?.name ?? selectedPlanExplicit} (${billingPreference})`;

    const paymentState = {
      petId: pet.id,
      petName: pet.name,
      selectedPlanId: selectedPlanExplicit,
      planName: chosenPlan?.name ?? selectedPlanExplicit,
      billingPreference: hasAnnualOption ? billingPreference : 'monthly',
      amountCents,
      currency: 'USD' as const,
      costSummary,
      addOns,
      enrollmentPayload,
      note,
      agreementSignature,
      intent: PaymentIntent.SUBSCRIPTION,
      subscriptionPlanId,
      metadata: {
        petId: pet.id,
        planName: chosenPlan?.name ?? selectedPlanExplicit,
        billingPreference: hasAnnualOption ? billingPreference : 'monthly',
        addOns,
        agreementSignature,
      },
    } as const;

    setError(null);
    navigate('/client-portal/membership-payment', { state: paymentState });
  }

  if (loading) {
    return (
      <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="cp-muted">Loading membership information…</div>
        </div>
      </div>
    );
  }

  if (error && !pet) {
    return (
      <div className="cp-wrap" style={{ maxWidth: 1120, margin: '32px auto', padding: '0 16px' }}>
        <div className="card" style={{ maxWidth: 600, margin: '30px auto' }}>
          <h2 style={{ marginTop: 0, color: '#e11d48' }}>Error</h2>
          <p className="muted">{error}</p>
          <button className="btn" onClick={() => navigate('/client-portal')} style={{ marginTop: 16 }}>
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
            color: brand,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back to Portal
        </button>
        <div className="cp-card" style={{ padding: 24, borderLeft: `4px solid ${brand}`, background: brandSoft }}>
          <h2 style={{ margin: '0 0 12px' }}>Schedule an Appointment First</h2>
          <p className="cp-muted" style={{ lineHeight: 1.6 }}>
            Since we haven't booked an appointment for {pet.name} yet, we advise contacting us first by calling
            {' '}
            <a href="tel:12075368387" style={{ color: brand, fontWeight: 600 }}>(207) 536-8387</a>, emailing
            {' '}<a href="mailto:info@vetatyourdoor.com" style={{ color: brand, fontWeight: 600 }}>info@vetatyourdoor.com</a>,
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
              style={{ textDecoration: 'none' }}
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
          padding-left: 20px;
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
          background: ${brand};
          color: #fff;
          box-shadow: 0 4px 12px rgba(15, 118, 110, 0.25);
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
          background: ${brand};
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          box-shadow: 0 4px 12px rgba(15, 118, 110, 0.25);
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
            color: brand,
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
                borderLeft: `4px solid ${brand}`,
                background: brandSoft,
                marginBottom: 16,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 8 }}>Welcome!</strong>
              <p className="cp-muted" style={{ margin: 0, lineHeight: 1.6 }}>
                We’re excited to have you sign up! Before your first visit, we just want to share an important note: we
                aren’t able to dispense medications, offer after-hours telehealth, or provide medical advice until we meet
                {` ${pet.name}`} and establish a VCPR. Once we’ve done that at your appointment, your One Team will be able to
                support you fully.
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
                }}
              >
                <img
                  src={petImg(pet)}
                  alt={pet.name}
                  style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 20 }}>{pet.name}</h3>
                <div className="cp-muted" style={{ marginBottom: 4 }}>
                  <strong>ID:</strong> {pet.id}
                </div>
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
                style={{ opacity: comfortAnswer === 'no' ? 1 : 0.6 }}
              >
                No
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setComfortAnswer('yes');
                  setSelectedPlanExplicit(null);
                  setSelectedPlanId('comfort-care');
                  setPlusExplicit(false);
                  setBillingPreference('monthly');
                }}
                style={{ background: comfortAnswer === 'yes' ? brand : undefined, opacity: comfortAnswer === 'yes' ? 1 : 0.85 }}
              >
                Yes, show Comfort Care
              </button>
            </div>
          </div>
        )}

        {shouldAskStarter && pet && (
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
                style={{ opacity: starterAnswer === 'yes' ? 1 : 0.6 }}
              >
                Yes
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setStarterAnswer('no');
                  setStarterExplicit(false);
                }}
                style={{ background: starterAnswer === 'no' ? brand : undefined, opacity: starterAnswer === 'no' ? 1 : 0.85 }}
              >
                No
              </button>
            </div>
          </div>
        )}

        {comfortAnswer === 'no' && recommendationCopy}

        {error && (
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
            {error}
          </div>
        )}

        {comfortAnswer ? (
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {plans
              .filter((plan) => {
                if (plan.id === 'comfort-care') return comfortAnswer === 'yes';
                if (plan.id === 'golden') return comfortAnswer === 'no' && meetsGolden;
                if (plan.id === 'foundations') return comfortAnswer === 'no';
                return false;
              })
              .sort((a, b) => {
                if (comfortAnswer === 'no' && meetsGolden) {
                  if (a.id === 'golden') return -1;
                  if (b.id === 'golden') return 1;
                }
                return 0;
              })
              .map((plan) => {
                const isRecommended = comfortAnswer === 'no' && plan.id === recommendedPlanId;
                const tiers = (() => {
                  if (!petDetails.kind) return plan.pricing;
                  const filtered = plan.pricing.filter((tier) => !tier.species || tier.species === petDetails.kind);
                  return filtered.length > 0 ? filtered : plan.pricing;
                })();
                const isSelected = selectedPlanExplicit === plan.id;
                return (
                  <article
                    key={plan.id}
                    className={`cp-card cp-plan-card ${isSelected ? 'selected' : ''}`}
                    style={{ padding: 24, position: 'relative' }}
                  >
                    {isSelected && <span className="cp-added-badge">Added to Cart</span>}
                    {isRecommended && plan.id === 'golden' && <span className="cp-recommended-badge">Recommended</span>}

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
                                <span>/mo</span>
                              </div>
                              {tier.annual ? (
                                <div className="cp-card-price-note">
                                  or ${tier.annual} annually {tier.suffix ? `(${tier.suffix})` : ''}
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
                          Foundations is still available if you’d prefer a lighter option—one visit with an abbreviated lab
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
                              <span className="cp-muted">{item}</span>
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
                        style={{ alignSelf: 'flex-end', marginTop: 'auto' }}
                      >
                        {isSelected ? 'Remove from Cart' : 'Add to Cart'}
                      </button>
                    </div>
                  </article>
                );
              })}

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
                      $49<span>/mo</span>
                    </div>
                    <div className="cp-card-price-note">or $529 annually (10% discount!)</div>
                  </div>
                </div>
                <div className="cp-card-body">
                  <div className="cp-card-includes">
                    <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Includes:</strong>
                    <ul>
                      <li className="cp-muted" style={{ marginBottom: 4 }}>
                        <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                          ⭐
                        </span>
                        Guaranteed two-hour response time during business hours from your Dedicated One Team
                      </li>
                      <li className="cp-muted" style={{ marginBottom: 4 }}>
                        <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                          ⭐
                        </span>
                        50% off all additional exams
                      </li>
                      <li className="cp-muted" style={{ marginBottom: 4 }}>
                        <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                          ⭐
                        </span>
                        10% off everything we offer (e.g., labs, services, medications)
                      </li>
                    </ul>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setPlusExplicit((prev) => !prev)}
                    style={{ alignSelf: 'flex-end', marginTop: 'auto' }}
                  >
                    {plusExplicit ? 'Remove from Cart' : 'Add to Cart'}
                  </button>
                </div>
              </article>
            )}

            {starterAnswer === 'no' && (
              <article
                className={`cp-card cp-plan-card ${starterExplicit ? 'selected' : ''}`}
                style={{ padding: 24, position: 'relative' }}
              >
                {starterExplicit && <span className="cp-added-badge">Added to Cart</span>}
                <div className="cp-card-upper">
                  <div className="cp-card-head">
                    <h3>Starter Wellness Add-On</h3>
                    <div className="cp-card-sub">Annual Membership Plan</div>
                  </div>
                  <div className="cp-card-price">
                    <div className="cp-card-price-main">
                      $29<span>/mo</span>
                    </div>
                    <div className="cp-card-price-note">or {formatMoney(309)} annually (10% discount!)</div>
                  </div>
                </div>
                <div className="cp-card-body">
                  <div className="cp-card-includes">
                    <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Includes:</strong>
                    <ul>
                      <li className="cp-muted" style={{ marginBottom: 4 }}>
                        <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                          ⭐
                        </span>
                        Two additional exams (one doctor, one technician) and trip fees to complete the vaccine series.
                      </li>
                      <li className="cp-muted" style={{ marginBottom: 4 }}>
                        <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                          ⭐
                        </span>
                        All boosters for full protection.
                      </li>
                      <li className="cp-muted" style={{ marginBottom: 4 }}>
                        <span role="img" aria-label="star" style={{ marginRight: 6 }}>
                          ⭐
                        </span>
                        Microchip scan & placement if needed.
                      </li>
                    </ul>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setStarterExplicit((prev) => !prev)}
                    style={{ alignSelf: 'flex-end', marginTop: 'auto' }}
                  >
                    {starterExplicit ? 'Remove from Cart' : 'Add to Cart'}
                  </button>
                </div>
              </article>
            )}
          </div>
        ) : (
          <div className="cp-card" style={{ padding: 20 }}>
            <p className="cp-muted" style={{ margin: 0 }}>
              Answer the comfort care question above to see recommended membership options.
            </p>
          </div>
        )}
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
                    const monthlyText = row.monthly != null ? `${formatMoney(row.monthly)}/mo` : null;
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
                const monthlyText = `${formatMoney(costSummary.totalMonthly)}/mo`;
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
          <button className="btn secondary" onClick={() => navigate('/client-portal')}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={handleProceedToPayment}
            disabled={!selectedPlanExplicit || !agreementAccepted || !agreementSignature.trim()}
            style={{
              minWidth: 200,
              opacity: !selectedPlanExplicit || !agreementAccepted || !agreementSignature.trim() ? 0.5 : 1,
              cursor: !selectedPlanExplicit || !agreementAccepted || !agreementSignature.trim() ? 'not-allowed' : 'pointer',
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
          {selectedPlanExplicit && (!agreementAccepted || !agreementSignature.trim()) && (
            <p className="cp-muted" style={{ color: '#b91c1c' }}>
              Please review the membership agreement, check the box, and sign to continue.
            </p>
          )}
        </div>
      </section>
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
          <p><strong>Foundations:</strong> Includes one annual wellness exam and trip fee, recommended annual vaccines based on age and lifestyle, annual lab work, and after-hours telehealth. Requires a 12-month commitment.</p>
          <p><strong>Golden:</strong> Includes two wellness exams with trip fees, recommended annual vaccines based on age and lifestyle, annual lab work, and after-hours telehealth. Requires a 12-month commitment.</p>
          <p><strong>Comfort Care:</strong> A month-to-month plan that includes one visit with trip fee, one telehealth consult during business hours per month, after-hours telehealth, and a one hundred dollar credit toward euthanasia.</p>
          <p><strong>Plus Add-On:</strong> Provides ten percent off all services and medications, fifty percent off exams, and a two-hour guaranteed response time by one of your One Team members during business hours if the need arises. The term matches the main plan. A store discount code is issued after sign-up.</p>
          <p><strong>Starter Wellness Add-On:</strong> Covers booster vaccine appointments during your pet’s first year, including the required doctor and technician visits with trip fees that are specifically tied to administering recommended booster vaccines.</p>
          <p><strong>After-Hours Telehealth</strong></p>
          <p>Members may access our virtual triage chat after hours during these times: Monday through Friday from 5 pm to 9 pm, and Saturday through Sunday from 8 am to 5 pm. A Triage Technician will review your pet’s history and may consult a veterinarian if needed. No house-call visits are made after hours. If urgent care is recommended, we will direct you to an appropriate emergency facility. Service is unavailable on listed holidays. Hours may change with 30 days of notice.</p>
          <p><strong>VCPR Requirements and Limitations for New or Lapsed Patients</strong></p>
          <p>A valid Veterinarian-Client-Patient Relationship requires an in-person exam within the past 365 days. If more than 12 months have passed since your pet’s most recent in-person exam with us, the VCPR is considered expired.</p>
          <p>For pets we have not yet seen, or for pets whose VCPR has lapsed, the following services cannot be provided until a current VCPR is re-established through an in-person exam:</p>
          <ul style={{ paddingLeft: 20 }}>
            <li>After-hours telehealth</li>
            <li>Medical advice, triage guidance, or care recommendations from your One Team</li>
            <li>Prescription medications or refills of any kind</li>
          </ul>
          <p>Once the initial or renewal exam is completed, all membership benefits become fully active.</p>
          <p>Memberships do not automatically cancel when the VCPR expires. It is the client’s responsibility to remain current.</p>
          <p><strong>Membership Rules</strong></p>
          <p>Benefits apply only to the enrolled pet and cannot be shared or transferred, including to another pet in the same household. Misuse may result in cancellation and repayment of discounts.</p>
          <p>Memberships bill monthly or annually, renew automatically, and may transition from Foundations to Golden when your pet reaches eight years of age for dogs or nine years of age for cats. We will email you twenty to thirty days before renewal with a recommendation. You may change your selection or cancel at that time.</p>
          <p>Foundations, Golden, Plus, and Starter Wellness plans require a twelve-month term. Comfort Care is month-to-month, as is Plus when selected with Comfort Care.</p>
          <p>If your pet passes away, moves, or transitions to Comfort Care, the value of used services will be deducted from the payments you have made. If the value of services used exceeds payments made, the remaining balance will be due before the plan is closed. No partial refunds are issued. Re-enrollment requires a new registration fee if charged.</p>
          <p>If the client moves, any refund will be issued only after we receive both a record request from a veterinary hospital outside our service area and a copy of the client’s new lease or mortgage agreement.</p>
          <p>A one-time registration fee, if charged, supports our Angel Fund for pets in need.</p>
          <p><strong>Scheduling and Availability</strong></p>
          <p>Visits should be scheduled in advance for best availability. Specific appointment times cannot be guaranteed. Services are available only within our service area and during our regular appointment hours.</p>
          <p>We will make every reasonable effort for your pet’s care to be provided by your dedicated One Team, especially for wellness visits and planned follow-up care. In situations where schedule constraints, urgent needs, staffing limitations, or routing requirements prevent your One Team from being available, another Vet At Your Door team may provide care to ensure your pet is seen in a timely manner.</p>
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
            I have read and agree to the Vet At Your Door Membership Plan terms and conditions.
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

