import { useEffect, useState } from 'react';
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
import { recordScoutChartCommunication } from '../../api/scoutChart';
import { PimsChartMessageComposeModal } from './PimsChartMessageComposeModal';
import { PimsChartNoteComposeModal } from './PimsChartNoteComposeModal';
import PimsChartCallModal from './PimsChartCallModal';
import PimsStartSoapModal from './PimsStartSoapModal';
import BriefMergePanel from '../brief/BriefMergePanel';
import BriefRecordReview from '../brief/BriefRecordReview';
import type { OutsideRecordAcceptResult } from '../../utils/briefRecordStore';

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
  onRecordsChanged?: (result?: OutsideRecordAcceptResult) => void;
  onTextClient?: () => void;
  onEmailClient?: () => void;
  onOpenCallSession: (sessionId: string) => void;
  onStartCallNote: () => void;
  launchNote?: boolean;
  launchCommunicate?: boolean;
  onLaunchConsumed?: () => void;
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
  launchNote = false,
  launchCommunicate = false,
  onLaunchConsumed,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messagePick, setMessagePick] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [soapPickOpen, setSoapPickOpen] = useState(false);

  useEffect(() => {
    if (!launchNote && !launchCommunicate) return;
    if (launchNote) setNoteOpen(true);
    if (launchCommunicate) setMessagePick(true);
    onLaunchConsumed?.();
    // Only react to the launch flags from the schedule menu, not a new callback each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchNote, launchCommunicate]);

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
            title={clientIdNum == null ? 'This pet has no client on file' : 'Text, email, call, or log a communication'}
            onClick={() => setMessagePick(true)}
          >
            <MessageSquare size={15} aria-hidden />
            Communicate
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
                  hideHeading
                  onAccepted={(result) => {
                    setUploadOpen(false);
                    onRecordsChanged?.(result);
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
                  <h3 id="pims-chart-msg-pick">Communicate {clientName}</h3>
                </div>
                <p className="pims-chart-pick__empty">
                  Text and email stay in your workflow unless you add them to the record. Call
                  starts a phone session. Log saves a communication on the chart.
                </p>
                <div className="pims-chart-pick__foot">
                  <button
                    type="button"
                    className="brief-btn primary"
                    disabled={!onTextClient}
                    onClick={() => {
                      setMessagePick(false);
                      if (onTextClient) onTextClient();
                      else setMessageOpen(true);
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
                      if (onEmailClient) onEmailClient();
                      else setMessageOpen(true);
                    }}
                  >
                    <Mail size={14} aria-hidden />
                    Email
                  </button>
                  <button
                    type="button"
                    className="brief-btn"
                    disabled={clientIdNum == null && !clientPhone}
                    onClick={() => {
                      setMessagePick(false);
                      setCallOpen(true);
                    }}
                  >
                    <Phone size={14} aria-hidden />
                    Call
                  </button>
                  <button
                    type="button"
                    className="brief-btn"
                    disabled={clientIdNum == null}
                    onClick={() => {
                      setMessagePick(false);
                      setLogOpen(true);
                    }}
                  >
                    <FileText size={14} aria-hidden />
                    Log
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

      {logOpen && clientIdNum != null && Number.isFinite(patientIdNum)
        ? createPortal(
            <PimsChartCommunicationLogModal
              patientId={patientIdNum}
              clientId={clientIdNum}
              clientName={clientName}
              onClose={() => setLogOpen(false)}
              onSaved={() => {
                setLogOpen(false);
                onRecordsChanged?.();
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function PimsChartCommunicationLogModal({
  patientId,
  clientId,
  clientName,
  onClose,
  onSaved,
}: {
  patientId: number;
  clientId: number;
  clientName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const text = body.trim();
    if (!text) {
      setError('Write the communication before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordScoutChartCommunication({
        patientId,
        clientId,
        channel: 'log',
        body: text,
        typeLabel: 'Communication log',
        includeOnMedicalRecord: true,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that communication.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-chart-log">
      <button
        type="button"
        className="pims-chart-pick__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="pims-chart-pick__card" style={{ width: 'min(520px, 100%)' }}>
        <div className="pims-chart-pick__head">
          <h3 id="pims-chart-log">Communications</h3>
          <button type="button" className="pims-chart-pick__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="pims-chart-pick__empty">
          Save a communication for {clientName}. This is added to the chart.
        </p>
        <textarea
          className="pims-chart-log__area"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the communication…"
        />
        {error ? <p className="pims-chart-pick__empty">{error}</p> : null}
        <div className="pims-chart-pick__foot">
          <button type="button" className="brief-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="brief-btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
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
