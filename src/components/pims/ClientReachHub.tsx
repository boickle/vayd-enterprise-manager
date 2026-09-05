import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Phone, X } from 'lucide-react';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import type { ClientReachPet, ClientReachPhone } from '../../utils/clientReachContacts';
import { buildPhoneDialHref } from '../../utils/quoContact';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import { ClientEmailHistoryModal } from '../ClientEmailHistoryModal';
import { ClientSmsWorkspaceModal } from './ClientSmsWorkspaceModal';
import './ClientReachHub.css';

export type ClientReachAction =
  | { kind: 'phone-menu'; phone: string; left: number; top: number }
  | { kind: 'call'; phone: string }
  | { kind: 'sms'; phone?: string | null; historyOnly?: boolean }
  | { kind: 'email'; email?: string | null }
  | { kind: 'email-history' };

export function useClientReach() {
  const [action, setAction] = useState<ClientReachAction | null>(null);

  const close = useCallback(() => setAction(null), []);

  const openPhoneMenu = useCallback((phone: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 260;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const top = r.bottom + 6;
    setAction({ kind: 'phone-menu', phone, left, top });
  }, []);

  const openSms = useCallback((phone?: string | null, historyOnly = false) => {
    setAction({ kind: 'sms', phone, historyOnly });
  }, []);

  const openEmail = useCallback((email?: string | null) => {
    setAction({ kind: 'email', email });
  }, []);

  const openCall = useCallback((phone: string) => {
    window.location.href = buildPhoneDialHref(phone);
    setAction({ kind: 'call', phone });
  }, []);

  return { action, setAction, close, openPhoneMenu, openSms, openEmail, openCall };
}

type HostProps = {
  action: ClientReachAction | null;
  onAction: (next: ClientReachAction | null) => void;
  clientId: number;
  clientLabel: string;
  phones: ClientReachPhone[];
  pets: ClientReachPet[];
  defaultPatientIds?: number[];
  doNotSms?: boolean;
  jotPatientId?: string | number | null;
  onRecordsChanged?: () => void;
};

