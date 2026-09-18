import { useCallback, useEffect, useState } from 'react';
import {
  formatMemorialItemLine,
  getEuthanasiaConsentStatus,
  parseMemorialItems,
  sendEuthanasiaConsent,
  type EuthanasiaConsentStatus,
} from '../../api/consent';
import { createOrder } from '../../api/visitWorkflow';
import { apiErrorMessage } from '../../api/http';
import { notifyEuthanasiaConsentStatusChanged } from '../../utils/euthanasiaConsentSettings';

export default function EuthanasiaConsentPanel({
  appointmentId,
  patientId,
  clientId,
  encounterId,
  onAddedToPlan,
}: {
  appointmentId: number;
  patientId: number;
  clientId?: number;
  encounterId?: string;
  onAddedToPlan?: () => void;
}) {
  const [status, setStatus] = useState<EuthanasiaConsentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getEuthanasiaConsentStatus(appointmentId, patientId);
    setStatus(next);
    return next;
  }, [appointmentId, patientId]);

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

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendEuthanasiaConsent({
        appointmentId,
        patientId,
        clientId,
      });
      await refresh();
      notifyEuthanasiaConsentStatusChanged();
      await navigator.clipboard.writeText(result.formUrl).catch(() => undefined);
      setCopied(true);
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

  return (
    <div className="soap-checkout" style={{ marginBottom: 14 }}>
      <div className="soap-checkout-head">
        <span>Euthanasia consent</span>
        {status.response ? (
          <span className="soap-invoice-badge">signed</span>
        ) : status.invite ? (
          <span className="soap-invoice-badge">sent</span>
        ) : (
          <span className="soap-invoice-badge">needed</span>
        )}
      </div>
      {error ? <p className="soap-empty">{error}</p> : null}
      {!status.invite && (
        <p className="soap-empty">Send the Scout consent form to the client.</p>
      )}
      {status.invite && !status.response && (
        <p className="soap-empty">
          Sent{status.invite.email ? ` to ${status.invite.email}` : ''}. Waiting for the client
          to sign.
        </p>
      )}
      {status.response && (
        <div style={{ fontSize: 13, lineHeight: 1.45, padding: '0 2px 8px' }}>
          <p>
            <strong>Signed by</strong> {status.response.signedName}
          </p>
          <p>
            <strong>Aftercare</strong> {status.response.aftercareLabel}
          </p>
          {typeof answers.nameplateLine1 === 'string' && answers.nameplateLine1 && (
            <p>
              <strong>Nameplate</strong> {[answers.nameplateLine1, answers.nameplateLine2, answers.nameplateLine3]
                .filter(Boolean)
                .join(' / ')}
            </p>
          )}
          <p>
            <strong>Paw print</strong> {status.response.pawPrintLabel}
          </p>
          {parseMemorialItems(answers.memorialItems).length ? (
            <div>
              <p>
                <strong>MEMORIAL ITEMS PURCHASED</strong>
                {answers.memorialPayment && typeof answers.memorialPayment === 'object'
                  ? ' — already paid'
                  : ''}
              </p>
              {parseMemorialItems(answers.memorialItems).map((item) => (
                <p key={`${item.listingId}-${item.procedureId ?? item.inventoryItemId ?? item.name}`}>
                  {formatMemorialItemLine(item)}
                  {answers.memorialPayment ? ' · already paid' : ''}
                </p>
              ))}
            </div>
          ) : null}
          {answers.clayChargePayment && typeof answers.clayChargePayment === 'object' ? (
            <p>
              <strong>Clay print paid</strong>{' '}
              {typeof (answers.clayChargePayment as { amount?: number }).amount === 'number'
                ? (answers.clayChargePayment as { amount: number }).amount.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  })
                : 'Yes'}
              {typeof (answers.clayChargePayment as { stripePaymentIntentId?: string })
                .stripePaymentIntentId === 'string'
                ? ` · ${(answers.clayChargePayment as { stripePaymentIntentId: string }).stripePaymentIntentId}`
                : ''}
            </p>
          ) : null}
          {typeof answers.vetsToNotify === 'string' && answers.vetsToNotify && (
            <p>
              <strong>Notify</strong> {answers.vetsToNotify}
              {typeof answers.otherVetsToNotify === 'string' && answers.otherVetsToNotify
                ? `; ${answers.otherVetsToNotify}`
                : ''}
            </p>
          )}
          {status.response.signatureDataUrl ? (
            <img
              src={status.response.signatureDataUrl}
              alt="Client signature"
              style={{ maxWidth: '100%', height: 64, objectFit: 'contain' }}
            />
          ) : null}
        </div>
      )}
      <div className="soap-checkout-actions">
        <button type="button" className="soap-btn" disabled={busy} onClick={() => void send()}>
          {status.invite && !status.response ? 'Resend form' : 'Send consent form'}
        </button>
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
