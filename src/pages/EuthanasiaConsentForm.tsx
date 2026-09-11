import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  getEuthanasiaConsentForm,
  memorialCartTotal,
  submitEuthanasiaConsent,
  type AftercareChoice,
  type AshReturnChoice,
  type ConsentMemorialItem,
  type EuthanasiaConsentForm as FormPayload,
} from '../api/consent';
import axios from 'axios';
import { storeListingImageUrl, type StoreListing, type StoreVariant } from '../api/onlineStore';
import ConsentCardPay from '../components/ConsentCardPay';
import ConsentMemorialPicker, {
  CLAY_PAW_PRINT_CART_ID,
  ConsentCartFloat,
  ConsentMemorialList,
  ConsentStoreListingModal,
} from '../components/ConsentMemorialPicker';
import SignaturePad from '../components/SignaturePad';
import {
  DEFAULT_ASH_RETURN_LABELS,
  DEFAULT_MEMORIAL_SUBCATEGORY,
  DEFAULT_PRIVATE_CREMATION_URNS,
} from '../utils/euthanasiaConsentSettings';
import './EuthanasiaConsentForm.css';

const publicStoreClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  withCredentials: false,
});

function displayPawPrintLabel(label: string): string {
  if (!/\(\s*charged\s*[—–-]/i.test(label)) return label;
  return label.replace(/\s*\(charged\s*[—–-]\s*/i, ' — ').replace(/\)\s*$/, '');
}

function veterinarianLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (/^dr\.?\s/i.test(trimmed)) return trimmed.replace(/^dr\.?\s+/i, 'Dr. ');
  if (/^doctor\s/i.test(trimmed)) return trimmed.replace(/^doctor\s+/i, 'Dr. ');
  return `Dr. ${trimmed}`;
}

type ConsentField =
  | 'clientFirstName'
  | 'clientLastName'
  | 'clientEmail'
  | 'petName'
  | 'petWeightLbs'
  | 'vetsToNotify'
  | 'otherVetsToNotify'
  | 'aftercare'
  | 'aftercareConfirmed'
  | 'nameplateLine1'
  | 'ashReturnMethod'
  | 'ashReturnHand'
  | 'ashLeaveNotes'
  | 'pawPrint'
  | 'clayCharge'
  | 'consentAcknowledged'
  | 'signature'
  | 'payment';

type FieldIssue = { field: ConsentField; message: string };

const AFTERCARE: Array<{ value: AftercareChoice; label: string }> = [
  {
    value: 'private_cremation',
    label: 'I would like my pet cremated WITH return of ashes (Private Cremation)',
  },
  {
    value: 'burial_at_sea',
    label: 'I would like my pet cremated with NO return of ashes (Burial at Sea)',
  },
  {
    value: 'home_burial',
    label: 'I will bury my pet at home / I will arrange for my pet’s aftercare',
  },
  { value: 'unsure', label: 'I am not sure yet what I would like' },
];


function aftercareLabel(value: AftercareChoice | ''): string {
  return AFTERCARE.find((row) => row.value === value)?.label ?? '';
}

function todayParts() {
  const now = new Date();
  return {
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
    year: String(now.getFullYear()),
  };
}

