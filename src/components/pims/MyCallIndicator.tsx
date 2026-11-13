import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  listClientCalls,
  markCallReviewOpened,
  resolveCall,
  type ClientCall,
} from '../../api/calls';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import {
  effectiveCallPhase,
  isSummaryOverdue,
  useMyCallStack,
  type StackedCall,
} from '../../hooks/useClientCallActivity';
import CallDock, { type CallDockPeek, type CallDockTone } from './CallDock';
import { CallTranscriptModal, type CallPillPatient } from './ClientCallPill';
import { petsFromClient } from '../../utils/callPets';

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function isIncoming(call: StackedCall): boolean {
  const dir = String(call.call?.direction ?? '').toLowerCase();
  return dir === 'incoming' || dir === 'inbound';
}

function toneFor(call: StackedCall): CallDockTone {
  const phase = effectiveCallPhase(call);
  if (phase === 'transcript_ready') return 'ready';
  if (phase === 'no_record_needed') return 'muted';
  return 'live';
}

function peekLabel(call: StackedCall): string {
  const phase = effectiveCallPhase(call);
  if (call.optimistic || phase === 'ringing') {
    return isIncoming(call) ? 'Incoming' : 'Calling';
  }
  if (phase === 'active') return isIncoming(call) ? 'On inbound' : 'On a call';
  if (phase === 'transcribing') return isSummaryOverdue(call) ? 'Still checking' : 'Summarizing';
  if (phase === 'transcript_ready') return 'Ready to file';
  if (phase === 'no_record_needed') return 'Nothing to file';
  return 'Call';
}

