import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createPayment,
  type PaymentResponse,
  PaymentIntent,
  type MembershipTransactionPayload,
  upgradeMembership,
  type MembershipUpgradeRequest,
} from '../api/payments';
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
  selectedPlanId?: string;
  planName?: string;
  billingPreference?: 'monthly' | 'annual';
  amountCents: number;
  currency: string;
  costSummary?: CostSummary;
  addOns?: string[];
  enrollmentPayload?: Record<string, any>;
  note?: string;
  agreementSignature?: string;
  intent?: PaymentIntent;
  subscriptionPlanId?: string;
  subscriptionPlanVariationId?: string;
  subscriptionStartDate?: string;
  metadata?: Record<string, any>;
  membershipTransaction?: MembershipTransactionPayload;
  // Upgrade-specific fields
  isUpgrade?: boolean;
  patientId?: number | string;
  selectedUpgrades?: Array<{
    planId: string;
    planName: string;
    pricingOption: 'monthly' | 'annual';
    price: number;
  }>;
  proratedCalculation?: {
    refundAmount: number;
    chargeAmount: number;
    refundDescription: string;
    chargeDescription: string;
    nextBillingDate: string;
    upgradeDate: string;
  };
  currentMembership?: {
    id: number;
    [key: string]: any;
  };
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

  const [cardholderName, setCardholderName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [locality, setLocality] = useState('');
  const [administrativeDistrictLevel1, setAdministrativeDistrictLevel1] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('US');

  async function handlePaymentSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!state || !card) return;
    if (!cardholderName.trim()) {
      setError('Please enter the cardholder name.');
      return;
    }
    if (!addressLine1.trim() || !locality.trim() || !administrativeDistrictLevel1.trim() || !postalCode.trim()) {
      setError('Please complete the billing address.');
      return;
    }
    setProcessing(true);
    setError(null);

    try {
      const tokenResult = await card.tokenize();
      if (tokenResult.status !== 'OK') {
        throw new Error(tokenResult.errors?.[0]?.message || 'Unable to tokenize card.');
      }

      // Handle upgrade flow
      if (state.isUpgrade && state.patientId && state.selectedUpgrades) {
        const upgradeRequest: MembershipUpgradeRequest = {
          patientId: state.patientId,
          newPlansSelected: state.selectedUpgrades,
          sourceId: tokenResult.token,
          customerEmail: userEmail ?? '',
          // Include prorated calculation if available
          proratedRefundAmount: state.proratedCalculation?.refundAmount,
          proratedChargeAmount: state.proratedCalculation?.chargeAmount,
          upgradeDate: state.proratedCalculation?.upgradeDate,
          nextBillingDate: state.proratedCalculation?.nextBillingDate,
          currentMembershipId: state.currentMembership?.id,
        };

        const upgradeResponse = await upgradeMembership(upgradeRequest);
        
        if (!upgradeResponse.success) {
          throw new Error(upgradeResponse.message || 'Upgrade was not successful.');
        }

        setEnrollmentComplete(true);
        return;
      }

      // Regular payment flow
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `membership-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      if (state.intent === PaymentIntent.SUBSCRIPTION && !state.subscriptionPlanId) {
        throw new Error('Subscription plan ID is missing for this selection.');
      }

      const membershipTransactionPayload = state.membershipTransaction
        ? {
            ...state.membershipTransaction,
            metadata: {
              ...(state.membershipTransaction.metadata ?? {}),
            },
          }
        : undefined;

      const payment = await createPayment({
        sourceId: tokenResult.token,
        idempotencyKey,
        amount: state.amountCents,
        currency: state.currency,
        locationId,
        note: state.note,
        intent: state.intent,
        subscriptionPlanId: state.subscriptionPlanId,
        subscriptionPlanVariationId: state.subscriptionPlanVariationId,
        subscriptionStartDate: state.subscriptionStartDate,
        customerEmail: userEmail ?? undefined,
        metadata: {
          ...(state.metadata ?? {}),
          cardholderName: cardholderName.trim(),
          billingAddress: {
            addressLine1: addressLine1.trim(),
            addressLine2: addressLine2.trim() || undefined,
            locality: locality.trim(),
            administrativeDistrictLevel1: administrativeDistrictLevel1.trim(),
            postalCode: postalCode.trim(),
            country: country.trim() || 'US',
          },
        },
        membershipTransaction: membershipTransactionPayload,
      });

      setPaymentResponse(payment);

      if (!payment.success) {
        throw new Error(payment.status || 'Payment was not successful.');
      }

      setEnrollmentComplete(true);
    } catch (err: any) {
      setError(err?.message || 'Unable to process payment.');
    } finally {
      setProcessing(false);
    }
  }

  if (!state) {
    return null;
  }

  if (enrollmentComplete && (paymentResponse?.success || state.isUpgrade)) {
    const providerPaymentId =
      paymentResponse?.providerPaymentId ??
      paymentResponse?.providerResponse?.payment?.id ??
      paymentResponse?.providerResponse?.id ??
      null;
    return (
      <div className="cp-wrap" style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
        <div className="cp-card" style={{ padding: 24, borderLeft: '4px solid var(--brand, #0f766e)' }}>
          <h1 className="cp-title" style={{ margin: '0 0 12px' }}>
            {state.isUpgrade ? 'Upgrade Successful' : 'Payment Successful'}
          </h1>
          <p className="cp-muted" style={{ marginBottom: 20 }}>
            {state.isUpgrade 
              ? `${state.petName}'s membership has been successfully upgraded. A confirmation email will arrive shortly.`
              : `${state.petName} is now enrolled in the ${state.planName || 'membership'} membership. A confirmation email will arrive shortly. Please note that it may take up to 24-48 business hours for ${state.petName}'s membership to be fully active in our system.`
            }
          </p>
          <div style={{ display: 'grid', gap: 8, fontSize: 15 }}>
            <div>
              <strong>Plan:</strong> {state.planName}
            </div>
            <div>
              <strong>Billing preference:</strong> {state.billingPreference === 'annual' ? 'Annual' : 'Monthly'}
            </div>
            <div>
              <strong>Total paid today:</strong> {formatMoney(state.amountCents, state.currency)}
            </div>
            {state.addOns && state.addOns.length > 0 && (
              <div>
                <strong>Add-ons:</strong> {state.addOns.join(', ')}
              </div>
            )}
            {providerPaymentId && (
              <div>
                <strong>Payment reference:</strong> {providerPaymentId}
              </div>
            )}
          </div>
        </div>

        {costSummaryItems.length > 0 && (
          <section className="cp-section" style={{ marginTop: 24 }}>
            <div className="cp-card" style={{ padding: 20 }}>
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>Breakdown</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {costSummaryItems.map((item) => {
                  // Only show the price for the selected billing preference
                  const showPrice = state.billingPreference === 'annual' 
                    ? (item.annual != null ? `${formatMoney(item.annual * 100, state.currency)} annually (10% discount!)` : null)
                    : (item.monthly != null ? `${formatMoney(item.monthly * 100, state.currency)}/mo` : null);
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
                      <span className="cp-muted">{showPrice || '—'}</span>
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
                <span>Total</span>
                <span>{formatMoney(state.amountCents, state.currency)}</span>
              </div>
            </div>
          </section>
        )}

        <div className="cp-card" style={{ marginTop: 24, padding: 20, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
          <p className="cp-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            <strong>NOTE:</strong> If you want to sign-up another pet from your household or if you want to make an appointment for {state.petName}, please{' '}
            <a 
              href="/client-portal" 
              onClick={(e) => {
                e.preventDefault();
                navigate('/client-portal');
              }}
              style={{ color: '#4FB128', textDecoration: 'underline', fontWeight: 600 }}
            >
              login to your client portal
            </a>
            .
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button 
            className="btn" 
            onClick={() => navigate('/client-portal')}
            style={{ backgroundColor: '#4FB128', color: '#fff' }}
          >
            Sign up another pet
          </button>
          <button 
            className="btn" 
            onClick={() => navigate('/client-portal')}
            style={{ backgroundColor: '#4FB128', color: '#fff' }}
          >
            Return to Client Portal
          </button>
        </div>

        {/* ---------------------------
            Footer
        ---------------------------- */}
        <footer
          style={{
            marginTop: '48px',
            padding: '32px 16px',
            borderTop: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: 1120, margin: '0 auto' }}>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
                Vet At Your Door
              </div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>
                Providing quality veterinary care at your doorstep.
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '24px',
                marginBottom: '16px',
              }}
            >
              <a
                href="tel:207-536-8387"
                style={{ fontSize: '14px', color: '#10b981', textDecoration: 'none' }}
              >
                (207) 536-8387
              </a>
              <a
                href="mailto:info@vetatyourdoor.com"
                style={{ fontSize: '14px', color: '#10b981', textDecoration: 'none' }}
              >
                info@vetatyourdoor.com
              </a>
              <a
                href="https://www.vetatyourdoor.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: '#10b981', textDecoration: 'none' }}
              >
                www.vetatyourdoor.com
              </a>
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '16px' }}>
              © {new Date().getFullYear()} Vet At Your Door. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
    );
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
          {state.isUpgrade ? 'Complete Membership Upgrade' : 'Complete Membership Payment'}
        </h1>
        <p className="cp-muted">
          {state.isUpgrade 
            ? `Securely submit your payment to complete ${state.petName}'s membership upgrade.`
            : `Securely submit your payment to finish enrolling ${state.petName}.`
          }
        </p>
      </div>

      <section className="cp-section">
        <div className="cp-card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>
            {state.isUpgrade ? 'Upgrade Summary' : 'Summary'}
          </h3>
          {state.isUpgrade && state.selectedUpgrades ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <strong>Pet:</strong> {state.petName}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {state.selectedUpgrades.map((upgrade, idx) => (
                  <li
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 14,
                      borderBottom: '1px solid rgba(0,0,0,0.06)',
                      paddingBottom: 6,
                    }}
                  >
                    <span>{upgrade.planName} ({upgrade.pricingOption === 'monthly' ? 'Monthly' : 'Annual'})</span>
                    <span className="cp-muted">
                      {formatMoney(upgrade.price * 100, state.currency)}
                      {upgrade.pricingOption === 'monthly' ? '/mo' : '/year'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {state.planName && (
                <div style={{ marginBottom: 16 }}>
                  <strong>Plan:</strong> {state.planName}
                </div>
              )}
              {state.billingPreference && (
                <div style={{ marginBottom: 16 }}>
                  <strong>Billing preference:</strong> {state.billingPreference === 'annual' ? 'Annual' : 'Monthly'}
                </div>
              )}
              {state.agreementSignature && (
                <div style={{ marginBottom: 16 }}>
                  <strong>Signature:</strong> {state.agreementSignature}
                </div>
              )}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {costSummaryItems.map((item) => {
                  // Only show the price for the selected billing preference
                  const showPrice = state.billingPreference === 'annual' 
                    ? (item.annual != null ? `${formatMoney(item.annual * 100, state.currency)} annually` : null)
                    : (item.monthly != null ? `${formatMoney(item.monthly * 100, state.currency)}/mo` : null);
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
                        {showPrice || '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
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
          <form onSubmit={handlePaymentSubmit} style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Cardholder Name</label>
                <input
                  type="text"
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  placeholder="Full name on card"
                  className="input"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Billing Address</label>
                <input
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  placeholder="Address line 1"
                  className="input"
                  required
                  style={{ marginBottom: 8 }}
                />
                <input
                  type="text"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  placeholder="Address line 2 (optional)"
                  className="input"
                  style={{ marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    placeholder="City"
                    className="input"
                    style={{ flex: '1 1 140px' }}
                    required
                  />
                  <input
                    type="text"
                    value={administrativeDistrictLevel1}
                    onChange={(e) => setAdministrativeDistrictLevel1(e.target.value.toUpperCase())}
                    placeholder="State"
                    className="input"
                    style={{ flex: '0 0 120px' }}
                    required
                    maxLength={2}
                  />
                  <input
                    type="text"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="Postal Code"
                    className="input"
                    style={{ flex: '0 0 140px' }}
                    required
                  />
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    placeholder="Country"
                    className="input"
                    style={{ flex: '0 0 100px' }}
                    required
                  />
                </div>
              </div>
            </div>

            {!squareAppId || !locationId ? (
              <p className="cp-muted" style={{ color: '#b91c1c' }}>
                Square configuration is missing. Please contact support.
              </p>
            ) : (
              <>
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
                  {processing ? 'Processing…' : state.isUpgrade ? 'Complete Upgrade' : 'Pay & Enroll'}
                </button>
              </>
            )}
          </form>
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
            Thank you! {state.petName} is now enrolled. You'll be redirected to the client portal shortly.
          </p>
        </div>
      )}

      {/* ---------------------------
          Footer
      ---------------------------- */}
      <footer
        style={{
          marginTop: '48px',
          padding: '32px 16px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>
              Vet At Your Door
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              Providing quality veterinary care at your doorstep.
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '24px',
              marginBottom: '16px',
            }}
          >
            <a
              href="tel:207-536-8387"
              style={{ fontSize: '14px', color: '#10b981', textDecoration: 'none' }}
            >
              (207) 536-8387
            </a>
            <a
              href="mailto:info@vetatyourdoor.com"
              style={{ fontSize: '14px', color: '#10b981', textDecoration: 'none' }}
            >
              info@vetatyourdoor.com
            </a>
            <a
              href="https://www.vetatyourdoor.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '14px', color: '#10b981', textDecoration: 'none' }}
            >
              www.vetatyourdoor.com
            </a>
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '16px' }}>
            © {new Date().getFullYear()} Vet At Your Door. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
