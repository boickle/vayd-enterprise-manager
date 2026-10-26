import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DateTime } from 'luxon';
import { Loader2, Sparkles } from 'lucide-react';
import {
  getMailOrder,
  storeApiError,
  type MailLineRxDecision,
  type MailOrder,
  type MailOrderLine,
} from '../../api/onlineStore';
import MailRxDecisionFields, {
  initialMailRxDecisionFromLine,
  mailRxDecisionMissing,
  parsedMailRefills,
  type MailRxDecisionDraft,
} from '../soap/MailRxDecisionFields';
import { fetchPatientByIdStaff, fetchPatientMedicalRecordStaff } from '../../api/patients';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
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
import { clientIdFromPatientRow, clientNameFromPatientRow } from '../../utils/briefDisplay';
import {
  employeeDisplayName,
  inactiveAtIso,
  statusNameFromPatient,
  type HouseholdPetStatusInput,
} from '../../utils/householdPetStatus';
import { formatAutoshipFrequency } from '../../pages/store/storeCartState';
import type { MedicalRecordBundle } from '../../utils/patientChartFromMedicalRecord';
import { stripCitationTokens } from '../../utils/chartCitation';
import { BookPatientChartButton } from '../BookPatientChartButton';
import { clampRefillExpiration, refillExpirationCapNote } from '../../utils/printRxLabel';
const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

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
  let householdPets: HouseholdPetStatusInput[] = [];
  const clientId = rec ? clientIdFromPatientRow(rec) : null;
  if (clientId != null) {
    const clientRow = await fetchClientByIdStaff(String(clientId)).catch(() => null);
    if (clientRow && typeof clientRow === 'object') {
      const rawPets = Array.isArray((clientRow as Record<string, unknown>).patients)
        ? ((clientRow as Record<string, unknown>).patients as unknown[])
        : [];
      householdPets = rawPets
        .map((raw): HouseholdPetStatusInput | null => {
          if (!raw || typeof raw !== 'object') return null;
          const p = raw as Record<string, unknown>;
          const id = p.id != null ? String(p.id) : '';
          if (!id) return null;
          return {
            id,
            name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Pet #${id}`,
            active: p.isActive !== false,
            statusName: statusNameFromPatient(p),
            inactiveAt: inactiveAtIso(p.inactiveAt),
            inactivatedByName: employeeDisplayName(p.inactivatedByEmployee),
          };
        })
        .filter((p): p is HouseholdPetStatusInput => p != null);
    }
  }
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
    householdPets,
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
  /** When set, only lines tied to this approval task are shown / decided. */
  taskId?: number | null;
  canApprove: boolean;
  busy: boolean;
  approvalNote: string;
  onApprovalNoteChange: (value: string) => void;
  onApprove: (
    outcome: 'approved' | 'rejected' | 'send_back',
    lineRefills?: MailLineRxDecision[],
    lineScripts?: Array<{ lineId: number; scriptText: string }>,
    approvalBasis?: 'standard' | 'chart' | 'refills',
  ) => void;
  onPresentationSynced?: () => void;
};