function cardCopy(call: StackedCall): {
  gripLabel: string;
  state: ReactNode;
  note: string;
  tone: CallDockTone;
} {
  const inbound = isIncoming(call);
  const phase = effectiveCallPhase(call);
  const ellipsis = (
    <span className="call-dock__ellipsis" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
  if (call.optimistic || phase === 'ringing') {
    return {
      tone: 'live',
      gripLabel: inbound ? 'Incoming' : 'Calling',
      state: inbound ? <>Incoming{ellipsis}</> : <>Calling{ellipsis}</>,
      note: inbound
        ? 'Quo matched this number to a client. Open their page if you need the chart.'
        : 'This stays with you on every page — Home, booking, anywhere.',
    };
  }
  if (phase === 'active') {
    return {
      tone: 'live',
      gripLabel: inbound ? 'Inbound call' : 'On a call',
      state: (
        <>
          {inbound ? 'On inbound' : 'On the call'} ·{' '}
          <span className="call-dock__timer">{mmss(call.elapsedSeconds)}</span>
        </>
      ),
      note: inbound
        ? 'You answered in Quo. Open the client anytime — the summary will land here when you hang up.'
        : 'Hang up when you are done. The summary follows you around the site.',
    };
  }
  if (phase === 'transcribing' && isSummaryOverdue(call)) {
    // COM-CALL (owner, Nov 10, 2026): never give up on our own; say so and let them Dismiss.
    const noneComing = ['absent', 'failed'].includes(
      String(call.call?.transcriptStatus ?? '').toLowerCase()
    );
    return {
      tone: 'live',
      gripLabel: 'Still checking',
      state: <>Summary taking longer than 3 minutes — still checking</>,
      note: noneComing
        ? 'Quo says it won’t write up this call (it may have been silent). Dismiss when you’re done — that means don’t file.'
        : 'Scout keeps checking Quo for a week. It turns to “Summary ready” when it arrives. Dismiss if there’s nothing to file.',
    };
  }
  if (phase === 'transcribing') {
    return {
      tone: 'live',
      gripLabel: 'Summarizing',
      state: <>Summarizing{ellipsis}</>,
      note: 'Quo is writing up the call. This usually takes a minute or two.',
    };
  }
  if (phase === 'transcript_ready' && call.clientId == null) {
    return {
      tone: 'ready',
      gripLabel: 'No client matched',
      state: <>Summary ready</>,
      note: call.call?.counterpartyPhone?.trim()
        ? 'Quo could not match this number to a client. Add the number to the client’s record (or add the new client) and this call matches within 10 minutes. If it isn’t matched in 7 days, it clears itself.'
        : 'This call had no outside number (staff to staff, or a transfer), so there is no chart to file it to.',
    };
  }
  if (phase === 'transcript_ready') {
    return {
      tone: 'ready',
      gripLabel: 'Ready to file',
      state: <>Summary ready</>,
      note: inbound
        ? 'Inbound call summary. File it, open the client, or skip it.'
        : 'Read it over, then file it to a chart, client-only, or skip it.',
    };
  }
  return {
    tone: 'muted',
    gripLabel: 'Nothing to file',
    state: <>Nothing for the record</>,
    note: call.call?.triageReason?.trim()
        ? `${call.call.triageReason.trim()} — dismiss whenever you like. It clears itself a day after the call unless you open it.`
        : 'Looked like scheduling or billing. Dismiss whenever you like. It clears itself a day after the call unless you open it.',
  };
}

/**
 * Your calls, as a bunch of post-its that follow you around Scout.
 *
 * Outbound dials from a chart and inbound Quo pickups both land here when Quo
 * attributes the call to your employee (openPhoneUserId). More than one waiting
 * summary stacks behind the front card.
 */
export default function MyCallIndicator() {
  const navigate = useNavigate();
  const { calls, more, dismiss, refresh } = useMyCallStack();
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{
    key: string;
    call: ClientCall;
    clientId: number;
    clientName: string | null;
    patientId: number | null;
  } | null>(null);
  const [patientsByClient, setPatientsByClient] = useState<Record<number, CallPillPatient[]>>({});

  const front =
    calls.find((c) => c.key === frontKey) ??
    calls[0] ??
    null;
  const behind = calls.filter((c) => c.key !== front?.key);

  useEffect(() => {
    if (frontKey && !calls.some((c) => c.key === frontKey)) {
      setFrontKey(null);
    }
  }, [calls, frontKey]);

  useEffect(() => {
    const id = reviewing?.clientId;
    if (id == null || patientsByClient[id]) return;
    let cancelled = false;
    void fetchClientByIdStaff(id)
      .then((raw) => {
        if (!cancelled) {
          setPatientsByClient((prev) => ({ ...prev, [id]: petsFromClient(raw) }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reviewing?.clientId, patientsByClient]);

  if (!front) return null;

  const phase = effectiveCallPhase(front);
  const copy = cardCopy(front);
  const hasText = Boolean(front.call?.transcriptText?.trim());
  const canOpenClient = front.clientId != null && Number.isFinite(front.clientId);
  // Filing needs a chart; without a client the only honest choice is to skip it.
  const ready = phase === 'transcript_ready' && hasText && canOpenClient;
  const fileAnyway = phase === 'no_record_needed' && hasText && canOpenClient;
  const canDismiss =
    phase === 'no_record_needed' ||
    phase === 'transcribing' ||
    phase === 'ringing' ||
    front.optimistic ||
    !canOpenClient;
  const peeks: CallDockPeek[] = behind.map((c) => ({
    key: c.key,
    who: c.clientName?.trim() || c.call?.counterpartyPhone?.trim() || 'Unknown caller',
    tone: toneFor(c),
    label: peekLabel(c),
  }));

  const openClient = () => {
    if (front.clientId == null) return;
    navigate(`/schedule/clients?clientId=${encodeURIComponent(String(front.clientId))}`);
  };

  const dismissFront = () => {
    if (front.callId) void resolveCall(front.callId).catch(() => undefined);
    dismiss(front.key);
    if (reviewing?.key === front.key) setReviewing(null);
  };

  const openReview = () => {
    const open = (call: ClientCall, clientId: number) => {
      // An opened call is never auto-cleared as non-clinical (COM-CALL, owner Nov 11, 2026).
      if (call.callId) void markCallReviewOpened(call.callId).catch(() => undefined);
      setReviewing({
        key: front.key,
        call,
        clientId,
        clientName: front.clientName,
        patientId: front.patientId,
      });
    };
    if (front.call?.transcriptText?.trim() && front.clientId != null) {
      open(front.call, front.clientId);
      return;
    }
    if (front.clientId == null) return;
    // Undecided calls come back however old; 240 only bounds decided ones.
    void listClientCalls(front.clientId, { sinceMinutes: 240 })
      .then(({ calls: rows }) => {
        const match =
          rows.find((c) => c.callId === front.callId) ??
          rows.find((c) => c.transcriptText?.trim());
        if (match && front.clientId != null) open(match, front.clientId);
      })
      .catch(() => undefined);
  };

  const whoLabel =
    front.clientName?.trim() ||
    front.call?.counterpartyPhone?.trim() ||
    'Unknown caller';

  return (
    <>
      {/* The dock floats over everything; hide it while its own review popup is open. */}
      {reviewing ? null : (
      <CallDock
        tone={copy.tone}
        gripLabel={copy.gripLabel}
        who={whoLabel}
        state={copy.state}
        note={copy.note}
        primaryLabel={
          ready
            ? 'Review & file'
            : fileAnyway
              ? 'File anyway'
              : canOpenClient && (phase === 'active' || phase === 'ringing')
                ? 'Open client'
                : undefined
        }
        onPrimary={
          ready || fileAnyway
            ? openReview
            : canOpenClient && (phase === 'active' || phase === 'ringing')
              ? openClient
              : undefined
        }
        secondaryLabel={
          canOpenClient &&
          (ready || fileAnyway || phase === 'transcribing' || phase === 'no_record_needed')
            ? 'Open client'
            : undefined
        }
        onSecondary={
          canOpenClient &&
          (ready || fileAnyway || phase === 'transcribing' || phase === 'no_record_needed')
            ? openClient
            : undefined
        }
        dismissLabel={
          canDismiss ? (phase === 'transcript_ready' ? 'Don’t file' : 'Dismiss') : undefined
        }
        behind={peeks}
        stackNote={
          more
            ? 'Showing your 50 newest calls. File or dismiss some to see older ones.'
            : undefined
        }
        onSelectBehind={setFrontKey}
        hidden={reviewing != null}
        urgent={front.optimistic || phase === 'ringing' || phase === 'active'}
        onDismiss={
          // Clinical summaries stay until filed or skipped in the review modal, unless there
          // is no client to file them to.
          canDismiss ? dismissFront : undefined
        }
      />
      )}

      {reviewing ? (
        <CallTranscriptModal
          call={reviewing.call}
          clientId={reviewing.clientId}
          clientName={reviewing.clientName}
          patients={patientsByClient[reviewing.clientId] ?? []}
          defaultPatientId={reviewing.patientId}
          onClose={() => setReviewing(null)}
          onFiled={() => {
            dismiss(reviewing.key);
            setReviewing(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}
