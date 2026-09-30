import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  getEuthanasiaConsentForm,
  memorialCartTotal,
  reportAftercareMismatch,
  submitEuthanasiaConsent,
  type AftercareItemType,
  type AshReturnChoice,
  type ConsentMemorialItem,
  type EuthanasiaConsentForm as FormPayload,
} from '../api/consent';
import axios from 'axios';
import { storeListingImageUrl, type StoreListing, type StoreVariant } from '../api/onlineStore';
import { AddressAutocomplete, type AddressFields } from '../components/AddressAutocomplete';
import ConsentCardPay from '../components/ConsentCardPay';
import { ManualAddressFields } from '../components/ManualAddressFields';
import OutsideHospitalPicker, {
  pickedHospitalsToText,
  type PickedHospital,
} from '../components/OutsideHospitalPicker';
import ConsentMemorialPicker, {
  CLAY_PAW_PRINT_CART_ID,
  ConsentCartFloat,
  ConsentStoreListingModal,
} from '../components/ConsentMemorialPicker';
import SignaturePad from '../components/SignaturePad';
import {
  DEFAULT_ASH_RETURN_LABELS,
  DEFAULT_MEMORIAL_SUBCATEGORY,
  DEFAULT_PRIVATE_CREMATION_URNS,
} from '../utils/euthanasiaConsentSettings';
import { EMPTY_ADDRESS_FIELDS } from '../utils/verifiedAddress';
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
  | 'visitAddressConfirmed'
  | 'visitAddress'
  | 'mailingAddressConfirmed'
  | 'mailingAddress'
  | 'petName'
  | 'petWeightLbs'
  | 'vetsToNotify'
  | 'aftercare'
  | 'aftercareConfirmed'
  | 'aftercareRequest'
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

function addressIsComplete(addr: AddressFields): boolean {
  return Boolean(addr.line1.trim() && addr.city.trim() && addr.state.trim() && addr.zip.trim());
}

function addressDisplayLines(addr: {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  displayText?: string;
} | null | undefined): string[] {
  if (!addr) return [];
  if (addr.displayText?.trim() && !addr.city?.trim()) return [addr.displayText.trim()];
  const locality = [addr.city?.trim(), addr.state?.trim()].filter(Boolean).join(', ');
  return [
    addr.line1?.trim(),
    addr.line2?.trim(),
    [locality, addr.zip?.trim()].filter(Boolean).join(' '),
  ].filter(Boolean) as string[];
}

