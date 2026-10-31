import { useCallback, useEffect, useState } from 'react';
import {
  getEuthanasiaConsentStatus,
  parseMemorialItems,
  recordEuthanasiaWitnessConsent,
  type EuthanasiaConsentStatus,
} from '../../api/consent';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { createOrder } from '../../api/visitWorkflow';
import { apiErrorMessage } from '../../api/http';
import ConsentAnswersView from '../consent/ConsentAnswersView';
import { parseConsentWeightChange } from '../../utils/consentWeightAlert';
import EuthanasiaEstimateModal from './EuthanasiaEstimateModal';

export default function EuthanasiaConsentPanel({
  appointmentId,
  patientId,
  patientName,
  clientId,
  encounterId,
  onAddedToPlan,
  onWeightAlert,
}: {
  appointmentId: number;
  patientId: number;
  patientName?: string | null;
  clientId?: number;
  encounterId?: string;
  onAddedToPlan?: () => void;
  onWeightAlert?: (change: { previousLbs: number | null; nextLbs: number } | null) => void;
}) {
  const [status, setStatus] = useState<EuthanasiaConsentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [oralPick, setOralPick] = useState(false);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [witnessA, setWitnessA] = useState('');
  const [witnessB, setWitnessB] = useState('');

  const refresh = useCallback(async () => {
    const next = await getEuthanasiaConsentStatus(appointmentId, patientId);
    setStatus(next);
    onWeightAlert?.(parseConsentWeightChange(next.response?.answers ?? null));
    return next;
  }, [appointmentId, onWeightAlert, patientId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh()
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (loading) return null;
  if (!status?.isEuthanasia && !status?.invite) return null;

  /** Sending runs through the estimate modal — the form quotes the total. */
  const send = () => setEstimateOpen(true);

  const openOral = () => {
    setOralPick(true);
    setWitnessA('');
    setWitnessB('');
    setError(null);
    if (staff.length) return;
    void fetchAllEmployees()
      .then((rows) => {
        setStaff(
          rows
            .filter((row) => row.isActive !== false && row.isDeleted !== true)
            .sort((a, b) =>
              `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
            ),
        );
      })
      .catch((err) => setError(apiErrorMessage(err)));
  };

  const recordPrinted = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await recordEuthanasiaWitnessConsent({
        appointmentId,
        patientId,
        method: 'printed',
      });
      setStatus(next);
      setOralPick(false);
      onWeightAlert?.(parseConsentWeightChange(next.response?.answers ?? null));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const recordOral = async () => {
    const first = Number(witnessA);
    const second = Number(witnessB);
    if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
      setError('Choose two staff members who heard this.');
      return;
    }
    if (first === second) {
      setError('Choose two different staff members.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await recordEuthanasiaWitnessConsent({
        appointmentId,
        patientId,
        method: 'oral',
        witnessEmployeeIds: [first, second],
      });
      setStatus(next);
      setOralPick(false);
      onWeightAlert?.(parseConsentWeightChange(next.response?.answers ?? null));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!status?.invite?.formUrl) return;
    await navigator.clipboard.writeText(status.invite.formUrl);
    setCopied(true);
  };

  const addPawPrint = async () => {
    const items =
      status?.response?.selectedCatalogItems?.length
        ? status.response.selectedCatalogItems
        : status?.response?.selectedCatalogItem
          ? [status.response.selectedCatalogItem]
          : [];
    if (!items.length || !encounterId) return;
    const paid =
      status?.response?.answers?.clayChargePayment &&
      typeof status.response.answers.clayChargePayment === 'object'
        ? (status.response.answers.clayChargePayment as {
            amount?: number;
            stripePaymentIntentId?: string;
          })
        : null;
    const memorialPaid =
      status?.response?.answers?.memorialPayment &&
      typeof status.response.answers.memorialPayment === 'object'
        ? (status.response.answers.memorialPayment as {
            amount?: number;
            stripePaymentIntentId?: string;
          })
        : null;
    setBusy(true);
    setError(null);
    try {
      for (const item of items) {
        const alreadyPaidClay = Boolean(paid && /clay/i.test(item.name));
        const alreadyPaidMemorial = Boolean(memorialPaid && !alreadyPaidClay);
        await createOrder(encounterId, {
          name: item.name,
          catalogItemId: item.itemId,
          catalogItemType: item.itemType,
          qty: 1,
          note:
            alreadyPaidClay || alreadyPaidMemorial
              ? `From euthanasia consent — already paid $${Number(
                  (alreadyPaidClay ? paid?.amount : memorialPaid?.amount) ?? 0,
                ).toFixed(2)}${
                  (alreadyPaidClay ? paid?.stripePaymentIntentId : memorialPaid?.stripePaymentIntentId)
                    ? ` (${alreadyPaidClay ? paid?.stripePaymentIntentId : memorialPaid?.stripePaymentIntentId})`
                    : ''
                }`
              : 'From euthanasia consent',
        });
      }
      onAddedToPlan?.();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const answers = status.response?.answers ?? {};
  const witnessMethodOnFile =
    answers.consentMethod === 'printed' || answers.consentMethod === 'oral'
      ? answers.consentMethod
      : null;
  const witnessNames = Array.isArray(answers.witnessNames)
    ? answers.witnessNames.map((name) => String(name)).filter(Boolean)
    : [];

  return (
    <div className="soap-checkout" style={{ marginBottom: 14 }}>
      <div className="soap-checkout-head">
        <span>Euthanasia consent</span>
        {witnessMethodOnFile === 'printed' ? (
          <span className="soap-invoice-badge">printed</span>
        ) : witnessMethodOnFile === 'oral' ? (
          <span className="soap-invoice-badge">oral</span>
        ) : status.response ? (
          <span className="soap-invoice-badge">signed</span>
        ) : status.invite ? (
          <span className="soap-invoice-badge">sent</span>
        ) : (
          <span className="soap-invoice-badge">needed</span>
        )}
      </div>
      {error ? <p className="soap-error">{error}</p> : null}
      {!status.invite && !oralPick && (
        <p className="soap-empty">Send the Scout consent form to the client.</p>
      )}
      {status.invite && !status.response && (
        <p className="soap-empty">
          Sent{status.invite.email ? ` to ${status.invite.email}` : ''}. Waiting for the client
          to sign.
        </p>
      )}
      {witnessMethodOnFile ? (
        <p className="soap-empty">
          {witnessMethodOnFile === 'printed'
            ? 'Signed printed consent.'
            : `Gave oral consent. Heard by ${witnessNames.join(' and ') || 'two staff members'}.`}
        </p>
      ) : status.response ? (
        <div style={{ padding: '0 2px 8px' }}>
          <ConsentAnswersView response={status.response} />
        </div>
      ) : null}
      {oralPick ? (
        <div className="soap-witness-pick">
          <p className="soap-empty" style={{ margin: 0 }}>
            Gave oral consent. Choose two staff members who heard this.
          </p>
          <label>
            First staff member
            <select
              className="soap-input"
              value={witnessA}
              disabled={busy}
              onChange={(e) => setWitnessA(e.target.value)}
            >
              <option value="">Select…</option>
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {[row.firstName, row.lastName].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Second staff member
            <select
              className="soap-input"
              value={witnessB}
              disabled={busy}
              onChange={(e) => setWitnessB(e.target.value)}
            >
              <option value="">Select…</option>
              {staff.map((row) => (
                <option key={row.id} value={row.id} disabled={String(row.id) === witnessA}>
                  {[row.firstName, row.lastName].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {estimateOpen && (
        <EuthanasiaEstimateModal
          appointmentId={appointmentId}
          patientId={patientId}
          patientName={patientName}
          clientId={clientId ?? null}
          isResend={Boolean(status.invite)}
          onClose={() => setEstimateOpen(false)}
          onSent={() => {
            setCopied(true);
            void refresh();
          }}
        />
      )}
      <div className="soap-checkout-actions">
        {oralPick ? (
          <>
            <button
              type="button"
              className="soap-btn"
              disabled={busy || !witnessA || !witnessB || witnessA === witnessB}
              onClick={() => void recordOral()}
            >
              {busy ? 'Saving…' : 'Record consent'}
            </button>
            <button
              type="button"
              className="soap-btn ghost"
              disabled={busy}
              onClick={() => setOralPick(false)}
            >
              Cancel
            </button>
          </>
        ) : !status.response ? (
          <>
            <button type="button" className="soap-btn" disabled={busy} onClick={send}>
              {status.invite && !status.response ? 'Resend form' : 'Send consent form'}
            </button>
            <button
              type="button"
              className="soap-btn ghost"
              disabled={busy}
              onClick={() => void recordPrinted()}
            >
              {busy ? 'Saving…' : 'Signed printed consent'}
            </button>
            <button
              type="button"
              className="soap-btn ghost"
              disabled={busy}
              onClick={openOral}
            >
              Gave oral consent
            </button>
          </>
        ) : witnessMethodOnFile ? null : (
          <button type="button" className="soap-btn" disabled={busy} onClick={send}>
            Send consent form
          </button>
        )}
        {status.invite?.formUrl && !status.response && (
          <button type="button" className="soap-btn ghost" onClick={() => void copyLink()}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        )}
        {(status.response?.selectedCatalogItems?.length ||
          status.response?.selectedCatalogItem) &&
          encounterId && (
          <button type="button" className="soap-btn ghost" disabled={busy} onClick={() => void addPawPrint()}>
            Add selected items to plan
            {answers.clayChargePayment || answers.memorialPayment ? ' (already paid)' : ''}
          </button>
        )}
      </div>
    </div>
  );
}
