import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCan } from '../../permissions/PermissionContext';
import { apiErrorMessage } from '../../api/http';
import {
  getClientCardOnFile,
  removeClientCardOnFile,
  saveClientCardOnFile,
  startClientCardReplacement,
  type ClientCardOnFile,
} from '../../api/visitWorkflow';
import { getMembershipCard, listPatientMemberships } from '../../api/memberships';
import ClientCardSetupEntry from './ClientCardSetupEntry';
import { expiredCardText } from '../soap/checkoutPaymentText';
import { CARD_ON_FILE_STAFF_WORDING } from '../../utils/cardOnFileWording';

const SOURCE_LABEL: Record<string, string> = {
  terminal: 'Tap to Pay at a visit',
  store: 'the online store',
  checkout_link: 'a pay link',
  consent_form: 'a signed consent form',
  membership: 'a membership sign-up',
  manual: 'entered by staff',
};

function cardText(card: NonNullable<ClientCardOnFile['card']>): string {
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  const ending = card.last4 ? ` ending ${card.last4}` : '';
  const exp =
    card.expMonth && card.expYear
      ? `, expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
      : '';
  return `${brand}${ending}${exp}`;
}

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "entered by staff, agreement 2026-11-12": how the card was saved, then which wording the owner agreed to. */
export function agreedHow(source: string | null | undefined, version: string | null | undefined): string {
  const how = source ? SOURCE_LABEL[source] ?? source : null;
  const which = version ? `agreement ${version}` : 'before agreement versions were recorded';
  return how ? `${how}, ${which}` : which;
}

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type OtherCardMembership = { id: number; patientId: number; petName: string };

/** Active Stripe memberships in the household billed on a card other than the one on file. Read only. */
async function membershipsOnOtherCard(
  clientId: number,
  card: NonNullable<ClientCardOnFile['card']>,
): Promise<OtherCardMembership[]> {
  const memberships = await listPatientMemberships({ clientId });
  const out: OtherCardMembership[] = [];
  for (const m of memberships) {
    if (m.status !== 'active' || !m.stripeSubscriptionId?.startsWith('sub_')) continue;
    try {
      const billed = (await getMembershipCard(m.id)).card;
      if (!billed) continue;
      if (billed.last4 !== card.last4 || billed.brand.toLowerCase() !== (card.brand ?? '').toLowerCase()) {
        out.push({ id: m.id, patientId: m.patientId, petName: m.patientName || 'this pet' });
      }
    } catch {
      // Not allowed to see it, or Stripe did not answer: say nothing rather than guess.
    }
  }
  return out;
}

/**
 * "Card on file" on the client's Financial tab: the card, when and how the owner agreed, and
 * Replace card (SetupIntent, no charge) / Remove card (with a reason) for staff who can take payments.
 */
export default function ClientCardOnFileSection({
  clientId,
  clientName,
}: {
  clientId: number;
  /** Fills in "Name on card" when replacing or adding a card (staff can change it). */
  clientName?: string | null;
}) {
  const canManage = useCan('card_on_file.manage');
  const [info, setInfo] = useState<ClientCardOnFile | null>(null);
  const [mode, setMode] = useState<'view' | 'replace' | 'remove'>('view');
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [others, setOthers] = useState<OtherCardMembership[]>([]);
  const confirmRef = useRef<((secret: string) => Promise<string>) | null>(null);
  const onReady = useCallback((confirm: (secret: string) => Promise<string>) => {
    confirmRef.current = confirm;
  }, []);

  const load = useCallback(async () => {
    try {
      setInfo(await getClientCardOnFile(clientId));
    } catch {
      // The section stays hidden when the card cannot be read.
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = info?.card ?? null;
  const cardKey = card ? `${card.brand}|${card.last4}` : '';
  useEffect(() => {
    let cancelled = false;
    setOthers([]);
    if (!card) return undefined;
    void membershipsOnOtherCard(clientId, card)
      .then((list) => {
        if (!cancelled) setOthers(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, cardKey]);

  function close() {
    setMode('view');
    setConsent(false);
    setReason('');
    setError(null);
  }

  async function replaceCard() {
    if (!confirmRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const { setupIntentId, clientSecret } = await startClientCardReplacement(clientId);
      const confirmedId = await confirmRef.current(clientSecret);
      setInfo(await saveClientCardOnFile(clientId, { setupIntentId: confirmedId || setupIntentId, consent }));
      setSaved('New card saved. Nothing was charged.');
      close();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeCard() {
    setBusy(true);
    setError(null);
    try {
      const after = await removeClientCardOnFile(clientId, reason.trim());
      setInfo(after);
      const kept = after.removed?.stillUsedBy ?? [];
      setSaved(kept.length ? `Card removed. Kept only for ${listNames(kept)}.` : 'Card removed.');
      close();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    return null;
  }

  const agreed = card && info.consentAt;
  const oldWording =
    card && info.agreementVersion != null && info.agreementVersion < info.currentAgreementVersion;

  return (
    <section className="client-card" aria-label="Card on file">
      <div className="client-card__head">
        <h3>Card on file</h3>
        {canManage && mode === 'view' ? (
          <div className="client-card__actions">
            <button type="button" className="client-fin__btn" onClick={() => { setSaved(null); setMode('replace'); }}>
              {card ? 'Replace card' : 'Add card'}
            </button>
            {card ? (
              <button type="button" className="client-fin__btn client-fin__btn-danger" onClick={() => { setSaved(null); setMode('remove'); }}>
                Remove card
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="client-card__card">
        {card ? (
          card.expired ? (
            <>
              {card.brand ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)}: ` : ''}
              <strong className="client-card__warn">{expiredCardText(card)}</strong>. Ask the owner for a new card.
            </>
          ) : (
            cardText(card)
          )
        ) : (
          'No card on file'
        )}
      </p>
      {agreed ? (
        <p className="client-card__muted">
          Owner agreed {when(info.consentAt)} ({agreedHow(info.consentSource, info.agreementVersion)}).
          {oldWording ? ' That is older than the current wording, so a visit charge needs a fresh yes.' : ''}
        </p>
      ) : card ? (
        <p className="client-card__muted">No record of when the owner agreed.</p>
      ) : info.declinedAt ? (
        <p className="client-card__muted">The owner said no to keeping a card on {when(info.declinedAt)}.</p>
      ) : null}

      {others.length > 0 ? (
        <p className="client-card__note">
          {others.length === 1
            ? `${others[0].petName}'s membership is billed on a different card.`
            : `${others.length} memberships are billed on a different card.`}{' '}
          {others.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ', ' : ''}
              <Link to={`/schedule/patients?patientId=${m.patientId}`}>Open {m.petName}&apos;s membership</Link>
            </span>
          ))}
        </p>
      ) : null}

      {saved ? <p className="client-fin__note">{saved}</p> : null}

      {canManage && mode === 'replace' ? (
        <div className="client-card__form">
          <ClientCardSetupEntry name={clientName?.trim() || null} onReady={onReady} />
          <label className="client-card__consent">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              {CARD_ON_FILE_STAFF_WORDING} Ask first. Tick this box when they say yes.
            </span>
          </label>
          {error ? <p className="client-fin__err">{error}</p> : null}
          <div className="client-card__actions">
            <button type="button" className="client-fin__btn" disabled={busy || !consent} onClick={() => void replaceCard()}>
              {busy ? 'Saving…' : 'Save card'}
            </button>
            <button type="button" className="client-fin__btn" disabled={busy} onClick={close}>Cancel</button>
          </div>
          <p className="client-card__muted">Nothing is charged. Memberships keep the card they are billed on.</p>
        </div>
      ) : null}

      {canManage && mode === 'remove' ? (
        <div className="client-card__form">
          {info.stillUsedBy?.length ? (
            <p className="client-card__note">
              Still used by {listNames(info.stillUsedBy)}. The card is kept for {info.stillUsedBy.length === 1 ? 'it' : 'them'} only,
              so {info.stillUsedBy.length === 1 ? 'it keeps' : 'they keep'} billing. It won&apos;t be used for visits or shown in the
              online store.
            </p>
          ) : null}
          <label className="client-card__field">
            <span>Why is the card being removed?</span>
            <input value={reason} maxLength={500} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error ? <p className="client-fin__err">{error}</p> : null}
          <div className="client-card__actions">
            <button type="button" className="client-fin__btn client-fin__btn-danger" disabled={busy || !reason.trim()} onClick={() => void removeCard()}>
              {busy ? 'Removing…' : 'Remove card'}
            </button>
            <button type="button" className="client-fin__btn" disabled={busy} onClick={close}>Cancel</button>
          </div>
          <p className="client-card__muted">
            Removes the card everywhere: visits, the online store and portal bill pay. The reason is kept in the financial audit log.
          </p>
        </div>
      ) : null}
    </section>
  );
}
