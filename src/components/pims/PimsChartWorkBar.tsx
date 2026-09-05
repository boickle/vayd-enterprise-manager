import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  GitMerge,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Sparkles,
  Stethoscope,
  Upload,
} from 'lucide-react';
import { PimsChartMessageComposeModal } from './PimsChartMessageComposeModal';
import { PimsChartNoteComposeModal } from './PimsChartNoteComposeModal';
import PimsChartCallModal from './PimsChartCallModal';
import PimsStartSoapModal from './PimsStartSoapModal';
import BriefMergePanel from '../brief/BriefMergePanel';
import BriefRecordReview from '../brief/BriefRecordReview';

type Props = {
  patientId: string;
  patientName: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  practiceTz: string;
  onSummarize: () => void;
  onStartSoap: (appointmentId: number, patientId: string, clientId: string | null) => void;
  onBookAppointment?: () => void;
  onInvoice: () => void;
  onRecordsChanged?: () => void;
  onTextClient?: () => void;
  onEmailClient?: () => void;
  onOpenCallSession: (sessionId: string) => void;
  onStartCallNote: () => void;
};

export default function PimsChartWorkBar({
  patientId,
  patientName,
  clientId,
  clientName,
  clientPhone,
  practiceTz,
  onSummarize,
  onStartSoap,
  onBookAppointment,
  onInvoice,
  onRecordsChanged,
  onTextClient,
  onEmailClient,
  onOpenCallSession,
  onStartCallNote,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messagePick, setMessagePick] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [soapPickOpen, setSoapPickOpen] = useState(false);

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
          <button
            type="button"
            className="brief-btn"
            disabled={clientIdNum == null && !clientPhone}
            title={
              clientIdNum == null && !clientPhone
                ? 'This pet has no client phone on file'
                : 'Call the client — transcript stays off the EMR unless you add it'
            }
            onClick={() => setCallOpen(true)}
          >
            <Phone size={15} aria-hidden />
            Call
          </button>
          <button type="button" className="brief-btn" onClick={onInvoice}>
            <Receipt size={15} aria-hidden />
            Invoice
          </button>
          <button type="button" className="brief-btn" onClick={() => setUploadOpen(true)}>
            <Upload size={15} aria-hidden />
            Upload File
          </button>
        </div>
        <div className="pims-chart-work__group pims-chart-work__group--end">
          <span className="pims-chart-work__label">Visit</span>
          <button type="button" className="brief-btn primary" onClick={onSummarize}>
            <Sparkles size={15} aria-hidden />
            Summarize
          </button>
          <button type="button" className="brief-btn" onClick={() => setSoapPickOpen(true)}>
            <Stethoscope size={15} aria-hidden />
            Start SOAP
          </button>
        </div>
      </div>

      <PimsStartSoapModal
        open={soapPickOpen}
        onClose={() => setSoapPickOpen(false)}
        patientId={patientId}
        patientName={patientName}
        clientId={clientId}
        practiceTz={practiceTz}
        onOpenSoap={onStartSoap}
        onBookAppointment={onBookAppointment}
      />

      <PimsChartCallModal
        open={callOpen}
        onClose={() => setCallOpen(false)}
        patientId={patientId}
        patientName={patientName}
        clientName={clientName}
        clientPhone={clientPhone}
        practiceTz={practiceTz}
        onOpenCallSession={onOpenCallSession}
        onStartCallNote={onStartCallNote}
      />

      {uploadOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pims-chart-pick"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pims-upload-title"
            >
              <button
                type="button"
                className="pims-chart-pick__backdrop"
                aria-label="Close"
                onClick={() => setUploadOpen(false)}
              />
              <div className="pims-chart-pick__card" style={{ width: 'min(640px, 100%)' }}>
                <div className="pims-chart-pick__head">
                  <h3 id="pims-upload-title">Upload File · {patientName}</h3>
                  <button
                    type="button"
                    className="pims-chart-pick__close"
                    onClick={() => setUploadOpen(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <BriefRecordReview
                  patientId={patientId}
                  patientName={patientName}
                  clientId={clientId}
                  onAccepted={() => {
                    onRecordsChanged?.();
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}

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
                  Messages are saved for your workflow. They are not on the medical record unless
                  you choose to add them.
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

/** Header Merge control — opens absorb-other-patient panel. */
export function PimsPatientMergeButton({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pims-detail__btn-secondary" onClick={() => setOpen(true)}>
        <GitMerge size={14} aria-hidden />
        Merge
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-merge-title">
              <button
                type="button"
                className="pims-chart-pick__backdrop"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
              <div className="pims-chart-pick__card" style={{ width: 'min(520px, 100%)' }}>
                <div className="pims-chart-pick__head">
                  <h3 id="pims-merge-title">Merge into {patientName}</h3>
                  <button
                    type="button"
                    className="pims-chart-pick__close"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <BriefMergePanel keepPatientId={patientId} keepPatientName={patientName} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
