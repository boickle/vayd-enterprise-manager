/**
 * Live co-editing for one visit: Socket.IO namespace `/visit`, room per appointment.
 *
 * A doctor in the SOAP and a tech on the invoice are expected to be in the same
 * household at the same time. Nothing here locks anything — events are nudges to
 * refetch, and presence is advisory so each side can see where the other is typing.
 */
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, getToken } from '../api/http';

export type VisitChangePayload = {
  practiceId: number;
  appointmentId: number;
  scope: 'invoice' | 'orders' | 'encounter';
  invoiceId?: string | null;
  encounterId?: string | null;
  fields?: string[];
  byEmployeeId?: number | null;
  byName?: string | null;
  at: string;
};

export type VisitPeer = {
  socketId: string;
  userId: number;
  employeeId: number | null;
  name: string | null;
  encounterId: string | null;
  /** SOAP field they have focused right now, or null. */
  field: string | null;
  /** True while this person's AI scribe is recording. */
  recording?: boolean;
  at: string;
};

export type VisitRealtimeHandle = {
  /** Tell the room which field this user is typing in (null on blur). */
  setFocus: (field: string | null, encounterId?: string | null) => void;
  /** True while the AI scribe on this screen is live. */
  setRecording: (recording: boolean, encounterId?: string | null) => void;
  close: () => void;
};

/** Server drops a peer after 60s without a ping. */
const HEARTBEAT_MS = 20_000;

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

export function subscribeVisit(opts: {
  practiceId: number;
  appointmentId: number;
  encounterId?: string | null;
  /** Shown to the other person in the presence chip. */
  name?: string | null;
  onChanged?: (payload: VisitChangePayload) => void;
  onPresence?: (peers: VisitPeer[]) => void;
}): VisitRealtimeHandle {
  const { practiceId, appointmentId, encounterId, name, onChanged, onPresence } = opts;
  const noop: VisitRealtimeHandle = {
    setFocus: () => {},
    setRecording: () => {},
    close: () => {},
  };

  const token = getToken();
  if (
    !token?.trim() ||
    typeof window === 'undefined' ||
    !Number.isFinite(practiceId) ||
    !Number.isFinite(appointmentId)
  ) {
    return noop;
  }

  const socket: Socket = io(`${normalizeApiOrigin()}/visit`, {
    auth: { token: token.trim() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  let currentField: string | null = null;
  let currentRecording = false;
  let currentEncounterId: string | null = encounterId ?? null;

  const join = () => {
    socket.emit('visit.join', {
      practiceId,
      appointmentId,
      encounterId: currentEncounterId,
      name: name ?? null,
    });
    // Re-announce so a reconnect does not look like the user walked away.
    if (currentField) {
      socket.emit('visit.focus', { field: currentField, encounterId: currentEncounterId });
    }
    if (currentRecording) {
      socket.emit('visit.recording', {
        recording: true,
        encounterId: currentEncounterId,
      });
    }
  };

  socket.on('connect', join);
  if (onChanged) socket.on('visit.changed', onChanged);
  if (onPresence) {
    socket.on('visit.presence', (payload: { peers?: VisitPeer[] }) => {
      onPresence(Array.isArray(payload?.peers) ? payload.peers : []);
    });
  }

  const heartbeat = window.setInterval(() => {
    if (socket.connected) socket.emit('visit.ping');
  }, HEARTBEAT_MS);

  return {
    setFocus: (field, nextEncounterId) => {
      if (nextEncounterId !== undefined) currentEncounterId = nextEncounterId;
      const next = field?.trim() || null;
      if (next === currentField) return;
      currentField = next;
      if (socket.connected) {
        socket.emit('visit.focus', { field: next, encounterId: currentEncounterId });
      }
    },
    setRecording: (recording, nextEncounterId) => {
      if (nextEncounterId !== undefined) currentEncounterId = nextEncounterId;
      const next = Boolean(recording);
      if (next === currentRecording) return;
      currentRecording = next;
      if (socket.connected) {
        socket.emit('visit.recording', {
          recording: next,
          encounterId: currentEncounterId,
        });
      }
    },
    close: () => {
      window.clearInterval(heartbeat);
      socket.off('connect', join);
      if (onChanged) socket.off('visit.changed', onChanged);
      if (onPresence) socket.off('visit.presence');
      if (socket.connected) socket.emit('visit.leave');
      socket.disconnect();
    },
  };
}

const FIELD_LABELS: Record<string, string> = {
  subjective: 'Subjective',
  objectiveVitals: 'Vitals',
  objectiveExam: 'Exam',
  objectiveNotes: 'Objective',
  assessmentProblemIds: 'Assessment',
  assessmentReasoning: 'Assessment',
  planNotes: 'Plan',
};

export function soapFieldLabel(field: string | null | undefined): string | null {
  if (!field) return null;
  return FIELD_LABELS[field] ?? null;
}

/** First name is enough on a chip, and fits next to the pet tabs. */
export function peerShortName(peer: VisitPeer): string {
  const raw = (peer.name ?? '').trim();
  if (!raw) return 'Someone';
  const beforeAt = raw.includes('@') ? raw.split('@')[0]! : raw;
  const first = beforeAt.split(/[\s._-]+/).filter(Boolean)[0] ?? beforeAt;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function peerPresenceCaption(peer: VisitPeer): {
  label: string;
  title: string;
  kind: 'recording' | 'editing' | 'open';
} {
  const name = peerShortName(peer);
  if (peer.recording) {
    return {
      label: `${name} · Recording`,
      title: `${name} is recording this visit`,
      kind: 'recording',
    };
  }
  const where = soapFieldLabel(peer.field);
  if (where) {
    return {
      label: `${name} · ${where}`,
      title: `${name} is editing ${where}`,
      kind: 'editing',
    };
  }
  return {
    label: name,
    title: `${name} has this visit open`,
    kind: 'open',
  };
}
