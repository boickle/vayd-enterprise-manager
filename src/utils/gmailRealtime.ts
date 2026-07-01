/**
 * Gmail inbox realtime: Socket.IO namespace `/gmail` on the REST API origin.
 * Backend polls Gmail history (default every 30–60s) and emits `gmail.inbox`.
 * The inbox page also refetches on a timer as a fallback when push/webhooks fail.
 */
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, getToken } from '../api/http';

export type GmailInboxWsPayload = {
  type: 'history';
  historyId: string;
  mailboxEmail: string;
  addedMessageIds: string[];
  affectedLabelIds: string[];
  unreadDelta: number;
};

const GMAIL_INBOX_EVENT = 'gmail.inbox';

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/**
 * Subscribe to Gmail inbox changes for a practice. Refetch when the active mailbox
 * (or any mailbox, if mailboxEmail omitted) receives new history.
 */
export function subscribeGmailInbox(opts: {
  practiceId: number;
  mailboxEmail?: string;
  onInboxChange: (payload: GmailInboxWsPayload) => void;
  debounceMs?: number;
}): () => void {
  const { practiceId, mailboxEmail, onInboxChange, debounceMs = 400 } = opts;

  const token = getToken();
  if (!token?.trim() || typeof window === 'undefined') {
    return () => {};
  }

  const base = normalizeApiOrigin();
  const socket: Socket = io(`${base}/gmail`, {
    auth: { token: token.trim() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  let flushTimer: number | null = null;
  let pending: GmailInboxWsPayload | null = null;

  const flush = () => {
    flushTimer = null;
    if (!pending) return;
    const payload = pending;
    pending = null;
    onInboxChange(payload);
  };

  const scheduleFlush = (payload: GmailInboxWsPayload) => {
    pending = payload;
    if (flushTimer != null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, debounceMs);
  };

  const joinPractice = () => {
    socket.emit('gmail.joinPractice', { practiceId }, (ack: { ok: boolean; error?: string } | undefined) => {
      if (ack && ack.ok === false) {
        console.warn('[gmail socket] gmail.joinPractice failed', ack.error);
      }
    });
  };

  socket.on('connect', joinPractice);

  socket.on(GMAIL_INBOX_EVENT, (payload: GmailInboxWsPayload) => {
    if (!payload?.mailboxEmail) return;
    const filter = mailboxEmail?.trim().toLowerCase();
    if (filter && payload.mailboxEmail.trim().toLowerCase() !== filter) return;
    scheduleFlush(payload);
  });

  socket.on('connect_error', (err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : err;
    console.warn('[gmail socket] connect_error', msg);
  });

  return () => {
    if (flushTimer != null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = null;
    try {
      socket.emit('gmail.leavePractice', { practiceId });
    } catch {
      /* ignore */
    }
    socket.removeAllListeners();
    socket.disconnect();
  };
}
