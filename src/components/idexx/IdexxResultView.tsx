import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  PenLine,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  fetchIdexxResultPdf,
  getIdexxResult,
  idexxErrorMessage,
  idexxResultIsPartial,
  idexxResultPdfUrl,
  idexxResultViewUrl,
  saveIdexxClientSummary,
  setIdexxResultReviewed,
  type IdexxResultDetail,
  type IdexxResultTest,
} from '../../api/idexx';
import { fetchPatientByIdStaff } from '../../api/patients';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import type { GmailComposeAttachment } from '../../api/gmail';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import { PimsChartNoteComposeModal } from '../pims/PimsChartNoteComposeModal';
import { clientIdFromPatientRow, clientNameFromPatientRow } from '../../utils/briefDisplay';
import { firstNameFromDisplayName } from '../../utils/clientNamePrefix';
import { appAlert } from '../../utils/appDialog';
import { mergeValuesFromNames } from '../../utils/messageTemplateFields';
import { idexxTestFlag, type IdexxFlag } from './idexxFlags';
import { draftIdexxClientSummary } from './idexxClientSummaryDraft';
import IdexxClientSummary from './IdexxClientSummary';
import './Idexx.css';

type Props = {
  resultId: number;
  /** Hide "Mark reviewed" (e.g. a read-only view). */
  readOnly?: boolean;
  onReviewedChange?: (reviewed: boolean) => void;
  /** Lets the list row say Partial once the full panel is loaded. */
  onPartialChange?: (partial: boolean) => void;
};

type Flag = IdexxFlag;
const testFlag = idexxTestFlag;

type Owner = { patientId: number; clientId: number; clientLabel: string };

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF.'));
    reader.readAsDataURL(blob);
  });
}

function pdfFilename(result: IdexxResultDetail): string {
  const pet = (result.patientName || 'patient').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-');
  const acc = result.accessionId ? `-${result.accessionId}` : '';
  return `${pet}-IDEXX${acc}.pdf`;
}

const EMAIL_P =
  'margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;';
const EMAIL_LI =
  'margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Paragraphs and "- " bullets, so the compose window and the sent mail keep the shape. */
function clientSummaryToEmailHtml(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    const bits = para.map((l) => escapeHtml(l.trim())).filter(Boolean);
    para = [];
    if (bits.length) out.push(`<p style="${EMAIL_P}">${bits.join('<br>')}</p>`);
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets.map((b) => `<li style="${EMAIL_LI}">${escapeHtml(b)}</li>`).join('');
    bullets = [];
    out.push(`<ul style="margin:0 0 14px;padding-left:22px;">${items}</ul>`);
  };

  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (!line) {
      flushPara();
      flushBullets();
      continue;
    }
    if (bullet) {
      flushPara();
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return out.join('');
}

function coverNote(result: IdexxResultDetail, clientLabel: string): string {
  const first = firstNameFromDisplayName(clientLabel) || 'there';
  const pet = result.patientName?.trim() || 'your pet';
  return `Hi ${first},\n\n${pet}'s IDEXX lab report is attached.\n\nThank you.`;
}

function medicalNoteSeed(
  result: IdexxResultDetail,
  flagged: Array<{ test: IdexxResultTest; flag: Exclude<Flag, null> }>
): string {
  const lines = [
    `IDEXX ${idexxResultStatusLabel(result).toLowerCase()} — ${result.patientName?.trim() || 'patient'}.`,
  ];
  const collected = result.specimenCollectionDate
    ? when(result.specimenCollectionDate).split(',').slice(0, 2).join(',')
    : '';
  if (collected) lines.push(`Collected ${collected}.`);
  if (result.accessionId) lines.push(`Accession ${result.accessionId}.`);
  if (result.testNames.length) lines.push(`${result.testNames.join(', ')}.`);
  if (flagged.length) {
    lines.push('', 'Out of range:');
    for (const { test, flag } of flagged) {
      lines.push(
        `- ${test.name}: ${test.result ?? '—'}${test.units ? ` ${test.units}` : ''} (${flag})`
      );
    }
  } else if ((result.categories ?? []).length) {
    lines.push('', 'Reported values are within the reference range.');
  }
  lines.push('', '');
  return lines.join('\n');
}