export default function MailOrderTaskPanel({
  practiceId,
  mailOrderId,
  taskId = null,
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
  const [decisionsByLine, setDecisionsByLine] = useState<Record<number, MailRxDecisionDraft>>({});
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
        setDecisionsByLine((prev) => {
          const next = { ...prev };
          for (const line of row.lines || []) {
            if (next[line.id] == null) next[line.id] = initialMailRxDecisionFromLine(line);
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

  const scopedOrder = useMemo(() => {
    if (!order) return null;
    if (taskId == null || !Number.isFinite(Number(taskId))) return order;
    const scoped = (order.lines || []).filter(
      (line) =>
        Number(line.approvalTaskId) === Number(taskId) &&
        (line.lineStatus === 'awaiting_doctor_approval' || line.lineStatus === 'send_back'),
    );
    return { ...order, lines: scoped };
  }, [order, taskId]);

  const groups = useMemo(
    () => (scopedOrder ? groupLines(scopedOrder) : []),
    [scopedOrder],
  );
  const pets = useMemo(() => {
    if (!scopedOrder) return [];
    const fromLines = groups
      .map((g) => ({ id: g.petId, name: g.petName }))
      .filter((p) => p.id != null || p.name);
    if (fromLines.length) return fromLines;
    if (scopedOrder.patients?.length) {
      return scopedOrder.patients.filter((p) => p.id != null || p.name);
    }
    return [];
  }, [scopedOrder, groups]);

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

  function submitApprove() {
    const current = scopedOrder;
    if (!current) return;
    const decisionFor = (line: MailOrderLine) =>
      decisionsByLine[line.id] ?? initialMailRxDecisionFromLine(line);
    const lineRefills: MailLineRxDecision[] = (current.lines || []).map((line) => {
      const decision = decisionFor(line);
      const refills = parsedMailRefills(decision.refills) ?? 0;
      return {
        lineId: line.id,
        refills,
        expiration: refills > 0 ? decision.expiration.trim() || null : null,
        acuity: decision.acuity || null,
      };
    });
    const lineScripts = (current.lines || []).map((line) => ({
      lineId: line.id,
      scriptText: (
        scriptsByLine[line.id] ||
        (!isPlaceholderMailScript(line.scriptText) ? line.scriptText : '') ||
        ''
      ).trim(),
    }));
    for (const line of current.lines || []) {
      const missing = mailRxDecisionMissing(decisionFor(line));
      if (missing) {
        setSummaryError(`${line.name}: ${missing}`);
        return;
      }
    }
    if (lineScripts.some((row) => isPlaceholderMailScript(row.scriptText))) {
      setSummaryError('Write directions for each item before approving.');
      return;
    }
    onApprove('approved', lineRefills, lineScripts, 'standard');
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

      {taskId != null && groups.length === 0 ? (
        <p className="pims-task-mail__line-meta">
          This approval was reassigned or handled on the mail queue. Nothing to do here.
        </p>
      ) : null}

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
              {canApprove ? (
                <label className="pims-task-mail__refill">
                  Directions
                  <textarea
                    className="settings-input"
                    rows={3}
                    value={
                      scriptsByLine[line.id] ??
                      (!isPlaceholderMailScript(line.scriptText) ? line.scriptText || '' : '')
                    }
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
                <MailRxDecisionFields
                  value={decisionsByLine[line.id] ?? initialMailRxDecisionFromLine(line)}
                  onChange={(next) =>
                    setDecisionsByLine((prev) => ({ ...prev, [line.id]: next }))
                  }
                  autoship={Boolean(line.autoshipFrequency)}
                  onError={setSummaryError}
                  chartExtra={
                    group.petId ? (
                      <BookPatientChartButton
                        patientId={String(group.petId)}
                        patientName={group.petName || line.patientName || 'Patient'}
                        practiceId={practiceId}
                        practiceTz={PRACTICE_TZ}
                        showAlerts
                        label="View details"
                        className="pims-task-mail__details-link"
                        onApplyRefillExpiration={(dateInput) => {
                          const current =
                            decisionsByLine[line.id] ?? initialMailRxDecisionFromLine(line);
                          setDecisionsByLine((prev) => ({
                            ...prev,
                            [line.id]: {
                              ...current,
                              expiration: clampRefillExpiration(dateInput),
                              expirationCapNote: refillExpirationCapNote(dateInput),
                            },
                          }));
                        }}
                      />
                    ) : null
                  }
                />
              ) : line.authorizedRefills != null ? (
                <p className="pims-task-mail__authorized">
                  {line.authorizedAcuity
                    ? `${line.authorizedAcuity === 'chronic' ? 'Chronic' : 'Acute'} · `
                    : ''}
                  Authorized {line.authorizedRefills} refill
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
          Summarize Case
        </button>
        {summaryError ? <p className="pims-task-detail__error">{summaryError}</p> : null}
      </div>

      {canApprove && groups.length > 0 ? (
        <>
          <p className="pims-task-detail__muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
            This task closes when you Approve, Reject, or Send back. It does not go back to the mail
            queue unless you send it back.
          </p>
          <label className="pims-task-detail__field">
            <span>Notes</span>
            <textarea
              rows={3}
              value={approvalNote}
              onChange={(e) => onApprovalNoteChange(e.target.value)}
              placeholder="Optional — e.g. dose confirmed in last SOAP"
            />
          </label>
          <div className="pims-task-detail__actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="pims-task-detail__btn pims-task-detail__btn--primary"
              disabled={busy}
              onClick={() => submitApprove()}
            >
              Approve
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
