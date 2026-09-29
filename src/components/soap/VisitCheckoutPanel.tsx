import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Ban,
  Banknote,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Pencil,
  Receipt,
  RotateCcw,
  Smartphone,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  VISIT_WORKFLOW_PRACTICE_ID,
  addCounterInvoiceLine,
  addVisitTender,
  cancelTerminalCheckout,
  authorizeSavedCard,
  captureAuthorization,
  chargeSavedCard,
  getInvoiceCardOnFile,
  deleteOrder,
  getInvoice,
  getOrderClinicalDetails,
  listOrders,
  removeCounterInvoiceLine,
  reopenInvoice,
  saveOrderPrescription,
  setOrderState,
  startTerminalCheckout,
  updateCounterInvoiceLine,
  updateOrder,
  voidInvoice,
  type EncounterOrder,
  type OrderPrescription,
  type OrderVaccination,
  type TerminalReaderCatalog,
  type StockDraw,
  type InvoiceCardOnFile,
  type VisitInvoice,
  type VisitInvoiceLine,
  type VisitTenderMethod,
} from '../../api/visitWorkflow';
import { subscribeTerminalCheckout } from '../../utils/terminalCheckoutRealtime';
import { appConfirm, appDeclineHow, appPrompt } from '../../utils/appDialog';
import {
  isOffRecordDeclineNote,
  offRecordDeclineNote,
} from '../../api/declinedTreatments';
import TerminalReaderPicker from './TerminalReaderPicker';
import EstimateSettlePanel from '../estimates/EstimateSettlePanel';
import CheckoutInventoryBranchField from './CheckoutInventoryBranchField';
import SendRxLabelButton, { type SendRxLabelSource } from './SendRxLabelButton';
import MailInvoiceLineCheckbox, {
  cancelMailOrdersForInvoiceLines,
  isMailOrderShipped,
  matchingMailOrderForLine,
  shippedMailMessage,
  shippingLineFromNotes,
} from './MailInvoiceLineCheckbox';
import { listMailOrders, type MailOrder } from '../../api/onlineStore';
import { attachShippingLines, isInvoiceShippingLine } from '../../utils/mailShippingTypes';
import { attachTagalongLines, tagalongTaxHint } from '../../utils/invoiceTagalongs';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import StockLotPicker from '../inventory/StockLotPicker';
import LinkedStockInvoiceDetails from '../invoice/LinkedStockInvoiceDetails';
import InvoiceVaccineDoseEditor from '../pims/InvoiceVaccineDoseEditor';
import { linkedStockFromLine } from '../../utils/linkedInvoiceStock';
import VisitDoseAndRxSection from './VisitDoseAndRxSection';
import PlanOrdersSection from './PlanOrdersSection';
import type { HouseholdRosterEntry } from '../../api/visitWorkflow';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';
import { fetchCatalogPricingForOrder, getCatalogLinePrice } from '../../utils/catalogItemPricing';
import DirectionsLimitHint, { directionsMaxLength } from './DirectionsLimitHint';
import { BookPatientChartButton } from '../BookPatientChartButton';
import '../pims/ClientFinancialWorkspace.css';
import {
  addCalendarYear,
  dateForInput,
  dateIsTodayOrBefore,
  maxRefillExpirationInput,
  refillExpirationExceedsMax,
  toDateInput,
  tomorrowInput,
} from '../../utils/printRxLabel';

/** Persist date-only inputs as noon-local ISO so the API date validator accepts them. */
function toRxDatePayload(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const day = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return `${day}T12:00:00`;
  return value.trim();
}

export type CheckoutRxLabelContext = {
  patientId?: number | null;
  patientName: string;
  species?: string | null;
  ownerName: string;
  veterinarianName?: string | null;
  veterinarianLicense?: string | null;
  veterinarianEmployeeId?: number | null;
};

function formatDeclineDay(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const day = when.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return ` (${day})`;
}

type Props = {
  /** Needed to delete the encounter order behind an invoice line. */
  encounterId?: string | null;
  invoice: VisitInvoice | null;
  /** Used to show / edit client notes and price overrides on checkout lines. */
  orders?: EncounterOrder[];
  disabled?: boolean;
  rxLabel?: CheckoutRxLabelContext | null;
  /** Rendered below the payment actions — the follow-up question, asked while
   * the client is still here (see CheckoutFollowUpPrompt). */
  followUpSlot?: ReactNode;
  /**
   * Payment lives on the checkout screen, not in the SOAP sidebar. With this off the
   * panel is the working bill (add charges, record doses, approve scripts) and offers
   * `onCheckout` once every line is ready to collect on.
   */
  showPayment?: boolean;
  /** Takes the tech to the checkout screen. Only used when `showPayment` is false. */
  onCheckout?: () => void;
  /** Blocks the pay actions with this explanation (e.g. follow-up not decided yet). */
  paymentBlockedReason?: string | null;
  /**
   * Dose / Rx recording used to live above the invoice lines (duplicating every item).
   * Clinical details now expand under each line — keep these for that embedded UI.
   */
  clientId?: number | null;
  patientId?: number | null;
  /** Pets on this visit. Lets the add bar bill a housemate without leaving this chart. */
  roster?: HouseholdRosterEntry[];
  practiceId?: number;
  onClinicalRecorded?: () => void;
  onChronicMedicationsMaybeChanged?: () => void;
  /** Bump when dose/Rx clinical details change so Approve sees fresh sigs. */
  clinicalRefreshSignal?: number;
  /** Bump when someone else on this visit changed an order, so housemates reload. */
  remoteRefreshSignal?: number;
  onInvoiceChange: (invoice: VisitInvoice) => void;
  onOpenEuthanasiaPrepay: () => void;
  /** After removing a line's order, drop it from local order state and refresh the invoice. */
  onOrderRemoved?: (orderId: string) => void;
  onOrdersChange?: (orders: EncounterOrder[]) => void;
  /** Refresh invoice after a catalog add (works even before the first line exists). */
  onInvoiceShouldRefresh?: () => void;
  /** Inventory catalog picks also go under Treatment Plan/Medications in the Plan narrative. */
  onInventoryItemAdded?: (item: { name: string; isVaccine?: boolean }) => void;
  onInventoryItemRemoved?: (itemName: string) => void;
  /** Marks Room Loader–originated order ids so Accept does not resurface them on the left Plan list. */
  onRoomLoaderOrderIds?: (ids: string[]) => void;
  /** Expand / scroll to the invoice line for this encounter order (wrap-up Rx chip). */
  focusOrderId?: string | null;
};

function isCheckoutRxLine(line: VisitInvoiceLine, order: EncounterOrder | null): boolean {
  if (order?.kind === 'med') return true;
  if (line.catalogIsMedication === true || line.catalogIsDispensable === true) return true;
  return Boolean(line.instructions?.trim() || line.refillCount != null);
}

type CheckoutRxMissingField =
  | 'provider'
  | 'instructions'
  | 'refillCount'
  | 'refillExpiration'
  | 'acuity'
  | 'discardAfter'
  | 'branch'
  | 'location'
  | 'lot';

function checkoutRxMissingFields(args: {
  instructions: string;
  refills: string;
  refillExpiration: string;
  acuity: string;
  discardAfter: string;
  providerId: number | null | undefined;
  invoice: VisitInvoice;
  mailed: boolean;
  trackLots?: boolean;
  lotId?: number | null;
}): CheckoutRxMissingField[] {
  const missing: CheckoutRxMissingField[] = [];
  if (args.providerId == null) missing.push('provider');
  if (!args.instructions.trim()) missing.push('instructions');
  const refillCount = args.refills.trim() === '' ? NaN : Number(args.refills);
  if (args.refills.trim() === '' || !Number.isFinite(refillCount) || refillCount < 0 || !Number.isInteger(refillCount)) {
    missing.push('refillCount');
  } else if (refillCount > 0) {
    if (!args.refillExpiration || dateIsTodayOrBefore(args.refillExpiration) || refillExpirationExceedsMax(args.refillExpiration)) {
      missing.push('refillExpiration');
    }
  }
  if (args.acuity !== 'acute' && args.acuity !== 'chronic') missing.push('acuity');
  if (!args.discardAfter || dateIsTodayOrBefore(args.discardAfter)) missing.push('discardAfter');
  if (!args.mailed) {
    if (args.invoice.inventoryBranchId == null) missing.push('branch');
    if (args.invoice.inventoryLocationId == null) missing.push('location');
    if (args.trackLots && args.lotId == null) missing.push('lot');
  }
  return missing;
}

function checkoutRxMissingMessage(field: CheckoutRxMissingField, refills: string): string {
  if (field === 'provider') return 'Set the visit provider before approving';
  if (field === 'instructions') return 'Enter the script first';
  if (field === 'refillCount') {
    return refills.trim() === '' ? 'Enter 0 if there are no refills' : 'Refills must be a whole number';
  }
  if (field === 'refillExpiration') return 'Enter refill expiration';
  if (field === 'acuity') return 'Select acute or chronic';
  if (field === 'discardAfter') return 'Enter discard after';
  if (field === 'branch') return 'Select a branch';
  if (field === 'location') return 'Select a fill location';
  if (field === 'lot') return 'Choose a lot';
  return 'Select a fill location';
}