function flagText(flag: Flag): string {
  return flag === 'critical' ? 'CRIT' : flag === 'high' ? 'H' : flag === 'low' ? 'L' : '';
}

function when(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export function idexxResultStatusLabel(r: {
  status: string | null;
  statusDetail: string | null;
  hasPending?: boolean;
  categories?: Array<{ tests?: Array<{ result?: string | null }> }>;
}): string {
  const status = (r.status || '').toUpperCase();
  const detail = (r.statusDetail || '').toUpperCase();
  if (status === 'CANCELLED') return 'Cancelled';
  if (idexxResultIsPartial(r)) return 'Partial';
  if (status === 'COMPLETE') return 'Final';
  if (detail === 'ATLAB') return 'At the lab';
  return 'In process';
}

/** Value against its reference range: the green band is normal. */
function RangeBar({ test, flag }: { test: IdexxResultTest; flag: Flag }) {
  const { low, high, resultNumeric: v } = test;
  if (v == null || low == null || high == null || !(high > low)) return null;
  const pos = Math.min(0.98, Math.max(0.02, 0.2 + (0.6 * (v - low)) / (high - low)));
  return (
    <span className="idexx-range-bar" aria-hidden>
      <span className="idexx-range-bar__normal" />
      <span
        className={`idexx-range-bar__dot${flag === 'critical' ? ' idexx-range-bar__dot--critical' : flag ? ' idexx-range-bar__dot--out' : ''}`}
        style={{ left: `${pos * 100}%` }}
      />
    </span>
  );
}

/**
 * One IDEXX result, readable at a glance: what is off comes first, every value sits on
 * its reference range, and the official PDF and VetConnect PLUS are a click away.
 */
export default function IdexxResultView({
  resultId,
  readOnly,
  onReviewedChange,
  onPartialChange,
}: Props) {
  const [result, setResult] = useState<IdexxResultDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [email, setEmail] = useState<{
    title: string;
    description: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments: GmailComposeAttachment[];
  } | null>(null);
  const [summaryExpand, setSummaryExpand] = useState(0);
  const [includeInEmr, setIncludeInEmr] = useState(true);
  const [emrPatientIds, setEmrPatientIds] = useState<number[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  useEffect(() => {
    let canceled = false;
    setResult(null);
    setError(null);
    void getIdexxResult(resultId)
      .then((r) => {
        if (!canceled) {
          setResult(r);
          onPartialChange?.(idexxResultIsPartial(r));
        }
      })
      .catch((e) => {
        if (!canceled) setError(idexxErrorMessage(e, 'Could not load this result.'));
      });
    return () => {
      canceled = true;
    };
  }, [resultId]);

  useEffect(() => {
    if (result?.patientId == null) {
      setOwner(null);
      return;
    }
    const patientId = result.patientId;
    let canceled = false;
    void fetchPatientByIdStaff(patientId)
      .then((raw) => {
        if (canceled || !raw || typeof raw !== 'object') return;
        const row = raw as Record<string, unknown>;
        const clientId = Number(clientIdFromPatientRow(row));
        if (!Number.isFinite(clientId) || clientId <= 0) return;
        setOwner({
          patientId,
          clientId,
          clientLabel: clientNameFromPatientRow(row) || result.clientLastName || 'Client',
        });
      })
      .catch(() => {
        /* Email and the medical note say so if the client can't be found. */
      });
    return () => {
      canceled = true;
    };
  }, [result?.patientId, result?.clientLastName]);

  const flagged = useMemo(() => {
    const out: Array<{ test: IdexxResultTest; flag: Exclude<Flag, null> }> = [];
    for (const c of result?.categories ?? []) {
      for (const t of c.tests) {
        const flag = testFlag(t);
        if (flag) out.push({ test: t, flag });
      }
    }
    return out;
  }, [result]);

  async function openPdf() {
    setBusy('pdf');
    setError(null);
    // Open the tab now so the browser doesn't block it as a pop-up.
    const win = window.open('', '_blank');
    try {
      const url = await idexxResultPdfUrl(resultId);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      setError(idexxErrorMessage(e, 'Could not open the IDEXX report.'));
    } finally {
      setBusy(null);
    }
  }

  async function openVetConnect() {
    setBusy('vcp');
    setError(null);
    const win = window.open('', '_blank');
    try {
      const url = await idexxResultViewUrl(resultId);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      setError(idexxErrorMessage(e, 'Could not open VetConnect PLUS.'));
    } finally {
      setBusy(null);
    }
  }

  async function resolveOwner(patientId: number): Promise<Owner | null> {
    if (owner?.patientId === patientId) return owner;
    const raw = await fetchPatientByIdStaff(patientId);
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const clientId = Number(clientIdFromPatientRow(row));
    if (!Number.isFinite(clientId) || clientId <= 0) return null;
    const next: Owner = {
      patientId,
      clientId,
      clientLabel: clientNameFromPatientRow(row) || result?.clientLastName || 'Client',
    };
    setOwner(next);
    return next;
  }

  async function openEmail(withSummary: boolean) {
    if (!result || result.patientId == null) return;
    setBusy(withSummary ? 'email-summary' : 'email');
    setError(null);
    try {
      const client = await resolveOwner(result.patientId);
      if (!client) {
        setError('This pet has no client on file to email.');
        return;
      }
      const pdf = await fetchIdexxResultPdf(resultId);
      const contentBase64 = await blobToBase64(pdf);
      if (!contentBase64) throw new Error('The IDEXX report was empty.');
      const pet = result.patientName?.trim() || 'Lab results';
      const wording = withSummary ? (result.clientSummary ?? '').trim() : '';
      const body = wording || coverNote(result, client.clientLabel);
      setIncludeInEmr(true);
      setEmrPatientIds([result.patientId]);
      setEmail({
        title: withSummary ? 'Email lab results' : 'Email lab report',
        description: withSummary
          ? `${pet}'s summary is the message. The IDEXX PDF is attached.`
          : `${pet}'s IDEXX PDF is attached, without the written summary.`,
        subject: `${pet}'s lab results`,
        body,
        bodyHtml: clientSummaryToEmailHtml(body),
        attachments: [
          { filename: pdfFilename(result), mimeType: 'application/pdf', contentBase64 },
        ],
      });
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not prepare the email.'));
    } finally {
      setBusy(null);
    }
  }

  async function draftSummary() {
    if (!result || result.patientId == null) return;
    if (
      result.clientSummary?.trim() &&
      !window.confirm('Replace the current summary with a new AI draft?')
    ) {
      return;
    }
    setBusy('draft');
    setError(null);
    try {
      const next = await draftIdexxClientSummary(
        result,
        result.patientName?.trim() || 'this pet'
      );
      setResult(await saveIdexxClientSummary(result.id, next, false));
      setSummaryExpand((n) => n + 1);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not draft the summary.'));
    } finally {
      setBusy(null);
    }
  }

  async function setReviewed(reviewed: boolean) {
    if (!result) return;
    if (reviewed && idexxResultIsPartial(result)) {
      await appAlert({
        title: "Results aren't complete",
        message:
          "These results aren't complete yet. Wait until all results are back before marking this reviewed.",
      });
      return;
    }
    setBusy('review');
    setError(null);
    try {
      const saved = await setIdexxResultReviewed(resultId, reviewed);
      setResult({
        ...result,
        reviewedAt: saved.reviewedAt,
        reviewedByEmployeeId: saved.reviewedByEmployeeId,
      });
      onReviewedChange?.(reviewed);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  if (!result) {
    return error ? (
      <p className="idexx-order__error">{error}</p>
    ) : (
      <p className="idexx-order__note">Loading results…</p>
    );
  }

  const critical = flagged.some((f) => f.flag === 'critical');
  const petName = result.patientName?.trim() || 'this pet';
  const noteSeed = medicalNoteSeed(result, flagged);
  const canAct = !readOnly && result.patientId != null;
  const hasSummary = Boolean(result.clientSummary?.trim());
  return (
    <div className="idexx-result">
      <div className="idexx-result__head">
        <div>
          <div className="idexx-order__title">{idexxResultStatusLabel(result)}</div>
          <div className="idexx-result__meta">
            {result.specimenCollectionDate ? (
              <span>
                Collected {when(result.specimenCollectionDate).split(',').slice(0, 2).join(',')}
              </span>
            ) : null}
            {result.idexxUpdatedAt ? <span>Updated {when(result.idexxUpdatedAt)}</span> : null}
            {result.accessionId ? <span>Accession {result.accessionId}</span> : null}
            {result.providerName || result.veterinarian ? (
              <span>{result.providerName || result.veterinarian}</span>
            ) : null}
            {result.delayed ? <span style={{ color: '#9a3412' }}>IDEXX posted a delay</span> : null}
          </div>
        </div>
        <div className="idexx-result__actions">
          {canAct ? (
            <button
              type="button"
              className={`btn btn-sm${hasSummary ? ' secondary' : ''}`}
              disabled={busy != null}
              title="Drafted from this result, earlier IDEXX values and the pet's chart"
              onClick={() => void draftSummary()}
            >
              {busy === 'draft' ? (
                <Loader2 size={13} className="pims-task-detail__spinner" aria-hidden />
              ) : (
                <Sparkles size={13} aria-hidden />
              )}{' '}
              {busy === 'draft' ? 'Drafting…' : hasSummary ? 'Draft again' : 'Draft client summary'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy != null}
            onClick={() => void openPdf()}
          >
            <FileText size={13} aria-hidden /> PDF
          </button>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy != null}
            title="Images, trends and IDEXX tools"
            onClick={() => void openVetConnect()}
          >
            <ExternalLink size={13} aria-hidden /> VetConnect PLUS
          </button>
          {canAct && hasSummary ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy != null}
              title="Email the generated summary, with the IDEXX PDF attached"
              onClick={() => void openEmail(true)}
            >
              <Mail size={13} aria-hidden />{' '}
              {busy === 'email-summary' ? 'Preparing…' : 'Email with summary'}
            </button>
          ) : null}
          {canAct ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy != null}
              title="Email a short note with the IDEXX PDF attached, without the written summary"
              onClick={() => void openEmail(false)}
            >
              <Mail size={13} aria-hidden />{' '}
              {busy === 'email' ? 'Preparing…' : hasSummary ? 'Email without summary' : 'Email client'}
            </button>
          ) : null}
          {canAct ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy != null}
              title="Write your read of these results and save it on the chart"
              onClick={() => setNoteOpen(true)}
            >
              <PenLine size={13} aria-hidden /> Medical note
            </button>
          ) : null}
          {readOnly ? null : result.reviewedAt ? (
            <>
              <span className="idexx-result__reviewed">
                <CheckCircle2 size={13} aria-hidden /> Reviewed {when(result.reviewedAt)}
              </span>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy != null}
                title="Mark as not reviewed"
                onClick={() => void setReviewed(false)}
              >
                <RotateCcw size={13} aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy != null}
              onClick={() => void setReviewed(true)}
            >
              <CheckCircle2 size={13} aria-hidden /> Mark reviewed
            </button>
          )}
        </div>
      </div>

      {error ? <p className="idexx-order__error">{error}</p> : null}
      {noteSaved ? (
        <p className="idexx-order__note idexx-order__note--ok">Medical note saved on the chart.</p>
      ) : null}

      {busy === 'draft' ? <p className="idexx-order__note">Drafting the client summary…</p> : null}
      {(result.categories ?? []).length || hasSummary ? (
        <IdexxClientSummary
          result={result}
          readOnly={readOnly}
          onSaved={setResult}
          expandSignal={summaryExpand}
          onEmail={canAct ? () => void openEmail(true) : undefined}
          emailBusy={busy === 'email-summary'}
        />
      ) : null}

      {flagged.length ? (
        <div className={`idexx-result__flags${critical ? ' idexx-result__flags--critical' : ''}`}>
          <span className="idexx-result__flags-title">
            {critical ? 'Critical' : `${flagged.length} out of range`}
          </span>
          {flagged.map(({ test, flag }, i) => (
            <span
              key={`${test.code ?? test.name}-${i}`}
              className={`idexx-result__flag-pill${flag === 'critical' ? ' idexx-result__flag-pill--critical' : ''}`}
            >
              {test.name} {test.result}
              {test.units ? ` ${test.units}` : ''} {flagText(flag)}
            </span>
          ))}
        </div>
      ) : (result.categories ?? []).length ? (
        <div className="idexx-order__note idexx-order__note--ok">
          Everything is within the reference range.
        </div>
      ) : (
        <div className="idexx-order__note">No values yet.</div>
      )}

      {flagged.length ? (
        <div className="idexx-result__toolbar">
          <span />
          <label className="idexx-result__toggle">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            Only out of range
          </label>
        </div>
      ) : null}

      {(result.categories ?? []).map((c, ci) => {
        const tests = onlyFlagged ? c.tests.filter((t) => testFlag(t)) : c.tests;
        if (!tests.length) return null;
        return (
          <div key={`${c.code ?? c.name}-${ci}`} className="idexx-result__section">
            <div className="idexx-result__section-title">{c.name}</div>
            <table className="idexx-result__table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Result</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t, ti) => {
                  const flag = testFlag(t);
                  return (
                    <tr
                      key={`${t.code ?? t.name}-${ti}`}
                      className={flag ? `idexx-result__row--${flag}` : undefined}
                    >
                      <td>
                        {t.name}
                        {t.notes?.length ? (
                          <div className="idexx-result__note">{t.notes.join('\n')}</div>
                        ) : null}
                      </td>
                      <td className="idexx-result__value">
                        {t.qualifier ? `${t.qualifier} ` : ''}
                        {t.result ?? '—'}
                        {t.units ? <span className="idexx-result__units">{t.units}</span> : null}
                        {flag ? <span className="idexx-result__flag">{flagText(flag)}</span> : null}
                      </td>
                      <td className="idexx-result__range">
                        <RangeBar test={t} flag={flag} />
                        {t.referenceRange ?? ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {c.notes?.length ? (
              <div className="idexx-result__note" style={{ padding: '6px 10px' }}>
                {c.notes.map((n) => [n.title, n.content].filter(Boolean).join(': ')).join('\n')}
              </div>
            ) : null}
          </div>
        );
      })}

      {result.notes?.content ? (
        <div className="idexx-result__notes">
          {result.notes.title ? <strong>{result.notes.title}: </strong> : null}
          {result.notes.content}
        </div>
      ) : null}

      {email && owner && result.patientId != null ? (
        <ClientEmailComposeModal
          open
          clientId={owner.clientId}
          clientLabel={owner.clientLabel}
          title={email.title}
          headerDescription={email.description}
          initialSubject={email.subject}
          initialBodyText={email.body}
          initialBodyHtml={email.bodyHtml}
          initialAttachments={email.attachments}
          mergeValues={mergeValuesFromNames({
            clientFullName: owner.clientLabel,
            clientFirstName: firstNameFromDisplayName(owner.clientLabel),
            patientName: result.patientName,
          })}
          regardingPatients={[{ id: result.patientId, name: petName }]}
          regardingPatientIds={emrPatientIds}
          onRegardingPatientIdsChange={setEmrPatientIds}
          patientEmrLogging="opt-in"
          includeInPatientEmr={includeInEmr}
          onIncludeInPatientEmrChange={setIncludeInEmr}
          onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
            await recordScoutChartCommunication({
              clientId: owner.clientId,
              patientIds: includeInEmr ? emrPatientIds : [],
              channel: 'email',
              body: bodyHtml || bodyText,
              subject,
              destination: to,
              sentFrom: from,
              typeLabel: 'IDEXX results email',
              includeOnMedicalRecord: includeInEmr,
            });
          }}
          onClose={() => setEmail(null)}
        />
      ) : null}

      {noteOpen && result.patientId != null ? (
        <PimsChartNoteComposeModal
          patientId={result.patientId}
          clientId={owner?.clientId ?? null}
          patientName={petName}
          seedBody={noteSeed}
          noteDate={result.specimenCollectionDate ?? result.receivedAt}
          hint="Your read of these results. Wrap up to lock it on the chart."
          onClose={() => setNoteOpen(false)}
          onWrappedUp={() => {
            setNoteOpen(false);
            setNoteSaved(true);
          }}
        />
      ) : null}
    </div>
  );
}