function toAddressFields(addr: {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
} | null | undefined): AddressFields {
  return {
    ...EMPTY_ADDRESS_FIELDS,
    line1: addr?.line1 ?? '',
    line2: addr?.line2 || undefined,
    city: addr?.city ?? '',
    state: addr?.state ?? '',
    zip: addr?.zip ?? '',
    country: addr?.country || 'US',
  };
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
  const [visitAddressConfirmed, setVisitAddressConfirmed] = useState<'yes' | 'no' | ''>('');
  const [visitAddress, setVisitAddress] = useState<AddressFields>({ ...EMPTY_ADDRESS_FIELDS });
  const [mailingAddressConfirmed, setMailingAddressConfirmed] = useState<'yes' | 'no' | ''>('');
  const [mailingAddress, setMailingAddress] = useState<AddressFields>({ ...EMPTY_ADDRESS_FIELDS });
  const [mailingManualEntry, setMailingManualEntry] = useState(false);
  const [petName, setPetName] = useState('');
  const [petWeightLbs, setPetWeightLbs] = useState('');
  const [chartHadWeight, setChartHadWeight] = useState(false);
  const [notifyNone, setNotifyNone] = useState(false);
  const [notifyHospitals, setNotifyHospitals] = useState<PickedHospital[]>([]);
  const [aftercareConfirmed, setAftercareConfirmed] = useState<'yes' | 'no' | ''>('');
  const [aftercareRequest, setAftercareRequest] = useState('');
  const [aftercareReported, setAftercareReported] = useState(false);
  const [reportingAftercare, setReportingAftercare] = useState(false);
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
  const [saveCardOnFile, setSaveCardOnFile] = useState(true);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [clayStoreOpen, setClayStoreOpen] = useState(false);
  const [clayStoreDetail, setClayStoreDetail] = useState<StoreListing | null>(null);
  const [clayStoreLoading, setClayStoreLoading] = useState(false);
  const [clayStoreError, setClayStoreError] = useState<string | null>(null);
  const createPaymentMethodRef = useRef<(() => Promise<string>) | null>(null);
  // The plan is whatever staff quoted. Nothing on this page can change it.
  const aftercare: AftercareItemType | '' = form?.aftercare?.type ?? '';
  const aftercareLabel = form?.aftercare?.label ?? '';
  const aftercareUnresolved: 'missing' | 'conflict' | null = !form
    ? null
    : form.aftercare?.type
      ? null
      : form.aftercare?.unresolved ?? 'missing';
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
        setVisitAddress(toAddressFields(payload.visitAddress));
        setMailingAddress(toAddressFields(payload.mailingAddress));
        setPetName(payload.pet.name);
        const chartWeight = usableConsentWeightLbs(payload.pet.weightLbs);
        setPetWeightLbs(chartWeight);
        setChartHadWeight(Boolean(chartWeight));
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
  // One number for the family: what staff quoted plus anything they picked here.
  const visitEstimateTotal = Number(form?.visitEstimate?.total ?? 0);
  const payTotal = visitEstimateTotal + clayAmount + memorialTotal;
  const chargeNow = Boolean(
    form?.appointmentStart && Date.parse(form.appointmentStart) < Date.now(),
  );
  const quoteLines = [
    ...(form?.visitEstimate?.lines ?? []).map((line) => ({
      description: line.description,
      qty: Number(line.qty) || 1,
      amount: Number(line.amount) || 0,
    })),
    ...(pawPrintClay && clayAmount > 0
      ? [
          {
            description:
              form?.pawPrint.clayChargePayment?.itemName ||
              form?.pawPrint.items.clayCharge?.name ||
              'Clay paw print',
            qty: 1,
            amount: clayAmount,
          },
        ]
      : []),
    ...memorialItems
      .filter((item) => item.timing !== 'later')
      .map((item) => ({
        description: item.variantName ? `${item.name} (${item.variantName})` : item.name,
        qty: item.quantity || 1,
        amount: (Number(item.priceFrom) || 0) * (item.quantity || 1),
      })),
  ];
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
      const hasVisitOnFile = addressDisplayLines(form?.visitAddress).length > 0;
      const hasMailingOnFile = addressDisplayLines(form?.mailingAddress).length > 0;
      if (hasVisitOnFile && !visitAddressConfirmed) {
        return {
          field: 'visitAddressConfirmed',
          message: 'Please confirm the address we are coming to.',
        };
      }
      if (
        (!hasVisitOnFile || visitAddressConfirmed === 'no') &&
        !addressIsComplete(visitAddress)
      ) {
        return { field: 'visitAddress', message: 'Please enter the address we should come to.' };
      }
      if (hasMailingOnFile && !mailingAddressConfirmed) {
        return {
          field: 'mailingAddressConfirmed',
          message: 'Please confirm your mailing address.',
        };
      }
      if (
        (!hasMailingOnFile || mailingAddressConfirmed === 'no') &&
        !addressIsComplete(mailingAddress)
      ) {
        return { field: 'mailingAddress', message: 'Please enter your mailing address.' };
      }
      if (!usableConsentWeightLbs(petWeightLbs)) {
        return {
          field: 'petWeightLbs',
          message: 'Please enter your pet’s approximate weight in pounds.',
        };
      }
      if (!notifyNone && notifyHospitals.length === 0) {
        return {
          field: 'vetsToNotify',
          message: 'Please choose who to notify, or select None.',
        };
      }
    }
    if (index === 1) {
      if (!aftercare) {
        return {
          field: 'aftercare',
          message: 'Please call us — we need to sort out the aftercare plan before you sign.',
        };
      }
      if (aftercareConfirmed !== 'yes') {
        return {
          field: 'aftercareConfirmed',
          message: 'Please let us know whether this is the plan you want.',
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

  /**
   * Ends the form. We do not change the plan here — staff do that on the
   * estimate and send a new form — so there is nothing left for the family to
   * fill in once this is sent.
   */
  const reportAftercare = async () => {
    const note = aftercareRequest.trim();
    if (!note) {
      showFieldIssue({
        field: 'aftercareRequest',
        message: 'Please tell us what you would like instead.',
      });
      return;
    }
    setReportingAftercare(true);
    setFieldError(null);
    setError(null);
    try {
      await reportAftercareMismatch({
        token,
        note,
        contactName: clientName,
      });
      setAftercareReported(true);
    } catch (err) {
      setError(
        axiosMessage(err) ||
          'We could not send that. Please call us so we can get this right.',
      );
    } finally {
      setReportingAftercare(false);
    }
  };

  const submit = async () => {
    const issue = validatePage(3);
    if (issue) {
      showFieldIssue(issue);
      return;
    }
    const hasVisitOnFile = addressDisplayLines(form?.visitAddress).length > 0;
    const hasMailingOnFile = addressDisplayLines(form?.mailingAddress).length > 0;
    if (hasVisitOnFile && visitAddressConfirmed !== 'yes' && visitAddressConfirmed !== 'no') return;
    if (hasMailingOnFile && mailingAddressConfirmed !== 'yes' && mailingAddressConfirmed !== 'no') {
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
          showFieldIssue({ field: 'payment', message: 'Enter the card to authorize for this visit.' });
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
          visitAddressConfirmed:
            visitAddressConfirmed === 'yes' && addressDisplayLines(form?.visitAddress).length
              ? 'yes'
              : 'no',
          visitAddress:
            visitAddressConfirmed === 'yes' && addressDisplayLines(form?.visitAddress).length
              ? undefined
              : visitAddress,
          mailingAddressConfirmed:
            mailingAddressConfirmed === 'yes' && addressDisplayLines(form?.mailingAddress).length
              ? 'yes'
              : 'no',
          mailingAddress:
            mailingAddressConfirmed === 'yes' && addressDisplayLines(form?.mailingAddress).length
              ? undefined
              : mailingAddress,
          petName: petName.trim(),
          petWeightLbs: petWeightLbs.trim(),
          vetsToNotify: notifyNone ? 'None' : pickedHospitalsToText(notifyHospitals),
          notifyHospitals: notifyNone
            ? []
            : notifyHospitals.map((h) => ({
                outsideHospitalId: h.outsideHospitalId,
                name: h.name,
              })),
          // Kept for older staff views / API shape; everything lives in vetsToNotify now.
          otherVetsToNotify: 'none',
          aftercare: aftercare || undefined,
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
          saveCardOnFile,
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

  if (aftercareReported) {
    return (
      <div className="consent-page">
        <div className="consent-card">
          <h1>Thank you for telling us</h1>
          <p>
            We have passed this along to our team. Someone will call you to go over what you
            would like for {pet}, and once everything is updated we will send you a new form to
            sign.
          </p>
          <p>
            Nothing has been signed, and you do not need to do anything else right now. If you
            would rather talk it through sooner, please call us any time.
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
            <p className="consent-intro">
              We know this is a difficult time and we hope you are doing okay. This form collects
              a little information about you and {pet}, your aftercare preferences, and your
              consent.
            </p>
            <div className="consent-row">
              <div className="consent-field">
                <span className="consent-question">First name</span>
                <div className="consent-readonly">{clientFirstName || '—'}</div>
              </div>
              <div className="consent-field">
                <span className="consent-question">Last name</span>
                <div className="consent-readonly">{clientLastName || '—'}</div>
              </div>
            </div>
            <div className="consent-field">
              <span className="consent-question">Your email</span>
              <div className="consent-readonly">{clientEmail || '—'}</div>
            </div>
            <div
              className={`consent-address-block${fieldError?.field === 'visitAddressConfirmed' || fieldError?.field === 'visitAddress' ? ' is-invalid' : ''}`}
              data-error-anchor="visitAddressConfirmed"
            >
              <p className="consent-question">Please confirm the address we are coming to.</p>
              {addressDisplayLines(form.visitAddress).length ? (
                <>
                  <div className="consent-address-card">
                    {addressDisplayLines(form.visitAddress).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                  <div className="consent-options">
                    {(
                      [
                        { value: 'yes', label: 'Yes — that is the address we should come to' },
                        { value: 'no', label: 'No — we will be at a different address' },
                      ] as const
                    ).map((row) => (
                      <label
                        key={row.value}
                        className={`consent-option ${visitAddressConfirmed === row.value ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="visitAddressConfirmed"
                          checked={visitAddressConfirmed === row.value}
                          onChange={() => {
                            setVisitAddressConfirmed(row.value);
                            clearField('visitAddressConfirmed');
                            clearField('visitAddress');
                          }}
                        />
                        <span>{row.label}</span>
                      </label>
                    ))}
                  </div>
                  <FieldHint field="visitAddressConfirmed" />
                </>
              ) : (
                <p className="consent-muted">
                  We do not have a visit address on file yet. Please enter where we should come.
                </p>
              )}
              {visitAddressConfirmed === 'no' || !addressDisplayLines(form.visitAddress).length ? (
                <div className="consent-address-edit" data-error-anchor="visitAddress">
                  {addressDisplayLines(form.visitAddress).length ? (
                    <p className="consent-question">Where should we come?</p>
                  ) : null}
                  <AddressAutocomplete
                    id="consent-visit-address"
                    value={visitAddress}
                    onChange={(next) => {
                      setVisitAddress(next);
                      clearField('visitAddress');
                    }}
                    error={fieldError?.field === 'visitAddress' ? fieldError.message : undefined}
                    placeholder="Start typing the address"
                  />
                </div>
              ) : null}
            </div>
            <div
              className={`consent-address-block${fieldError?.field === 'mailingAddressConfirmed' || fieldError?.field === 'mailingAddress' ? ' is-invalid' : ''}`}
              data-error-anchor="mailingAddressConfirmed"
            >
              <p className="consent-question">
                Please confirm the mailing address we have on file.
              </p>
              <p className="consent-muted">
                We use this if we need to mail ashes, prescriptions, or other information. PO Boxes
                are fine.
              </p>
              {addressDisplayLines(form.mailingAddress).length ? (
                <>
                  <div className="consent-address-card">
                    {addressDisplayLines(form.mailingAddress).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    {form.mailingSameAsVisit ? (
                      <div className="consent-address-note">Same as the visit address</div>
                    ) : null}
                  </div>
                  <div className="consent-options">
                    {(
                      [
                        { value: 'yes', label: 'Yes — that mailing address is correct' },
                        { value: 'no', label: 'No — I need to update my mailing address' },
                      ] as const
                    ).map((row) => (
                      <label
                        key={row.value}
                        className={`consent-option ${mailingAddressConfirmed === row.value ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="mailingAddressConfirmed"
                          checked={mailingAddressConfirmed === row.value}
                          onChange={() => {
                            setMailingAddressConfirmed(row.value);
                            clearField('mailingAddressConfirmed');
                            clearField('mailingAddress');
                          }}
                        />
                        <span>{row.label}</span>
                      </label>
                    ))}
                  </div>
                  <FieldHint field="mailingAddressConfirmed" />
                </>
              ) : (
                <p className="consent-muted">
                  We do not have a mailing address on file yet. Please enter the mailing address we
                  should use.
                </p>
              )}
              {mailingAddressConfirmed === 'no' || !addressDisplayLines(form.mailingAddress).length ? (
                <div className="consent-address-edit" data-error-anchor="mailingAddress">
                  <p className="consent-help">
                    Predictive search works for street addresses; check the box below if yours is a
                    PO Box or is not listed.
                  </p>
                  <label className="consent-po-box">
                    <input
                      type="checkbox"
                      checked={mailingManualEntry}
                      onChange={(e) => {
                        const manual = e.target.checked;
                        setMailingManualEntry(manual);
                        setMailingAddress({ ...EMPTY_ADDRESS_FIELDS });
                        clearField('mailingAddress');
                      }}
                    />
                    <span>My mailing address is a PO Box or isn&apos;t listed — I&apos;ll enter it manually</span>
                  </label>
                  {mailingManualEntry ? (
                    <ManualAddressFields
                      value={mailingAddress}
                      onChange={(next) => {
                        setMailingAddress(next);
                        clearField('mailingAddress');
                      }}
                      errors={
                        fieldError?.field === 'mailingAddress'
                          ? { 'mailingAddress.line1': fieldError.message }
                          : {}
                      }
                      errorPrefix="mailingAddress"
                      line1Placeholder="PO Box 123 or street address"
                    />
                  ) : (
                    <AddressAutocomplete
                      id="consent-mailing-address"
                      value={mailingAddress}
                      onChange={(next) => {
                        setMailingAddress(next);
                        clearField('mailingAddress');
                      }}
                      error={fieldError?.field === 'mailingAddress' ? fieldError.message : undefined}
                      placeholder="Start typing your mailing address"
                    />
                  )}
                </div>
              ) : null}
            </div>
            <div className="consent-row consent-row--pet">
              <div className="consent-field">
                <span className="consent-question">Pet we are helping</span>
                <div className="consent-readonly">{petName || '—'}</div>
              </div>
              <label
                className={`consent-field consent-field--narrow${fieldError?.field === 'petWeightLbs' ? ' is-invalid' : ''}${
                  !chartHadWeight ? ' is-needed' : ''
                }`}
                data-error-anchor="petWeightLbs"
              >
                <span className="consent-question">
                  Weight (lbs) <span className="consent-required">required</span>
                </span>
                <input
                  value={petWeightLbs}
                  onChange={(e) => {
                    setPetWeightLbs(e.target.value);
                    clearField('petWeightLbs');
                  }}
                  inputMode="decimal"
                  required
                  aria-required="true"
                  placeholder={chartHadWeight ? undefined : 'Enter weight'}
                />
                <FieldHint field="petWeightLbs" />
              </label>
            </div>
            {!chartHadWeight ? (
              <p className="consent-weight-needed" role="alert">
                We do not have a weight on file. Please enter an approximate weight in pounds —
                we use this to calculate medications.
              </p>
            ) : null}
            <div
              className={`consent-field${fieldError?.field === 'vetsToNotify' ? ' is-invalid' : ''}`}
              data-error-anchor="vetsToNotify"
            >
              <span className="consent-question">
                Who should we inform about {pet}’s passing?
              </span>
              <p className="consent-help">
                Choose practices from our list, or type a practice or doctor name that is not
                listed. You can select more than one.
              </p>
              {!notifyNone ? (
                <div className="consent-hospital-picker">
                  <OutsideHospitalPicker
                    practiceId={form.practiceId || Number(import.meta.env.VITE_PRACTICE_ID) || 1}
                    value={notifyHospitals}
                    onChange={(next) => {
                      setNotifyHospitals(next);
                      if (next.length) setNotifyNone(false);
                      clearField('vetsToNotify');
                    }}
                    placeholder="Search or add a practice or doctor…"
                  />
                </div>
              ) : null}
              <label className={`consent-none-option${notifyNone ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={notifyNone}
                  onChange={(e) => {
                    const none = e.target.checked;
                    setNotifyNone(none);
                    if (none) setNotifyHospitals([]);
                    clearField('vetsToNotify');
                  }}
                />
                <span>None — there is no one to notify</span>
              </label>
              <FieldHint field="vetsToNotify" />
            </div>
          </>
        )}

        {page === 1 && (
          <>
            <h2>Aftercare for {pet}</h2>
            {aftercareUnresolved ? (
              <div
                className="consent-error"
                data-error-anchor="aftercare"
                role="alert"
              >
                <p>
                  We are not able to show you {pet}’s aftercare plan right now, and this is far
                  too important for us to guess at.
                </p>
                <p>
                  Please call us before you go any further and we will get this sorted out
                  together.
                </p>
              </div>
            ) : (
              <>
                <p className="consent-intro">
                  This is the aftercare we have planned for {pet}. Please read it over and tell
                  us it is right.
                </p>
                <div className="consent-aftercare-plan" data-error-anchor="aftercare">
                  <span className="consent-aftercare-plan-label">Our plan for {pet}</span>
                  <strong>{aftercareLabel}</strong>
                </div>
                {aftercare === 'home_burial' && (
                  <div className="consent-note">
                    If you bury {pet} at home, please use a proper, safe burial so wildlife and
                    your family stay safe.
                  </div>
                )}
                <label
                  className={`consent-field${fieldError?.field === 'aftercareConfirmed' ? ' is-invalid' : ''}`}
                  data-error-anchor="aftercareConfirmed"
                >
                  <span className="consent-question">Is this what you would like for {pet}?</span>
                  <select
                    value={aftercareConfirmed}
                    onChange={(e) => {
                      setAftercareConfirmed(e.target.value as 'yes' | 'no' | '');
                      clearField('aftercareConfirmed');
                    }}
                  >
                    <option value="">Please select</option>
                    <option value="yes">Yes — this is what we want</option>
                    <option value="no">No — we would like something different</option>
                  </select>
                  <FieldHint field="aftercareConfirmed" />
                </label>
                {aftercareConfirmed === 'no' && (
                  <div className="consent-aftercare-change">
                    <p>
                      That is completely okay. Changing your mind is allowed, and we would much
                      rather hear it now than get this wrong.
                    </p>
                    <p>
                      Tell us what you would like instead. We will call you, update everything on
                      our end, and send you a fresh form to sign. Nothing is signed until then.
                    </p>
                    <label
                      className={`consent-field${fieldError?.field === 'aftercareRequest' ? ' is-invalid' : ''}`}
                      data-error-anchor="aftercareRequest"
                    >
                      <span className="consent-question">
                        What would you like for {pet} instead?
                      </span>
                      <textarea
                        rows={4}
                        maxLength={2000}
                        value={aftercareRequest}
                        onChange={(e) => {
                          setAftercareRequest(e.target.value);
                          clearField('aftercareRequest');
                        }}
                      />
                      <FieldHint field="aftercareRequest" />
                    </label>
                    <button
                      type="button"
                      className="consent-btn"
                      disabled={reportingAftercare}
                      onClick={() => void reportAftercare()}
                    >
                      {reportingAftercare ? 'Sending…' : 'Send this to our team'}
                    </button>
                  </div>
                )}
              </>
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
                  <span className="consent-question">Line 1</span>
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
                  <span className="consent-question">Line 2 (optional)</span>
                  <input
                    maxLength={20}
                    value={nameplateLine2}
                    onChange={(e) => setNameplateLine2(e.target.value)}
                  />
                </label>
                <label className="consent-field">
                  <span className="consent-question">Line 3 (optional)</span>
                  <input
                    maxLength={20}
                    value={nameplateLine3}
                    onChange={(e) => setNameplateLine3(e.target.value)}
                  />
                </label>
                <p className="consent-question">How should we return {pet}’s ashes?</p>
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
                        <span className="consent-question">Please describe the safe location</span>
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
                You chose {form.pawPrint.clayChargePayment.itemName}, which adds{' '}
                {form.pawPrint.clayChargePayment.amount.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })}{' '}
                to your total.
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
              <p>My aftercare preference is as follows: {aftercareLabel}.</p>
              <p>
                It is my desire to provide for {pet} decent and humane after-death care,
                complying with all legal requirements of the area. If I choose or have chosen
                cremation for {pet}, I authorize Vet At Your Door, PC to take charge of my pet’s
                remains in accordance with practice policy, releasing the staff from any and all
                liability for performing said after-death care.
              </p>
            </div>
            {payTotal > 0 ? (
              <div className="consent-quote">
                <span className="consent-quote-label">Estimated total for {pet}’s visit</span>
                <strong className="consent-quote-amount">
                  {payTotal.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  })}
                </strong>
                <p className="consent-quote-note">
                  {chargeNow
                    ? 'This includes everything you have chosen. Because this visit has already happened, we will charge this card when you submit.'
                    : 'This includes everything you have chosen. The next step is an authorization — a hold, not a charge. We will charge this card on the day of service.'}
                </p>
                {quoteLines.length > 0 ? (
                  <details className="consent-quote-lines">
                    <summary>See itemized estimate</summary>
                    <table>
                      <tbody>
                        {quoteLines.map((line, i) => (
                          <tr key={`${line.description}-${i}`}>
                            <td>
                              {line.description}
                              {line.qty > 1 ? ` × ${line.qty}` : ''}
                            </td>
                            <td>
                              {line.amount.toLocaleString('en-US', {
                                style: 'currency',
                                currency: 'USD',
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
              </div>
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
                <h3>Card authorization</h3>
                <p className="consent-pay-auth">
                  {chargeNow ? (
                    <>
                      Because this visit has already happened, we will charge{' '}
                      {payTotal.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      })}{' '}
                      on this card when you submit.
                    </>
                  ) : (
                    <>
                      This is an authorization, not a charge. We will hold{' '}
                      {payTotal.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      })}{' '}
                      on this card now. We will charge this card on the day of service.
                    </>
                  )}
                </p>
                <ConsentCardPay
                  name={clientName}
                  email={clientEmail}
                  onReady={(create) => {
                    createPaymentMethodRef.current = create;
                  }}
                />
                <label className="consent-save-card">
                  <input
                    type="checkbox"
                    checked={saveCardOnFile}
                    onChange={(e) => setSaveCardOnFile(e.target.checked)}
                  />
                  <span>Save this card on file for this visit</span>
                </label>
                <FieldHint field="payment" />
              </div>
            ) : null}
            <label className="consent-field">
              <span className="consent-question">Additional information for us (optional)</span>
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
                  ? `Authorize ${payTotal.toLocaleString('en-US', {
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

function usableConsentWeightLbs(raw: string | null | undefined): string {
  const n = Number(String(raw ?? '').trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(n);
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