/** Same Rx block as the client invoice: sig + Approve + DYMO on the left, lot/refills on the right. */
function CheckoutInvoiceRxFields({
  line,
  invoice,
  encounterId,
  orderId,
  recorded,
  rxName,
  strength,
  employeeId,
  disabled,
  scriptApproved,
  approveTried,
  approvedByName,
  mailed,
  hideLotPicker,
  dymoSource,
  patientId,
  patientName,
  onSaved,
  onPrescriptionSaved,
  onError,
  onApproved,
  onSavedAndCollapse,
  onApproveTried,
}: {
  line: VisitInvoiceLine;
  invoice: VisitInvoice;
  encounterId?: string | null;
  orderId?: string | null;
  recorded: OrderPrescription | null;
  rxName: string;
  strength?: string | null;
  employeeId?: number | null;
  disabled: boolean;
  scriptApproved: boolean;
  approveTried?: boolean;
  approvedByName?: string | null;
  mailed: boolean;
  hideLotPicker: boolean;
  dymoSource: Omit<
    SendRxLabelSource,
    | 'instructions'
    | 'refill'
    | 'refillExpiration'
    | 'discardAfter'
    | 'acuity'
    | 'onSavePrescription'
  > | null;
  patientId?: number | null;
  patientName?: string | null;
  onSaved: (invoice: VisitInvoice) => void;
  onPrescriptionSaved: (saved: OrderPrescription) => void;
  onError: (message: string) => void;
  /** Called after Rx is saved + approved — e.g. set provider on the line. */
  onApproved: () => void;
  /** After a successful Save Rx — collapse the line. */
  onSavedAndCollapse?: () => void;
  onApproveTried?: () => void;
}) {
  const prescribed = toDateInput(invoice.created ?? invoice.paidAt) || dateForInput(new Date());
  const [instructions, setInstructions] = useState(
    () =>
      recorded?.instructions?.trim() ||
      line.instructions?.trim() ||
      line.catalogInstructions?.trim() ||
      '',
  );
  const [refills, setRefills] = useState(() =>
    recorded?.refill != null
      ? String(recorded.refill)
      : line.refillCount == null
        ? ''
        : String(line.refillCount),
  );
  const [acuity, setAcuity] = useState<'acute' | 'chronic' | ''>(
    () => recorded?.acuity ?? '',
  );
  const [refillExpiration, setRefillExpiration] = useState(
    () =>
      toDateInput(recorded?.refillExpiration) ||
      toDateInput(line.catalogRefillExpiration) ||
      '',
  );
  const [discardAfter, setDiscardAfter] = useState(
    () => line.catalogDiscardAfter || addCalendarYear(prescribed),
  );
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const canWriteRx = Boolean(encounterId && orderId);

  // Re-hydrate when the saved Rx row arrives (navigate away + back). The recorded
  // row is the only source of truth here: if it has no expiration/acuity, these
  // fields must read empty, because that is exactly what the line is red about.
  useEffect(() => {
    setInstructions(
      recorded?.instructions?.trim() ||
        line.instructions?.trim() ||
        line.catalogInstructions?.trim() ||
        '',
    );
    setRefills(
      recorded?.refill != null
        ? String(recorded.refill)
        : line.refillCount == null
          ? ''
          : String(line.refillCount),
    );
    setAcuity(recorded?.acuity ?? '');
    setRefillExpiration(
      toDateInput(recorded?.refillExpiration) ||
        toDateInput(line.catalogRefillExpiration) ||
        '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, recorded?.id, recorded?.refillExpiration, recorded?.acuity, recorded?.refill]);

  const refillCount = refills.trim() === '' ? NaN : Number(refills);
  const providerId = line.providerEmployeeId ?? employeeId ?? null;
  const missingFields = checkoutRxMissingFields({
    instructions,
    refills,
    refillExpiration,
    acuity,
    discardAfter,
    providerId,
    invoice,
    mailed,
    trackLots: line.trackLots,
    lotId: line.inventoryLotBalanceId,
  });
  const missingBeforeSave = (): string | null => {
    const first = missingFields.find(
      (field) => field !== 'provider' && field !== 'branch' && field !== 'location' && field !== 'lot'
    );
    return first ? checkoutRxMissingMessage(first, refills) : null;
  };
  const highlight = (field: CheckoutRxMissingField) =>
    Boolean(approveTried && missingFields.includes(field));
  const needsSigSave =
    !disabled &&
    (instructions.trim() !== (line.instructions ?? '').trim() ||
      !line.instructionsEnteredByEmployeeId);

  const persistRx = async (opts?: { approve?: boolean }): Promise<boolean> => {
    if (opts?.approve) {
      onApproveTried?.();
      if (missingFields.length) {
        onError(checkoutRxMissingMessage(missingFields[0], refills));
        return false;
      }
    } else {
      const extrasMissing = missingBeforeSave();
      if (extrasMissing) {
        onError(extrasMissing);
        return false;
      }
    }
    if (!canWriteRx) {
      onError('This charge is not linked to a visit order, so the Rx cannot be saved here.');
      return false;
    }
    setSaving(true);
    try {
      const nextInstructions = instructions.trim();
      const saved = await saveOrderPrescription(encounterId!, orderId!, {
        name: rxName,
        strength: strength || undefined,
        instructions: nextInstructions || undefined,
        refill: refillCount,
        refillExpiration:
          refillCount > 0
            ? toRxDatePayload(refillExpiration || recorded?.refillExpiration)
            : undefined,
        startDate: toRxDatePayload(prescribed),
        acuity: acuity as 'acute' | 'chronic',
        employeeId: employeeId ?? undefined,
      });
      onPrescriptionSaved(saved);
      const invoicePatch: Parameters<typeof updateCounterInvoiceLine>[2] = {
        instructions: nextInstructions || null,
        refillCount,
      };
      if (opts?.approve) invoicePatch.rxApproved = true;
      onSaved(await updateCounterInvoiceLine(invoice.id, line.id, invoicePatch));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
      return true;
    } catch (e) {
      onError(apiErrorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const persistSig = async (force = false) => {
    const next = instructions.trim();
    const saved = (line.instructions ?? '').trim();
    if (!force && next === saved && line.instructionsEnteredByEmployeeId) return;
    setSaving(true);
    try {
      onSaved(
        await updateCounterInvoiceLine(invoice.id, line.id, {
          instructions: next || null,
        }),
      );
    } catch (e) {
      onError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const persistExtrasIfReady = async () => {
    if (!canWriteRx || missingBeforeSave()) return;
    await persistRx();
  };

  return (
    <div className="client-fin__line-meta soap-checkout-invoice-rx-match">
      <label className={`client-fin__sig${highlight('instructions') ? ' is-missing' : ''}`}>
        <span className="client-fin__sig-label">
          Directions (sig)
          {needsSigSave ? (
            <button
              type="button"
              className="client-fin__btn"
              disabled={saving}
              title="Save the written directions"
              onClick={() => void persistSig(true)}
            >
              Save sig
            </button>
          ) : line.instructionsEnteredByName ? (
            <span className="client-fin__entered">
              Entered by {line.instructionsEnteredByName}
            </span>
          ) : null}
          {!disabled && !scriptApproved ? (
            <button
              type="button"
              className="client-fin__btn client-fin__btn-approve"
              disabled={saving}
              title="Approve this script"
              onClick={() => {
                void (async () => {
                  const ok = await persistRx({ approve: true });
                  if (ok) onApproved();
                })();
              }}
            >
              Approve
            </button>
          ) : scriptApproved ? (
            <span className="client-fin__entered">
              Approved
              {approvedByName ? ` by ${approvedByName}` : ''}
            </span>
          ) : null}
          {dymoSource ? (
            <SendRxLabelButton
              className="client-fin__dymo"
              disabled={!scriptApproved || saving}
              source={{
                ...dymoSource,
                instructions,
                refill: Number.isFinite(refillCount) ? refillCount : recorded?.refill ?? 0,
                refillExpiration: refillExpiration || recorded?.refillExpiration,
                discardAfter,
                acuity: acuity || recorded?.acuity,
                onSavePrescription: async (value) => {
                  if (!canWriteRx) {
                    const rxNumber = await ensurePrintRxNumber({
                      existingNumber: recorded?.rxNumber,
                      patientId: dymoSource.patientId ?? undefined,
                      name: value.name,
                      inventoryItemId: line.catalogItemId,
                      instructions: value.instructions,
                      refill: value.refill,
                      startDate: value.startDate,
                      refillExpiration: value.refillExpiration,
                      acuity: value.acuity,
                    });
                    return { rxNumber };
                  }
                  const saved = await saveOrderPrescription(encounterId!, orderId!, {
                    name: value.name,
                    strength: value.strength,
                    instructions: value.instructions,
                    refill: value.refill,
                    refillExpiration: toRxDatePayload(
                      value.refillExpiration ||
                        refillExpiration ||
                        recorded?.refillExpiration,
                    ),
                    startDate: toRxDatePayload(value.startDate) || undefined,
                    acuity:
                      value.acuity === 'acute' || value.acuity === 'chronic'
                        ? value.acuity
                        : undefined,
                    employeeId: employeeId ?? undefined,
                  });
                  onPrescriptionSaved(saved);
                  onSaved(
                    await updateCounterInvoiceLine(invoice.id, line.id, {
                      instructions: value.instructions.trim() || null,
                      refillCount: value.refill,
                    }),
                  );
                  if (saved.rxNumber != null) return { rxNumber: saved.rxNumber };
                  const rxNumber = await ensurePrintRxNumber({
                    existingNumber: saved.rxNumber,
                    patientId: dymoSource.patientId ?? undefined,
                    name: value.name,
                    inventoryItemId: line.catalogItemId,
                    instructions: value.instructions,
                    refill: value.refill,
                    startDate: value.startDate,
                    refillExpiration: value.refillExpiration,
                    acuity: value.acuity,
                  });
                  return { rxNumber };
                },
              }}
            />
          ) : null}
        </span>
        <textarea
          value={instructions}
          rows={4}
          disabled={disabled || saving}
          maxLength={directionsMaxLength()}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => void persistSig()}
        />
        <DirectionsLimitHint value={instructions} className="client-fin__sig-limit" />
      </label>
      <div className="client-fin__rx-extras">
        {line.trackLots && !mailed && !hideLotPicker ? (
          <div className={`client-fin__rx-field client-fin__rx-lot${highlight('lot') ? ' is-missing' : ''}`}>
            <StockLotPicker
              practiceId={VISIT_WORKFLOW_PRACTICE_ID}
              inventoryItemId={line.stockInventoryItemId ?? line.catalogItemId ?? null}
              branchId={invoice.inventoryBranchId ?? null}
              locationId={invoice.inventoryLocationId ?? null}
              itemName={line.description}
              disabled={disabled || saving}
              selectedLotId={line.inventoryLotBalanceId ?? null}
              lotNumber={line.lotNumber ?? ''}
              onChange={(pick) => {
                void (async () => {
                  setSaving(true);
                  try {
                    onSaved(
                      await updateCounterInvoiceLine(invoice.id, line.id, {
                        inventoryLotBalanceId: pick.lotId,
                        lotNumber: pick.lotNumber || null,
                      }),
                    );
                  } catch (e) {
                    onError(apiErrorMessage(e));
                  } finally {
                    setSaving(false);
                  }
                })();
              }}
            />
          </div>
        ) : line.trackLots && mailed ? (
          <p className="client-fin__fulfill-note">Lot chosen when filled</p>
        ) : null}
        <label className={`client-fin__rx-field client-fin__refill${highlight('refillCount') ? ' is-missing' : ''}`}>
          <span>
            # refills *
            {patientId != null ? (
              <BookPatientChartButton
                patientId={String(patientId)}
                patientName={patientName?.trim() || 'Patient'}
                practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                practiceTz={PRACTICE_TZ}
                showAlerts
                label="View details"
                className="client-fin__details-link"
                onApplyRefillExpiration={(dateInput) => {
                  if (dateIsTodayOrBefore(dateInput)) {
                    onError('Refill expiration must be after today.');
                    return;
                  }
                  if (refillExpirationExceedsMax(dateInput)) {
                    onError('Refill expiration cannot be more than 1 year from today.');
                    setRefillExpiration(maxRefillExpirationInput());
                    return;
                  }
                  setRefillExpiration(dateInput);
                }}
              />
            ) : null}
          </span>
          <input
            className="client-fin__refill-input"
            inputMode="numeric"
            placeholder="0 if none"
            value={refills}
            disabled={disabled || saving}
            onChange={(e) => {
              const next = e.target.value;
              setRefills(next);
              const n = Number(next);
              if (
                next.trim() !== '' &&
                Number.isFinite(n) &&
                n > 0 &&
                !refillExpiration
              ) {
                setRefillExpiration(
                  toDateInput(line.catalogRefillExpiration) ||
                    maxRefillExpirationInput(),
                );
              }
            }}
            onBlur={() => void persistExtrasIfReady()}
          />
        </label>
        {Number.isFinite(refillCount) && refillCount > 0 ? (
          <label className={`client-fin__rx-field${highlight('refillExpiration') ? ' is-missing' : ''}`}>
            <span>Refill expiration *</span>
            <input
              type="date"
              min={tomorrowInput()}
              max={maxRefillExpirationInput()}
              value={refillExpiration}
              disabled={disabled || saving}
              onChange={(e) => {
                const next = e.target.value;
                if (next && dateIsTodayOrBefore(next)) {
                  onError('Refill expiration must be after today.');
                  return;
                }
                if (refillExpirationExceedsMax(next)) {
                  onError('Refill expiration cannot be more than 1 year from today.');
                  setRefillExpiration(maxRefillExpirationInput());
                  return;
                }
                setRefillExpiration(next);
              }}
              onBlur={() => void persistExtrasIfReady()}
            />
          </label>
        ) : null}
        <label className={`client-fin__rx-field${highlight('acuity') ? ' is-missing' : ''}`}>
          <span>Acute or chronic *</span>
          <select
            className="client-fin__rx-select"
            aria-label="Acute or chronic prescription"
            value={acuity}
            disabled={disabled || saving}
            onChange={(e) => setAcuity(e.target.value as 'acute' | 'chronic' | '')}
          >
            <option value="">Select…</option>
            <option value="acute">Acute</option>
            <option value="chronic">Chronic</option>
          </select>
        </label>
        <label className={`client-fin__rx-field${highlight('discardAfter') ? ' is-missing' : ''}`}>
          <span>Discard after *</span>
          <input
            type="date"
            min={tomorrowInput()}
            value={discardAfter}
            disabled={disabled || saving}
            onChange={(e) => {
              const next = e.target.value;
              if (next && dateIsTodayOrBefore(next)) {
                onError('Discard after must be after today.');
                return;
              }
              setDiscardAfter(next);
            }}
            onBlur={() => void persistExtrasIfReady()}
          />
        </label>
        {!disabled ? (
          <div className="client-fin__rx-save-row">
            <button
              type="button"
              className="client-fin__btn client-fin__btn-save-rx"
              disabled={saving || !canWriteRx}
              title={
                !canWriteRx
                  ? 'Not linked to a visit order'
                  : missingBeforeSave() ?? 'Save refills, expiration, and acute/chronic'
              }
              onClick={() => {
                void persistRx().then((ok) => {
                  if (ok) onSavedAndCollapse?.();
                });
              }}
            >
              {saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save Rx'}
            </button>
            {missingBeforeSave() && canWriteRx ? (
              <span className="client-fin__rx-incomplete">{missingBeforeSave()}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function money(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function overflowingAncestor(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      parent.scrollHeight > parent.clientHeight + 1
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.querySelector<HTMLElement>('.soap-workspace .soap-aside');
}

function scrollAsideToPet(patientId: number): boolean {
  const target = document.getElementById(`soap-invoice-pet-${patientId}`);
  if (!target) return false;
  const container = overflowingAncestor(target);
  if (!container) return false;
  const nextTop =
    container.scrollTop +
    target.getBoundingClientRect().top -
    container.getBoundingClientRect().top;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
  return true;
}

const PREVISIT_DECLINE_NOTE = 'Declined (pre-visit accept):';

function isRoomLoaderPrevisitOrder(order: EncounterOrder): boolean {
  if (order.state === 'proposed') return true;
  return (
    order.state === 'declined' && (order.note ?? '').includes(PREVISIT_DECLINE_NOTE)
  );
}

function lineCharge(line: VisitInvoiceLine): number {
  return line.isCovered ? 0 : Number(line.amount) || 0;
}

/**
 * One invoice, split by pet so a four-pet visit is not a flat list of untitled lines.
 * Unassigned charges (trip fee, etc.) sit under "Whole visit".
 */
function groupCheckoutLinesByPet(
  lines: VisitInvoiceLine[],
  roster: HouseholdRosterEntry[]
): {
  key: string;
  label: string;
  patientId: number | null;
  isCurrent: boolean;
  lines: VisitInvoiceLine[];
}[] {
  if (roster.length <= 1) {
    return [
      {
        key: 'all',
        label: roster[0]?.patientName ?? '',
        patientId: roster[0]?.patientId ?? null,
        isCurrent: true,
        lines,
      },
    ];
  }
  const seen = new Set<string>();
  const sections: {
    key: string;
    label: string;
    patientId: number | null;
    isCurrent: boolean;
    lines: VisitInvoiceLine[];
  }[] = [...roster]
    .sort((a, b) => {
      const byName = a.patientName.localeCompare(b.patientName, undefined, {
        sensitivity: 'base',
      });
      return byName !== 0 ? byName : a.patientId - b.patientId;
    })
    .map((r) => {
    const petLines = lines.filter((l) => l.patientId === r.patientId);
    for (const l of petLines) seen.add(l.id);
    return {
      key: `pet:${r.patientId}`,
      label: r.patientName,
      patientId: r.patientId,
      isCurrent: r.isCurrent,
      lines: petLines,
    };
  });
  const leftover = lines.filter((l) => !seen.has(l.id));
  if (leftover.length > 0) {
    sections.push({
      key: 'visit',
      label: 'Whole visit',
      patientId: null,
      isCurrent: false,
      lines: leftover,
    });
  }
  return sections;
}

/** Compact provider label for tight checkout columns — e.g. "H. Crispell". */
function shortProviderName(
  full?: string | null,
  firstName?: string | null,
  lastName?: string | null,
): string {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first && last) return `${first[0]!.toUpperCase()}. ${last}`;
  const cleaned = (full ?? '')
    .replace(/^(dr|dra|mr|mrs|ms)\.?\s+/i, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  while (
    parts.length > 1 &&
    /^(dvm|vmd|phd|dacv[a-z]*|vm\.?d)\.?$/i.test(parts[parts.length - 1]!)
  ) {
    parts.pop();
  }
  if (parts.length >= 2) {
    const given = parts[0]!;
    const surname = parts[parts.length - 1]!;
    return `${given[0]!.toUpperCase()}. ${surname}`;
  }
  return cleaned || '—';
}

function invoiceMailPaymentStatus(inv: VisitInvoice): 'paid' | 'awaiting_payment' {
  const due = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
  return due <= 0.009 ? 'paid' : 'awaiting_payment';
}

/** Nest returns the useful text in `response.data.message`, not `Error.message`. */
function apiErrorMessage(e: unknown): string {
  const res = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const message = res?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (message) return message;
  return e instanceof Error ? e.message : 'Action failed';
}

/**
 * Tech-run checkout (spec §7). Runs off the invoice and is independent of SOAP
 * completion — the tech can check the client out before the doctor finishes
 * notes, and the doctor can sign the chart before checkout ends.
 *
 * Payment is the invoice's lock: it finalizes and publishes charges to the chart,
 * so there is no separate Finalize step. Checkout never marks the visit completed
 * (that is End Visit on the schedule) and never mutates the visit (spec §2).
 *
 * Tap to Pay starts a Scout Terminal checkout job; the reader app collects.
 * Invoice is marked paid via Stripe webhook (socket `invoice.paid` refreshes UI).
 */
export default function VisitCheckoutPanel({
  encounterId,
  invoice,
  orders = [],
  disabled,
  rxLabel,
  followUpSlot,
  showPayment = true,
  onCheckout,
  paymentBlockedReason = null,
  clientId,
  patientId,
  roster = [],
  practiceId = VISIT_WORKFLOW_PRACTICE_ID,
  onClinicalRecorded,
  onChronicMedicationsMaybeChanged,
  clinicalRefreshSignal = 0,
  remoteRefreshSignal = 0,
  onInvoiceChange,
  onOpenEuthanasiaPrepay,
  onOrderRemoved,
  onOrdersChange,
  onInvoiceShouldRefresh,
  onInventoryItemAdded,
  onInventoryItemRemoved,
  onRoomLoaderOrderIds,
  focusOrderId = null,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCheckoutId, setActiveCheckoutId] = useState<string | null>(null);
  const [readerCatalog, setReaderCatalog] = useState<TerminalReaderCatalog | null>(null);
  // Asked out loud at the door. Starts unchecked if this household said no before.
  const [saveCardConsent, setSaveCardConsent] = useState(true);
  const [cardDeclinedAt, setCardDeclinedAt] = useState<string | null>(null);
  const [prescriptionsByOrderId, setPrescriptionsByOrderId] = useState<
    Record<string, OrderPrescription>
  >({});
  const [vaccineOrderIds, setVaccineOrderIds] = useState<ReadonlySet<string>>(new Set());
  const [vaccinationsByOrderId, setVaccinationsByOrderId] = useState<
    Record<string, OrderVaccination>
  >({});
  const [stockDrawsByOrderId, setStockDrawsByOrderId] = useState<Record<string, StockDraw>>({});
  const [mailOrders, setMailOrders] = useState<MailOrder[]>([]);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [rxApproveTried, setRxApproveTried] = useState<Record<string, true>>({});
  const [drawerLineId, setDrawerLineId] = useState<string | null>(null);
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null);
  useEffect(() => {
    if (expandedLineId) {
      setDrawerLineId(expandedLineId);
      return;
    }
    const close = window.setTimeout(() => setDrawerLineId(null), 240);
    return () => window.clearTimeout(close);
  }, [expandedLineId]);
  useEffect(() => {
    const pending = (invoice?.lines ?? []).find(
      (l) => !l.isDeleted && isCheckoutRxLine(l, null) && !l.rxApprovedAt,
    );
    setExpandedLineId(pending?.id ?? null);
  }, [invoice?.id]);
  useEffect(() => {
    if (!focusOrderId) return;
    const line = (invoice?.lines ?? []).find(
      (l) => !l.isDeleted && l.orderId === focusOrderId,
    );
    if (!line) return;
    setExpandedLineId(line.id);
    setFocusedLineId(line.id);
    const handle = window.setTimeout(() => {
      document.getElementById(`checkout-line-${line.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    const clear = window.setTimeout(() => setFocusedLineId(null), 8000);
    return () => {
      window.clearTimeout(handle);
      window.clearTimeout(clear);
    };
  }, [focusOrderId, invoice?.id]);
  const [editingPriceLineId, setEditingPriceLineId] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [cardOnFile, setCardOnFile] = useState<InvoiceCardOnFile | null>(null);
  /**
   * Pet the next catalog add is billed to. The household shares one invoice, so a tech can
   * charge a housemate from here instead of switching charts; the order is still written on
   * that pet's own encounter, which is what tags the invoice line with the right patient.
   */
  const [chargeToPatientId, setChargeToPatientId] = useState<number | null>(patientId ?? null);
  /** Proposed/declined Room Loader lines for housemates (current chart's orders come from `orders`). */
  const [siblingPendingOrders, setSiblingPendingOrders] = useState<EncounterOrder[]>([]);
  const [previsitBusyId, setPrevisitBusyId] = useState<string | null>(null);
  const [siblingRefreshTick, setSiblingRefreshTick] = useState(0);
  const checkoutRef = useRef<HTMLDivElement>(null);
  /** Accept/decline on the invoice should not yank scroll back to the open chart. */
  const holdInvoiceScrollRef = useRef(false);

  useEffect(() => {
    holdInvoiceScrollRef.current = false;
    setChargeToPatientId(patientId ?? null);
  }, [patientId]);

  const currentPendingOrders = useMemo(
    () => orders.filter((o) => o.state === 'proposed' || o.state === 'declined'),
    [orders]
  );

  const previsitOrders = useMemo(() => {
    const byId = new Map<string, EncounterOrder>();
    for (const o of siblingPendingOrders) byId.set(o.id, o);
    for (const o of currentPendingOrders) byId.set(o.id, o);
    return [...byId.values()].filter(isRoomLoaderPrevisitOrder);
  }, [siblingPendingOrders, currentPendingOrders]);

  const visitDeclinedOrders = useMemo(() => {
    const byId = new Map<string, EncounterOrder>();
    for (const o of siblingPendingOrders) byId.set(o.id, o);
    for (const o of currentPendingOrders) byId.set(o.id, o);
    return [...byId.values()].filter(
      (o) => o.state === 'declined' && !isRoomLoaderPrevisitOrder(o)
    );
  }, [siblingPendingOrders, currentPendingOrders]);

  useEffect(() => {
    if (patientId == null || roster.length <= 1) return;
    if (holdInvoiceScrollRef.current) return;
    let cancelled = false;
    const timers: number[] = [];
    const run = () => {
      if (!cancelled && !holdInvoiceScrollRef.current) scrollAsideToPet(patientId);
    };
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    for (const ms of [50, 180, 400, 800]) {
      timers.push(window.setTimeout(run, ms));
    }
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      for (const id of timers) window.clearTimeout(id);
    };
  }, [patientId, roster.length]);

  const previsitIdsKey = previsitOrders.map((o) => o.id).join(',');

  useEffect(() => {
    if (!previsitIdsKey || !onRoomLoaderOrderIds) return;
    onRoomLoaderOrderIds(previsitIdsKey.split(','));
  }, [previsitIdsKey, onRoomLoaderOrderIds]);

  // Other pets' Room Loader accepts live on their own encounters — load them so the
  // household invoice can show PRE-VISIT ACCEPTS under each blank pet section.
  useEffect(() => {
    const siblings = roster.filter((r) => !r.isCurrent && r.soapEncounterId);
    if (siblings.length === 0) {
      setSiblingPendingOrders([]);
      return;
    }
    let canceled = false;
    void Promise.all(
      siblings.map((r) => listOrders(r.soapEncounterId).catch(() => [] as EncounterOrder[]))
    ).then((results) => {
      if (canceled) return;
      setSiblingPendingOrders(
        results.flat().filter((o) => o.state === 'proposed' || o.state === 'declined')
      );
    });
    return () => {
      canceled = true;
    };
  }, [roster, siblingRefreshTick, invoice?.id, remoteRefreshSignal]);

  const applyPrevisitState = async (
    order: EncounterOrder,
    state: 'accepted' | 'declined'
  ): Promise<void> => {
    if (previsitBusyId || disabled) return;
    holdInvoiceScrollRef.current = true;

    let declineHow: { recordOnChart: boolean; note: string } | null = null;
    if (state === 'declined') {
      declineHow = await appDeclineHow({
        title: 'Decline this item?',
        itemName: order.name,
        message: 'The owner already accepted this on the pre-visit form.',
        placeholder: 'Why aren’t you doing it today?',
        requireReason: true,
      });
      if (!declineHow) return;
    }

    setPrevisitBusyId(order.id);
    setError(null);
    try {
      onRoomLoaderOrderIds?.([order.id]);
      const encId = order.encounterId || encounterId;
      if (!encId) throw new Error('Missing encounter for this order');

      if (declineHow) {
        await updateOrder(encId, order.id, {
          note: declineHow.recordOnChart
            ? `Declined (pre-visit accept): ${declineHow.note.trim()}`
            : offRecordDeclineNote(declineHow.note),
        });
      }

      let updated = await setOrderState(
        encId,
        order.id,
        state,
        state === 'declined' && declineHow && !declineHow.recordOnChart
          ? { recordOnChart: false }
          : undefined
      );

      if (state === 'accepted' && order.catalogItemId != null && order.patientId != null) {
        const snapshot = await fetchCatalogPricingForOrder({
          order: updated,
          patientId: order.patientId,
          practiceId,
          clientId: clientId ?? undefined,
        });
        if (snapshot) {
          const qty = Number(updated.qty) || 1;
          const { unitFinal, isCovered } = getCatalogLinePrice(snapshot, qty);
          const keepExisting =
            unitFinal === 0 && !isCovered && Number(updated.unitPrice) > 0;
          if (
            !keepExisting &&
            (unitFinal !== Number(updated.unitPrice) || isCovered !== updated.isCovered)
          ) {
            updated = await updateOrder(encId, updated.id, {
              unitPrice: unitFinal,
              isCovered,
            });
          }
        }
      }

      const onCurrentChart = !encounterId || order.encounterId === encounterId;
      if (onCurrentChart && onOrdersChange) {
        onOrdersChange(orders.map((o) => (o.id === order.id ? updated : o)));
      } else {
        setSiblingPendingOrders((prev) => {
          if (updated.state === 'accepted') return prev.filter((o) => o.id !== updated.id);
          return prev.map((o) => (o.id === updated.id ? updated : o));
        });
      }
      onInvoiceShouldRefresh?.();
      if (!onCurrentChart) setSiblingRefreshTick((t) => t + 1);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setPrevisitBusyId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetchPrimaryProviders()
      .then((rows) => {
        if (!cancelled) {
          setProviders(
            [...rows]
              .filter((e) => e?.id != null && Number(e.id) > 0)
              .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!invoice?.id) {
      setCardOnFile(null);
      setCardDeclinedAt(null);
      setSaveCardConsent(true);
      return;
    }
    let cancelled = false;
    void getInvoiceCardOnFile(invoice.id)
      .then((lookup) => {
        if (cancelled) return;
        setCardOnFile(lookup.card);
        setCardDeclinedAt(lookup.declinedAt);
        setSaveCardConsent(!lookup.declinedAt);
      })
      .catch(() => {
        if (cancelled) return;
        setCardOnFile(null);
        setCardDeclinedAt(null);
        setSaveCardConsent(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice?.id]);

  useEffect(() => {
    let cancelled = false;
    void listMailOrders(VISIT_WORKFLOW_PRACTICE_ID)
      .then((rows) => {
        if (!cancelled) setMailOrders(rows);
      })
      .catch(() => {
        if (!cancelled) setMailOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice?.id]);

  useEffect(() => {
    if (!invoice?.id) return;
    const invoiceId = invoice.id;
    return subscribeTerminalCheckout({
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      onInvoicePaid: (payload) => {
        if (payload.invoiceId !== invoiceId) return;
        setActiveCheckoutId(null);
        setNote('Payment received on Scout Terminal — invoice marked paid.');
        onInvoiceChange({
          ...invoice,
          status: 'paid',
          amountPaid: invoice.total,
          paidAt: new Date().toISOString(),
          stripePaymentIntentId: payload.paymentIntentId,
          lastChargeStatus: 'succeeded',
        });
      },
    });
    // Re-subscribe when the open invoice id changes, not on every invoice field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const clinicalEncounterIds = useMemo(() => {
    const ids = new Set<string>();
    if (encounterId) ids.add(encounterId);
    for (const row of roster) {
      if (row.soapEncounterId) ids.add(row.soapEncounterId);
    }
    for (const line of invoice?.lines ?? []) {
      if (line.encounterId) ids.add(line.encounterId);
    }
    for (const order of orders) {
      if (order.encounterId) ids.add(order.encounterId);
    }
    return [...ids];
  }, [encounterId, roster, invoice?.lines, orders]);

  // Household invoice: each pet's Rx lives on that pet's encounter. Loading only
  // the open SOAP chart is why Save Rx looked gone after leaving and coming back.
  useEffect(() => {
    if (clinicalEncounterIds.length === 0) return;
    let canceled = false;
    void Promise.all(
      clinicalEncounterIds.map((id) => getOrderClinicalDetails(id).catch(() => null)),
    )
      .then((pages) => {
        if (canceled) return;
        const next: Record<string, OrderPrescription> = {};
        const vaxIds = new Set<string>();
        const shots: Record<string, OrderVaccination> = {};
        const draws: Record<string, StockDraw> = {};
        let any = false;
        for (const details of pages) {
          if (!details) continue;
          any = true;
          for (const rx of details.prescriptions) {
            if (rx.encounterOrderId) next[rx.encounterOrderId] = rx;
          }
          for (const id of details.vaccineOrderIds) vaxIds.add(id);
          for (const shot of details.vaccinations) {
            if (shot.encounterOrderId) shots[shot.encounterOrderId] = shot;
          }
          for (const draw of details.stockDraws) draws[draw.orderId] = draw;
        }
        if (!any) {
          setPrescriptionsByOrderId({});
          setVaccineOrderIds(new Set());
          setVaccinationsByOrderId({});
          setStockDrawsByOrderId({});
          return;
        }
        setPrescriptionsByOrderId(next);
        setVaccineOrderIds(vaxIds);
        setVaccinationsByOrderId(shots);
        setStockDrawsByOrderId(draws);
      });
    return () => {
      canceled = true;
    };
  }, [clinicalEncounterIds.join(','), invoice?.id, clinicalRefreshSignal]);

  // Stamp the visit provider onto production lines that still lack one (SOAP used to leave these blank).
  useEffect(() => {
    if (!invoice?.id || invoice.status !== 'open' || disabled) return;
    const visitProvider = rxLabel?.veterinarianEmployeeId ?? null;
    if (visitProvider == null || visitProvider <= 0) return;
    const missing = (invoice.lines ?? []).filter((l) => {
      if (l.isDeleted) return false;
      if (isInvoiceShippingLine(l)) return false;
      if (l.excludeFromProduction === true) return false;
      return l.providerEmployeeId == null;
    });
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      let next = invoice;
      for (const line of missing) {
        if (cancelled) return;
        try {
          next = await updateCounterInvoiceLine(invoice.id, line.id, {
            providerEmployeeId: visitProvider,
          });
        } catch {
          /* keep going — UI still lets staff pick */
        }
      }
      if (!cancelled && next !== invoice) onInvoiceChange(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.status, rxLabel?.veterinarianEmployeeId, disabled]);

  const selectedReader =
    readerCatalog?.readers.find((r) => r.id === readerCatalog.selectedId) ?? null;
  const readerReady = Boolean(selectedReader?.online);

  // Socket fallback: while a reader job is live, poll until the invoice settles
  // so a dropped `invoice.paid` cannot leave this panel showing an open invoice.
  useEffect(() => {
    if (!activeCheckoutId || !invoice?.id) return;
    const invoiceId = invoice.id;
    let stopped = false;

    const timer = window.setInterval(async () => {
      try {
        const fresh = await getInvoice(invoiceId);
        if (stopped || fresh.status !== 'paid') return;
        setActiveCheckoutId(null);
        setNote('Payment received on Scout Terminal — invoice marked paid.');
        onInvoiceChange(fresh);
      } catch {
        /* keep polling; a transient failure should not end the wait */
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCheckoutId, invoice?.id]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const voidInv = () =>
    run('void', async () => {
      if (!invoice) return;
      const ok = await appConfirm({
        title: 'Void invoice?',
        message:
          'Void this whole invoice? Every charge comes off the bill and no payment can be taken until it is reopened. Nothing has been collected yet.',
        confirmLabel: 'Void',
        danger: true,
      });
      if (!ok) return;
      if (activeCheckoutId) {
        await cancelTerminalCheckout(activeCheckoutId).catch(() => undefined);
        setActiveCheckoutId(null);
      }
      onInvoiceChange(
        await voidInvoice(invoice.id, { reason: 'Voided from visit checkout' }),
      );
      setNote('Invoice voided. Reopen it to take payment.');
    });

  const reopen = () =>
    run('reopen', async () => {
      if (!invoice) return;
      onInvoiceChange(await reopenInvoice(invoice.id));
      setNote('Invoice reopened — charges are editable and payment can be taken.');
    });

  const chargeCardOnFile = () =>
    run('saved', async () => {
      if (!invoice) return;
      onInvoiceChange(await chargeSavedCard(invoice.id));
      setNote('Charged the card on file.');
    });

  const recordTender = (method: VisitTenderMethod) =>
    run(`tender-${method}`, async () => {
      if (!invoice) return;
      const due = Math.max(
        0,
        (Number(invoice.total) || 0) - (Number(invoice.amountPaid) || 0),
      );
      if (due <= 0.009) {
        setNote('Nothing left to collect on this invoice.');
        return;
      }
      let cashReceived: number | null = null;
      let checkNumber: string | null = null;
      if (method === 'cash') {
        const raw = await appPrompt({
          title: 'Cash received',
          message: `Amount due is $${due.toFixed(2)}. Enter cash received (or leave blank for exact).`,
          defaultValue: due.toFixed(2),
        });
        if (raw === null) return;
        const parsed = Number(String(raw).replace(/[^0-9.]/g, ''));
        if (Number.isFinite(parsed) && parsed > 0) cashReceived = parsed;
      }
      if (method === 'check') {
        const raw = await appPrompt({
          title: 'Check number',
          message: `Recording a $${due.toFixed(2)} check. Enter the check number (optional).`,
          defaultValue: '',
        });
        if (raw === null) return;
        checkNumber = String(raw).trim() || null;
      }
      onInvoiceChange(
        await addVisitTender(invoice.id, {
          method,
          amount: due,
          cashReceived,
          checkNumber,
        }),
      );
      setNote(
        method === 'cash'
          ? `Recorded cash payment of $${due.toFixed(2)}.`
          : `Recorded check payment of $${due.toFixed(2)}.`,
      );
    });

  const authorizeCard = () =>
    run('authorize', async () => {
      if (!invoice) return;
      onInvoiceChange(await authorizeSavedCard(invoice.id));
      setNote('Card authorized. Future appointments stay on the books until you convert this to payment.');
    });

  const convertAuthorization = () =>
    run('capture', async () => {
      if (!invoice) return;
      onInvoiceChange(await captureAuthorization(invoice.id));
      setNote('Authorization converted to payment.');
    });

  const tapToPay = () =>
    run('terminal', async () => {
      if (!invoice) return;
      try {
        const session = await startTerminalCheckout(invoice.id, {
          saveCard: saveCardConsent,
        });
        setActiveCheckoutId(session.checkoutId);
        if (session.invoice) onInvoiceChange(session.invoice);
        const dollars = (session.amountCents / 100).toFixed(2);
        const dest = selectedReader?.label ?? 'the selected reader';
        setNote(
          `Sent $${dollars} to ${dest}. Present the card on the reader — this screen updates when payment succeeds.`
        );
      } catch (e) {
        // The reader may have collected while this panel still showed the
        // invoice as open (missed `invoice.paid`). Re-sync instead of erroring.
        if (!/already paid/i.test(apiErrorMessage(e))) throw e;
        setActiveCheckoutId(null);
        onInvoiceChange(await getInvoice(invoice.id));
        setNote('This invoice was already paid on Scout Terminal.');
      }
    });

  const cancelReader = () =>
    run('cancel-terminal', async () => {
      if (!activeCheckoutId) return;
      await cancelTerminalCheckout(activeCheckoutId);
      setActiveCheckoutId(null);
      setNote('Canceled the Terminal checkout job.');
    });

  const status = invoice?.status ?? 'open';
  const isPaid = status === 'paid';
  const isVoid = status === 'void';
  const hasSavedCard = Boolean(cardOnFile || invoice?.savedPaymentMethodId);
  const branchReady =
    invoice?.status !== 'open' ||
    (invoice.inventoryBranchId != null && invoice.inventoryLocationId != null);
  const canEditLines = Boolean(encounterId) && !isPaid && !isVoid && status === 'open';
  const payDisabled =
    disabled || busy != null || !branchReady || Boolean(paymentBlockedReason);

  const chargeToIsCurrent = chargeToPatientId == null || chargeToPatientId === patientId;
  const chargeToEncounterId = chargeToIsCurrent
    ? encounterId ?? undefined
    : roster.find((r) => r.patientId === chargeToPatientId)?.soapEncounterId ??
      encounterId ??
      undefined;

  const activeCheckoutLines = (invoice?.lines ?? []).filter((row) => !row.isDeleted);
  const checkoutTagalongs = attachTagalongLines(activeCheckoutLines);
  const checkoutLineGroups = attachShippingLines(
    [...checkoutTagalongs.parents, ...checkoutTagalongs.leftover],
    (row) => isInvoiceShippingLine(row),
    (row) =>
      String(row.catalogItemType ?? '').toLowerCase() === 'inventory' ||
      isCheckoutRxLine(row, row.orderId != null ? orders.find((o) => o.id === row.orderId) ?? null : null),
    (ship) => {
      if (!invoice) return null;
      for (const order of mailOrders) {
        if (order.status === 'cancelled') continue;
        if (shippingLineFromNotes(order.notes) !== ship.id) continue;
        const m = (order.notes || '').match(/invoiceLine:([0-9a-f-]{36})/i);
        return m?.[1] ?? null;
      }
      return null;
    },
  );

  /**
   * What still has to happen on this line before the visit can be collected on — dose or
   * script recorded, provider attributed, lot picked. Null means ready. Single source of
   * truth for the per-line tick and the Checkout gate, and the text is shown on the row:
   * a line going red with no explanation is indistinguishable from a bug.
   *
   * Note the Rx checks read `recorded` (the saved prescriptions row), never the form
   * inputs — the whole point is to say when what's on screen has not reached the server.
   */
  const lineNotReadyReason = (l: VisitInvoiceLine): string | null => {
    const order = l.orderId != null ? orders.find((o) => o.id === l.orderId) ?? null : null;
    const recorded = l.orderId ? prescriptionsByOrderId[l.orderId] ?? null : null;
    const showRxLabel = Boolean(rxLabel) && isCheckoutRxLine(l, order);
    const instructions =
      recorded?.instructions || l.instructions || l.catalogInstructions || '';
    const isVaccineLine =
      Boolean(l.orderId && vaccineOrderIds.has(l.orderId)) || l.catalogIsVaccine === true;
    const excludesProduction =
      order?.catalogFlags?.excludeFromProduction === true ||
      l.excludeFromProduction === true;
    const needsProvider = !excludesProduction && !isInvoiceShippingLine(l);
    const mailed = invoice ? matchingMailOrderForLine(mailOrders, invoice.id, l) : null;
    const refillN = recorded?.refill ?? l.refillCount ?? 0;

    if (l.orderId && vaccineOrderIds.has(l.orderId)) {
      if (!vaccinationsByOrderId[l.orderId]) return 'Record the dose given';
    } else if (showRxLabel) {
      if (!String(instructions).trim()) return 'Enter the directions (sig)';
      if (!l.rxApprovedAt) return 'Approve the sig';
      if (recorded?.acuity !== 'acute' && recorded?.acuity !== 'chronic') {
        return 'Select acute or chronic, then Save Rx';
      }
      if (refillN > 0 && !recorded?.refillExpiration) {
        return 'Enter the refill expiration, then Save Rx';
      }
    }
    if (needsProvider && l.providerEmployeeId == null) return 'Pick a provider';
    if (l.trackLots && !mailed && !isVaccineLine && l.inventoryLotBalanceId == null) {
      return 'Pick a lot';
    }
    return null;
  };

  const computeLineReady = (l: VisitInvoiceLine): boolean =>
    lineNotReadyReason(l) === null;

  const visibleCheckoutLines = [
    ...checkoutLineGroups.parents,
    ...checkoutLineGroups.leftover,
  ];
  const outstandingLines = visibleCheckoutLines.filter((l) => !computeLineReady(l));

  const shippedMailForLine = (line: VisitInvoiceLine): MailOrder | null => {
    if (!invoice) return null;
    const match = matchingMailOrderForLine(mailOrders, invoice.id, line);
    return match && isMailOrderShipped(match) ? match : null;
  };

  const removeLine = (line: VisitInvoiceLine) => {
    const shipped = shippedMailForLine(line);
    if (shipped) {
      setError(shippedMailMessage(shipped));
      return;
    }
    if (line.tagalongOfLineId) {
      if (!canEditLines || !invoice) return;
      void run(`remove:${line.id}`, async () => {
        onInvoiceChange(await removeCounterInvoiceLine(invoice.id, line.id));
      });
      return;
    }
    if (!canEditLines || !invoice) return;
    void run(`remove:${line.id}`, async () => {
      const shippingIds = await cancelMailOrdersForInvoiceLines(invoice.id, [line]);
      for (const shippingId of shippingIds) {
        if (shippingId === line.id) continue;
        await removeCounterInvoiceLine(invoice.id, shippingId).catch(() => undefined);
      }
      if (line.orderId && encounterId) {
        await deleteOrder(encounterId, line.orderId);
        onOrderRemoved?.(line.orderId);
        return;
      }
      onInvoiceChange(await removeCounterInvoiceLine(invoice.id, line.id));
    });
  };

  const declineLine = (line: VisitInvoiceLine) => {
    if (!line.orderId || !canEditLines) return;
    const orderEncounterId =
      roster.find((r) => r.patientId === line.patientId)?.soapEncounterId ?? encounterId;
    if (!orderEncounterId) return;
    void run(`decline:${line.id}`, async () => {
      const how = await appDeclineHow({
        title: 'Decline this charge?',
        itemName: line.description,
        message: '',
        placeholder: 'Add a note',
      });
      if (!how) return;
      if (invoice) {
        const shippingIds = await cancelMailOrdersForInvoiceLines(invoice.id, [line]);
        for (const shippingId of shippingIds) {
          if (shippingId === line.id) continue;
          await removeCounterInvoiceLine(invoice.id, shippingId).catch(() => undefined);
        }
      }
      const nextNote = how.recordOnChart
        ? how.note.trim() || null
        : offRecordDeclineNote(how.note);
      if (nextNote) {
        await updateOrder(orderEncounterId, line.orderId!, { note: nextNote });
      }
      await setOrderState(
        orderEncounterId,
        line.orderId!,
        'declined',
        how.recordOnChart ? undefined : { recordOnChart: false }
      );
      onOrderRemoved?.(line.orderId!);
      if (onInvoiceShouldRefresh) onInvoiceShouldRefresh();
      else if (invoice?.id) {
        onInvoiceChange(await getInvoice(invoice.id));
      }
    });
  };

  return (
    <div className="soap-checkout" ref={checkoutRef}>
      <div className="soap-checkout-head">
        <Receipt size={16} />
        <span>Checkout</span>
        <span className={`soap-invoice-badge status-${status}`}>{status}</span>
        {invoice?.created ? (
          <span className="soap-checkout-opened">
            Opened{' '}
            {new Date(invoice.created).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        ) : null}
        {invoice?.isEuthanasiaPrepay && (
          <span className="soap-invoice-badge euthanasia">
            {invoice.lastChargeStatus === 'requires_capture' ? 'authorized' : 'euthanasia auth'}
          </span>
        )}
      </div>

      {encounterId && onOrdersChange ? (
        <div className="soap-checkout-add-block">
          {roster.length > 1 ? (
            <label className="soap-checkout-charge-to">
              <select
                className="soap-select"
                value={chargeToPatientId ?? ''}
                disabled={disabled || busy != null}
                onChange={(e) =>
                  setChargeToPatientId(e.target.value ? Number(e.target.value) : null)
                }
                aria-label="Charge to"
              >
                {roster.map((r) => (
                  <option key={r.patientId} value={r.patientId}>
                    {r.patientName}
                  </option>
                ))}
              </select>
              <span>Charge to</span>
            </label>
          ) : null}
          <PlanOrdersSection
            // Remount when the billed pet changes so the search resets to their pricing.
            key={`checkout-add-${chargeToEncounterId ?? encounterId}`}
            className="soap-checkout-add"
            encounterId={chargeToEncounterId ?? encounterId}
            orders={chargeToIsCurrent ? orders : []}
            disabled={disabled}
            patientId={chargeToPatientId ?? undefined}
            clientId={clientId ?? undefined}
            practiceId={practiceId}
            showList={false}
            showSearch={!disabled}
            onChange={(next) => {
              // A housemate's orders belong to their chart, not this one — the shared
              // invoice refresh below is what surfaces the new line here.
              if (chargeToIsCurrent) onOrdersChange(next);
            }}
            onInvoiceShouldRefresh={() => {
              if (onInvoiceShouldRefresh) {
                onInvoiceShouldRefresh();
                return;
              }
              if (!invoice?.id) return;
              void getInvoice(invoice.id)
                .then(onInvoiceChange)
                .catch(() => undefined);
            }}
            onInventoryItemAdded={chargeToIsCurrent ? onInventoryItemAdded : undefined}
            onInventoryItemRemoved={chargeToIsCurrent ? onInventoryItemRemoved : undefined}
          />
        </div>
      ) : null}

      {!invoice && previsitOrders.length === 0 ? (
        <div className="soap-empty">
          No invoice yet — add a charge above to open one.
        </div>
      ) : !invoice ? (
        <div className="soap-invoice-lines">
          {groupCheckoutLinesByPet([], roster).map((section) => {
            const sectionPrevisit =
              section.key === 'visit'
                ? []
                : previsitOrders.filter((o) => {
                    if (section.patientId != null) return o.patientId === section.patientId;
                    return patientId == null || o.patientId === patientId;
                  });
            if (sectionPrevisit.length === 0) return null;
            return (
              <div
                key={section.key}
                id={
                  section.patientId != null
                    ? `soap-invoice-pet-${section.patientId}`
                    : undefined
                }
                className="soap-invoice-pet-block"
              >
                {roster.length > 1 ? (
                  <div className="soap-invoice-pet-head">
                    <span>{section.label}</span>
                    <span>{sectionPrevisit.length} pre-visit</span>
                  </div>
                ) : null}
                <div className="soap-invoice-previsit">
                  <div className="soap-invoice-previsit-banner">Pre-visit accepts</div>
                  <p className="soap-invoice-previsit-hint">
                    Owner already agreed on the pre-visit form. Accept to charge, or decline
                    with a reason if you won&apos;t do it.
                  </p>
                  {sectionPrevisit.map((o) => (
                    <div
                      key={o.id}
                      className={`soap-invoice-previsit-row${
                        o.state === 'declined' ? ' is-declined' : ''
                      }`}
                    >
                      <span className="soap-invoice-previsit-name">
                        {o.name}
                        {Number(o.qty) > 1 ? ` ×${Number(o.qty)}` : ''}
                        {o.state === 'declined' ? (
                          <span className="soap-tag declined">declined</span>
                        ) : null}
                      </span>
                      <span className="soap-invoice-previsit-amt">
                        {o.isCovered
                          ? 'covered'
                          : money(Number(o.qty) * Number(o.unitPrice))}
                      </span>
                      <div className="soap-invoice-previsit-actions">
                        {o.state === 'declined' ? (
                          <button
                            type="button"
                            className="soap-btn small ok"
                            disabled={disabled || previsitBusyId != null}
                            onClick={() => void applyPrevisitState(o, 'accepted')}
                          >
                            <RotateCcw size={12} /> Re-add
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="soap-btn small ok"
                              disabled={disabled || previsitBusyId != null}
                              onClick={() => void applyPrevisitState(o, 'accepted')}
                            >
                              <Check size={12} /> Accept
                            </button>
                            <button
                              type="button"
                              className="soap-btn small danger"
                              disabled={disabled || previsitBusyId != null}
                              onClick={() => void applyPrevisitState(o, 'declined')}
                            >
                              <X size={12} /> Decline
                            </button>
                          </>
                        )}
                      </div>
                      {o.state === 'declined' && o.note?.trim() ? (
                        <div className="soap-invoice-previsit-reason">{o.note.trim()}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <CheckoutInventoryBranchField
            invoice={invoice}
            disabled={disabled || busy != null}
            onInvoiceChange={onInvoiceChange}
            className="soap-checkout-branch"
            selectClassName="soap-select"
            highlightBranch={
              Object.keys(rxApproveTried).length > 0 && invoice.inventoryBranchId == null
            }
            highlightLocation={
              Object.keys(rxApproveTried).length > 0 && invoice.inventoryLocationId == null
            }
          />
          <div className="soap-invoice-lines">
            <div className="soap-invoice-lines-head" aria-hidden>
              <span />
              <span>Item</span>
              <span>Provider</span>
              <span>Qty</span>
              <span>Amt</span>
              <span />
            </div>
            {groupCheckoutLinesByPet(visibleCheckoutLines, roster).map((section) => {
              const sectionPrevisit =
                section.key === 'visit'
                  ? []
                  : previsitOrders.filter((o) => {
                      if (section.patientId != null) return o.patientId === section.patientId;
                      return patientId == null || o.patientId === patientId;
                    });
              const openPrevisit = sectionPrevisit.filter((o) => o.state === 'proposed');
              const declinedPrevisit = sectionPrevisit.filter((o) => o.state === 'declined');
              const sectionVisitDeclined =
                section.key === 'visit'
                  ? []
                  : visitDeclinedOrders.filter((o) => {
                      if (section.patientId != null) return o.patientId === section.patientId;
                      return patientId == null || o.patientId === patientId;
                    });
              const petHeadRight =
                section.lines.length > 0
                  ? money(section.lines.reduce((sum, row) => sum + lineCharge(row), 0))
                  : openPrevisit.length > 0
                    ? `${openPrevisit.length} pre-visit`
                    : declinedPrevisit.length > 0
                      ? 'Declined'
                      : sectionVisitDeclined.length > 0
                        ? money(0)
                        : 'No items';

              return (
              <div
                key={section.key}
                id={
                  section.patientId != null
                    ? `soap-invoice-pet-${section.patientId}`
                    : undefined
                }
                className="soap-invoice-pet-block"
              >
                {roster.length > 1 ? (
                  <button
                    type="button"
                    className={`soap-invoice-pet-head${section.isCurrent ? ' is-current' : ''}${
                      section.patientId != null && section.patientId === chargeToPatientId
                        ? ' is-charging'
                        : ''
                    }`}
                    onClick={() => {
                      if (section.patientId != null) setChargeToPatientId(section.patientId);
                    }}
                    title={
                      section.patientId != null
                        ? `New charges go to ${section.label}`
                        : undefined
                    }
                  >
                    <span>
                      {section.label}
                      {section.isCurrent ? (
                        <span className="soap-scribe-tag">this chart</span>
                      ) : null}
                    </span>
                    <span>{petHeadRight}</span>
                  </button>
                ) : null}
                {sectionPrevisit.length > 0 ? (
                  <div className="soap-invoice-previsit">
                    <div className="soap-invoice-previsit-banner">Pre-visit accepts</div>
                    <p className="soap-invoice-previsit-hint">
                      Owner already agreed on the pre-visit form. Accept to charge, or decline
                      with a reason if you won&apos;t do it.
                    </p>
                    {sectionPrevisit.map((o) => (
                      <div
                        key={o.id}
                        className={`soap-invoice-previsit-row${
                          o.state === 'declined' ? ' is-declined' : ''
                        }`}
                      >
                        <span className="soap-invoice-previsit-name">
                          {o.name}
                          {Number(o.qty) > 1 ? ` ×${Number(o.qty)}` : ''}
                          {o.state === 'declined' ? (
                            <span className="soap-tag declined">declined</span>
                          ) : null}
                        </span>
                        <span className="soap-invoice-previsit-amt">
                          {o.isCovered
                            ? 'covered'
                            : money(Number(o.qty) * Number(o.unitPrice))}
                        </span>
                        <div className="soap-invoice-previsit-actions">
                          {o.state === 'declined' ? (
                            <button
                              type="button"
                              className="soap-btn small ok"
                              disabled={disabled || previsitBusyId != null}
                              onClick={() => void applyPrevisitState(o, 'accepted')}
                            >
                              <RotateCcw size={12} /> Re-add
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="soap-btn small ok"
                                disabled={disabled || previsitBusyId != null}
                                onClick={() => void applyPrevisitState(o, 'accepted')}
                              >
                                <Check size={12} /> Accept
                              </button>
                              <button
                                type="button"
                                className="soap-btn small danger"
                                disabled={disabled || previsitBusyId != null}
                                onClick={() => void applyPrevisitState(o, 'declined')}
                              >
                                <X size={12} /> Decline
                              </button>
                            </>
                          )}
                        </div>
                        {o.state === 'declined' && o.note?.trim() ? (
                          <div className="soap-invoice-previsit-reason">{o.note.trim()}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {section.lines.map((l) => {
                const order =
                  l.orderId != null
                    ? orders.find((o) => o.id === l.orderId) ?? null
                    : null;
                const showClientNote = order?.catalogFlags?.hasClientNotes === true;
                const allowPrice = order?.catalogFlags?.allowPriceChange === true;
                const recorded = l.orderId ? prescriptionsByOrderId[l.orderId] ?? null : null;
                const showRxLabel = Boolean(rxLabel) && isCheckoutRxLine(l, order);
                const instructions =
                  recorded?.instructions || l.instructions || l.catalogInstructions || '';
                const scriptApproved = Boolean(l.rxApprovedAt);
                const providerId = l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId ?? null;
                const attachedShipping = checkoutLineGroups.attached.get(l.id) ?? [];
                const attachedTagalongs = checkoutTagalongs.attached.get(l.id) ?? [];
                const mailed = matchingMailOrderForLine(mailOrders, invoice.id, l);
                const isVaccineLine =
                  Boolean(l.orderId && vaccineOrderIds.has(l.orderId)) ||
                  l.catalogIsVaccine === true;
                const excludesProduction =
                  order?.catalogFlags?.excludeFromProduction === true ||
                  l.excludeFromProduction === true;
                const needsProvider =
                  !excludesProduction && !isInvoiceShippingLine(l);
                const notReadyReason = lineNotReadyReason(l);
                const lineReady = notReadyReason === null;
                const effectiveProviderId =
                  providerId ?? rxLabel?.veterinarianEmployeeId ?? null;
                const needsClinical =
                  isVaccineLine || showRxLabel || order?.kind === 'med';
                const canEditLineMeta =
                  Boolean(order) && Boolean(encounterId) && canEditLines && !l.isCovered;
                const stockDraw = l.orderId ? stockDrawsByOrderId[l.orderId] ?? null : null;
                const stock = linkedStockFromLine(l, stockDraw);
                const canExpand =
                  needsClinical ||
                  showClientNote ||
                  isVaccineLine ||
                  Boolean(l.trackLots && !stock.linked);
                const lineExpanded = expandedLineId === l.id;
                const mailBlockedReason = showRxLabel
                  ? effectiveProviderId == null
                    ? 'Provider is required'
                    : !String(instructions).trim()
                      ? 'Enter the script first'
                      : !scriptApproved
                        ? 'Approve the script first'
                        : invoice.inventoryBranchId == null
                          ? 'Select a branch'
                          : invoice.inventoryLocationId == null
                            ? 'Select a fill location'
                            : null
                  : null;
                return (
                  <Fragment key={l.id}>
                  <div
                    id={`checkout-line-${l.id}`}
                    className={`soap-invoice-line ${lineReady ? 'is-ready' : 'is-pending'}${
                      focusedLineId === l.id ? ' is-focus' : ''
                    }`}
                  >
                    {canExpand ? (
                      <button
                        type="button"
                        className="soap-invoice-line-expand"
                        title={
                          lineExpanded
                            ? 'Collapse'
                            : needsClinical
                              ? 'Enter dose / Rx details'
                              : 'More details'
                        }
                        aria-expanded={lineExpanded}
                        onClick={() =>
                          setExpandedLineId(lineExpanded ? null : l.id)
                        }
                      >
                        {lineExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="soap-invoice-line-expand" aria-hidden />
                    )}
                    <span className="soap-invoice-line-desc">
                      <span className="soap-invoice-line-title">
                        {l.isCovered ? (
                          <span
                            className="soap-invoice-heart"
                            title="Membership covered"
                            aria-label="Membership covered"
                          >
                            ❤️{' '}
                          </span>
                        ) : null}
                        {l.description}
                        {lineReady ? (
                          <Check className="soap-invoice-line-check" size={14} aria-label="All set" />
                        ) : (
                          <>
                            <AlertCircle
                              className="soap-invoice-line-alert"
                              size={14}
                              aria-hidden
                            />
                            <span className="soap-invoice-line-todo">{notReadyReason}</span>
                          </>
                        )}
                      </span>
                    </span>
                    {needsProvider ? (
                      canEditLines ? (
                        <select
                          className={`soap-select soap-checkout-provider-select${
                            rxApproveTried[l.id] && l.providerEmployeeId == null
                              ? ' is-missing'
                              : ''
                          }`}
                          title="Provider"
                          aria-label="Provider"
                          value={l.providerEmployeeId ?? ''}
                          disabled={disabled || busy != null}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const next = e.target.value ? Number(e.target.value) : null;
                            if (next == null || !Number.isFinite(next)) {
                              setError('Provider is required on invoice line items.');
                              return;
                            }
                            void updateCounterInvoiceLine(invoice.id, l.id, {
                              providerEmployeeId: next,
                            })
                              .then(onInvoiceChange)
                              .catch((err) => setError(apiErrorMessage(err)));
                          }}
                        >
                          {l.providerEmployeeId == null ? (
                            <option value="" disabled>
                              Provider…
                            </option>
                          ) : null}
                          {providers.map((emp) => (
                            <option key={String(emp.id)} value={emp.id}>
                              {shortProviderName(emp.name, emp.firstName, emp.lastName)}
                            </option>
                          ))}
                          {l.providerEmployeeId != null &&
                          !providers.some((e) => Number(e.id) === l.providerEmployeeId) ? (
                            <option value={l.providerEmployeeId}>
                              {shortProviderName(
                                rxLabel?.veterinarianEmployeeId === l.providerEmployeeId
                                  ? rxLabel.veterinarianName
                                  : `Provider #${l.providerEmployeeId}`,
                              )}
                            </option>
                          ) : null}
                        </select>
                      ) : (
                        <span className="soap-checkout-provider-ro">
                          {(() => {
                            const emp = providers.find(
                              (e) => Number(e.id) === l.providerEmployeeId,
                            );
                            if (emp) {
                              return shortProviderName(emp.name, emp.firstName, emp.lastName);
                            }
                            if (rxLabel && rxLabel.veterinarianEmployeeId === l.providerEmployeeId) {
                              return shortProviderName(rxLabel.veterinarianName);
                            }
                            return l.providerEmployeeId != null
                              ? `#${l.providerEmployeeId}`
                              : '—';
                          })()}
                        </span>
                      )
                    ) : (
                      <span className="soap-checkout-provider-ro" aria-hidden>
                        —
                      </span>
                    )}
                    {canEditLineMeta && order && encounterId ? (
                      <input
                        className="soap-input soap-checkout-line-qty-input"
                        type="number"
                        min={0.001}
                        step="any"
                        title="Quantity"
                        aria-label="Quantity"
                        key={`qty-${order.id}-${order.qty}`}
                        defaultValue={Number(order.qty) || Number(l.qty) || 1}
                        disabled={disabled || busy != null}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n) || n <= 0) return;
                          if (Math.abs(n - Number(order.qty)) < 0.0001) return;
                          void (async () => {
                            const updated = await updateOrder(encounterId, order.id, {
                              qty: n,
                            });
                            onOrdersChange?.(
                              orders.map((o) => (o.id === order.id ? updated : o))
                            );
                          })();
                        }}
                      />
                    ) : (
                      <span className="soap-checkout-line-qty--ro">
                        {Number(l.qty) || 1}
                      </span>
                    )}
                    <span className="soap-invoice-line-amt">
                      {l.isCovered ? (
                        'covered'
                      ) : (
                        <>
                          {money(l.amount)}
                          {canEditLineMeta && order && allowPrice ? (
                            editingPriceLineId === l.id ? (
                              <input
                                className="soap-input soap-checkout-inline-price"
                                type="number"
                                min={0}
                                step="0.01"
                                autoFocus
                                key={`price-${order.id}-${order.unitPrice}`}
                                defaultValue={Number(order.unitPrice) || 0}
                                disabled={disabled || busy != null}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => {
                                  const n = Number(e.target.value);
                                  setEditingPriceLineId(null);
                                  if (!Number.isFinite(n) || n < 0) return;
                                  if (Math.abs(n - Number(order.unitPrice)) < 0.0001) return;
                                  void (async () => {
                                    const updated = await updateOrder(encounterId!, order.id, {
                                      unitPrice: n,
                                    });
                                    onOrdersChange?.(
                                      orders.map((o) => (o.id === order.id ? updated : o))
                                    );
                                    try {
                                      onInvoiceChange(await getInvoice(invoice.id));
                                    } catch {
                                      /* ignore */
                                    }
                                  })();
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="soap-checkout-price-edit-btn"
                                title="Edit unit price (catalog allows price change)"
                                disabled={disabled || busy != null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPriceLineId(l.id);
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                            )
                          ) : null}
                        </>
                      )}
                    </span>
                    {canEditLines ? (
                      <span className="soap-invoice-line-actions">
                        {l.orderId ? (
                          <button
                            type="button"
                            className="soap-invoice-line-decline"
                            title="Decline — record as declined, no reminder"
                            aria-label={`Decline ${l.description}`}
                            disabled={disabled || busy != null || Boolean(shippedMailForLine(l))}
                            onClick={() => declineLine(l)}
                          >
                            <Ban size={14} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="soap-invoice-line-remove"
                          title={
                            shippedMailForLine(l)
                              ? shippedMailMessage(shippedMailForLine(l))
                              : 'Remove from checkout'
                          }
                          disabled={disabled || busy != null || Boolean(shippedMailForLine(l))}
                          onClick={() => removeLine(l)}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ) : (
                      <span className="soap-invoice-line-remove" aria-hidden />
                    )}

                    {attachedShipping.map((ship) => (
                      <div key={ship.id} className="soap-invoice-line-ship">
                        <span className="soap-invoice-line-expand" aria-hidden />
                        <span className="soap-invoice-line-desc">
                          <span className="soap-invoice-line-ship-name">{ship.description}</span>
                        </span>
                        <span />
                        <span />
                        <span className="soap-invoice-line-amt">
                          <span className="soap-invoice-line-ship-kind">Shipping</span>
                          {ship.isCovered ? 'covered' : money(ship.amount)}
                        </span>
                        <span className="soap-invoice-line-remove" aria-hidden />
                      </div>
                    ))}
                    {attachedTagalongs.map((child) => (
                      <div key={child.id} className="soap-invoice-line-ship soap-invoice-line-tagalong">
                        <span className="soap-invoice-line-expand" aria-hidden />
                        <span className="soap-invoice-line-desc">
                          <span className="soap-invoice-line-ship-name">
                            {child.description}
                            {tagalongTaxHint(child) ? (
                              <span className="settings-muted"> · {tagalongTaxHint(child)}</span>
                            ) : null}
                          </span>
                        </span>
                        <span />
                        <span className="soap-checkout-line-qty--ro">{Number(child.qty) || 1}</span>
                        <span className="soap-invoice-line-amt">
                          {child.isCovered ? 'covered' : money(child.amount)}
                        </span>
                        {canEditLines ? (
                          <button
                            type="button"
                            className="soap-invoice-line-remove"
                            title="Remove tagalong"
                            disabled={disabled || busy != null}
                            onClick={() => removeLine(child)}
                          >
                            <X size={14} />
                          </button>
                        ) : (
                          <span className="soap-invoice-line-remove" aria-hidden />
                        )}
                      </div>
                    ))}

                    {drawerLineId === l.id ? (
                      <div
                        className={`soap-invoice-line-drawer${lineExpanded ? ' is-open' : ''}`}
                      >
                      <div className="soap-invoice-line-drawer-inner">
                      <div className="soap-invoice-line-extra">
                        {showRxLabel && stock.linked && !mailed ? (
                          <LinkedStockInvoiceDetails
                            line={l}
                            stockDraw={stockDraw}
                            practiceId={practiceId ?? VISIT_WORKFLOW_PRACTICE_ID}
                            providerId={l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId}
                            branchId={invoice.inventoryBranchId}
                            locationId={invoice.inventoryLocationId}
                            disabled={disabled || !canEditLines}
                            onSelectLot={(lot) => {
                              void updateCounterInvoiceLine(invoice.id, l.id, {
                                inventoryLotBalanceId: lot?.id ?? null,
                                lotNumber: lot?.lotNumber || null,
                              }).then(onInvoiceChange);
                            }}
                          />
                        ) : null}
                        {showRxLabel ? (
                          <CheckoutInvoiceRxFields
                            line={l}
                            invoice={invoice}
                            encounterId={l.encounterId || order?.encounterId || encounterId}
                            orderId={l.orderId}
                            recorded={recorded}
                            rxName={recorded?.name || order?.name || l.description}
                            strength={recorded?.strength}
                            employeeId={rxLabel?.veterinarianEmployeeId ?? l.providerEmployeeId}
                            disabled={disabled || !canEditLines}
                            scriptApproved={scriptApproved}
                            approveTried={Boolean(rxApproveTried[l.id])}
                            onApproveTried={() =>
                              setRxApproveTried((prev) => ({ ...prev, [l.id]: true }))
                            }
                            approvedByName={
                              l.rxApprovedByName ? shortProviderName(l.rxApprovedByName) : null
                            }
                            mailed={Boolean(mailed)}
                            hideLotPicker={isVaccineLine || stock.linked}
                            patientId={l.patientId ?? invoice.patientId ?? rxLabel?.patientId}
                            patientName={rxLabel?.patientName}
                            dymoSource={
                              rxLabel
                                ? {
                                    patientId: rxLabel.patientId,
                                    patientName: rxLabel.patientName,
                                    species: rxLabel.species,
                                    ownerName: rxLabel.ownerName,
                                    veterinarianName: rxLabel.veterinarianName,
                                    veterinarianLicense: rxLabel.veterinarianLicense,
                                    providerEmployeeId: rxLabel.veterinarianEmployeeId,
                                    quantity: l.qty,
                                    name: recorded?.name || order?.name || l.description,
                                    strength: recorded?.strength,
                                    startDate: recorded?.startDate ?? invoice?.created,
                                    rxNumber: recorded?.rxNumber,
                                  }
                                : null
                            }
                            onSaved={onInvoiceChange}
                            onPrescriptionSaved={(saved) => {
                              if (!l.orderId) return;
                              setPrescriptionsByOrderId((prev) => ({
                                ...prev,
                                [l.orderId!]: saved,
                              }));
                            }}
                            onError={setError}
                            onSavedAndCollapse={() => setExpandedLineId(null)}
                            onApproved={() => {
                              if (
                                l.providerEmployeeId != null ||
                                rxLabel?.veterinarianEmployeeId == null
                              ) {
                                return;
                              }
                              void updateCounterInvoiceLine(invoice.id, l.id, {
                                providerEmployeeId: rxLabel.veterinarianEmployeeId,
                              })
                                .then(onInvoiceChange)
                                .catch((e) => setError(apiErrorMessage(e)));
                            }}
                          />
                        ) : null}
                        {!isVaccineLine ? (
                          <MailInvoiceLineCheckbox
                            invoiceId={invoice.id}
                            line={{
                              ...l,
                              catalogItemId: l.catalogItemId ?? order?.catalogItemId ?? null,
                              catalogItemType:
                                l.catalogItemType ?? order?.catalogItemType ?? null,
                            }}
                            clientId={invoice.clientId}
                            clientName={rxLabel?.ownerName || 'Client'}
                            patientId={l.patientId ?? invoice.patientId ?? rxLabel?.patientId}
                            patientName={rxLabel?.patientName}
                            paymentStatus={invoiceMailPaymentStatus(invoice)}
                            doctorEmployeeId={effectiveProviderId}
                            blockedReason={mailBlockedReason}
                            disabled={disabled || busy != null}
                            onError={setError}
                            onChargeShipping={async (result) => {
                              const next = await addCounterInvoiceLine(invoice.id, {
                                description: result.shippingChargeName,
                                qty: 1,
                                unitPrice: result.shipping,
                                catalogItemId: result.type.catalogItemId ?? null,
                                catalogItemType: result.type.catalogItemType ?? 'procedure',
                                patientId: l.patientId ?? invoice.patientId ?? null,
                                providerEmployeeId: effectiveProviderId,
                                miscCharge: true,
                              });
                              onInvoiceChange(next);
                              const matches = (next.lines ?? []).filter(
                                (row) =>
                                  !row.isDeleted &&
                                  row.description === result.shippingChargeName &&
                                  Math.abs(Number(row.unitPrice) - result.shipping) < 0.009
                              );
                              return matches[matches.length - 1]?.id ?? null;
                            }}
                            onRemoveShipping={async (shippingLineId) => {
                              onInvoiceChange(
                                await removeCounterInvoiceLine(invoice.id, shippingLineId)
                              );
                            }}
                          />
                        ) : null}
                        {showClientNote && order && encounterId && canEditLines ? (
                          <label className="soap-checkout-client-note">
                            Client note
                            <textarea
                              className="soap-input"
                              rows={2}
                              defaultValue={order.clientNote ?? ''}
                              disabled={disabled || busy != null}
                              onBlur={(e) => {
                                const next = e.target.value.trim() || null;
                                if ((order.clientNote ?? null) === next) return;
                                void (async () => {
                                  const updated = await updateOrder(encounterId, order.id, {
                                    clientNote: next,
                                  });
                                  onOrdersChange?.(
                                    orders.map((o) => (o.id === order.id ? updated : o))
                                  );
                                })();
                              }}
                            />
                          </label>
                        ) : null}
                        {isVaccineLine && !(encounterId && order) ? (
                          <div className="soap-invoice-line-clinical">
                            {stock.linked && !mailed ? (
                              <LinkedStockInvoiceDetails
                                line={l}
                                stockDraw={stockDraw}
                                practiceId={practiceId ?? VISIT_WORKFLOW_PRACTICE_ID}
                                providerId={l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId}
                                branchId={invoice.inventoryBranchId}
                                locationId={invoice.inventoryLocationId}
                                disabled={disabled || !canEditLines}
                                onSelectLot={(lot) => {
                                  void updateCounterInvoiceLine(invoice.id, l.id, {
                                    inventoryLotBalanceId: lot?.id ?? null,
                                    lotNumber: lot?.lotNumber || null,
                                  }).then(onInvoiceChange);
                                }}
                              />
                            ) : null}
                            <InvoiceVaccineDoseEditor
                              line={l}
                              disabled={disabled || !canEditLines}
                              hideLotPicker={stock.linked}
                              branchId={invoice.inventoryBranchId}
                              locationId={invoice.inventoryLocationId}
                              recorded={null}
                              onSaved={() => {
                                onClinicalRecorded?.();
                              }}
                              onLotPicked={(pick) => {
                                void updateCounterInvoiceLine(invoice.id, l.id, {
                                  inventoryLotBalanceId: pick.lotId,
                                  lotNumber: pick.lotNumber,
                                }).then(onInvoiceChange);
                              }}
                            />
                          </div>
                        ) : null}
                        {needsClinical && encounterId && order && !showRxLabel ? (
                          <div className="soap-invoice-line-clinical">
                            {stock.linked && !mailed ? (
                              <LinkedStockInvoiceDetails
                                line={l}
                                stockDraw={stockDraw}
                                practiceId={practiceId ?? VISIT_WORKFLOW_PRACTICE_ID}
                                providerId={l.providerEmployeeId ?? rxLabel?.veterinarianEmployeeId}
                                branchId={invoice.inventoryBranchId}
                                locationId={invoice.inventoryLocationId}
                                disabled={disabled || !canEditLines}
                                onSelectLot={(lot) => {
                                  void updateCounterInvoiceLine(invoice.id, l.id, {
                                    inventoryLotBalanceId: lot?.id ?? null,
                                    lotNumber: lot?.lotNumber || null,
                                  }).then(onInvoiceChange);
                                }}
                              />
                            ) : null}
                            <VisitDoseAndRxSection
                              encounterId={encounterId}
                              orders={orders}
                              disabled={disabled}
                              patientId={patientId ?? rxLabel?.patientId ?? undefined}
                              clientId={clientId ?? invoice.clientId ?? undefined}
                              practiceId={practiceId}
                              providerId={rxLabel?.veterinarianEmployeeId}
                              inventoryBranchId={invoice.inventoryBranchId}
                              inventoryLocationId={invoice.inventoryLocationId}
                              patientName={rxLabel?.patientName ?? 'Patient'}
                              patientSpecies={rxLabel?.species}
                              ownerName={rxLabel?.ownerName}
                              providerName={rxLabel?.veterinarianName}
                              providerLicense={rxLabel?.veterinarianLicense}
                              onlyOrderIds={[order.id]}
                              embedded
                              forceOpenOrderId={order.id}
                              invoiceLots={{
                                [order.id]: {
                                  lotId: l.inventoryLotBalanceId ?? null,
                                  lotNumber: l.lotNumber ?? null,
                                },
                              }}
                              onOrderUpdated={(updated) => {
                                onOrdersChange?.(
                                  orders.map((o) => (o.id === updated.id ? updated : o))
                                );
                              }}
                              onInvoiceShouldRefresh={() => {
                                void getInvoice(invoice.id)
                                  .then(onInvoiceChange)
                                  .catch(() => undefined);
                              }}
                              onChronicMedicationsMaybeChanged={onChronicMedicationsMaybeChanged}
                              onClinicalRecorded={onClinicalRecorded}
                            />
                          </div>
                        ) : null}
                      </div>
                      </div>
                      </div>
                    ) : null}
                  </div>
                  </Fragment>
                );
              })}
                {sectionVisitDeclined.map((o) => (
                  <div
                    key={o.id}
                    className={`soap-invoice-line${
                      isOffRecordDeclineNote(o.note) ? ' is-off-record' : ' is-declined'
                    }`}
                  >
                    <span className="soap-invoice-line-expand" aria-hidden />
                    <span className="soap-invoice-line-desc">
                      <span className="soap-invoice-line-title">
                        <span className="soap-invoice-line-name">{o.name}</span>
                        <span
                          className={`soap-tag${
                            isOffRecordDeclineNote(o.note) ? ' off-record' : ' declined'
                          }`}
                        >
                          {isOffRecordDeclineNote(o.note) ? 'Not charted' : 'Declined'}
                        </span>
                      </span>
                    </span>
                    <span className="soap-checkout-provider-ro" aria-hidden>
                      —
                    </span>
                    <span className="soap-checkout-line-qty--ro">{Number(o.qty) || 1}</span>
                    <span className="soap-invoice-line-amt">{money(0)}</span>
                    <button
                      type="button"
                      className="soap-invoice-line-readd"
                      title="Add this declined item back to the invoice"
                      disabled={disabled || previsitBusyId != null}
                      onClick={() => void applyPrevisitState(o, 'accepted')}
                    >
                      <RotateCcw size={12} /> Re-add
                    </button>
                  </div>
                ))}
              </div>
            );
            })}
          </div>

          {Array.isArray(invoice.staffAudit) && invoice.staffAudit.length > 0 ? (
            <details className="soap-checkout-staff-audit">
              <summary>Staff audit · {invoice.staffAudit.length}</summary>
              <ul>
                {invoice.staffAudit.map((row, i) => (
                  <li key={`${row.at}-${i}`}>
                    {(row.at || '').slice(0, 16).replace('T', ' ')}
                    {row.employeeName ? ` · ${row.employeeName}` : ''}
                    {' — '}
                    {row.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="soap-invoice-totals">
            {Number(invoice.membershipAdjustments) !== 0 && (
              <div className="soap-invoice-row covered">
                <span>Membership covered</span>
                <span>{money(invoice.membershipAdjustments)}</span>
              </div>
            )}
            {Number(invoice.subtotal) !== Number(invoice.total) && (
              <div className="soap-invoice-row">
                <span>Subtotal</span>
                <span>{money(invoice.subtotal)}</span>
              </div>
            )}
            {Number(invoice.taxTotal) > 0 && (
              <div className="soap-invoice-row">
                <span>Sales tax</span>
                <span>{money(invoice.taxTotal)}</span>
              </div>
            )}
            <div className="soap-invoice-row total">
              <span>Total</span>
              <span>{money(invoice.total)}</span>
            </div>
            {Number(invoice.amountPaid) > 0 && (
              <div className="soap-invoice-row">
                <span>Paid</span>
                <span>{money(invoice.amountPaid)}</span>
              </div>
            )}
          </div>

          {error && <div className="soap-error">{error}</div>}
          {note && <div className="soap-note-banner">{note}</div>}
          {isVoid && (
            <p className="soap-hint">
              This invoice is voided, so no payment can be taken and charges are locked. Nothing was
              collected. Reopen it to correct the bill and take payment.
            </p>
          )}

          {!showPayment && onCheckout ? (
            <div className="soap-checkout-goto">
              <button
                type="button"
                className="soap-btn"
                disabled={disabled || busy != null || isVoid || outstandingLines.length > 0}
                title={
                  outstandingLines.length > 0
                    ? `Finish ${outstandingLines.length} item${outstandingLines.length === 1 ? '' : 's'} first: ${outstandingLines
                        .map((l) => l.description)
                        .join(', ')}`
                    : 'Take payment and settle the follow-up'
                }
                onClick={onCheckout}
              >
                <Receipt size={14} /> {isPaid ? 'Open checkout' : 'Checkout'}
              </button>
              <p className="soap-hint">
                {outstandingLines.length > 0
                  ? `${outstandingLines.length} item${outstandingLines.length === 1 ? '' : 's'} still need doses, scripts, or a lot picked.`
                  : 'Everything is recorded. Checkout collects for the whole household at once.'}
              </p>
            </div>
          ) : null}

          {showPayment && !isPaid && !isVoid && (
            <EstimateSettlePanel
              appointmentId={invoice?.appointmentId ?? null}
              disabled={disabled || busy != null}
              onSettled={(invoiceId) => {
                void getInvoice(invoiceId).then(onInvoiceChange).catch(() => undefined);
              }}
            />
          )}

          {showPayment && !isPaid && !isVoid && (
            <TerminalReaderPicker
              disabled={disabled || busy != null}
              onCatalog={setReaderCatalog}
            />
          )}

          {showPayment && !isPaid && !isVoid && !invoice?.isEuthanasiaPrepay && !hasSavedCard && (
            <label className="soap-checkout-consent">
              <input
                type="checkbox"
                checked={saveCardConsent}
                disabled={disabled || busy != null}
                onChange={(e) => setSaveCardConsent(e.target.checked)}
              />
              <span>
                {cardDeclinedAt
                  ? `This household said no to keeping a card on file last time${formatDeclineDay(cardDeclinedAt)}. Leave unchecked unless they have changed their mind.`
                  : 'Owner is happy for us to keep this card on file for future visits, refills, and memberships. Ask before you tap — uncheck if they say no.'}
              </span>
            </label>
          )}

          {showPayment ? (
            <>
          <div className="soap-checkout-actions">
            {!isPaid && !isVoid && invoice?.isEuthanasiaPrepay && (
              <>
                <button
                  type="button"
                  className="soap-btn ghost"
                  disabled={disabled || busy != null}
                  onClick={onOpenEuthanasiaPrepay}
                >
                  <ShieldCheck size={14} /> Save card
                </button>
                {invoice.lastChargeStatus === 'requires_capture' ? (
                  <button
                    type="button"
                    className="soap-btn"
                    disabled={payDisabled}
                    onClick={convertAuthorization}
                  >
                    <CreditCard size={14} /> Convert Authorization to Payment
                  </button>
                ) : (
                  <button
                    type="button"
                    className="soap-btn"
                    disabled={payDisabled || !hasSavedCard}
                    title={hasSavedCard ? '' : 'Save a card before authorizing'}
                    onClick={authorizeCard}
                  >
                    <ShieldCheck size={14} /> Authorize card
                  </button>
                )}
              </>
            )}
            {!isPaid && !isVoid && !invoice?.isEuthanasiaPrepay && (
              <>
                <button
                  type="button"
                  className="soap-btn"
                  disabled={payDisabled || !readerReady}
                  title={
                    paymentBlockedReason
                      ? paymentBlockedReason
                      : !branchReady
                      ? 'Choose the branch and location inventory is drawn from'
                      : !selectedReader
                        ? 'Select a reader first'
                        : !readerReady
                          ? 'That reader is offline'
                          : ''
                  }
                  onClick={tapToPay}
                >
                  <Smartphone size={14} /> Tap to Pay
                </button>
                {activeCheckoutId ? (
                  <button
                    type="button"
                    className="soap-btn ghost"
                    disabled={disabled || busy != null}
                    onClick={cancelReader}
                  >
                    Cancel reader
                  </button>
                ) : null}
                <button
                  type="button"
                  className="soap-btn"
                  disabled={payDisabled || !hasSavedCard}
                  title={
                    !branchReady
                      ? 'Choose the branch and location inventory is drawn from'
                      : hasSavedCard
                        ? cardOnFile
                          ? `${(cardOnFile.brand || 'Card').replace(/^./, (c) => c.toUpperCase())} ${cardOnFile.last4 ? `•••• ${cardOnFile.last4}` : 'on file'}`
                          : ''
                        : 'No card saved on file'
                  }
                  onClick={chargeCardOnFile}
                >
                  <CreditCard size={14} /> Card on file
                </button>
                <button
                  type="button"
                  className="soap-btn ghost"
                  disabled={payDisabled}
                  title={!branchReady ? 'Choose the branch and location inventory is drawn from' : ''}
                  onClick={() => recordTender('cash')}
                >
                  <Banknote size={14} /> Cash
                </button>
                <button
                  type="button"
                  className="soap-btn ghost"
                  disabled={payDisabled}
                  title={!branchReady ? 'Choose the branch and location inventory is drawn from' : ''}
                  onClick={() => recordTender('check')}
                >
                  <Receipt size={14} /> Check
                </button>
              </>
            )}
            {!isPaid && !isVoid && status !== 'open' && (
              <button
                type="button"
                className="soap-btn ghost danger"
                disabled={disabled || busy != null}
                title="Cancel this entire bill. Nothing has been collected yet."
                onClick={voidInv}
              >
                Void invoice
              </button>
            )}
            {isVoid && (
              <button
                type="button"
                className="soap-btn"
                disabled={disabled || busy != null}
                title="Back to open so charges can be edited and payment taken"
                onClick={reopen}
              >
                <RotateCcw size={14} /> Reopen invoice
              </button>
            )}
          </div>
          {!isPaid && !isVoid && (
            <p className="soap-hint">
              {selectedReader
                ? `Tap to Pay goes to ${selectedReader.label} until you pick a different reader.`
                : 'Select a reader once — Scout Terminal or a WisePOS. That choice is saved for your account.'}
            </p>
          )}
            </>
          ) : null}
        </>
      )}

      {followUpSlot}

      {showPayment ? (
        <div className="soap-visit-complete">
          <p className="soap-hint">
            Payment locks the invoice and posts these charges to the chart. Ending the visit on the
            schedule and signing the SOAP are separate steps — neither one waits on this.
          </p>
        </div>
      ) : null}
    </div>
  );
}
