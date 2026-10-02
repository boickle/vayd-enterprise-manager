import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, CalendarClock, Mic, Receipt, Users } from 'lucide-react';
import './SoapEncounterPage.css';
import './VisitCheckoutPage.css';
import {
  createEncounter,
  getHouseholdRoster,
  getInvoiceByAppointment,
  listOrders,
  VISIT_WORKFLOW_PRACTICE_ID,
  type EncounterOrder,
  type HouseholdRosterEntry,
  type VisitInvoice,
} from '../api/visitWorkflow';
import { getVisitWrapUp, type VisitWrapUp } from '../api/visitWrapUp';
import { useAuth } from '../auth/useAuth';
import {
  peerPresenceCaption,
  subscribeVisit,
  type VisitPeer,
} from '../utils/visitRealtime';
import { forwardBookingDispositionIsComplete } from '../utils/forwardBookingDisposition';
import VisitCheckoutPanel from '../components/soap/VisitCheckoutPanel';
import WrapUpForwardBooking from '../components/soap/WrapUpForwardBooking';

/**
 * Checkout for the whole visit.
 *
 * Split out of the SOAP sidebar so the bill is built during the visit and collected in one
 * place at the end: a household shares one invoice, so the owner is charged once rather
 * than once per pet.
 *
 * Forward booking is settled here, while the client is still standing at the door, and it
 * gates payment — it used to be asked on End Visit, long after they had gone.
 */
