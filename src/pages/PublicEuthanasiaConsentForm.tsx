import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CLAY_PAW_UNIT_CENTS,
  fetchEuthanasiaConsentForm,
  submitEuthanasiaConsent,
  type EuthanasiaConsentFormPayload,
  type EuthanasiaConsentVariant,
} from '../api/euthanasiaConsent';
import { SignaturePad } from '../components/SignaturePad';
import './PublicEuthanasiaConsentForm.css';

const DOCTORS = [
  'Dr. Nina Petersen',
  'Dr. Abigail Messina',
  'Dr. Heather Crispell',
  'Dr. Kate Cheeseman',
  'Dr. Lisa Benson',
  'Dr. Brian Quinn',
  'Dr. Julie Greenlaw',
];

const AFTERCARE = [
  'I would like my pet cremated WITH return of ashes (Private Cremation)',
  'I would like my pet cremated with NO return of ashes (Burial at Sea)',
  'I will bury my pet at home / I will arrange for my pet\'s aftercare',
  'I am not sure yet what I would like',
] as const;

const ASH_RETURN_MAIL =
  'I wish to have my pet\'s ashes mailed to me, with tracking information, as soon as they are available. I accept any risks, minimal though they may be, of mail system delivery error. (Most popular - Timeframe: 1-2 weeks)';
const ASH_RETURN_HOME =
  'I wish to have my pet\'s ashes personally delivered to my home. (Timeframe: 3-5 weeks)';

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  doctor: string;
  petName: string;
  petWeightLbs: string;
  vetsToInform: string;
  illnessAcknowledged: boolean;
  aftercare: string;
  aftercareConfirmed: string;
  nameplateLine1: string;
  nameplateLine2: string;
  nameplateLine3: string;
  ashReturnMethod: string;
  ashHomeDeliveryDetail: string;
  inkPaw: string;
  pawPrintChoices: string[];
  clayPawCv: string;
  clayPawQty: number;
  additionalInfo: string;
  signatureDataUrl: string | null;
  signedDate: string;
};

const emptyForm = (): FormState => ({
  firstName: '',
  lastName: '',
  email: '',
  doctor: '',
  petName: '',
  petWeightLbs: '',
  vetsToInform: '',
  illnessAcknowledged: false,
  aftercare: '',
  aftercareConfirmed: '',
  nameplateLine1: '',
  nameplateLine2: '',
  nameplateLine3: '',
  ashReturnMethod: '',
  ashHomeDeliveryDetail: '',
  inkPaw: '',
  pawPrintChoices: [],
  clayPawCv: '',
  clayPawQty: 1,
  additionalInfo: '',
  signatureDataUrl: null,
  signedDate: new Date().toISOString().slice(0, 10),
});

function isPrivateCremation(aftercare: string) {
  return aftercare.includes('WITH return of ashes');
}

function isHomeBurial(aftercare: string) {
  return aftercare.toLowerCase().includes('bury my pet at home');
}

function wantsClaySouthern(choices: string[]) {
  return choices.some((c) => c.toLowerCase().includes('clay'));
}

