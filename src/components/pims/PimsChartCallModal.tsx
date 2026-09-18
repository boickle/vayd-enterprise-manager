import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Phone, ChevronRight } from 'lucide-react';
import { listLocalBriefsForPatient } from '../../utils/briefStore';
import { formatBriefDateTime } from '../../utils/briefDisplay';
import { buildPhoneDialHref } from '../../utils/quoContact';

type Props = {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  clientName: string;
  clientPhone: string | null;
  practiceTz: string;
  onOpenCallSession: (sessionId: string) => void;
  onStartCallNote: () => void;
};

export default function PimsChartCallModal({
  open,
  onClose,
  patientId,
  patientName,
  clientName,
  clientPhone,
  practiceTz,
  onOpenCallSession,
  onStartCallNote,
}: Props) {
  const [tick, setTick] = useState(0);
  const calls = useMemo(() => {
    void tick;
    return listLocalBriefsForPatient(patientId)
      .filter((s) => s.kind === 'callback' && s.status !== 'archived')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [patientId, tick]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-chart-call-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card">
        <div className="pims-chart-pick__head">
          <h3 id="pims-chart-call-title">
            <Phone size={16} aria-hidden /> Call · {clientName || patientName}
          </h3>
          <button type="button" className="pims-chart-pick__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="pims-chart-pick__empty">
          Place the call in Quo. Jot transcribes while you talk — the transcript is saved with
          the call and is not on the medical record unless you add it.
        </p>

        <div className="pims-chart-pick__foot" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
          {clientPhone ? (
            <a
              className="brief-btn primary"
              href={buildPhoneDialHref(clientPhone)}
              onClick={() => {
                onStartCallNote();
                onClose();
              }}
            >
              <Phone size={14} aria-hidden />
              Call {clientPhone}
            </a>
          ) : (
            <button type="button" className="brief-btn primary" disabled>
              No phone on file
            </button>
          )}
          <button
            type="button"
            className="brief-btn"
            onClick={() => {
              onStartCallNote();
              onClose();
            }}
          >
            Start call note only
          </button>
        </div>

        <p className="pims-chart-work__label" style={{ margin: '4px 0 6px' }}>
          Saved call transcripts
        </p>
        {calls.length === 0 ? (
          <p className="pims-chart-pick__empty">No saved calls for this pet yet.</p>
        ) : (
          <ul className="pims-chart-pick__list">
            {calls.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCallSession(s.id);
                    onClose();
                    setTick((n) => n + 1);
                  }}
                >
                  <strong>{s.title || 'Call'}</strong>
                  <span>
                    {formatBriefDateTime(s.updatedAt, practiceTz)}
                    {s.transcript.trim()
                      ? ` · ${s.transcript.trim().slice(0, 80)}${s.transcript.trim().length > 80 ? '…' : ''}`
                      : ' · no transcript yet'}
                  </span>
                  <ChevronRight size={14} aria-hidden style={{ marginLeft: 'auto' }} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="pims-chart-pick__foot">
          <button type="button" className="brief-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
