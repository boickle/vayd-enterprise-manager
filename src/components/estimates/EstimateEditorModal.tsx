import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import {
  convertEstimateToInvoice,
  createVisitEstimate,
  getVisitEstimate,
  type VisitEstimate,
} from '../../api/visitEstimates';
import EstimateWorkspace, { type EstimatePet } from './EstimateWorkspace';
import '../soap/EuthanasiaEstimateModal.css';

type Props = {
  estimateId?: string | null;
  clientId: number;
  clientName?: string | null;
  pets: EstimatePet[];
  patientId?: number | null;
  title?: string | null;
  onClose: () => void;
  onSaved?: (estimate: VisitEstimate) => void;
  /** After the quote becomes a bill, so the ledger can open it. */
  onConverted?: (invoiceId: string) => void;
};

/**
 * Household estimate from the client chart. Lines persist as they are added —
 * Save just closes. Unlike the euthanasia modal, pets can be mixed on one quote.
 */
export default function EstimateEditorModal({
  estimateId,
  clientId,
  clientName,
  pets,
  patientId,
  title,
  onClose,
  onSaved,
  onConverted,
}: Props) {
  const [estimate, setEstimate] = useState<VisitEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const defaultPetId = patientId ?? pets[0]?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const boot = estimateId
      ? getVisitEstimate(estimateId)
      : createVisitEstimate({
          clientId,
          patientId: defaultPetId,
          title: title ?? null,
        });
    void boot
      .then((next) => {
        if (!cancelled) setEstimate(next);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [estimateId, clientId, defaultPetId, title]);

  const close = () => {
    if (estimate) onSaved?.(estimate);
    onClose();
  };

  const alreadyConverted = Boolean(estimate?.convertedInvoiceId || estimate?.status === 'converted');
  const canConvert = Boolean(
    estimate &&
      !alreadyConverted &&
      estimate.status !== 'declined' &&
      (estimate.lines?.length ?? 0) > 0 &&
      Number(estimate.total) > 0,
  );

  const convertHint = !estimate
    ? ''
    : alreadyConverted
      ? 'This estimate is already an invoice.'
      : estimate.status === 'declined'
        ? 'A declined estimate cannot be converted.'
        : !(estimate.lines?.length ?? 0)
          ? 'Add at least one charge first.'
          : Number(estimate.total) <= 0
            ? 'Add a charge with a total before converting.'
            : estimate.appointmentId == null
              ? 'This estimate is not attached to a visit yet.'
              : '';

  const convert = async () => {
    if (!estimate) return;
    if (alreadyConverted && estimate.convertedInvoiceId) {
      onConverted?.(estimate.convertedInvoiceId);
      onClose();
      return;
    }
    if (!canConvert) return;
    setConverting(true);
    setError(null);
    try {
      const invoice = await convertEstimateToInvoice(estimate.id);
      onConverted?.(invoice.id);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setConverting(false);
    }
  };

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={close}>
      <div
        className="scheduler-modal euth-estimate-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="soap-modal-head">
          <h3>
            {estimate?.estimateNumber != null
              ? `Estimate #${estimate.estimateNumber}`
              : 'New estimate'}
          </h3>
          <button type="button" className="soap-icon-btn" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <p className="euth-estimate-sub">
          Lines save as you add them. This is a quote, not a bill.
        </p>
        {loading ? (
          <p className="estimate-empty">Loading…</p>
        ) : estimate ? (
          <EstimateWorkspace
            estimate={estimate}
            onChange={setEstimate}
            patientId={patientId ?? estimate.patientId}
            clientId={clientId}
            clientName={clientName}
            pets={pets}
            allowEmail
          />
        ) : null}
        {error && <div className="soap-error">{error}</div>}
        {convertHint && !alreadyConverted ? (
          <p className="euth-estimate-hint">{convertHint}</p>
        ) : null}
        <div className="soap-modal-actions euth-estimate-actions">
          <button type="button" className="soap-btn ghost" onClick={close} disabled={converting}>
            Save estimate
          </button>
          <button
            type="button"
            className="soap-btn"
            disabled={converting || (!alreadyConverted && !canConvert)}
            title={convertHint}
            onClick={() => void convert()}
          >
            {converting
              ? 'Converting…'
              : alreadyConverted
                ? 'Open invoice'
                : 'Convert to invoice'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
