import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileSearch } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import {
  convertEstimateToInvoice,
  listClientEstimates,
  type VisitEstimate,
} from '../../api/visitEstimates';
import { estimateHeading, estimateMoney } from './estimateFormat';
import './FindEstimatePanel.css';

type Props = {
  clientId: number;
  /** The open bill this was opened from; the estimate's lines are added to it. */
  invoiceId: string;
  disabled?: boolean;
  /** After an estimate is added, so the bill reloads. */
  onConverted: (invoiceId: string) => void;
};

/**
 * Find estimate (owner, Nov 6, 2026): from a bill, list the household's open estimates (not
 * declined, converted or expired), newest first. Each expands to show its pets, lines and total;
 * Convert adds the whole estimate to this bill at the estimate's prices (Reprice can update them
 * afterwards) and marks it converted. Staff remove any line that wasn't done.
 */
export default function FindEstimatePanel({ clientId, invoiceId, disabled, onConverted }: Props) {
  const [open, setOpen] = useState(false);
  const [estimates, setEstimates] = useState<VisitEstimate[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const converting = useRef(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    setNote(null);
    setEstimates(null);
    try {
      const rows = await listClientEstimates(clientId, { billable: true });
      setEstimates(
        [...rows].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()),
      );
    } catch (e) {
      setError(apiErrorMessage(e));
      setEstimates([]);
    }
  };

  const convert = async (estimate: VisitEstimate) => {
    if (converting.current) return;
    converting.current = true;
    setBusyId(estimate.id);
    setError(null);
    try {
      const invoice = await convertEstimateToInvoice(estimate.id, { invoiceId });
      setEstimates((rows) => (rows ?? []).filter((r) => r.id !== estimate.id));
      setExpanded(null);
      setNote(
        `Added ${estimate.estimateNumber != null ? `estimate #${estimate.estimateNumber}` : 'the estimate'} to this bill. Remove any line that wasn't done.`,
      );
      onConverted(invoice.id);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      converting.current = false;
      setBusyId(null);
    }
  };

  return (
    <div className="find-estimate">
      <button
        type="button"
        className="soap-btn ghost find-estimate__toggle"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => void toggle()}
        title="Add one of this family's open estimates to this bill"
      >
        <FileSearch size={14} /> Find estimate
      </button>
      {open ? (
        <div className="find-estimate__list" role="region" aria-label="Open estimates">
          {estimates == null ? <p className="find-estimate__muted">Loading…</p> : null}
          {estimates && estimates.length === 0 && !error ? (
            <p className="find-estimate__muted">No open estimates for this family.</p>
          ) : null}
          {(estimates ?? []).map((e) => {
            const isOpen = expanded === e.id;
            return (
              <div key={e.id} className="find-estimate__row" data-testid="find-estimate-row">
                <div className="find-estimate__head">
                  <button
                    type="button"
                    className="find-estimate__expand"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{estimateHeading(e)}</span>
                  </button>
                  <span className="find-estimate__total">{estimateMoney(e.total)}</span>
                </div>
                {isOpen ? (
                  <div className="find-estimate__body">
                    <table className="find-estimate__lines">
                      <tbody>
                        {(e.lines ?? []).map((l) => (
                          <tr key={l.id}>
                            <td>{l.patientName ?? ''}</td>
                            <td>{l.description}</td>
                            <td className="find-estimate__num">
                              {Number(l.qty) !== 1 ? `${Number(l.qty)} × ` : ''}
                              {l.isCovered ? 'covered' : estimateMoney(l.unitPrice)}
                            </td>
                            <td className="find-estimate__num">{estimateMoney(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="find-estimate__actions">
                      <span className="find-estimate__muted">
                        Adds every line at the estimate's prices.
                      </span>
                      <button
                        type="button"
                        className="soap-btn"
                        disabled={disabled || busyId != null}
                        onClick={() => void convert(e)}
                      >
                        {busyId === e.id ? 'Adding…' : 'Convert'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {error ? <div className="soap-error">{error}</div> : null}
        </div>
      ) : null}
      {note ? <div className="soap-note-banner">{note}</div> : null}
    </div>
  );
}
