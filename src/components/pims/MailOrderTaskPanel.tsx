import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DateTime } from 'luxon';
import { Loader2, Sparkles } from 'lucide-react';
import {
  getMailOrder,
  storeApiError,
  type MailOrder,
  type MailOrderLine,
} from '../../api/onlineStore';
import { fetchPatientByIdStaff, fetchPatientMedicalRecordStaff } from '../../api/patients';
import { fetchPatientAppointmentsStaff } from '../../api/pimsAppointments';
import {
  listEncounters,
  listPatientPrescriptions,
  listProblems,
  type PatientPrescription,
  type PatientProblem,
  type SoapEncounter,
} from '../../api/visitWorkflow';
import { chatAboutChart } from '../../api/soapScribe';
import {
  buildCaseHistorySource,
  signalmentFromPatient,
} from '../../utils/buildCaseHistorySource';
import { clientNameFromPatientRow } from '../../utils/briefDisplay';
import { formatAutoshipFrequency } from '../../pages/store/storeCartState';
import type { MedicalRecordBundle } from '../../utils/patientChartFromMedicalRecord';
import { stripCitationTokens } from '../../utils/chartCitation';
import { BookPatientChartButton } from '../BookPatientChartButton';
import {
  clampRefillExpiration,
  dateForInput,
  maxRefillExpirationInput,
  refillExpirationExceedsMax,
  todayInput,
} from '../../utils/printRxLabel';

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function addMonths(from: string, months: number): string {
  const date = from ? new Date(`${from}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  date.setMonth(date.getMonth() + months);
  return dateForInput(date);
}

function unwrapPatientRecord(profile: unknown): Record<string, unknown> | null {
  if (!profile || typeof profile !== 'object') return null;
  const o = profile as Record<string, unknown>;
  const nested = o.patient;
  if (nested && typeof nested === 'object') {
    return {
      ...(nested as Record<string, unknown>),
      client: o.client ?? (nested as Record<string, unknown>).client,
    };
  }
  return o;
}

function isPlaceholderMailScript(text?: string | null): boolean {
  const t = (text || '').trim();
  return !t || /^use as directed\.?$/i.test(t);
}

function groupLines(order: MailOrder) {
  const groups = new Map<
    string,
    { key: string; petId: number | null; petName: string | null; lines: MailOrderLine[] }
  >();
  for (const line of order.lines || []) {
    const key = String(line.patientId || line.patientName || 'household');
    const existing = groups.get(key);
    if (existing) existing.lines.push(line);
    else {
      groups.set(key, {
        key,
        petId: line.patientId ?? null,
        petName: line.patientName ?? null,
        lines: [line],
      });
    }
  }
  return [...groups.values()];
}

async function summarizePet(opts: {
  practiceId: number;
  patientId: number;
  patientName: string;
  clientName: string | null;
}): Promise<string> {
  const today = DateTime.now().toISODate() || '';
  const apptStart = DateTime.now().minus({ years: 20 }).toUTC().toISO();
  const apptEnd = DateTime.now().plus({ years: 2 }).toUTC().toISO();
  const [profile, problems, meds, encounters, medicalRecord, appointments] = await Promise.all([
    fetchPatientByIdStaff(opts.patientId).catch(() => null),
    listProblems(opts.patientId).catch(() => [] as PatientProblem[]),
    listPatientPrescriptions(opts.patientId, { activeChronicOnly: true }).catch(
      () => [] as PatientPrescription[],
    ),
    listEncounters({ patientId: opts.patientId }).catch(() => [] as SoapEncounter[]),
    fetchPatientMedicalRecordStaff(opts.patientId).catch(() => null),
    fetchPatientAppointmentsStaff(opts.patientId, {
      practiceId: opts.practiceId,
      start: apptStart ?? undefined,
      end: apptEnd ?? undefined,
      includeInactivePatient: true,
    }).catch(() => []),
  ]);
  const rec = unwrapPatientRecord(profile);
  const owner = rec ? clientNameFromPatientRow(rec) : opts.clientName;
  const src = buildCaseHistorySource({
    patientId: String(opts.patientId),
    patientName: opts.patientName,
    clientName: owner,
    signalment: signalmentFromPatient(rec),
    problems,
    meds,
    encounters,
    appointments,
    patientRecord: rec,
    medicalRecord: medicalRecord as MedicalRecordBundle | null,
    asOfDate: today,
  });
  if (!src.text.trim()) return 'No chart text to summarize yet.';
  const summary = await chatAboutChart({
    sourceText: src.text,
    patientName: opts.patientName,
    clientName: owner,
    asOfDate: today,
    patientId: opts.patientId,
    question: [
      `Write a refill-approval snapshot for ${opts.patientName}.`,
      'The doctor is deciding whether this mail-order medication is appropriate — not walking into an exam.',
      'Use only facts in the source.',
      'Do not include [ref:…] tokens, record IDs, brackets, or source markers of any kind.',
      'Use short labeled sections with a blank line between them.',
      'Headings on their own line: Signalment, Pertinent history, Vaccines / preventatives, Chronic medications, Watch.',
      'Keep it under 180 words. Dates as YYYY-MM-DD only when the source has them.',
    ].join(' '),
  });
  return stripCitationTokens(summary.trim() || '') || 'No summary came back.';
}

type Props = {
  practiceId: number;
  mailOrderId: number;
  canApprove: boolean;
  busy: boolean;
  approvalNote: string;
  onApprovalNoteChange: (value: string) => void;
  onApprove: (
    outcome: 'approved' | 'rejected' | 'send_back',
    lineRefills?: Array<{ lineId: number; refills: number; expiration?: string | null }>,
    lineScripts?: Array<{ lineId: number; scriptText: string }>,
  ) => void;
  onPresentationSynced?: () => void;
};

export default function MailOrderTaskPanel({
  practiceId,
  mailOrderId,
  canApprove,
  busy,
  approvalNote,
  onApprovalNoteChange,
  onApprove,
  onPresentationSynced,
}: Props) {
  const [order, setOrder] = useState<MailOrder | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [refillsByLine, setRefillsByLine] = useState<Record<number, string>>({});
  const [expirationsByLine, setExpirationsByLine] = useState<Record<number, string>>({});
  const [scriptsByLine, setScriptsByLine] = useState<Record<number, string>>({});
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const syncedRef = useRef(false);
  const onSyncedRef = useRef(onPresentationSynced);
  onSyncedRef.current = onPresentationSynced;

  useEffect(() => {
    let cancelled = false;
    syncedRef.current = false;
    setLoadError(null);
    void getMailOrder(practiceId, mailOrderId)
      .then((row) => {
        if (cancelled) return;
        setOrder(row);
        setRefillsByLine((prev) => {
          const next = { ...prev };
          for (const line of row.lines || []) {
            if (next[line.id] == null) {
              next[line.id] =
                line.authorizedRefills != null
                  ? String(line.authorizedRefills)
                  : line.refillsRemaining != null
                    ? String(line.refillsRemaining)
                    : '';
            }
          }
          return next;
        });
        setExpirationsByLine((prev) => {
          const next = { ...prev };
          for (const line of row.lines || []) {
            if (next[line.id] == null) {
              next[line.id] = (line.authorizedRefillExpiration || '').slice(0, 10);
            }
          }
          return next;
        });
        setScriptsByLine((prev) => {
          const next = { ...prev };
          for (const line of row.lines || []) {
            if (next[line.id] == null && !isPlaceholderMailScript(line.scriptText)) {
              next[line.id] = line.scriptText || '';
            }
          }
          return next;
        });
        if (!syncedRef.current) {
          syncedRef.current = true;
          onSyncedRef.current?.();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(storeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, mailOrderId]);

  const groups = useMemo(() => (order ? groupLines(order) : []), [order]);
  const pets = useMemo(() => {
    if (!order) return [];
    if (order.patients?.length) {
      return order.patients.filter((p) => p.id != null || p.name);
    }
    return groups.map((g) => ({ id: g.petId, name: g.petName }));
  }, [order, groups]);

  const handleSummarize = async () => {
    if (!order || summarizing) return;
    const targets = pets.filter((p): p is { id: number; name: string | null } => p.id != null);
    if (!targets.length) {
      setSummaryError('No pets are linked to this order.');
      return;
    }
    setSummarizing(true);
    setSummaryError(null);
    try {
      const next: Record<string, string> = {};
      for (const pet of targets) {
        next[String(pet.id)] = await summarizePet({
          practiceId,
          patientId: pet.id,
          patientName: pet.name || `Patient #${pet.id}`,
          clientName: order.customerName,
        });
      }
      setSummaries(next);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Could not summarize the case.');
    } finally {
      setSummarizing(false);
    }
  };

  if (loadError) {
    return <p className="pims-task-detail__error">{loadError}</p>;
  }
  if (!order) {
    return (
      <p className="pims-task-detail__muted">
        <Loader2 className="pims-task-detail__spinner" size={16} /> Loading mail order…
      </p>
    );
  }

  return (
    <section className="pims-task-mail">
      <div className="pims-task-mail__who">
        <p className="pims-task-mail__client">
          {order.clientId ? (
            <Link
              className="pims-task-mail__link"
              to={`/schedule/clients?clientId=${encodeURIComponent(String(order.clientId))}`}
            >
              {order.customerName}
            </Link>
          ) : (
            order.customerName
          )}
        </p>
        <p className="pims-task-mail__pets">
          {pets.length
            ? pets.map((pet, i) => (
                <span key={`${pet.id ?? pet.name ?? i}`}>
                  {i > 0 ? ', ' : null}
                  {pet.id ? (
                    <Link
                      className="pims-task-mail__link"
                      to={`/schedule/patients?patientId=${encodeURIComponent(String(pet.id))}`}
                    >
                      {pet.name || `Patient #${pet.id}`}
                    </Link>
                  ) : (
                    pet.name || 'Household'
                  )}
                </span>
              ))
            : 'No pets on this order'}
        </p>
        <p className="pims-task-mail__meta">
          <Link
            className="pims-task-mail__link"
            to={`/schedule/mail-orders?orderId=${encodeURIComponent(String(order.id))}`}
          >
            Mail order #{order.id}
          </Link>
          {order.doctorName ? ` · ${order.doctorName}` : ''}
        </p>
      </div>

      {groups.map((group) => (
        <div key={group.key} className="pims-task-mail__group">
          {group.petName || group.petId ? (
            <p className="pims-task-mail__pet">
              {group.petId ? (
                <Link
                  className="pims-task-mail__link"
                  to={`/schedule/patients?patientId=${encodeURIComponent(String(group.petId))}`}
                >
                  {group.petName || `Patient #${group.petId}`}
                </Link>
              ) : (
                group.petName
              )}
            </p>
          ) : null}
          {group.lines.map((line) => (
            <div key={line.id} className="pims-task-mail__line">
              <h4>
                {line.name} × {Number(line.quantity)}
              </h4>
              <p className="pims-task-mail__line-meta">
                {line.autoshipFrequency
                  ? `Auto-ship ${formatAutoshipFrequency(line.autoshipFrequency)}${
                      line.renewalDate ? ` · next ${line.renewalDate}` : ''
                    }`
                  : 'One-time fill'}
                {line.primaryProviderName ? ` · ${line.primaryProviderName}` : ''}
              </p>
              <p className="pims-task-mail__line-meta">
                {line.refillsRemaining != null
                  ? `${line.refillsRemaining} refill${line.refillsRemaining === 1 ? '' : 's'} remaining on the prior Rx`
                  : line.refillNote || 'No prior refill count on file'}
              </p>
              {canApprove && isPlaceholderMailScript(line.scriptText) ? (
                <label className="pims-task-mail__refill">
                  Directions
                  <textarea
                    className="settings-input"
                    rows={3}
                    value={scriptsByLine[line.id] ?? ''}
                    onChange={(e) =>
                      setScriptsByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                    }
                    placeholder="Required — write the sig for the filler"
                  />
                </label>
              ) : !isPlaceholderMailScript(line.scriptText) ? (
                <p className="pims-task-mail__script">{line.scriptText}</p>
              ) : null}
              {canApprove ? (
                <>
                  <label className="pims-task-mail__refill">
                    <span className="pims-task-mail__refill-head">
                      How many refills should the filler add?
                      {group.petId ? (
                        <BookPatientChartButton
                          patientId={String(group.petId)}
                          patientName={group.petName || line.patientName || 'Patient'}
                          practiceId={practiceId}
                          practiceTz={PRACTICE_TZ}
                          showAlerts
                          label="View details"
                          className="pims-task-mail__details-link"
                          onApplyRefillExpiration={(dateInput) => {
                            if (refillExpirationExceedsMax(dateInput)) {
                              setSummaryError('Refill expiration cannot be more than 1 year from today.');
                              setExpirationsByLine((prev) => ({
                                ...prev,
                                [line.id]: maxRefillExpirationInput(),
                              }));
                              return;
                            }
                            setSummaryError(null);
                            setExpirationsByLine((prev) => ({ ...prev, [line.id]: dateInput }));
                          }}
                        />
                      ) : null}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="settings-input"
                      value={refillsByLine[line.id] ?? ''}
                      onChange={(e) =>
                        setRefillsByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                      placeholder="Required"
                      required
                    />
                  </label>
                  {Math.max(0, Math.floor(Number(refillsByLine[line.id]) || 0)) > 0 ||
                  expirationsByLine[line.id] ? (
                    <label className="pims-task-mail__refill">
                      <span className="pims-task-mail__refill-head">
                        Refill expiration
                        <span className="pims-task-mail__exp-chips" role="group" aria-label="Set refill expiration">
                          {([3, 6, 12] as const).map((months) => {
                            const value = clampRefillExpiration(addMonths(todayInput(), months));
                            const active = expirationsByLine[line.id] === value;
                            return (
                              <button
                                key={months}
                                type="button"
                                className={`pims-task-mail__chip${active ? ' is-active' : ''}`}
                                onClick={() =>
                                  setExpirationsByLine((prev) => ({ ...prev, [line.id]: value }))
                                }
                              >
                                +{months}m
                              </button>
                            );
                          })}
                        </span>
                      </span>
                      <input
                        type="date"
                        className="settings-input"
                        max={maxRefillExpirationInput()}
                        value={expirationsByLine[line.id] ?? ''}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (refillExpirationExceedsMax(next)) {
                            setSummaryError('Refill expiration cannot be more than 1 year from today.');
                            setExpirationsByLine((prev) => ({
                              ...prev,
                              [line.id]: maxRefillExpirationInput(),
                            }));
                            return;
                          }
                          setSummaryError(null);
                          setExpirationsByLine((prev) => ({ ...prev, [line.id]: next }));
                        }}
                        required={Math.max(0, Math.floor(Number(refillsByLine[line.id]) || 0)) > 0}
                      />
                    </label>
                  ) : null}
                </>
              ) : line.authorizedRefills != null ? (
                <p className="pims-task-mail__authorized">
                  Doctor authorized {line.authorizedRefills} refill
                  {line.authorizedRefills === 1 ? '' : 's'}
                  {line.authorizedRefillExpiration
                    ? ` · expire ${line.authorizedRefillExpiration}`
                    : ''}
                </p>
              ) : null}
            </div>
          ))}
          {group.petId && summaries[String(group.petId)] ? (
            <div className="pims-task-mail__summary">
              <strong>Case summary</strong>
              {summaries[String(group.petId)].split(/\n{2,}/).map((para, i) => (
                <p key={i} className="pims-task-mail__summary-p">
                  {para}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <div className="pims-task-mail__toolbar">
        <button
          type="button"
          className="pims-task-detail__btn pims-task-detail__btn--secondary"
          disabled={summarizing}
          onClick={() => void handleSummarize()}
        >
          {summarizing ? <Loader2 className="pims-task-detail__spinner" size={16} /> : <Sparkles size={16} />}
          Summarize
        </button>
        {summaryError ? <p className="pims-task-detail__error">{summaryError}</p> : null}
      </div>

      {canApprove ? (
        <>
          <label className="pims-task-detail__field">
            <span>Notes</span>
            <textarea
              rows={3}
              value={approvalNote}
              onChange={(e) => onApprovalNoteChange(e.target.value)}
              placeholder="Notes are saved on the mail order"
            />
          </label>
          <div className="pims-task-detail__actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="pims-task-detail__btn pims-task-detail__btn--primary"
              disabled={busy}
              onClick={() => {
                const lineRefills = (order.lines || []).map((line) => ({
                  lineId: line.id,
                  refills: Math.max(0, Math.floor(Number(refillsByLine[line.id]) || 0)),
                  expiration: (expirationsByLine[line.id] || '').trim() || null,
                }));
                const lineScripts = (order.lines || []).map((line) => ({
                  lineId: line.id,
                  scriptText: (
                    scriptsByLine[line.id] ||
                    (!isPlaceholderMailScript(line.scriptText) ? line.scriptText : '') ||
                    ''
                  ).trim(),
                }));
                const missing = (order.lines || []).some(
                  (line) => String(refillsByLine[line.id] ?? '').trim() === '',
                );
                if (missing) {
                  setSummaryError('Enter how many refills to add for each item before approving.');
                  return;
                }
                const missingExpiration = lineRefills.some(
                  (row) => row.refills > 0 && !row.expiration,
                );
                if (missingExpiration) {
                  setSummaryError(
                    'Enter a refill expiration for each item with refills. Use View details to match a wellness reminder.',
                  );
                  return;
                }
                if (lineScripts.some((row) => isPlaceholderMailScript(row.scriptText))) {
                  setSummaryError('Write directions for each item before approving.');
                  return;
                }
                onApprove('approved', lineRefills, lineScripts);
              }}
            >
              Approved
            </button>
            <button
              type="button"
              className="pims-task-detail__btn pims-task-detail__btn--secondary"
              disabled={busy}
              onClick={() => onApprove('rejected')}
            >
              Rejected
            </button>
            <button
              type="button"
              className="pims-task-detail__btn pims-task-detail__btn--secondary"
              disabled={busy}
              onClick={() => onApprove('send_back')}
            >
              Send back
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
