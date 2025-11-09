import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { enrollPetInPlan } from '../api/clientPortal';
import { createPayment, type PaymentResponse, PaymentIntent } from '../api/payments';
import { useAuth } from '../auth/useAuth';

declare global {
  interface Window {
    Square?: any;
  }
}

const runtimeEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {};
const viteEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};

const squareAppId =
  viteEnv.VITE_SQUARE_APP_ID ||
  viteEnv.SQUARE_APP_ID ||
  runtimeEnv.REACT_APP_SQUARE_APP_ID ||
  runtimeEnv.SQUARE_APP_ID ||
  '';
const defaultSquareLocationId =
  viteEnv.VITE_SQUARE_LOCATION_ID ||
  viteEnv.SQUARE_LOCATION_ID ||
  runtimeEnv.REACT_APP_SQUARE_LOCATION_ID ||
  runtimeEnv.SQUARE_LOCATION_ID ||
  '';
const squareEnvironment =
  ((viteEnv.VITE_SQUARE_ENVIRONMENT ||
    viteEnv.SQUARE_ENVIRONMENT ||
    runtimeEnv.REACT_APP_SQUARE_ENVIRONMENT ||
    runtimeEnv.SQUARE_ENVIRONMENT ||
    'sandbox') as string)
    .toString()
    .toLowerCase();
const squareScriptUrl =
  squareEnvironment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';

function formatMoney(amountCents: number, currency = 'USD') {
  return (amountCents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });
}

type CostSummaryItem = {
  label: string;
  monthly?: number | null;
  annual?: number | null;
};

type CostSummary = {
  items: CostSummaryItem[];
  totalMonthly: number;
  totalAnnual: number | null;
};

type PaymentNavigationState = {
  petId: string;
  petName: string;
  selectedPlanId: string;
  planName: string;
  billingPreference: 'monthly' | 'annual';
  amountCents: number;
  currency: string;
  costSummary: CostSummary;
  addOns: string[];
  enrollmentPayload: Record<string, any>;
  note?: string;
  agreementSignature?: string;
  intent: PaymentIntent;
  subscriptionPlanId?: string;
  subscriptionStartDate?: string;
  metadata?: Record<string, any>;
};

