import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  getPublicMembershipAgreement,
  signPublicMembershipAgreement,
  type PublicMembershipAgreement,
} from '../api/memberships';
import MembershipAgreementWaiver, {
  hasDrawnMembershipSignature,
} from '../components/MembershipAgreementWaiver';
import './FormSignPage.css';

const money = (n: number) => `$${n.toFixed(2)}`;

function errorMessage(e: unknown): string {
  const data = (e as { response?: { data?: { message?: unknown } } })?.response?.data;
  const msg = Array.isArray(data?.message) ? data?.message.join(' ') : data?.message;
  return typeof msg === 'string' && msg.trim()
    ? msg
    : e instanceof Error
      ? e.message
      : 'Something went wrong. Please try again.';
}

/**
 * The owner signs their membership agreement from an emailed link (they weren't at the visit).
 * For a post-visit signup, signing is what starts the membership, the refund and billing.
 */
export default function MembershipAgreementSignPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicMembershipAgreement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState('');
  const [drawing, setDrawing] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'completed' | 'received' | null>(null);

  useEffect(() => {
    void getPublicMembershipAgreement(token)
      .then(setData)
      .catch((e) => setLoadError(errorMessage(e)));
  }, [token]);

  const canSign = accepted && signature.trim() !== '' && hasDrawnMembershipSignature(drawing);

  async function submit() {
    if (!canSign || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await signPublicMembershipAgreement(token, {
        accepted: true,
        signedName: signature.trim(),
        signatureDataUrl: drawing,
      });
      setDone(res.status === 'completed' ? 'completed' : 'received');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const s = data?.summary;
  const per = s?.billingInterval === 'annual' ? 'year' : 'month';

  return (
    <div className="fsign-shell">
      <div className="fsign-card">
        <div className="fsign-header">
          <p className="fsign-practice">{data?.practiceName ?? ''}</p>
          <h1 style={{ margin: 0, fontSize: 22 }}>Membership agreement</h1>
          {data?.petName ? (
            <p style={{ margin: '6px 0 0', color: '#4b5563' }}>
              {data.petName}
              {data.planName ? ` · ${data.planName}` : ''}
            </p>
          ) : null}
        </div>
        <div style={{ padding: '20px 28px 28px' }}>
          {loadError ? (
            <p role="alert">{loadError}</p>
          ) : !data ? (
            <p>Loading…</p>
          ) : done || data.status === 'completed' || data.status === 'signing' ? (
            <div role="status">
              <h2 style={{ fontSize: 18 }}>Thank you{data.signedName || signature ? `, ${(data.signedName || signature).split(' ')[0]}` : ''}!</h2>
              <p>
                {done === 'received'
                  ? 'We received your signature. Our team will finish setting up the membership and will be in touch.'
                  : data.kind === 'post_visit_signup'
                    ? `${data.petName ?? 'Your pet'}'s membership is active.${
                        (s?.refundDue ?? 0) > 0.009
                          ? ` Your refund of ${money(s!.refundDue)} should show up on your card within 5 business days.`
                          : ''
                      }`
                    : 'Your signed agreement is on file.'}
              </p>
            </div>
          ) : data.status === 'failed' ? (
            <p role="status">
              We received your signature. Our team will finish setting up the membership and will be
              in touch.
            </p>
          ) : data.status !== 'pending' ? (
            <p role="alert">
              {data.status === 'expired'
                ? 'This link has expired. Please contact us and we will send a new one.'
                : 'This link is no longer active. Please contact us and we will send a new one.'}
            </p>
          ) : (
            <>
              {data.kind === 'post_visit_signup' && s ? (
                <ul style={{ margin: '0 0 16px', paddingLeft: 20, color: '#374151' }}>
                  {s.price != null ? (
                    <li>
                      {data.planName}: {money(s.price)} per {per}.
                    </li>
                  ) : null}
                  {s.refundDue > 0.009 ? (
                    <li>
                      Your visit is re-priced at member rates, so we'll refund {money(s.refundDue)} to
                      your card once you sign.
                    </li>
                  ) : null}
                  {s.balanceDue > 0.009 ? (
                    <li>The remaining {money(s.balanceDue)} is charged to your card once you sign.</li>
                  ) : null}
                  {s.subscriptionAmount > 0.009 ? (
                    <li>
                      Your first membership payment of {money(s.subscriptionAmount)} starts once you
                      sign.
                    </li>
                  ) : null}
                  <li>Nothing is charged or refunded until you sign.</li>
                </ul>
              ) : null}
              <MembershipAgreementWaiver
                text={data.agreementText}
                title="Please review and sign"
                hint={null}
                accepted={accepted}
                signature={signature}
                signatureDrawing={drawing}
                onAcceptedChange={setAccepted}
                onSignatureChange={setSignature}
                onSignatureDrawingChange={setDrawing}
                disabled={submitting}
              />
              {error ? (
                <p role="alert" style={{ color: '#b91c1c' }}>
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                className="btn primary"
                style={{ marginTop: 16, width: '100%' }}
                disabled={!canSign || submitting}
                onClick={() => void submit()}
              >
                {submitting ? 'Signing…' : 'Sign agreement'}
              </button>
              <p style={{ color: '#6b7280', fontSize: 13, marginTop: 10 }}>
                This link expires{' '}
                {new Date(data.expiresAt).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
