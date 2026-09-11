/**
 * Scout Terminal checkout realtime: Socket.IO namespace `/terminal`.
 * Events: `checkout.ready`, `invoice.paid`.
 */
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, getToken } from '../api/http';

export type TerminalInvoicePaidPayload = {
  invoiceId: string;
  practiceId: number;
  appointmentId: number;
  paymentIntentId: string | null;
  checkoutId?: string | null;
  status: 'paid';
};

export type TerminalCheckoutReadyPayload = {
  checkoutId: string;
  invoiceId: string;
  appointmentId: number;
  practiceId: number;
  paymentIntentId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
  clientLabel?: string | null;
  expiresAt: string;
  targetDeviceId?: string | null;
};

function normalizeApiOrigin(): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/**
 * Subscribe to Terminal checkout events for a practice (mainly `invoice.paid`
 * so SOAP checkout can refresh when the reader finishes).
 */
export function subscribeTerminalCheckout(opts: {
  practiceId: number;
  onInvoicePaid?: (payload: TerminalInvoicePaidPayload) => void;
  onCheckoutReady?: (payload: TerminalCheckoutReadyPayload) => void;
}): () => void {
  const { practiceId, onInvoicePaid, onCheckoutReady } = opts;

  const token = getToken();
  if (!token?.trim() || typeof window === 'undefined' || !Number.isFinite(practiceId)) {
    return () => {};
  }

  const base = normalizeApiOrigin();
  const socket: Socket = io(`${base}/terminal`, {
    auth: { token: token.trim() },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  const join = () => {
    socket.emit('terminal.joinPractice', { practiceId });
  };

  socket.on('connect', join);
  if (onInvoicePaid) {
    socket.on('invoice.paid', onInvoicePaid);
  }
  if (onCheckoutReady) {
    socket.on('checkout.ready', onCheckoutReady);
  }

  return () => {
    socket.off('connect', join);
    if (onInvoicePaid) socket.off('invoice.paid', onInvoicePaid);
    if (onCheckoutReady) socket.off('checkout.ready', onCheckoutReady);
    socket.disconnect();
  };
}