export function ClientReachHost({
  action,
  onAction,
  clientId,
  clientLabel,
  phones,
  pets,
  defaultPatientIds,
  doNotSms,
  jotPatientId,
  onRecordsChanged,
}: HostProps) {
  const [includeInPatientEmr, setIncludeInPatientEmr] = useState((defaultPatientIds ?? []).length > 0);
  const [regardingPatientIds, setRegardingPatientIds] = useState<number[]>(defaultPatientIds ?? []);

  useEffect(() => {
    if (action?.kind !== 'email') return;
    const defaults = defaultPatientIds ?? [];
    setIncludeInPatientEmr(defaults.length > 0);
    setRegardingPatientIds(defaults);
  }, [action?.kind, defaultPatientIds]);

  const close = () => onAction(null);
  const emailOpen = action?.kind === 'email';
  const smsOpen = action?.kind === 'sms';
  const historyOnly = action?.kind === 'sms' ? Boolean(action.historyOnly) : false;
  const smsPhone = action?.kind === 'sms' ? action.phone : null;

  return (
    <>
      {action?.kind === 'phone-menu'
        ? createPortal(
            <div className="client-reach-menu-layer">
              <button type="button" className="client-reach-menu-layer__backdrop" aria-label="Close" onClick={close} />
              <div
                className="client-reach-menu"
                role="menu"
                style={{ left: action.left, top: action.top }}
              >
                <p className="client-reach-menu__num">{action.phone}</p>
                <button type="button" role="menuitem" onClick={() => {
                  window.location.href = buildPhoneDialHref(action.phone);
                  onAction({ kind: 'call', phone: action.phone });
                }}>
                  <Phone size={15} aria-hidden />
                  Call
                </button>
                <button type="button" role="menuitem" onClick={() => onAction({ kind: 'sms', phone: action.phone })}>
                  <MessageSquare size={15} aria-hidden />
                  Text this number
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onAction({ kind: 'sms', historyOnly: true })}
                >
                  <MessageSquare size={15} aria-hidden />
                  View text history
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {action?.kind === 'call'
        ? createPortal(
            <div className="pims-chart-pick client-reach-overlay" role="dialog" aria-modal="true" aria-labelledby="client-reach-call-title">
              <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={close} />
              <div className="pims-chart-pick__card client-reach-call">
                <div className="pims-chart-pick__head">
                  <h3 id="client-reach-call-title">Call {action.phone}</h3>
                  <button type="button" className="pims-chart-pick__close" onClick={close} aria-label="Close">
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <p className="client-reach-call__body">
                  Quo (OpenPhone) places the call. Scout cannot nest a live phone inside this tab —
                  Quo has no in-app widget we can embed.
                </p>
                <p className="client-reach-call__body">
                  After you hang up, call events and transcripts come back through Quo webhooks when
                  they are connected. That is not live transcription here.
                </p>
                <p className="client-reach-call__body">
                  Jot can transcribe while you talk. The transcript is saved with the call and
                  stays off the medical record unless you add it. You still place the call in Quo.
                </p>
                <div className="pims-chart-pick__foot">
                  <a className="brief-btn primary" href={buildPhoneDialHref(action.phone)}>
                    <Phone size={15} aria-hidden />
                    Open Quo call
                  </a>
                  <a
                    className="brief-btn"
                    href={
                      jotPatientId
                        ? `/schedule/jot?new=1&kind=callback&patientId=${encodeURIComponent(String(jotPatientId))}&view=patients`
                        : '/schedule/jot?new=1&kind=callback'
                    }
                  >
                    Start call note in Jot
                  </a>
                  <button type="button" className="brief-btn" onClick={close}>
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ClientSmsWorkspaceModal
        open={smsOpen}
        clientId={clientId}
        clientLabel={clientLabel}
        phones={phones}
        initialPhone={smsPhone}
        historyOnly={historyOnly}
        pets={pets}
        defaultPatientIds={defaultPatientIds}
        doNotSms={doNotSms}
        onClose={close}
        onPostedToEmr={onRecordsChanged}
      />

      <ClientEmailComposeModal
        open={emailOpen}
        clientId={clientId}
        clientLabel={clientLabel}
        initialSubject=""
        initialBodyText=""
        regardingPatients={pets}
        regardingPatientIds={regardingPatientIds}
        onRegardingPatientIdsChange={setRegardingPatientIds}
        patientEmrLogging="opt-in"
        includeInPatientEmr={includeInPatientEmr}
        onIncludeInPatientEmrChange={(next) => {
          setIncludeInPatientEmr(next);
          if (next && regardingPatientIds.length === 0 && (defaultPatientIds ?? []).length) {
            setRegardingPatientIds(defaultPatientIds ?? []);
          }
        }}
        onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
          await recordScoutChartCommunication({
            clientId,
            patientIds: includeInPatientEmr ? regardingPatientIds : [],
            channel: 'email',
            body: bodyHtml || bodyText,
            subject,
            destination: to,
            sentFrom: from,
            includeOnMedicalRecord: includeInPatientEmr,
          });
          onRecordsChanged?.();
        }}
        onOpenEmailHistory={() => onAction({ kind: 'email-history' })}
        onClose={close}
      />

      <ClientEmailHistoryModal
        open={action?.kind === 'email-history'}
        clientId={clientId}
        clientLabel={clientLabel}
        onClose={close}
      />

    </>
  );
}

export function ClientReachLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: (el: HTMLElement) => void;
}) {
  return (
    <button type="button" className="pims-detail__reach-link" onClick={(e) => onClick(e.currentTarget)}>
      {children}
    </button>
  );
}

export function ClientReachEmailLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pims-detail__reach-link" onClick={onClick}>
      {children}
    </button>
  );
}