export default function PublicEuthanasiaConsentForm() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<EuthanasiaConsentFormPayload | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const variant: EuthanasiaConsentVariant = payload?.variant ?? 'southern';
  const allowAshHome = payload?.allowAshHomeDelivery !== false;
  const pet = form.petName.trim() || 'your pet';
  const clientName = [form.firstName, form.lastName].filter(Boolean).join(' ') || 'the owner';

  useEffect(() => {
    if (!token) {
      setError('This form link is missing a token. Please use the link from your email.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchEuthanasiaConsentForm(token);
        if (cancelled) return;
        setPayload(data);
        if (data.alreadySubmitted) {
          setDone(true);
        }
        setForm((prev) => ({
          ...prev,
          firstName: data.prefill.clientFirstName ?? '',
          lastName: data.prefill.clientLastName ?? '',
          email: data.prefill.email ?? '',
          petName: data.prefill.petName ?? '',
          petWeightLbs: data.prefill.petWeightLbs ?? '',
          doctor: data.prefill.doctorDisplayName ?? '',
        }));
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Could not load this consent form. The link may be invalid or expired.';
        setError(String(msg));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const isPetersen = /petersen/i.test(form.doctor);
  const steps = useMemo(() => {
    const labels = ['About you', 'Aftercare', 'Memorial items', 'Consent', 'Finish'];
    return labels;
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldError(null);
  }

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return 'Please enter your first and last name.';
      if (!form.email.trim() || !form.email.includes('@')) return 'Please enter a valid email.';
      if (variant === 'southern' && !form.doctor.trim()) return 'Please select which doctor you are seeing.';
      if (!form.petName.trim()) return 'Please enter your pet\'s name.';
      if (!form.petWeightLbs.trim()) return 'Please enter your pet\'s approximate weight.';
      if (!form.vetsToInform.trim()) {
        return 'Please list veterinarians to inform, or type "None".';
      }
      if (!form.illnessAcknowledged) {
        return 'Please acknowledge the illness notice before continuing.';
      }
    }
    if (s === 1) {
      if (!form.aftercare) return 'Please select an aftercare preference.';
      if (form.aftercareConfirmed !== 'Yes') {
        return 'Please confirm your aftercare preference (select Yes).';
      }
      if (isPrivateCremation(form.aftercare)) {
        if (!form.nameplateLine1.trim()) return 'Please enter at least line 1 for the nameplate.';
        if (variant === 'southern') {
          if (!form.ashReturnMethod) return 'Please choose how ashes should be returned.';
          if (form.ashReturnMethod === ASH_RETURN_HOME && !form.ashHomeDeliveryDetail.trim()) {
            return 'Please tell us how you want ashes delivered at home.';
          }
        } else if (!form.ashHomeDeliveryDetail.trim()) {
          return 'Please tell us how you want ashes delivered.';
        }
      }
    }
    if (s === 2) {
      if (variant === 'southern') {
        if (!form.inkPaw) return 'Please choose whether you want an ink paw print.';
        if (form.pawPrintChoices.length === 0) return 'Please select a paw print option.';
      } else if (!form.clayPawCv) {
        return 'Please choose whether you want a clay paw print.';
      }
    }
    if (s === 3) {
      if (!form.signatureDataUrl) return 'Please sign the consent form.';
      if (!form.signedDate) return 'Please enter today\'s date.';
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setFieldError(err);
      return;
    }
    setStep((x) => Math.min(x + 1, steps.length - 1));
  }

  function back() {
    setFieldError(null);
    setStep((x) => Math.max(x - 1, 0));
  }

  async function onSubmit() {
    const err = validateStep(3);
    if (err) {
      setFieldError(err);
      return;
    }
    if (!token) return;
    setSubmitting(true);
    setFieldError(null);
    try {
      const clayQty =
        variant === 'southern' && wantsClaySouthern(form.pawPrintChoices)
          ? Math.max(1, form.clayPawQty || 1)
          : 0;
      const clayCents = clayQty * CLAY_PAW_UNIT_CENTS;
      await submitEuthanasiaConsent({
        token,
        signatureDataUrl: form.signatureDataUrl!,
        signerName: clientName,
        clayPawQuantity: clayQty || undefined,
        clayPawAmountCents: clayCents || undefined,
        formData: {
          variant,
          ...form,
          clayPawQty: clayQty || undefined,
          clayPawAmountCents: clayCents || undefined,
          clayPawNote:
            clayCents > 0
              ? 'Clay paw print selected — charge via Stripe/eVet (on-form Stripe checkout coming next).'
              : undefined,
        },
      });
      setDone(true);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Could not submit the form. Please try again.';
      setFieldError(String(msg));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="euth-form">
        <p className="euth-muted">Loading consent form…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="euth-form">
        <h1 className="euth-title">Euthanasia Consent Form</h1>
        <p className="euth-error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="euth-form">
        <h1 className="euth-title">Thank you</h1>
        <p>
          Your consent form for {pet} has been received. If you have questions before your visit,
          please contact Vet At Your Door.
        </p>
      </div>
    );
  }

  return (
    <div className="euth-form">
      <header className="euth-header">
        <h1 className="euth-title">
          {variant === 'cv' ? 'Euthanasia Consent Form (CV)' : 'Euthanasia Consent Form'}
        </h1>
        <p className="euth-lede">
          We know this is a difficult time. This form collects information about you and {pet},
          your consent, and aftercare / memorial preferences.
        </p>
        <ol className="euth-steps" aria-label="Form progress">
          {steps.map((label, i) => (
            <li key={label} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}>
              {label}
            </li>
          ))}
        </ol>
      </header>

      {fieldError ? (
        <p className="euth-error" role="alert">
          {fieldError}
        </p>
      ) : null}

      {step === 0 ? (
        <section className="euth-card">
          <label className="euth-label">
            First name
            <input
              className="euth-input"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              autoComplete="given-name"
            />
          </label>
          <label className="euth-label">
            Last name
            <input
              className="euth-input"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              autoComplete="family-name"
            />
          </label>
          <label className="euth-label">
            Email
            <input
              className="euth-input"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
            />
          </label>
          {variant === 'southern' ? (
            <label className="euth-label">
              Which doctor are you seeing?
              <select
                className="euth-input"
                value={form.doctor}
                onChange={(e) => set('doctor', e.target.value)}
              >
                <option value="">Please select</option>
                {DOCTORS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : form.doctor ? (
            <p className="euth-muted">Doctor: {form.doctor}</p>
          ) : null}
          <label className="euth-label">
            Pet&apos;s name
            <input
              className="euth-input"
              value={form.petName}
              onChange={(e) => set('petName', e.target.value)}
            />
          </label>
          <label className="euth-label">
            Approximate weight (lbs)
            <input
              className="euth-input"
              value={form.petWeightLbs}
              onChange={(e) => set('petWeightLbs', e.target.value)}
            />
          </label>
          <label className="euth-label">
            Which veterinary practices should we inform about the loss of {pet}?
            <textarea
              className="euth-textarea"
              value={form.vetsToInform}
              onChange={(e) => set('vetsToInform', e.target.value)}
              rows={3}
              placeholder='Type "None" if your pet hasn&apos;t seen another veterinarian'
            />
          </label>

          <div className="euth-callout">
            <h2 className="euth-h2">Before your visit</h2>
            <p>
              If you or anyone who will be present is ill, please let us know prior to arrival so we
              can plan accordingly.
            </p>
            {isPetersen ? (
              <p>
                <strong>Dr. Petersen will be wearing a mask</strong> during your visit.
              </p>
            ) : null}
            <label className="euth-check">
              <input
                type="checkbox"
                checked={form.illnessAcknowledged}
                onChange={(e) => set('illnessAcknowledged', e.target.checked)}
              />
              I have read this notice and will contact the practice if anyone is ill before the
              visit.
            </label>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="euth-card">
          <h2 className="euth-h2">Aftercare preferences</h2>
          <p>
            After euthanasia you may care for {pet} on your own, or we can arrange cremation — with
            or without return of ashes (burial at sea / memorial reef). Private cremations include a
            wood urn and customized nameplate.
          </p>
          <fieldset className="euth-fieldset">
            <legend>What is your aftercare preference for {pet}?</legend>
            {AFTERCARE.map((opt) => (
              <label key={opt} className="euth-radio">
                <input
                  type="radio"
                  name="aftercare"
                  checked={form.aftercare === opt}
                  onChange={() => {
                    set('aftercare', opt);
                    set('aftercareConfirmed', '');
                  }}
                />
                {opt}
              </label>
            ))}
          </fieldset>

          {form.aftercare ? (
            <fieldset className="euth-fieldset">
              <legend>
                Please confirm: you selected &quot;{form.aftercare}&quot;. Is that correct?
              </legend>
              {['Yes', 'No'].map((opt) => (
                <label key={opt} className="euth-radio">
                  <input
                    type="radio"
                    name="aftercareConfirmed"
                    checked={form.aftercareConfirmed === opt}
                    onChange={() => set('aftercareConfirmed', opt)}
                  />
                  {opt}
                </label>
              ))}
              {form.aftercareConfirmed === 'No' ? (
                <p className="euth-warn">Please correct your aftercare preference above.</p>
              ) : null}
            </fieldset>
          ) : null}

          {isHomeBurial(form.aftercare) ? (
            <div className="euth-callout euth-callout--warn">
              If you bury {pet} at home, please follow{' '}
              <a
                href="https://www.maine.gov/dacf/php/nutrient_management/documents/Brochure-HomeownerCarcassBurialGuidelines.pdf"
                target="_blank"
                rel="noreferrer"
              >
                Maine homeowner carcass burial guidelines
              </a>
              .
            </div>
          ) : null}

          {isPrivateCremation(form.aftercare) && form.aftercareConfirmed === 'Yes' ? (
            <>
              <h3 className="euth-h3">Nameplate (3 lines, 20 characters each)</h3>
              <p className="euth-muted">
                No emojis or punctuation like quotes. The crematory recommends starting each line
                with a capital letter.
              </p>
              {(['nameplateLine1', 'nameplateLine2', 'nameplateLine3'] as const).map((key, i) => (
                <label key={key} className="euth-label">
                  Line {i + 1}
                  {i === 0 ? ' (required)' : ' (optional)'}
                  <input
                    className="euth-input"
                    maxLength={20}
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value.slice(0, 20))}
                  />
                </label>
              ))}

              {variant === 'southern' ? (
                <fieldset className="euth-fieldset">
                  <legend>How should {pet}&apos;s ashes be returned?</legend>
                  <label className="euth-radio">
                    <input
                      type="radio"
                      name="ashReturn"
                      checked={form.ashReturnMethod === ASH_RETURN_MAIL}
                      onChange={() => set('ashReturnMethod', ASH_RETURN_MAIL)}
                    />
                    {ASH_RETURN_MAIL}
                  </label>
                  {allowAshHome ? (
                    <label className="euth-radio">
                      <input
                        type="radio"
                        name="ashReturn"
                        checked={form.ashReturnMethod === ASH_RETURN_HOME}
                        onChange={() => set('ashReturnMethod', ASH_RETURN_HOME)}
                      />
                      {ASH_RETURN_HOME}
                    </label>
                  ) : (
                    <p className="euth-muted">
                      Home ash delivery is not available for your location (over 45 minutes from our
                      depot). We will mail ashes with tracking.
                    </p>
                  )}
                </fieldset>
              ) : null}

              {(variant === 'cv' || form.ashReturnMethod === ASH_RETURN_HOME) &&
              (variant === 'cv' || allowAshHome) ? (
                <fieldset className="euth-fieldset">
                  <legend>
                    {variant === 'cv'
                      ? `How would you like us to hand-deliver ${pet}'s ashes? (typically 2–4 weeks)`
                      : `How should we deliver ${pet}'s ashes at home?`}
                  </legend>
                  <label className="euth-radio">
                    <input
                      type="radio"
                      name="ashHomeDetail"
                      checked={form.ashHomeDeliveryDetail.startsWith('I want you to deliver') || form.ashHomeDeliveryDetail.startsWith('I would like you to deliver')}
                      onChange={() =>
                        set(
                          'ashHomeDeliveryDetail',
                          'I want you to deliver them to me so I see you in person. I do not want you to leave them at my home without me there.'
                        )
                      }
                    />
                    Deliver in person — do not leave without me present.
                  </label>
                  <label className="euth-label">
                    Or describe a safe outdoor drop spot
                    <input
                      className="euth-input"
                      value={
                        form.ashHomeDeliveryDetail.startsWith('I want you to deliver') ||
                        form.ashHomeDeliveryDetail.startsWith('I would like you to deliver')
                          ? ''
                          : form.ashHomeDeliveryDetail
                      }
                      onChange={(e) => set('ashHomeDeliveryDetail', e.target.value)}
                      placeholder="Safe spot description"
                    />
                  </label>
                </fieldset>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="euth-card">
          <h2 className="euth-h2">Memorial items</h2>
          {variant === 'southern' ? (
            <>
              <p>
                Ink paw prints are complimentary. Clay paw prints (more three-dimensional) are
                $80.25 each for cremations and are ordered through Final Gift.
              </p>
              <fieldset className="euth-fieldset">
                <legend>Would you like an ink paw print of {pet}&apos;s paw?</legend>
                {['Yes, please', 'No, thank you.'].map((opt) => (
                  <label key={opt} className="euth-radio">
                    <input
                      type="radio"
                      name="inkPaw"
                      checked={form.inkPaw === opt}
                      onChange={() => set('inkPaw', opt)}
                    />
                    {opt}
                  </label>
                ))}
              </fieldset>
              <fieldset className="euth-fieldset">
                <legend>Which paw print type(s) would you like?</legend>
                {[
                  'Ink paw print ($0)',
                  'Clay paw print (for cremations only) ($80.25)',
                  'I do not want a paw print, thank you.',
                ].map((opt) => (
                  <label key={opt} className="euth-check">
                    <input
                      type="checkbox"
                      checked={form.pawPrintChoices.includes(opt)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.pawPrintChoices.filter((x) => !x.includes('do not want')), opt]
                          : form.pawPrintChoices.filter((x) => x !== opt);
                        if (opt.includes('do not want') && e.target.checked) {
                          set('pawPrintChoices', [opt]);
                        } else {
                          set(
                            'pawPrintChoices',
                            next.filter((x) => !x.includes('do not want'))
                          );
                        }
                      }}
                    />
                    {opt}
                  </label>
                ))}
              </fieldset>
              {wantsClaySouthern(form.pawPrintChoices) ? (
                <label className="euth-label">
                  How many clay paw prints?
                  <input
                    className="euth-input"
                    type="number"
                    min={1}
                    max={10}
                    value={form.clayPawQty}
                    onChange={(e) => set('clayPawQty', Math.max(1, Number(e.target.value) || 1))}
                  />
                  <span className="euth-muted">
                    Total: ${((form.clayPawQty || 1) * (CLAY_PAW_UNIT_CENTS / 100)).toFixed(2)}. Card
                    payment on this form (Stripe) is next — for now we record the selection and staff
                    can charge in eVet/Stripe.
                  </span>
                </label>
              ) : null}
            </>
          ) : (
            <fieldset className="euth-fieldset">
              <legend>
                We offer clay paw prints at no charge at the time of the visit. Would you like one?
              </legend>
              {['Yes, please', 'No, thank you.', "I'm not sure yet."].map((opt) => (
                <label key={opt} className="euth-radio">
                  <input
                    type="radio"
                    name="clayPawCv"
                    checked={form.clayPawCv === opt}
                    onChange={() => set('clayPawCv', opt)}
                  />
                  {opt}
                </label>
              ))}
            </fieldset>
          )}
          <p>
            You can also browse{' '}
            <a
              href="https://www.vetatyourdoor.com/online-pharmacy/-c138284806"
              target="_blank"
              rel="noreferrer"
            >
              memorial items in our online store
            </a>
            .
          </p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="euth-card">
          <h2 className="euth-h2">Consent</h2>
          <div className="euth-legal">
            <p>
              By signing below, I, {clientName}, hereby state that I am the legal owner or legally
              authorized representative of the legal owner of {pet} and am authorized to make all
              medical decisions regarding {pet}. I have declined any further care for {pet} and am
              hereby authorizing Vet At Your Door, PC to euthanize {pet}.
            </p>
            <p>
              I agree to have Vet At Your Door, PC choose a euthanasia protocol at their sole and
              exclusive discretion and have had all my questions and concerns regarding this process
              answered prior to signing this consent. I attest that {pet} has not been exposed to
              rabies, has not bitten anyone, and has not displayed any signs of unusual attitude or
              aggression in the last 15 days.
            </p>
            <p>My aftercare preference is as follows: {form.aftercare || '—'}</p>
            <p>
              It is my desire to provide for {pet} decent and humane after-death care, complying with
              all legal requirements of the area. If I choose or have chosen cremation for {pet}, I
              authorize Vet At Your Door, PC to take charge of my pet&apos;s remains in accordance with
              practice policy, releasing the staff from any and all liability for performing said
              after-death care.
            </p>
          </div>
          <SignaturePad
            value={form.signatureDataUrl}
            onChange={(v) => set('signatureDataUrl', v)}
            disabled={submitting}
          />
          <label className="euth-label">
            Date
            <input
              className="euth-input"
              type="date"
              value={form.signedDate}
              onChange={(e) => set('signedDate', e.target.value)}
            />
          </label>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="euth-card">
          <h2 className="euth-h2">Additional information</h2>
          <label className="euth-label">
            Anything else we should know?
            <textarea
              className="euth-textarea"
              rows={4}
              value={form.additionalInfo}
              onChange={(e) => set('additionalInfo', e.target.value)}
            />
          </label>
          <p className="euth-muted">
            Review your answers on previous pages if needed, then submit. You will not be able to
            edit after submitting.
          </p>
        </section>
      ) : null}

      <div className="euth-nav">
        {step > 0 ? (
          <button type="button" className="euth-btn euth-btn--ghost" onClick={back} disabled={submitting}>
            Back
          </button>
        ) : (
          <span />
        )}
        {step < steps.length - 1 ? (
          <button type="button" className="euth-btn" onClick={next}>
            Next
          </button>
        ) : (
          <button type="button" className="euth-btn" onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        )}
      </div>
    </div>
  );
}