export default function MembershipPayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as PaymentNavigationState | undefined;
  const { userEmail } = useAuth() as any;

  const [loadingScript, setLoadingScript] = useState(true);
  const [initializingPaymentForm, setInitializingPaymentForm] = useState(false);
  const [card, setCard] = useState<any>(null);
  const [paymentsInstance, setPaymentsInstance] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentResponse, setPaymentResponse] = useState<PaymentResponse | null>(null);
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);

  const locationId = state?.enrollmentPayload?.locationId ?? defaultSquareLocationId;

  useEffect(() => {
    if (!state) {
      navigate('/client-portal');
    }
  }, [state, navigate]);

  useEffect(() => {
    if (!state) return;

    if (window.Square) {
      setLoadingScript(false);
      return;
    }

    const existing = document.getElementById('square-web-payments-sdk');
    if (existing) {
      const onLoad = () => setLoadingScript(false);
      const onError = () => setError('Unable to load Square payment SDK.');
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', onError);
      return () => {
        existing.removeEventListener('load', onLoad);
        existing.removeEventListener('error', onError);
      };
    }

    const script = document.createElement('script');
    script.id = 'square-web-payments-sdk';
    script.src = squareScriptUrl;
    script.onload = () => setLoadingScript(false);
    script.onerror = () => setError('Unable to load Square payment SDK.');
    document.head.appendChild(script);

    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, [state]);

  useEffect(() => {
    if (!state || loadingScript) return;
    if (!squareAppId || !locationId) {
      setError('Square is not fully configured. Please contact support.');
      return;
    }

    let canceled = false;

    async function init() {
      try {
        setInitializingPaymentForm(true);
        const payments = window.Square?.payments(squareAppId, locationId);
        if (!payments) {
          throw new Error('Square payments object not available.');
        }
        const card = await payments.card();
        await card.attach('#card-container');
        if (!canceled) {
          setPaymentsInstance(payments);
          setCard(card);
        }
      } catch (err: any) {
        if (!canceled) {
          setError(err?.message || 'Failed to initialise payment form.');
        }
      } finally {
        if (!canceled) setInitializingPaymentForm(false);
      }
    }

    init();

    return () => {
      canceled = true;
      if (card && typeof card.destroy === 'function') {
        card.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, loadingScript, locationId]);

  const costSummaryItems = useMemo(() => state?.costSummary?.items ?? [], [state]);

  async function handlePaymentSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!state || !card) return;
    setProcessing(true);
    setError(null);

    try {
      const tokenResult = await card.tokenize();
      if (tokenResult.status !== 'OK') {
        throw new Error(tokenResult.errors?.[0]?.message || 'Unable to tokenize card.');
      }

      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `membership-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      if (state.intent === PaymentIntent.SUBSCRIPTION && !state.subscriptionPlanId) {
        throw new Error('Subscription plan ID is missing for this selection.');
      }

      const payment = await createPayment({
        sourceId: tokenResult.token,
        idempotencyKey,
        amount: state.amountCents,
        currency: state.currency,
        locationId,
        note: state.note,
        intent: state.intent,
        subscriptionPlanId: state.subscriptionPlanId,
        subscriptionStartDate: state.subscriptionStartDate,
        customerEmail: userEmail ?? undefined,
        metadata: state.metadata,
      });

      setPaymentResponse(payment);

      if (!payment.success) {
        throw new Error(payment.status || 'Payment was not successful.');
      }

      await enrollPetInPlan(
        state.petId,
        state.enrollmentPayload && Object.keys(state.enrollmentPayload).length > 0
          ? state.enrollmentPayload
          : undefined,
      );

      setEnrollmentComplete(true);
      setTimeout(() => navigate('/client-portal'), 2500);
    } catch (err: any) {
      setError(err?.message || 'Unable to process payment.');
    } finally {
      setProcessing(false);
    }
  }

  if (!state) {
    return null;
  }

  return (
    <div className="cp-wrap" style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--brand, #0f766e)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back
        </button>
        <h1 className="cp-title" style={{ margin: '12px 0 4px' }}>
          Complete Membership Payment
        </h1>
        <p className="cp-muted">Securely submit your payment to finish enrolling {state.petName}.</p>
      </div>

      <section className="cp-section">
        <div className="cp-card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Summary</h3>
          <div style={{ marginBottom: 16 }}>
            <strong>Plan:</strong> {state.planName}
          </div>
          <div style={{ marginBottom: 16 }}>
            <strong>Billing preference:</strong> {state.billingPreference === 'annual' ? 'Annual' : 'Monthly'}
          </div>
          {state.agreementSignature && (
            <div style={{ marginBottom: 16 }}>
              <strong>Signature:</strong> {state.agreementSignature}
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {costSummaryItems.map((item) => {
              const monthly =
                item.monthly != null ? `${formatMoney(item.monthly * 100, state.currency)}/mo` : null;
              const annual =
                item.annual != null ? `${formatMoney(item.annual * 100, state.currency)} annually` : null;
              return (
                <li
                  key={item.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 14,
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                    paddingBottom: 6,
                  }}
                >
                  <span>{item.label}</span>
                  <span className="cp-muted">
                    {[monthly, annual].filter(Boolean).join(' • ')}
                  </span>
                </li>
              );
            })}
          </ul>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontWeight: 700,
              fontSize: 16,
              marginTop: 16,
            }}
          >
            <span>Total Due Today</span>
            <span>{formatMoney(state.amountCents, state.currency)}</span>
          </div>
        </div>
      </section>

      <section className="cp-section">
        <div className="cp-card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Payment Method</h3>
          {!squareAppId || !locationId ? (
            <p className="cp-muted" style={{ color: '#b91c1c' }}>
              Square configuration is missing. Please contact support.
            </p>
          ) : (
            <form onSubmit={handlePaymentSubmit} style={{ display: 'grid', gap: 16 }}>
              <div id="card-container" style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: 12 }} />
              <button
                type="submit"
                className="btn"
                disabled={processing || initializingPaymentForm || !card}
                style={{
                  minWidth: 200,
                  opacity: processing || initializingPaymentForm || !card ? 0.6 : 1,
                  cursor: processing || initializingPaymentForm || !card ? 'not-allowed' : 'pointer',
                }}
              >
                {processing ? 'Processing…' : 'Pay & Enroll'}
              </button>
            </form>
          )}
        </div>
      </section>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            border: '1px solid #dc2626',
            borderRadius: 8,
            color: '#dc2626',
            background: '#fef2f2',
          }}
        >
          {error}
        </div>
      )}

      {paymentResponse && (
        <div className="cp-card" style={{ marginTop: 16, padding: 20 }}>
          <h4 style={{ margin: '0 0 8px' }}>Payment Reference</h4>
          <p className="cp-muted" style={{ margin: 0 }}>
            Provider status: {paymentResponse.status ?? '—'}
            {paymentResponse.providerPaymentId ? ` • Payment ID: ${paymentResponse.providerPaymentId}` : ''}
          </p>
        </div>
      )}

      {enrollmentComplete && (
        <div className="cp-card" style={{ marginTop: 16, padding: 20, background: '#ecfdf5', border: '1px solid #10b981' }}>
          <h3 style={{ marginTop: 0, color: '#047857' }}>Membership Activated!</h3>
          <p className="cp-muted" style={{ marginBottom: 0 }}>
            Thank you! {state.petName} is now enrolled. You’ll be redirected to the client portal shortly.
          </p>
        </div>
      )}
    </div>
  );
}