export default function VisitCheckoutPage() {
  const { appointmentId: appointmentIdParam, patientId: patientIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { employeeId, userEmail } = useAuth() as {
    employeeId?: string | null;
    userEmail?: string | null;
  };

  const appointmentId = Number(appointmentIdParam);
  const patientId = Number(patientIdParam);
  const clientIdParam = searchParams.get('clientId');
  const focusOrderId = searchParams.get('focusOrder');

  const [encounterId, setEncounterId] = useState<string | null>(null);
  /** Read inside the socket handler, which must not resubscribe when the id lands. */
  const encounterIdRef = useRef(encounterId);
  encounterIdRef.current = encounterId;
  const [orders, setOrders] = useState<EncounterOrder[]>([]);
  const [peers, setPeers] = useState<VisitPeer[]>([]);
  /** Bumped so the panel reloads housemates' pre-visit orders. */
  const [ordersRevision, setOrdersRevision] = useState(0);
  const [invoice, setInvoice] = useState<VisitInvoice | null>(null);
  const [roster, setRoster] = useState<HouseholdRosterEntry[]>([]);
  const [wrapUp, setWrapUp] = useState<VisitWrapUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const soapPath = `/schedule/soap/${appointmentId}/${patientId}${
    clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : ''
  }`;

  const refreshInvoice = useCallback(async () => {
    try {
      setInvoice(await getInvoiceByAppointment(appointmentId));
    } catch {
      /* invoice may not exist yet */
    }
  }, [appointmentId]);

  const loadWrapUp = useCallback(async () => {
    if (!encounterId) return;
    try {
      setWrapUp(await getVisitWrapUp(encounterId));
    } catch {
      /* forward booking section just stays hidden */
    }
  }, [encounterId]);

  useEffect(() => {
    if (!Number.isFinite(appointmentId) || !Number.isFinite(patientId)) {
      setError('Missing appointment or patient.');
      setLoading(false);
      return;
    }
    let canceled = false;
    setLoading(true);
    void (async () => {
      try {
        // Idempotent — returns the encounter the SOAP page has been writing to.
        const enc = await createEncounter({
          appointmentId,
          patientId,
          ...(clientIdParam ? { clientId: Number(clientIdParam) } : {}),
        });
        if (canceled) return;
        setEncounterId(enc.id);
        const [inv, rosterRows, orderRows] = await Promise.all([
          getInvoiceByAppointment(appointmentId).catch(() => null),
          getHouseholdRoster(enc.id).catch(() => []),
          listOrders(enc.id).catch(() => []),
        ]);
        if (canceled) return;
        setInvoice(inv);
        setRoster(rosterRows);
        setOrders(orderRows);
      } catch (e) {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Could not load this checkout.');
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [appointmentId, patientId, clientIdParam]);

  useEffect(() => {
    void loadWrapUp();
  }, [loadWrapUp]);

  // The doctor is usually still in the chart while this screen builds the bill — keep
  // both in step rather than making either of them reload by hand.
  useEffect(() => {
    if (!Number.isFinite(appointmentId)) return;
    const handle = subscribeVisit({
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      appointmentId,
      encounterId: encounterIdRef.current,
      name: userEmail ?? null,
      onPresence: setPeers,
      onChanged: (payload) => {
        if (payload.scope === 'encounter') return;
        void refreshInvoice();
        if (payload.scope === 'orders') {
          setOrdersRevision((n) => n + 1);
          const id = encounterIdRef.current;
          if (id) void listOrders(id).then(setOrders).catch(() => undefined);
        }
      },
    });
    return () => handle.close();
  }, [appointmentId, userEmail, refreshInvoice]);

  const otherPeers = useMemo(
    () => peers.filter((p) => employeeId == null || String(p.employeeId ?? '') !== employeeId),
    [peers, employeeId]
  );

  const pets = wrapUp?.pets ?? [];
  const followUpOutstanding = pets.filter(
    (p) => !forwardBookingDispositionIsComplete(p.forwardBookingDisposition)
  );
  const followUpSettled = pets.length > 0 && followUpOutstanding.length === 0;

  const paymentBlockedReason = !followUpSettled
    ? pets.length === 0
      ? null
      : `Settle the follow-up for ${followUpOutstanding
          .map((p) => p.patientName)
          .join(', ')} before taking payment.`
    : null;

  if (loading) {
    return <div className="soap-checkout-page soap-empty">Loading checkout…</div>;
  }

  return (
    <div className="soap-checkout-page">
      <header className="soap-checkout-page__head">
        <button type="button" className="soap-btn ghost" onClick={() => navigate(soapPath)}>
          <ArrowLeft size={14} /> Back to chart
        </button>
        <h1>
          <Receipt size={18} aria-hidden /> Checkout
        </h1>
        <p className="soap-hint">
          {roster.length > 1
            ? `One bill for ${roster.length} pets on this visit — the owner is charged once.`
            : 'Take payment and settle the follow-up before the client leaves.'}
        </p>
        {otherPeers.length > 0 && (
          <div className="soap-presence">
            {otherPeers.map((peer) => {
              const cap = peerPresenceCaption(peer);
              return (
                <span
                  key={peer.socketId}
                  className={`soap-presence-chip${
                    cap.kind === 'recording'
                      ? ' is-recording'
                      : cap.kind === 'editing'
                        ? ' is-editing'
                        : ''
                  }`}
                  title={cap.title}
                >
                  {cap.kind === 'recording' ? <Mic size={12} /> : <Users size={12} />}
                  {cap.label}
                </span>
              );
            })}
          </div>
        )}
      </header>

      {error ? <div className="soap-error">{error}</div> : null}

      <div className="soap-checkout-page__body">
        <section className="soap-checkout-page__pane">
          <h2>
            <CalendarClock size={15} aria-hidden /> Follow-up
          </h2>
          <p className="soap-hint">
            Ask now, while they are still here. Payment unlocks once every pet has an answer.
          </p>
          {wrapUp && pets.length > 0 ? (
            <WrapUpForwardBooking
              pets={pets}
              clientId={wrapUp.clientId}
              providerId={wrapUp.provider?.id ?? null}
              returnTo={`/schedule/soap/${appointmentId}/${patientId}/checkout`}
              onSaved={loadWrapUp}
            />
          ) : (
            <p className="soap-hint">No charts on this visit yet.</p>
          )}
        </section>

        <section className="soap-checkout-page__pane">
          <VisitCheckoutPanel
            encounterId={encounterId ?? undefined}
            invoice={invoice}
            orders={orders}
            clientId={wrapUp?.clientId ?? (clientIdParam ? Number(clientIdParam) : null)}
            patientId={patientId}
            roster={roster}
            practiceId={VISIT_WORKFLOW_PRACTICE_ID}
            remoteRefreshSignal={ordersRevision}
            paymentBlockedReason={paymentBlockedReason}
            onInvoiceChange={setInvoice}
            onOrdersChange={(next) => {
              setOrders(next);
              void refreshInvoice();
            }}
            onInvoiceShouldRefresh={() => void refreshInvoice()}
            onOrderRemoved={() => void refreshInvoice()}
            onOpenEuthanasiaPrepay={() => navigate(soapPath)}
            focusOrderId={focusOrderId}
            rxLabel={{
              patientId,
              patientName:
                roster.find((r) => r.patientId === patientId)?.patientName ??
                wrapUp?.pets.find((p) => p.patientId === patientId)?.patientName ??
                'Patient',
              species: roster.find((r) => r.patientId === patientId)?.species ?? null,
              ownerName: wrapUp?.clientName ?? 'Client',
              veterinarianName: wrapUp?.provider?.name ?? null,
              veterinarianLicense: null,
              veterinarianEmployeeId: wrapUp?.provider?.id ?? null,
            }}
          />
        </section>
      </div>
    </div>
  );
}
