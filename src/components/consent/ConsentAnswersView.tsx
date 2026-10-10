import {
  formatMemorialItemLine,
  parseMemorialItems,
  type EuthanasiaConsentStatus,
} from '../../api/consent';
import ConsentWeightAlert from './ConsentWeightAlert';
import { parseConsentWeightChange } from '../../utils/consentWeightAlert';
import './ConsentAnswersView.css';

function answerStr(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === 'string' ? v.trim() : '';
}

function money(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function pawPrints(answers: Record<string, unknown>): string[] {
  if (Array.isArray(answers.pawPrints)) {
    return (answers.pawPrints as unknown[]).filter((v): v is string => typeof v === 'string');
  }
  return typeof answers.pawPrint === 'string' ? [answers.pawPrint] : [];
}

function paidClayMemorial(answers: Record<string, unknown>): {
  name: string;
  amountLabel: string;
} | null {
  const prints = pawPrints(answers);
  const pay =
    answers.clayChargePayment && typeof answers.clayChargePayment === 'object'
      ? (answers.clayChargePayment as { itemName?: string; amount?: number })
      : null;
  const isPaid = prints.includes('clayCharge') || Boolean(pay);
  if (!isPaid) return null;
  return {
    name: pay?.itemName?.trim() || 'Clay paw print',
    amountLabel: money(pay?.amount) || 'Paid',
  };
}

export default function ConsentAnswersView({
  response,
}: {
  response: NonNullable<EuthanasiaConsentStatus['response']>;
}) {
  const answers = response.answers ?? {};
  const weightChange = parseConsentWeightChange(answers);
  const nameplate = [answers.nameplateLine1, answers.nameplateLine2, answers.nameplateLine3]
    .filter((line) => typeof line === 'string' && line.trim())
    .join(' / ');
  const clay = paidClayMemorial(answers);
  const storeItems = parseMemorialItems(answers.memorialItems).filter(
    (item) => !clay || !/clay\s*paw/i.test(item.name),
  );
  const memorialLines = [
    ...(clay
      ? [{ line: `${clay.name} — ${clay.amountLabel}`, highlight: true }]
      : []),
    ...storeItems.map((item) => ({ line: formatMemorialItemLine(item), highlight: false })),
  ];
  const notify = answerStr(answers, 'vetsToNotify');
  const notes = answerStr(answers, 'additionalInfo');
  const language = Array.isArray(answers.consentLanguage)
    ? (answers.consentLanguage as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  return (
    <div className="consent-answers">
      {weightChange ? <ConsentWeightAlert change={weightChange} /> : null}

      <div className="consent-answers-card">
        <span>Signed by</span>
        <strong>{response.signedName || '—'}</strong>
      </div>

      {answerStr(answers, 'petWeightLbs') ? (
        <div className="consent-answers-card">
          <span>Weight</span>
          <strong>{answerStr(answers, 'petWeightLbs')} lbs</strong>
        </div>
      ) : null}

      <div className="consent-answers-card is-emphasis">
        <span>Aftercare</span>
        <strong>{response.aftercareLabel || '—'}</strong>
      </div>

      {nameplate ? (
        <div className="consent-answers-card">
          <span>Nameplate</span>
          <strong>{nameplate}</strong>
        </div>
      ) : null}

      <div className="consent-answers-card">
        <span>Paw print</span>
        <strong>{response.pawPrintLabel || '—'}</strong>
      </div>

      {memorialLines.length ? (
        <div className="consent-answers-card is-memorial">
          <span>Memorial items purchased</span>
          <ul>
            {memorialLines.map((row) => (
              <li key={row.line} className={row.highlight ? 'is-highlight' : undefined}>
                {row.line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notify && !/^none$/i.test(notify) ? (
        <div className="consent-answers-card">
          <span>Clinics to inform</span>
          <strong>{notify}</strong>
        </div>
      ) : null}

      {notes ? (
        <div className="consent-answers-card">
          <span>Notes from the family</span>
          <strong>{notes}</strong>
        </div>
      ) : null}

      {language.length ? (
        <details className="consent-answers-legal">
          <summary>Signed consent language</summary>
          {language.map((para, idx) => (
            <p key={idx}>{para}</p>
          ))}
        </details>
      ) : null}

      {response.signatureDataUrl ? (
        <div className="consent-answers-card">
          <span>Signature</span>
          <img src={response.signatureDataUrl} alt="Client signature" />
        </div>
      ) : null}
    </div>
  );
}
