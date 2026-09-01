import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Mail, MessageSquare, Plus, Receipt, Sparkles } from 'lucide-react';
import { PimsChartMessageComposeModal } from './PimsChartMessageComposeModal';
import { PimsChartNoteComposeModal } from './PimsChartNoteComposeModal';

type Props = {
  patientId: string;
  patientName: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  onSummarize: () => void;
  onEpiphany: () => void;
  onInvoice: () => void;
  onRecordsChanged?: () => void;
  onTextClient?: () => void;
  onEmailClient?: () => void;
};

export default function PimsChartWorkBar({
  patientId,
  patientName,
  clientId,
  clientName,
  clientPhone,
  onSummarize,
  onEpiphany,
  onInvoice,
  onRecordsChanged,
  onTextClient,
  onEmailClient,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messagePick, setMessagePick] = useState(false);

  const clientIdNum =
    clientId != null && Number.isFinite(Number(clientId)) && Number(clientId) > 0
      ? Number(clientId)
      : null;
  const patientIdNum = Number(patientId);

  return (
    <>
      <div className="pims-chart-work" role="toolbar" aria-label="Chart actions">
        <div className="pims-chart-work__group">
          <span className="pims-chart-work__label">Write</span>
          <button type="button" className="brief-btn" onClick={() => setNoteOpen(true)}>
            <FileText size={15} aria-hidden />
            Medical note
          </button>
          <button
            type="button"
            className="brief-btn"
            disabled={clientIdNum == null}
            title={clientIdNum == null ? 'This pet has no client on file' : 'Text or email the client'}
            onClick={() => {
              if (onTextClient || onEmailClient) setMessagePick(true);
              else setMessageOpen(true);
            }}
          >
            <MessageSquare size={15} aria-hidden />
            Message
          </button>
          <button type="button" className="brief-btn" onClick={onInvoice}>
            <Receipt size={15} aria-hidden />
            Invoice
          </button>
        </div>
        <div className="pims-chart-work__group pims-chart-work__group--end">
          <span className="pims-chart-work__label">Prep</span>
          <button type="button" className="brief-btn primary" onClick={onSummarize}>
            <Sparkles size={15} aria-hidden />
            Summarize
          </button>
          <button type="button" className="brief-btn" onClick={onEpiphany}>
            <Plus size={15} aria-hidden />
            Epiphany
          </button>
        </div>
      </div>

      {noteOpen && Number.isFinite(patientIdNum) ? (
        <PimsChartNoteComposeModal
          patientId={patientIdNum}
          clientId={clientIdNum}
          patientName={patientName}
          onClose={() => setNoteOpen(false)}
          onWrappedUp={() => {
            setNoteOpen(false);
            onRecordsChanged?.();
          }}
        />
      ) : null}

      {messageOpen && clientIdNum != null && Number.isFinite(patientIdNum) ? (
        <PimsChartMessageComposeModal
          patientId={patientIdNum}
          clientId={clientIdNum}
          patientName={patientName}
          clientName={clientName}
          canText={Boolean(clientPhone)}
          onClose={() => setMessageOpen(false)}
          onSent={() => {
            setMessageOpen(false);
            onRecordsChanged?.();
          }}
        />
      ) : null}

      {messagePick && typeof document !== 'undefined'
        ? createPortal(
            <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-chart-msg-pick">
              <button
                type="button"
                className="pims-chart-pick__backdrop"
                aria-label="Close"
                onClick={() => setMessagePick(false)}
              />
              <div className="pims-chart-pick__card">
                <div className="pims-chart-pick__head">
                  <h3 id="pims-chart-msg-pick">Message {clientName}</h3>
                </div>
                <p className="pims-chart-pick__empty">
                  Text history and Gmail both default this pet when you add the message to the EMR.
                </p>
                <div className="pims-chart-pick__foot">
                  <button
                    type="button"
                    className="brief-btn primary"
                    disabled={!onTextClient}
                    onClick={() => {
                      setMessagePick(false);
                      onTextClient?.();
                    }}
                  >
                    <MessageSquare size={14} aria-hidden />
                    Text
                  </button>
                  <button
                    type="button"
                    className="brief-btn"
                    disabled={!onEmailClient}
                    onClick={() => {
                      setMessagePick(false);
                      onEmailClient?.();
                    }}
                  >
                    <Mail size={14} aria-hidden />
                    Email
                  </button>
                  <button type="button" className="brief-btn" onClick={() => setMessagePick(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