export default function EuthanasiaConsentForm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<FieldIssue | null>(null);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState<FormPayload | null>(null);
  const [signature, setSignature] = useState('');
  const today = useMemo(() => todayParts(), []);

  const [clientFirstName, setClientFirstName] = useState('');
  const [clientLastName, setClientLastName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [petName, setPetName] = useState('');
  const [petWeightLbs, setPetWeightLbs] = useState('');
  const [vetsToNotify, setVetsToNotify] = useState('');
  const [otherVetsToNotify, setOtherVetsToNotify] = useState('');
  const [aftercare, setAftercare] = useState<AftercareChoice | ''>('');
  const [aftercareConfirmed, setAftercareConfirmed] = useState<'yes' | 'no' | ''>('');
  const [nameplateLine1, setNameplateLine1] = useState('');
  const [nameplateLine2, setNameplateLine2] = useState('');
  const [nameplateLine3, setNameplateLine3] = useState('');
  const [ashReturnMethod, setAshReturnMethod] = useState<'mail' | 'hand_deliver' | ''>('');
  const [ashReturn, setAshReturn] = useState<AshReturnChoice | ''>('');
  const [ashLeaveNotes, setAshLeaveNotes] = useState('');
  const [pawPrintInk, setPawPrintInk] = useState(false);
  const [pawPrintClay, setPawPrintClay] = useState(false);
  const [pawPrintNone, setPawPrintNone] = useState(false);
  const [memorialItems, setMemorialItems] = useState<ConsentMemorialItem[]>([]);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [clayStoreOpen, setClayStoreOpen] = useState(false);
  const [clayStoreDetail, setClayStoreDetail] = useState<StoreListing | null>(null);
  const [clayStoreLoading, setClayStoreLoading] = useState(false);
  const [clayStoreError, setClayStoreError] = useState<string | null>(null);
  const createPaymentMethodRef = useRef<(() => Promise<string>) | null>(null);
  const ashReturnLabels = { ...DEFAULT_ASH_RETURN_LABELS, ...form?.ashReturnLabels };
  const cremationUrns =
    aftercare === 'private_cremation'
      ? form?.privateCremationUrns ?? DEFAULT_PRIVATE_CREMATION_URNS
      : null;
  const substituteUrnIds = new Set((cremationUrns?.substitutes || []).map((row) => row.listingId));

  const addStoreListingToCart = (detail: StoreListing, variant: StoreVariant | null) => {
    const included = cremationUrns?.included ?? null;
    const isSubstitute = substituteUrnIds.has(detail.listingId);
    const next: ConsentMemorialItem = {
      listingId: detail.listingId,
      name: detail.name,
      storeCategory: detail.storeCategory,
      priceFrom: isSubstitute ? 0 : variant?.onlineStorePrice ?? detail.priceFrom,
      timing: 'shop_now',
      quantity: 1,
      variantName:
        isSubstitute && included
          ? `Substitutes ${included.name}`
          : variant?.name && variant.name !== detail.name
            ? variant.name
            : null,
      inventoryItemId: variant?.inventoryItemId ?? null,
      procedureId: variant?.procedureId ?? null,
      catalogItemType: variant?.catalogItemType,
    };
    setMemorialItems((rows) => {
      const without = isSubstitute
        ? rows.filter((row) => !substituteUrnIds.has(row.listingId))
        : rows.filter((row) => row.listingId !== next.listingId);
      return [...without, next];
    });
    setClayStoreOpen(false);
  };

  const openStoreListing = (listingId: string) => {
    const practiceId = form?.practiceId || Number(import.meta.env.VITE_PRACTICE_ID) || 1;
    if (!listingId) return;
    setClayStoreOpen(true);
    setClayStoreError(null);
    if (clayStoreDetail?.listingId === listingId) return;
    setClayStoreLoading(true);
    setClayStoreDetail(null);
    void publicStoreClient
      .get<StoreListing>(`/public/store/products/${listingId}`, { params: { practiceId } })
      .then((res) => {
        setClayStoreDetail(res.data);
      })
      .catch(() => {
        setClayStoreError('Could not load this item from the store.');
      })
      .finally(() => {
        setClayStoreLoading(false);
      });
  };

  const openClayStoreInfo = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const listingId = form?.pawPrint.storeListing?.listingId;
    if (listingId) openStoreListing(listingId);
  };

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('This consent link is missing a token.');
      return;
    }
    let cancelled = false;
    void getEuthanasiaConsentForm(token)
      .then((payload) => {
        if (cancelled) return;
        setForm(payload);
        setClientFirstName(payload.client.firstName);
        setClientLastName(payload.client.lastName);
        setClientEmail(payload.client.email);
        setPetName(payload.pet.name);
        setPetWeightLbs(payload.pet.weightLbs);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            axiosMessage(err) || 'This consent link is invalid or has already been used.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pet = petName.trim() || 'your pet';
  const clientName = `${clientFirstName.trim()} ${clientLastName.trim()}`.trim() || 'the client';
  const memorialTotal = memorialCartTotal(memorialItems);
  const clayIsCharged = Boolean(
    form?.pawPrint.offering.clayCharge && form.pawPrint.clayChargePayment,
  );
  const clayAmount =
    pawPrintClay && clayIsCharged && form?.pawPrint.clayChargePayment
      ? form.pawPrint.clayChargePayment.amount
      : 0;
  const payTotal = clayAmount + memorialTotal;
  const clayCartItem: ConsentMemorialItem | null = pawPrintClay
    ? {
        listingId: CLAY_PAW_PRINT_CART_ID,
        name: clayIsCharged
          ? form?.pawPrint.clayChargePayment?.itemName ||
            form?.pawPrint.items.clayCharge?.name ||
            'Clay paw print'
          : form?.pawPrint.items.clayFree?.name || 'Clay paw print',
        priceFrom: clayAmount,
        timing: 'shop_now',
      }
    : null;
  const cartItems = clayCartItem ? [clayCartItem, ...memorialItems] : memorialItems;

  const validatePage = (index: number): FieldIssue | null => {
    if (index === 0) {
      if (!clientFirstName.trim()) return { field: 'clientFirstName', message: 'Please enter your first name.' };
      if (!clientLastName.trim()) return { field: 'clientLastName', message: 'Please enter your last name.' };
      if (!clientEmail.trim()) return { field: 'clientEmail', message: 'Please enter your email.' };
      if (!petName.trim()) return { field: 'petName', message: 'Please enter your pet’s name.' };
      if (!petWeightLbs.trim()) {
        return { field: 'petWeightLbs', message: 'Please enter your pet’s approximate weight.' };
      }
      if (!vetsToNotify.trim()) {
        return {
          field: 'vetsToNotify',
          message: 'Please list veterinary practices to notify, or type None.',
        };
      }
      if (!otherVetsToNotify.trim()) {
        return {
          field: 'otherVetsToNotify',
          message: 'Please list any other veterinarians to notify, or type none.',
        };
      }
    }
    if (index === 1) {
      if (!aftercare) return { field: 'aftercare', message: 'Please choose an aftercare preference.' };
      if (aftercareConfirmed !== 'yes') {
        return {
          field: 'aftercareConfirmed',
          message: 'Please confirm your aftercare preference (or go back and change it).',
        };
      }
      if (aftercare === 'private_cremation') {
        if (!nameplateLine1.trim()) {
          return { field: 'nameplateLine1', message: 'Please enter nameplate line 1.' };
        }
        if (!ashReturnMethod) {
          return { field: 'ashReturnMethod', message: 'Please choose how ashes should be returned.' };
        }
        if (
          ashReturnMethod === 'hand_deliver' &&
          ashReturn !== 'hand_deliver_in_person' &&
          ashReturn !== 'hand_deliver_leave'
        ) {
          return {
            field: 'ashReturnHand',
            message:
              'Please choose whether we should deliver in person or may leave them in a safe location.',
          };
        }
        if (ashReturn === 'hand_deliver_leave' && !ashLeaveNotes.trim()) {
          return { field: 'ashLeaveNotes', message: 'Please describe where we may leave the ashes.' };
        }
      }
    }
    if (index === 2) {
      if (!pawPrintInk && !pawPrintClay && !pawPrintNone) {
        return {
          field: 'pawPrint',
          message: 'Please choose a paw print option (you can select both ink and clay).',
        };
      }
      if (
        pawPrintClay &&
        form?.pawPrint.offering.clayCharge &&
        !form.pawPrint.clayChargePayment
      ) {
        return {
          field: 'clayCharge',
          message:
            'The clay Final Gift cannot be charged yet. Please ask the practice to link the priced catalog item.',
        };
      }
    }
    if (index === 3) {
      if (!consentAcknowledged) {
        return { field: 'consentAcknowledged', message: 'Please confirm you agree to the consent.' };
      }
      if (!signature) return { field: 'signature', message: 'Please sign the form.' };
    }
    return null;
  };

  const showFieldIssue = (issue: FieldIssue) => {
    setFieldError(issue);
    setError(null);
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-error-anchor="${issue.field}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const clearField = (field: ConsentField) => {
    if (fieldError?.field === field) setFieldError(null);
  };

  const next = () => {
    const issue = validatePage(page);
    if (issue) {
      showFieldIssue(issue);
      return;
    }
    setFieldError(null);
    setError(null);
    setPage((cur) => Math.min(cur + 1, 3));
  };

  const submit = async () => {
    const issue = validatePage(3);
    if (issue) {
      showFieldIssue(issue);
      return;
    }
    if (!aftercare || aftercareConfirmed !== 'yes') return;
    if (!pawPrintInk && !pawPrintClay && !pawPrintNone) return;
    const memorialTotal = memorialCartTotal(memorialItems);
    const needsPay = Boolean(
      memorialTotal > 0 ||
        (pawPrintClay && form?.pawPrint.offering.clayCharge && form.pawPrint.clayChargePayment),
    );
    setSubmitting(true);
    setFieldError(null);
    setError(null);
    try {
      let paymentMethodId: string | undefined;
      if (needsPay) {
        if (!createPaymentMethodRef.current) {
          showFieldIssue({ field: 'payment', message: 'Enter the card to pay for the selected items.' });
          setSubmitting(false);
          return;
        }
        paymentMethodId = await createPaymentMethodRef.current();
      }
      await submitEuthanasiaConsent({
        token,
        signedName: clientName,
        signatureDataUrl: signature,
        paymentMethodId,
        answers: {
          clientFirstName: clientFirstName.trim(),
          clientLastName: clientLastName.trim(),
          clientEmail: clientEmail.trim(),
          petName: petName.trim(),
          petWeightLbs: petWeightLbs.trim(),
          vetsToNotify: vetsToNotify.trim(),
          otherVetsToNotify: otherVetsToNotify.trim(),
          aftercare,
          aftercareConfirmed: 'yes',
          nameplateLine1: nameplateLine1.trim() || undefined,
          nameplateLine2: nameplateLine2.trim() || undefined,
          nameplateLine3: nameplateLine3.trim() || undefined,
          ashReturn: aftercare === 'private_cremation' ? ashReturn || undefined : undefined,
          ashLeaveNotes: ashLeaveNotes.trim() || undefined,
          pawPrintInk,
          pawPrintClay,
          additionalInfo: additionalInfo.trim() || undefined,
          memorialItems: memorialItems.length ? memorialItems : undefined,
          consentAcknowledged: true,
        },
      });
      setDone(true);
    } catch (err) {
      const message = axiosMessage(err) || 'Could not submit the form.';
      if (/card|pay/i.test(message)) {
        showFieldIssue({ field: 'payment', message });
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="consent-page">
        <div className="consent-card">Loading the consent form…</div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="consent-page">
        <div className="consent-card">
          <h1>Thank you</h1>
          <p>
            We received your consent for {pet}. If you have questions before the visit, please
            call us.
          </p>
        </div>
      </div>
    );
  }

  const FieldHint = ({ field }: { field: ConsentField }) =>
    fieldError?.field === field ? (
      <p className="consent-field-error" role="alert">
        {fieldError.message}
      </p>
    ) : null;

  if (!form) {
    return (
      <div className="consent-page">
        <div className="consent-card">
          <h1>Euthanasia consent</h1>
          <p>{error || 'This link is not valid.'}</p>
        </div>
      </div>
    );
  }

  const removeCartItem = (_listingId: string, item: ConsentMemorialItem) => {
    if (item.listingId === CLAY_PAW_PRINT_CART_ID) {
      setPawPrintClay(false);
      return;
    }
    setMemorialItems((rows) =>
      rows.filter(
        (row) =>
          !(
            row.listingId === item.listingId &&
            row.inventoryItemId === item.inventoryItemId &&
            row.procedureId === item.procedureId
          ),
      ),
    );
  };

  return (
    <div className="consent-page">
      <ConsentCartFloat items={cartItems} onRemove={removeCartItem} />
      <div className="consent-card">
        <p className="consent-progress">Step {page + 1} of 4</p>
        <h1>Euthanasia Consent Form</h1>
        {form.providerName ? (
          <p className="consent-muted">Your veterinarian: {veterinarianLabel(form.providerName)}</p>
        ) : null}
        {error ? <div className="consent-error">{error}</div> : null}

        {page === 0 && (
          <>
            <p>
              We know this is a difficult time and we hope you are doing okay. This form collects
              a little information about you and {pet}, your aftercare preferences, and your
              consent.
            </p>
            <label
              className={`consent-field${fieldError?.field === 'clientFirstName' ? ' is-invalid' : ''}`}
              data-error-anchor="clientFirstName"
            >
              Your first name
              <input
                value={clientFirstName}
                onChange={(e) => {
                  setClientFirstName(e.target.value);
                  clearField('clientFirstName');
                }}
              />
              <FieldHint field="clientFirstName" />
            </label>
            <label
              className={`consent-field${fieldError?.field === 'clientLastName' ? ' is-invalid' : ''}`}
              data-error-anchor="clientLastName"
            >
              Your last name
              <input
                value={clientLastName}
                onChange={(e) => {
                  setClientLastName(e.target.value);
                  clearField('clientLastName');
                }}
              />
              <FieldHint field="clientLastName" />
            </label>
            <label
              className={`consent-field${fieldError?.field === 'clientEmail' ? ' is-invalid' : ''}`}
              data-error-anchor="clientEmail"
            >
              Your email
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => {
                  setClientEmail(e.target.value);
                  clearField('clientEmail');
                }}
              />
              <FieldHint field="clientEmail" />
            </label>
            <label
              className={`consent-field${fieldError?.field === 'petName' ? ' is-invalid' : ''}`}
              data-error-anchor="petName"
            >
              Pet we are helping
              <input
                value={petName}
                onChange={(e) => {
                  setPetName(e.target.value);
                  clearField('petName');
                }}
              />
              <FieldHint field="petName" />
            </label>
            <label
              className={`consent-field${fieldError?.field === 'petWeightLbs' ? ' is-invalid' : ''}`}
              data-error-anchor="petWeightLbs"
            >
              Approximate weight (lbs)
              <input
                value={petWeightLbs}
                onChange={(e) => {
                  setPetWeightLbs(e.target.value);
                  clearField('petWeightLbs');
                }}
              />
              <FieldHint field="petWeightLbs" />
            </label>
            <label
              className={`consent-field${fieldError?.field === 'vetsToNotify' ? ' is-invalid' : ''}`}
              data-error-anchor="vetsToNotify"
            >
              Which veterinary practices should we inform about {pet}’s passing? Type “None” if
              none.
              <textarea
                rows={3}
                value={vetsToNotify}
                onChange={(e) => {
                  setVetsToNotify(e.target.value);
                  clearField('vetsToNotify');
                }}
              />
              <FieldHint field="vetsToNotify" />
            </label>
            <label
              className={`consent-field${fieldError?.field === 'otherVetsToNotify' ? ' is-invalid' : ''}`}
              data-error-anchor="otherVetsToNotify"
            >
              What other veterinarian(s), if any, should we inform? Type “none” if none.
              <textarea
                rows={2}
                value={otherVetsToNotify}
                onChange={(e) => {
                  setOtherVetsToNotify(e.target.value);
                  clearField('otherVetsToNotify');
                }}
              />
              <FieldHint field="otherVetsToNotify" />
            </label>
          </>
        )}

        {page === 1 && (
          <>
            <h2>Aftercare preferences</h2>
            <p>
              After {pet} has passed, you may care for them on your own. We also provide
              cremation with return of ashes (private cremation, including a wood urn and
              nameplate) or without return of ashes. Pets whose ashes are not returned are given
              a burial at sea, added with other beloved pets to a Memorial Reef Sphere on the
              ocean floor.
            </p>
            <div
              className={`consent-options${fieldError?.field === 'aftercare' ? ' is-invalid' : ''}`}
              data-error-anchor="aftercare"
            >
              {AFTERCARE.map((row) => (
                <label
                  key={row.value}
                  className={`consent-option ${aftercare === row.value ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="aftercare"
                    checked={aftercare === row.value}
                    onChange={() => {
                      setAftercare(row.value);
                      setAftercareConfirmed('');
                      clearField('aftercare');
                    }}
                  />
                  <span>{row.label}</span>
                </label>
              ))}
              <FieldHint field="aftercare" />
            </div>
            {aftercare === 'home_burial' && (
              <div className="consent-note">
                If you bury {pet} at home, please use a proper, safe burial so wildlife and your
                family stay safe.
              </div>
            )}
            {aftercare && (
              <label
                className={`consent-field${fieldError?.field === 'aftercareConfirmed' ? ' is-invalid' : ''}`}
                data-error-anchor="aftercareConfirmed"
              >
                We want to double check. You selected “{aftercareLabel(aftercare)}”. Is that
                correct?
                <select
                  value={aftercareConfirmed}
                  onChange={(e) => {
                    setAftercareConfirmed(e.target.value as 'yes' | 'no' | '');
                    clearField('aftercareConfirmed');
                  }}
                >
                  <option value="">Please select</option>
                  <option value="yes">Yes</option>
                  <option value="no">No — I will change it above</option>
                </select>
                <FieldHint field="aftercareConfirmed" />
              </label>
            )}
            {aftercare === 'private_cremation' && (
              <>
                <p>
                  Private cremations include a nameplate: three lines, 20 characters each. Please
                  avoid emojis and punctuation. The crematory recommends a capital letter at the
                  start of each line.
                </p>
                <label
                  className={`consent-field${fieldError?.field === 'nameplateLine1' ? ' is-invalid' : ''}`}
                  data-error-anchor="nameplateLine1"
                >
                  Line 1
                  <input
                    maxLength={20}
                    value={nameplateLine1}
                    onChange={(e) => {
                      setNameplateLine1(e.target.value);
                      clearField('nameplateLine1');
                    }}
                  />
                  <FieldHint field="nameplateLine1" />
                </label>
                <label className="consent-field">
                  Line 2 (optional)
                  <input
                    maxLength={20}
                    value={nameplateLine2}
                    onChange={(e) => setNameplateLine2(e.target.value)}
                  />
                </label>
                <label className="consent-field">
                  Line 3 (optional)
                  <input
                    maxLength={20}
                    value={nameplateLine3}
                    onChange={(e) => setNameplateLine3(e.target.value)}
                  />
                </label>
                <p>How should we return {pet}’s ashes?</p>
                <div
                  className={`consent-options${fieldError?.field === 'ashReturnMethod' ? ' is-invalid' : ''}`}
                  data-error-anchor="ashReturnMethod"
                >
                  <label
                    className={`consent-option ${ashReturnMethod === 'mail' ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ashReturnMethod"
                      checked={ashReturnMethod === 'mail'}
                      onChange={() => {
                        setAshReturnMethod('mail');
                        setAshReturn('mail');
                        setAshLeaveNotes('');
                        clearField('ashReturnMethod');
                      }}
                    />
                    <span>{ashReturnLabels.mail}</span>
                  </label>
                  <label
                    className={`consent-option ${ashReturnMethod === 'hand_deliver' ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ashReturnMethod"
                      checked={ashReturnMethod === 'hand_deliver'}
                      onChange={() => {
                        setAshReturnMethod('hand_deliver');
                        if (ashReturn === 'mail') setAshReturn('');
                        clearField('ashReturnMethod');
                      }}
                    />
                    <span>{ashReturnLabels.hand_deliver}</span>
                  </label>
                  <FieldHint field="ashReturnMethod" />
                </div>
                {ashReturnMethod === 'hand_deliver' && (
                  <>
                    <p>{ashReturnLabels.hand_deliver_followup}</p>
                    <div
                      className={`consent-options consent-options-nested${fieldError?.field === 'ashReturnHand' ? ' is-invalid' : ''}`}
                      data-error-anchor="ashReturnHand"
                    >
                      <label
                        className={`consent-option ${ashReturn === 'hand_deliver_in_person' ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="ashReturn"
                          checked={ashReturn === 'hand_deliver_in_person'}
                          onChange={() => {
                            setAshReturn('hand_deliver_in_person');
                            setAshLeaveNotes('');
                            clearField('ashReturnHand');
                          }}
                        />
                        <span>{ashReturnLabels.hand_deliver_in_person}</span>
                      </label>
                      <label
                        className={`consent-option ${ashReturn === 'hand_deliver_leave' ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="ashReturn"
                          checked={ashReturn === 'hand_deliver_leave'}
                          onChange={() => {
                            setAshReturn('hand_deliver_leave');
                            clearField('ashReturnHand');
                          }}
                        />
                        <span>{ashReturnLabels.hand_deliver_leave}</span>
                      </label>
                      <FieldHint field="ashReturnHand" />
                    </div>
                    {ashReturn === 'hand_deliver_leave' && (
                      <label
                        className={`consent-field${fieldError?.field === 'ashLeaveNotes' ? ' is-invalid' : ''}`}
                        data-error-anchor="ashLeaveNotes"
                      >
                        Please describe the safe location
                        <textarea
                          rows={2}
                          value={ashLeaveNotes}
                          onChange={(e) => {
                            setAshLeaveNotes(e.target.value);
                            clearField('ashLeaveNotes');
                          }}
                        />
                        <FieldHint field="ashLeaveNotes" />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {page === 2 && (
          <>
            <h2>Paw prints and memorial items</h2>
            <p>
              An ink paw print can be a lasting reminder and is offered at no charge when your
              veterinarian offers it. Some doctors also offer a clay paw print. You may choose
              one, both, or neither.
            </p>
            <div
              className={`consent-options${fieldError?.field === 'pawPrint' || fieldError?.field === 'clayCharge' ? ' is-invalid' : ''}`}
              data-error-anchor="pawPrint"
            >
              {form.pawPrint.options.map((row) => {
                const checked =
                  row.value === 'none'
                    ? pawPrintNone
                    : row.value === 'ink'
                      ? pawPrintInk
                      : pawPrintClay;
                const onToggle = (next: boolean) => {
                  if (row.value === 'none') {
                    setPawPrintNone(next);
                    if (next) {
                      setPawPrintInk(false);
                      setPawPrintClay(false);
                    }
                    clearField('pawPrint');
                    return;
                  }
                  if (row.value === 'ink') setPawPrintInk(next);
                  else setPawPrintClay(next);
                  if (next) setPawPrintNone(false);
                  clearField('pawPrint');
                  clearField('clayCharge');
                };
                const showInkPhoto =
                  form.pawPrint.showInkPhoto ?? form.pawPrint.offering.ink;
                const showClayPhotos =
                  form.pawPrint.showClayPhotos ?? form.pawPrint.offering.clayCharge;
                const clayStore = form.pawPrint.storeListing;
                const clayStoreHref = clayStore?.listingId
                  ? `/store/${clayStore.listingId}`
                  : null;
                const clayStoreImage =
                  row.value === 'clayCharge' && clayStore
                    ? storeListingImageUrl(
                        form.practiceId || Number(import.meta.env.VITE_PRACTICE_ID) || 1,
                        {
                          imageInventoryItemId: clayStore.imageInventoryItemId ?? null,
                          imageProductId: clayStore.imageProductId ?? null,
                          storeProductId: clayStore.storeProductId ?? undefined,
                          hasImage: clayStore.hasImage,
                        },
                      )
                    : null;
                const photos =
                  row.value === 'ink' && showInkPhoto
                    ? [{ src: '/images/euthanasia/ink-paw-print.png', alt: 'Example ink paw print' }]
                    : row.value === 'clayCharge' && showClayPhotos
                      ? [
                          ...(clayStoreImage
                            ? [{ src: clayStoreImage, alt: clayStore?.name || row.label }]
                            : []),
                          {
                            src: '/images/euthanasia/clay-paw-print-framed.png',
                            alt: 'Framed clay paw print',
                          },
                          {
                            src: '/images/euthanasia/clay-paw-print-bag.png',
                            alt: 'Clay paw print in gift bag',
                          },
                        ]
                      : [];
                const label = displayPawPrintLabel(row.label);
                return (
                  <label
                    key={row.value}
                    className={`consent-option ${checked ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => onToggle(e.target.checked)}
                    />
                    <span>
                      <span>
                        {clayStoreHref && row.value === 'clayCharge' ? (
                          <button
                            type="button"
                            className="consent-option-link"
                            onClick={openClayStoreInfo}
                          >
                            {label}
                          </button>
                        ) : (
                          label
                        )}
                      </span>
                      {photos.length > 0 ? (
                        <span className="consent-option-photos">
                          {photos.map((photo) =>
                            clayStoreHref && row.value === 'clayCharge' ? (
                              <button
                                key={photo.src}
                                type="button"
                                className="consent-option-photo-btn"
                                onClick={openClayStoreInfo}
                              >
                                <img src={photo.src} alt={photo.alt} />
                              </button>
                            ) : (
                              <img key={photo.src} src={photo.src} alt={photo.alt} />
                            ),
                          )}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
              <span data-error-anchor="clayCharge">
                <FieldHint field="pawPrint" />
                <FieldHint field="clayCharge" />
              </span>
            </div>
            {pawPrintClay && form.pawPrint.clayChargePayment ? (
              <p>
                You chose {form.pawPrint.clayChargePayment.itemName}. We will charge{' '}
                {form.pawPrint.clayChargePayment.amount.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })}{' '}
                on the last page when you submit this form.
              </p>
            ) : null}
            {clayStoreOpen ? (
              <ConsentStoreListingModal
                practiceId={form.practiceId || Number(import.meta.env.VITE_PRACTICE_ID) || 1}
                listing={clayStoreDetail}
                loading={clayStoreLoading}
                error={clayStoreError}
                onClose={() => setClayStoreOpen(false)}
                onOpenListing={openStoreListing}
                onAddToCart={
                  clayStoreDetail && substituteUrnIds.has(clayStoreDetail.listingId)
                    ? addStoreListingToCart
                    : undefined
                }
                substituteFor={
                  clayStoreDetail && substituteUrnIds.has(clayStoreDetail.listingId)
                    ? cremationUrns?.included ?? null
                    : null
                }
              />
            ) : null}
            <ConsentMemorialPicker
              practiceId={form.practiceId || Number(import.meta.env.VITE_PRACTICE_ID) || 1}
              category={form.memorialStoreCategory || 'Memorial Items'}
              petName={pet}
              selected={memorialItems}
              onChange={setMemorialItems}
              privateCremationUrns={cremationUrns}
              onOpenListing={openStoreListing}
              defaultSubcategory={
                form.memorialDefaultSubcategory || DEFAULT_MEMORIAL_SUBCATEGORY
              }
            />
          </>
        )}

        {page === 3 && (
          <>
            <h2>Consent</h2>
            <div className="consent-legal">
              <p>
                By signing below, I, {clientName}, hereby state that I am the legal owner or
                legally authorized representative of the legal owner of {pet} and am authorized
                to make all medical decisions regarding {pet}. I have declined any further care
                for {pet} and am hereby authorizing Vet At Your Door, PC to euthanize {pet}.
              </p>
              <p>
                I agree to have Vet At Your Door, PC choose a euthanasia protocol at their sole
                and exclusive discretion and have had all my questions and concerns regarding
                this process answered prior to signing this consent. I attest that {pet} has not
                been exposed to rabies, has not bitten anyone, and has not displayed any signs of
                unusual attitude or aggression in the last 15 days.
              </p>
              <p>My aftercare preference is as follows: {aftercareLabel(aftercare)}.</p>
              <p>
                It is my desire to provide for {pet} decent and humane after-death care,
                complying with all legal requirements of the area. If I choose or have chosen
                cremation for {pet}, I authorize Vet At Your Door, PC to take charge of my pet’s
                remains in accordance with practice policy, releasing the staff from any and all
                liability for performing said after-death care.
              </p>
            </div>
            {cartItems.length > 0 ? (
              <ConsentMemorialList
                selected={cartItems}
                title="Invoice"
                footer={
                  payTotal > 0 ? (
                    <p className="consent-invoice-note">
                      Your card will be charged{' '}
                      {payTotal.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      })}{' '}
                      when you submit this form.
                    </p>
                  ) : null
                }
              />
            ) : null}
            <label
              className={`consent-field${fieldError?.field === 'consentAcknowledged' ? ' is-invalid' : ''}`}
              data-error-anchor="consentAcknowledged"
            >
              <span>
                <input
                  type="checkbox"
                  checked={consentAcknowledged}
                  onChange={(e) => {
                    setConsentAcknowledged(e.target.checked);
                    clearField('consentAcknowledged');
                  }}
                />{' '}
                I have read and agree to the consent above.
              </span>
              <FieldHint field="consentAcknowledged" />
            </label>
            <p>
              Signed, {clientName} · {today.month}/{today.day}/{today.year}
            </p>
            <div
              className={`consent-signature${fieldError?.field === 'signature' ? ' is-invalid' : ''}`}
              data-error-anchor="signature"
            >
              <SignaturePad
                onChange={(value) => {
                  setSignature(value);
                  clearField('signature');
                }}
              />
              <FieldHint field="signature" />
            </div>
            {payTotal > 0 ? (
              <div className="consent-pay-block" data-error-anchor="payment">
                <h3>Payment</h3>
                <ConsentCardPay
                  name={clientName}
                  email={clientEmail}
                  onReady={(create) => {
                    createPaymentMethodRef.current = create;
                  }}
                />
                <FieldHint field="payment" />
              </div>
            ) : null}
            <label className="consent-field">
              Additional information for us (optional)
              <textarea
                rows={3}
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
              />
            </label>
          </>
        )}

        <div className="consent-actions">
          {page > 0 ? (
            <button type="button" className="consent-btn ghost" onClick={() => setPage((p) => p - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          {page < 3 ? (
            <button type="button" className="consent-btn" onClick={next}>
              Next
            </button>
          ) : (
            <button type="button" className="consent-btn" disabled={submitting} onClick={() => void submit()}>
              {submitting
                ? 'Submitting…'
                : payTotal > 0
                  ? `Pay ${payTotal.toLocaleString('en-US', {
                      style: 'currency',
                      currency: 'USD',
                    })} and submit`
                  : 'Submit consent'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function axiosMessage(err: unknown): string | null {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { message?: string | string[] } } }).response?.data;
    const message = data?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
  }
  return err instanceof Error ? err.message : null;
}
