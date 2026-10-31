// View completed Room Loader PDF from scheduler context menu (stays on calendar)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Appointment, RoomLoader } from '../api/roomLoader';
import { http } from '../api/http';
import { RoomLoaderPdfCanvas } from '../components/RoomLoaderPdfCanvas';
import {
  preferRoomLoaderPreApptStatus,
  resolveRoomLoaderPreApptUiStatus,
  type RoomLoaderPreApptUiStatus,
} from '../utils/roomLoaderPreApptDisplay';
import { findRoomLoaderForAppointment } from '../utils/schedulerRoomLoaderResolve';
import './Scheduler.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientsLabel(appt: Appointment): string {
  const multi = (appt as { patients?: { name?: string | null }[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    return multi.map((p) => pickStr(p.name) ?? '—').join(', ');
  }
  return pickStr(appt.patient?.name) ?? '—';
}

type Props = {
  appt: Appointment;
  practiceTz: string;
  accentColor: string;
  allAppointments?: Appointment[];
  onClose: () => void;
  /** When the form is not completed yet, open full Room Loader details on the schedule */
  onOpenDetails: (roomLoaderId: number) => void;
};

export function SchedulerRoomLoaderPdfModal({
  appt,
  practiceTz,
  accentColor,
  allAppointments,
  onClose,
  onOpenDetails,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomLoader, setRoomLoader] = useState<RoomLoader | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const pdfUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setPdfUrl(null);
    try {
      const match = await findRoomLoaderForAppointment(appt, practiceTz, allAppointments);
      setRoomLoader(match);
      if (match?.sentStatus === 'completed' && match.id) {
        try {
          const res = await http.get(`/room-loader/${match.id}/pdf`, { responseType: 'blob' });
          const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
          const url = URL.createObjectURL(blob);
          pdfUrlRef.current = url;
          setPdfUrl(url);
        } catch {
          setError('Could not load Room Loader PDF.');
        }
      }
    } catch (e: unknown) {
      const ax = e as { message?: string };
      setError(ax?.message ?? 'Could not load Room Loader.');
      setRoomLoader(null);
    } finally {
      setLoading(false);
    }
  }, [appt, practiceTz, allAppointments]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    },
    []
  );

  const clientName = useMemo(() => {
    const c = appt.client;
    if (!c) return '—';
    const fn = pickStr(c.firstName);
    const ln = pickStr(c.lastName);
    return [fn, ln].filter(Boolean).join(' ').trim() || '—';
  }, [appt.client]);

  const showPdf = Boolean(pdfUrl);

  const handleDownloadPdf = async () => {
    const id = roomLoader?.id;
    if (!id) return;
    setDownloadingPdf(true);
    try {
      const res = await http.get(`/room-loader/${id}/pdf`, { responseType: 'blob' });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `room-loader-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setError(
        ax?.response?.data?.message ?? ax?.message ?? 'Failed to download PDF. Please try again.'
      );
    } finally {
      setDownloadingPdf(false);
    }
  };

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`scheduler-modal scheduler-modal--edit${showPdf ? ' scheduler-modal--room-loader-pdf' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-rl-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Room Loader</p>
            <h2 id="scheduler-rl-modal-title">View Room Loader</h2>
            <p className="scheduler-modal-subtitle">
              {clientName}
              <span className="scheduler-modal-subtitle-sep">·</span>
              {patientsLabel(appt)}
            </p>
          </div>
          <button
            type="button"
            className="scheduler-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div
          className={
            showPdf
              ? 'scheduler-modal-body scheduler-modal-body--room-loader-pdf'
              : 'scheduler-modal-body scheduler-modal-body--edit'
          }
        >
          {error ? <p className="scheduler-edit-error">{error}</p> : null}
          {loading ? (
            <p className="scheduler-modal-muted">Loading…</p>
          ) : showPdf ? (
            <RoomLoaderPdfCanvas url={pdfUrl!} className="scheduler-room-loader-pdf-canvas" />
          ) : (
            <p className="scheduler-modal-muted">
              {roomLoader
                ? `Room Loader #${roomLoader.id} · status: ${roomLoader.sentStatus}`
                : 'No Room Loader exists yet for this visit.'}
              {roomLoader?.sentStatus !== 'completed'
                ? ' The client has not submitted the form yet — use Re-send Room Loader from the menu when ready.'
                : null}
            </p>
          )}
        </div>

        <div className="scheduler-edit-footer">
          <button
            type="button"
            className="btn secondary"
            disabled={downloadingPdf}
            onClick={onClose}
          >
            Close
          </button>
          {roomLoader?.sentStatus === 'completed' && roomLoader.id ? (
            <button
              type="button"
              className="btn"
              disabled={downloadingPdf || loading}
              onClick={() => void handleDownloadPdf()}
            >
              {downloadingPdf ? 'Downloading…' : 'Download PDF'}
            </button>
          ) : roomLoader?.id ? (
            <button type="button" className="btn" onClick={() => onOpenDetails(roomLoader.id!)}>
              Open Room Loader
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function roomLoaderMenuUiStatus(
  confirmStatusName: string | null | undefined,
  sentStatus?: string | null,
  scoutUiStatus?: RoomLoaderPreApptUiStatus | null
): RoomLoaderPreApptUiStatus {
  const fromConfirmAndSent = resolveRoomLoaderPreApptUiStatus(confirmStatusName, sentStatus);
  if (!scoutUiStatus || scoutUiStatus === 'none') return fromConfirmAndSent;
  return preferRoomLoaderPreApptStatus(fromConfirmAndSent, scoutUiStatus);
}

/** Label for context menu from appointment confirm status (+ optional Scout sentStatus). */
export function schedulerRoomLoaderMenuLabel(
  confirmStatusName: string | null | undefined,
  sentStatus?: string | null,
  scoutUiStatus?: RoomLoaderPreApptUiStatus | null
): string {
  const st = roomLoaderMenuUiStatus(confirmStatusName, sentStatus, scoutUiStatus);
  if (st === 'complete') return 'View Room Loader';
  if (st === 'sent') return 'Re-send Room Loader';
  return 'Send Room Loader';
}

export function schedulerRoomLoaderMenuMode(
  confirmStatusName: string | null | undefined,
  sentStatus?: string | null,
  scoutUiStatus?: RoomLoaderPreApptUiStatus | null
): 'send' | 'resend' | 'view' {
  const st = roomLoaderMenuUiStatus(confirmStatusName, sentStatus, scoutUiStatus);
  if (st === 'complete') return 'view';
  if (st === 'sent') return 'resend';
  return 'send';
}
