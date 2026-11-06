import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import {
  cancelMembershipAgreement,
  listMembershipAgreementRequests,
  resendMembershipAgreement,
  sendMembershipAgreement,
  type MembershipAgreementRequest,
} from '../../api/memberships';
import { fetchChatHoursOfOperation } from '../../api/chatHoursOfOperation';
import { fetchClientInfo } from '../../api/clientPortal';
import { apiErrorMessage } from '../../api/http';
import { useCan } from '../../permissions/PermissionContext';
import { appConfirm, appPrompt } from '../../utils/appDialog';
import { buildMembershipAgreementText, defaultChatHoursOfOperation } from '../../utils/chatHours';
import { currentPracticeId } from '../../utils/practiceIdFromToken';

type Props = {
  patientId: number;
  clientId?: number | null;
  /** Current membership: enables "Send membership agreement" (re-send, or none on file). */
  membershipId?: number | null;
  /** Bump to reload (e.g. after the post-visit signup modal closes). */
  refreshKey?: number;
};

const STATUS_LABEL: Record<MembershipAgreementRequest['status'], string> = {
  pending: 'Waiting for signature',
  signing: 'Signed — finishing setup',
  completed: 'Signed',
  failed: 'Signed — signup needs attention',
  expired: 'Expired unsigned',
  cancelled: 'Cancelled',
};

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Membership agreements emailed to the owner to sign: status, copy link, resend, cancel; and
 * sending the agreement on its own for an existing membership.
 */
export default function MembershipAgreementRequests({
  patientId,
  clientId,
  membershipId,
  refreshKey = 0,
}: Props) {
  const canSend = useCan('membership.enroll');
  const [rows, setRows] = useState<MembershipAgreementRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(() => {
    void listMembershipAgreementRequests(patientId)
      .then(setRows)
      .catch(() => setRows([]));
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function ownerEmail(): Promise<string> {
    if (clientId == null) return '';
    const c = await fetchClientInfo(clientId).catch(() => null);
    return typeof c?.email === 'string' ? c.email.trim() : '';
  }

  async function sendAgreement() {
    if (membershipId == null) return;
    const toEmail = await appPrompt({
      title: 'Send membership agreement',
      message:
        'Email the owner a link to read and sign the membership agreement. The signed copy is filed on the chart. Their membership and billing do not change.',
      defaultValue: await ownerEmail(),
      placeholder: 'owner@example.com',
      confirmLabel: 'Send',
    });
    if (!toEmail?.trim()) return;
    const hours = await fetchChatHoursOfOperation(currentPracticeId()).catch(() => null);
    await run(() =>
      sendMembershipAgreement({
        membershipId,
        toEmail: toEmail.trim(),
        agreementText: buildMembershipAgreementText(hours ?? defaultChatHoursOfOperation()),
      }),
    );
  }

  const visible = rows.filter((r) => r.status !== 'cancelled').slice(0, 3);
  if (!visible.length && (membershipId == null || !canSend)) return null;

  return (
    <div className="pmp-agreements" style={{ marginTop: 12 }}>
      {visible.map((r) => (
        <div
          key={r.id}
          className="pmp-agreements__row"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}
        >
          <Mail size={14} aria-hidden />
          <span>
            <strong>{STATUS_LABEL[r.status]}</strong>
            {' · '}
            {r.kind === 'post_visit_signup' ? 'Signup agreement' : 'Agreement'} sent {when(r.sentAt)} to{' '}
            {r.sentToEmail}
            {r.status === 'pending' ? ` · expires ${when(r.expiresAt)}` : ''}
            {r.status === 'completed' && r.signedName ? ` · signed by ${r.signedName} ${when(r.signedAt)}` : ''}
          </span>
          {r.status === 'failed' && r.error ? (
            <span className="pmp-muted" style={{ flexBasis: '100%', color: '#9a3412' }}>
              {r.error}
            </span>
          ) : null}
          {r.status === 'pending' ? (
            <button
              type="button"
              className="pims-detail__btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(r.link).then(() => setCopiedId(r.id));
              }}
            >
              {copiedId === r.id ? 'Link copied' : 'Copy link'}
            </button>
          ) : null}
          {canSend && (r.status === 'pending' || r.status === 'expired') ? (
            <button
              type="button"
              className="pims-detail__btn-ghost"
              disabled={busy}
              onClick={() => void run(() => resendMembershipAgreement(r.id))}
            >
              Resend
            </button>
          ) : null}
          {canSend && r.status === 'pending' ? (
            <button
              type="button"
              className="pims-detail__btn-ghost"
              disabled={busy}
              onClick={() => {
                void appConfirm({
                  title: 'Cancel this agreement?',
                  message: 'The link stops working. Nothing was charged or refunded.',
                  confirmLabel: 'Cancel agreement',
                  danger: true,
                }).then((ok) => {
                  if (ok) void run(() => cancelMembershipAgreement(r.id));
                });
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ))}
      {membershipId != null && canSend ? (
        <button
          type="button"
          className="pims-detail__btn-ghost"
          disabled={busy}
          onClick={() => void sendAgreement()}
        >
          <Mail size={15} aria-hidden /> Send membership agreement
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="pmp-muted" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
