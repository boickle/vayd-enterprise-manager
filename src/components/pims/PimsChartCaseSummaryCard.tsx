import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronUp, MessageSquare, Search, Send, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { fetchEmployee, fetchEmployeeRoles, type EmployeeRole } from '../../api/appointmentSettings';
import { fetchPracticeInfo, fetchPracticeInfoById } from '../../api/clientPortal';
import { fetchPatientAppointmentsStaff } from '../../api/pimsAppointments';
import {
  chatAboutChart,
  deleteMyCaseHistoryChat,
  fetchMyCaseHistoryChat,
  saveMyCaseHistoryChat,
  searchMyAssistantChats,
  summarizeChartText,
  type AssistantChatSearchHit,
} from '../../api/soapScribe';
import { getCurrentUser } from '../../api/users';
import {
  listPatientPrescriptions,
  VISIT_WORKFLOW_PRACTICE_ID,
  type PatientPrescription,
  type PatientProblem,
  type SoapEncounter,
} from '../../api/visitWorkflow';
import { appConfirm } from '../../utils/appDialog';
import {
  appendCaseHistoryChat,
  clearCaseHistoryChat,
  listCaseHistoryChat,
  listCaseHistorySummaries,
  replaceCaseHistoryChat,
  saveCaseHistorySummary,
  type CaseHistorySummary,
} from '../../utils/briefRecordStore';
import {
  buildCaseHistorySource,
  signalmentFromPatient,
  type CaseHistoryCitation,
  type CaseHistorySource,
} from '../../utils/buildCaseHistorySource';
import {
  fillLetterheadPlaceholders,
  letterheadBlock,
  type ChartIdentity,
} from '../../utils/chartLetterhead';
import { clientIdFromPatientRow, clientNameFromPatientRow } from '../../utils/briefDisplay';
import { pickPracticeMainPhone } from '../../utils/practicePhone';
import type { MedicalRecordBundle } from '../../utils/patientChartFromMedicalRecord';
import BriefChartCitedText from '../brief/BriefChartCitedText';
import { PimsExamDetailModal } from './PimsExamDetailModal';
import { PimsMedicalNoteModal } from './PimsMedicalNoteModal';
import PimsSoapNoteModal from './PimsSoapNoteModal';
import { fetchClientByIdStaff } from '../../api/clientsStaff';

const STARTERS = [
  'When was this patient treated for parasites or worms?',
  'What vaccines are current, and when were they last given?',
  'Any clinic behavior or escape notes I should know before I walk in?',
  'Any products we carry that would help today?',
];

type Props = {
  patientId: string;
  patientName: string;
  clientName?: string | null;
  practiceTz: string;
  patientRecord: Record<string, unknown> | null;
  medicalRecord: MedicalRecordBundle | null;
  problems: PatientProblem[];
  encounters: SoapEncounter[];
  /** When false, pause auto-load (other chart tabs). */
  enabled: boolean;
  /** Prep “Summarize” bumps this to force a fresh today snapshot. */
  refreshRequestId?: number;
  refreshConsumedId?: number;
  onRefreshConsumed?: (requestId: number) => void;
};

function excerptText(raw: string, max = 320): string {
  const plain = raw.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${(lastStop > 80 ? cut.slice(0, lastStop) : cut).trim()}…`;
}

function formatAsOfLabel(asOfDate: string, practiceTz: string): string {
  const d = DateTime.fromISO(asOfDate, { zone: practiceTz });
  if (!d.isValid) return asOfDate;
  return d.toFormat('L/d/yyyy');
}

function staffDisplayName(emp: {
  firstName?: string;
  lastName?: string;
  isProvider?: boolean;
}): string | null {
  const name = [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim();
  if (!name) return null;
  if (emp.isProvider && !/^dr\.?\b/i.test(name)) return `Dr. ${name}`;
  return name;
}

function findRecordById(rows: unknown[] | undefined, id: string): Record<string, unknown> | null {
  if (!rows?.length) return null;
  const found = rows.find(
    (e) => e && typeof e === 'object' && String((e as Record<string, unknown>).id) === id
  );
  return found && typeof found === 'object' ? (found as Record<string, unknown>) : null;
}

/**
 * Chart-tab case prep: today’s walk-in summary (expandable) + ChatGPT-style chart chat.
 */
export default function PimsChartCaseSummaryCard({
  patientId,
  patientName,
  clientName,
  practiceTz,
  patientRecord,
  medicalRecord,
  problems,
  encounters,
  enabled,
  refreshRequestId = 0,
  refreshConsumedId = 0,
  onRefreshConsumed,
}: Props) {
  const auth = useAuth();
  const today = useMemo(
    () => DateTime.now().setZone(practiceTz).toFormat('yyyy-LL-dd'),
    [practiceTz]
  );
  const chatOwner = auth.userId || auth.employeeId || 'local';

  const [row, setRow] = useState<CaseHistorySummary | null>(null);
  const [source, setSource] = useState<CaseHistorySource | null>(null);
  const [identity, setIdentity] = useState<ChartIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState(() => listCaseHistoryChat(patientId, chatOwner));
  const [searchQ, setSearchQ] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<AssistantChatSearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedExam, setSelectedExam] = useState<Record<string, unknown> | null>(null);
  const [selectedNote, setSelectedNote] = useState<{
    title: string;
    record: Record<string, unknown>;
  } | null>(null);
  const [selectedSoap, setSelectedSoap] = useState<SoapEncounter | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const runGen = useRef(0);
  const forceRefresh = useRef(false);
  const chartRef = useRef({
    patientName,
    clientName,
    patientRecord,
    medicalRecord,
    problems,
    encounters,
  });
  chartRef.current = {
    patientName,
    clientName,
    patientRecord,
    medicalRecord,
    problems,
    encounters,
  };

  const refreshChat = () => setChat(listCaseHistoryChat(patientId, chatOwner));

  const persistChat = () => {
    const messages = listCaseHistoryChat(patientId, chatOwner);
    void saveMyCaseHistoryChat(patientId, messages).catch(() => undefined);
  };

  useEffect(() => {
    setChat(listCaseHistoryChat(patientId, chatOwner));
    setExpanded(false);
    setError(null);
    void fetchMyCaseHistoryChat(patientId)
      .then((remote) => {
        if (remote.length) {
          replaceCaseHistoryChat(patientId, remote, chatOwner);
          setChat(remote);
          return;
        }
        const local = listCaseHistoryChat(patientId, chatOwner);
        if (local.length) void saveMyCaseHistoryChat(patientId, local).catch(() => undefined);
      })
      .catch(() => undefined);
  }, [patientId, chatOwner]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat, chatBusy]);

  const buildSource = async (): Promise<CaseHistorySource> => {
    const snap = chartRef.current;
    const empId = Number(auth.employeeId || auth.doctorId);
    const apptStart = DateTime.now().minus({ years: 20 }).toUTC().toISO();
    const apptEnd = DateTime.now().plus({ years: 2 }).toUTC().toISO();
    const [meds, appointments, practice, practiceById, employee, me, roleCatalog] =
      await Promise.all([
        listPatientPrescriptions(Number(patientId), { activeChronicOnly: true }).catch(
          () => [] as PatientPrescription[]
        ),
        fetchPatientAppointmentsStaff(patientId, {
          practiceId: VISIT_WORKFLOW_PRACTICE_ID,
          start: apptStart ?? undefined,
          end: apptEnd ?? undefined,
          includeInactivePatient: true,
        }).catch(() => []),
        fetchPracticeInfo().catch(() => null),
        fetchPracticeInfoById(VISIT_WORKFLOW_PRACTICE_ID).catch(() => null),
        Number.isFinite(empId) && empId > 0
          ? fetchEmployee(empId).catch(() => null)
          : Promise.resolve(null),
        getCurrentUser()
          .then((res) => (res as { data?: unknown })?.data ?? res)
          .catch(() => null),
        fetchEmployeeRoles().catch(() => [] as EmployeeRole[]),
      ]);

    let owner = snap.clientName ?? null;
    const clientId = snap.patientRecord ? clientIdFromPatientRow(snap.patientRecord) : null;
    if (!owner && clientId != null) {
      const client = await fetchClientByIdStaff(String(clientId)).catch(() => null);
      if (client && typeof client === 'object') {
        owner = clientNameFromPatientRow(client as Record<string, unknown>);
      }
    }

    const meRec = me && typeof me === 'object' ? (me as Record<string, unknown>) : null;
    const clinic = practiceById ?? practice;
    const nextIdentity: ChartIdentity = {
      clientName: owner,
      staffName:
        (employee ? staffDisplayName(employee) : null) ||
        (typeof meRec?.employeeName === 'string' ? meRec.employeeName : null) ||
        (typeof meRec?.doctorName === 'string' ? meRec.doctorName : null),
      staffRole: employee?.isProvider
        ? 'Veterinarian'
        : roleCatalog.find((r) => employee?.roleIds?.includes(r.id))?.name ?? null,
      staffEmail: employee?.email?.trim() || auth.userEmail || null,
      practiceName: clinic?.name?.trim() || null,
      practicePhone: clinic ? pickPracticeMainPhone(clinic) : null,
      practiceEmail: clinic?.email?.trim() || null,
      practiceAddress: null,
      practiceWebsite: clinic?.website?.trim() || null,
    };
    setIdentity(nextIdentity);

    return buildCaseHistorySource({
      patientId,
      patientName: snap.patientName,
      clientName: owner,
      signalment: signalmentFromPatient(snap.patientRecord),
      problems: snap.problems,
      meds,
      encounters: snap.encounters,
      appointments,
      patientRecord: snap.patientRecord,
      medicalRecord: snap.medicalRecord,
      asOfDate: today,
    });
  };

  const ensureSummary = async (opts?: { force?: boolean }) => {
    const gen = ++runGen.current;
    setBusy(true);
    setError(null);
    try {
      const src = await buildSource();
      if (gen !== runGen.current) return;
      setSource(src);

      if (!opts?.force) {
        const cached =
          listCaseHistorySummaries(patientId).find((r) => r.asOfDate === today) ?? null;
        if (cached?.summary.trim()) {
          setRow(cached);
          return;
        }
      }

      if (!src.text.trim()) {
        setError('No chart text to summarize yet.');
        return;
      }
      const summary = await summarizeChartText({
        mode: 'case-history',
        sourceText: src.text,
        patientName: chartRef.current.patientName,
        asOfDate: today,
      });
      if (gen !== runGen.current) return;
      if (!summary.trim()) {
        setError('No summary came back.');
        return;
      }
      const saved = saveCaseHistorySummary({
        patientId,
        asOfDate: today,
        summary,
      });
      setRow(saved);
    } catch (err) {
      if (gen === runGen.current) {
        setError(err instanceof Error ? err.message : 'Could not summarize the chart.');
      }
    } finally {
      if (gen === runGen.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    void ensureSummary({ force: forceRefresh.current });
    forceRefresh.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per patient/day when chart is shown
  }, [enabled, patientId, today]);

  useEffect(() => {
    if (!enabled) return;
    if (refreshRequestId <= 0 || refreshRequestId <= refreshConsumedId) return;
    onRefreshConsumed?.(refreshRequestId);
    forceRefresh.current = true;
    void ensureSummary({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRequestId, refreshConsumedId, enabled]);

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || chatBusy) return;
    let src = source;
    if (!src?.text.trim()) {
      try {
        src = await buildSource();
        setSource(src);
      } catch {
        setError('Chart source is not ready yet.');
        return;
      }
    }
    if (!src?.text.trim()) {
      setError('Chart source is empty.');
      return;
    }
    setError(null);
    setChatBusy(true);
    setQuestion('');
    appendCaseHistoryChat(patientId, { role: 'user', content: q }, chatOwner);
    persistChat();
    refreshChat();
    try {
      const prior = listCaseHistoryChat(patientId, chatOwner)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      const headed = `${letterheadBlock(identity, patientName)}\n\n${src.text}`;
      const rawAnswer = await chatAboutChart({
        sourceText: headed,
        question: q,
        history: prior,
        patientName,
        asOfDate: today,
        patientId,
        clientId: clientIdFromPatientRow(patientRecord ?? {}) ?? undefined,
        chatScope: 'patient',
        ...identity,
      });
      const answer = fillLetterheadPlaceholders(rawAnswer, identity);
      if (!answer.trim()) throw new Error('No answer came back.');
      appendCaseHistoryChat(patientId, { role: 'assistant', content: answer }, chatOwner);
      persistChat();
      refreshChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer from the chart.');
    } finally {
      setChatBusy(false);
    }
  };

  const removeMyChats = () => {
    void (async () => {
      const ok = await appConfirm({
        title: 'Remove chat?',
        message:
          'Remove your chart chat for this patient? Other staff never saw it. This cannot be undone.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      clearCaseHistoryChat(patientId, chatOwner);
      refreshChat();
      void deleteMyCaseHistoryChat(patientId).catch(() => undefined);
    })();
  };

  const runChatSearch = async (raw: string) => {
    const q = raw.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchError(null);
      return;
    }
    setSearchBusy(true);
    setSearchError(null);
    try {
      const hits = await searchMyAssistantChats(q, 20);
      setSearchHits(hits);
      if (!hits.length) setSearchError('No matches in your chats.');
    } catch (err) {
      setSearchHits([]);
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearchBusy(false);
    }
  };

  const citations = source?.citations ?? [];
  const openCitation = (c: CaseHistoryCitation): boolean => {
    if (!c.kind || !c.recordId) return false;
    if (c.kind === 'exam') {
      const found = findRecordById(medicalRecord?.exams, c.recordId);
      if (found) {
        setSelectedExam(found);
        return true;
      }
    }
    if (c.kind === 'history') {
      const found = findRecordById(medicalRecord?.histories, c.recordId);
      if (found) {
        setSelectedNote({ title: 'Medical note', record: found });
        return true;
      }
    }
    if (c.kind === 'chartNote') {
      const found = findRecordById(medicalRecord?.chartNotes, c.recordId);
      if (found) {
        setSelectedNote({ title: 'Medical note', record: found });
        return true;
      }
    }
    if (c.kind === 'soap') {
      const found = encounters.find((enc) => String(enc.id) === c.recordId);
      if (found) {
        setSelectedSoap(found);
        return true;
      }
    }
    return false;
  };

  const summary = row?.summary?.trim() ?? '';

  return (
    <div className="pims-emr-case-prep">
      <section className="pims-emr-prep__card pims-emr-case-prep__summary" aria-labelledby="pims-emr-case">
        <h3 id="pims-emr-case">
          <Sparkles size={15} aria-hidden />
          Case summary
        </h3>

        {busy ? (
          <p className="pims-emr-prep__loading" role="status" aria-live="polite">
            …Loading
          </p>
        ) : null}

        {error && !summary ? (
          <p className="pims-detail__banner-error" role="alert">
            {error}
          </p>
        ) : null}

        {!busy && summary ? (
          <>
            {expanded ? (
              <BriefChartCitedText
                className="pims-emr-prep__full"
                text={summary}
                citations={citations}
                onOpenCitation={openCitation}
              />
            ) : (
              <p className="pims-emr-prep__excerpt">{excerptText(summary)}</p>
            )}
            <p className="pims-emr-prep__meta">
              As of {formatAsOfLabel(row?.asOfDate || today, practiceTz)}
            </p>
            <div className="pims-emr-story__actions">
              <button type="button" onClick={() => setExpanded((v) => !v)}>
                {expanded ? (
                  <>
                    <ChevronUp size={14} aria-hidden />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} aria-hidden />
                    See full case history information
                  </>
                )}
              </button>
            </div>
          </>
        ) : null}

        {!busy && !summary && !error ? (
          <p className="pims-emr-story__muted">No chart summary yet.</p>
        ) : null}
      </section>

      <section className="pims-emr-prep__card pims-emr-case-prep__chat" aria-labelledby="pims-emr-chart-chat">
        <div className="pims-emr-case-prep__chat-head">
          <h3 id="pims-emr-chart-chat">
            <MessageSquare size={15} aria-hidden />
            Ask about this chart
          </h3>
          <p className="pims-emr-case-prep__chat-hint">
            Private to your login. Answers cite the chart.
          </p>
        </div>

        <form
          className="pims-emr-case-prep__compose"
          style={{ marginBottom: '0.75rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            void runChatSearch(searchQ);
          }}
        >
          <label className="pims-emr-case-prep__chat-hint" htmlFor="pims-chart-chat-search">
            Search my chats across patients / households
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
            <input
              id="pims-chart-chat-search"
              className="input"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="e.g. Fluffy hyperthyroid"
              disabled={searchBusy}
            />
            <button type="submit" className="brief-btn" disabled={searchBusy || searchQ.trim().length < 2}>
              <Search size={14} aria-hidden />
              {searchBusy ? '…' : 'Search'}
            </button>
          </div>
          {searchError ? (
            <p className="pims-emr-case-prep__chat-hint" role="status">
              {searchError}
            </p>
          ) : null}
          {searchHits.length > 0 ? (
            <ul className="pims-emr-case-prep__starters" style={{ listStyle: 'none', padding: 0 }}>
              {searchHits.map((hit, i) => {
                const href =
                  hit.scope === 'patient' && hit.patientId
                    ? `/schedule/patients?patientId=${encodeURIComponent(hit.patientId)}`
                    : hit.scope === 'client' && hit.clientId
                      ? `/schedule/clients?clientId=${encodeURIComponent(hit.clientId)}`
                      : null;
                const label =
                  hit.scope === 'patient' && hit.patientId
                    ? `Patient #${hit.patientId}`
                    : hit.scope === 'client' && hit.clientId
                      ? `Household #${hit.clientId}`
                      : hit.scope;
                return (
                  <li key={`${hit.scope}-${hit.patientId}-${hit.clientId}-${i}`}>
                    {href ? (
                      <Link to={href} className="pims-emr-case-prep__starter">
                        <strong>{label}</strong>
                        <span> — {hit.snippet}</span>
                      </Link>
                    ) : (
                      <span className="pims-emr-case-prep__starter">
                        <strong>{label}</strong>
                        <span> — {hit.snippet}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </form>

        {error && summary ? (
          <p className="pims-detail__banner-error" role="alert">
            {error}
          </p>
        ) : null}

        {chat.length === 0 ? (
          <div className="pims-emr-case-prep__starters">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                className="pims-emr-case-prep__starter"
                disabled={chatBusy}
                onClick={() => void ask(s)}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div className="pims-emr-case-prep__log" ref={logRef}>
          {chat.map((m) => (
            <div
              key={m.id}
              className={`pims-emr-case-prep__bubble pims-emr-case-prep__bubble--${m.role}`}
            >
              <span className="pims-emr-case-prep__who">
                {m.role === 'user' ? 'You' : 'Chart'}
              </span>
              {m.role === 'assistant' ? (
                <BriefChartCitedText
                  className="pims-emr-case-prep__body"
                  text={m.content}
                  citations={citations}
                  onOpenCitation={openCitation}
                />
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          ))}
          {chatBusy ? (
            <p className="pims-emr-case-prep__thinking" role="status">
              Looking in the record…
            </p>
          ) : null}
        </div>

        <form
          className="pims-emr-case-prep__compose"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            className="input pims-emr-case-prep__input"
            rows={2}
            value={question}
            disabled={chatBusy}
            placeholder="Ask anything in the record — worms, vaccines, last weight…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="pims-emr-case-prep__compose-actions">
            <button
              type="submit"
              className="brief-btn primary"
              disabled={chatBusy || !question.trim()}
            >
              <Send size={14} aria-hidden />
              {chatBusy ? 'Asking…' : 'Ask'}
            </button>
            {chat.length > 0 ? (
              <button type="button" className="brief-text-btn" onClick={removeMyChats}>
                Clear chat
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {selectedExam ? (
        <PimsExamDetailModal
          exam={selectedExam}
          weightHistory={medicalRecord?.weightHistory ?? []}
          patientAgeLabel={null}
          patientWeightDisplay={null}
          onClose={() => setSelectedExam(null)}
        />
      ) : null}
      {selectedNote ? (
        <PimsMedicalNoteModal
          title={selectedNote.title}
          record={selectedNote.record}
          onClose={() => setSelectedNote(null)}
        />
      ) : null}
      {selectedSoap ? (
        <PimsSoapNoteModal
          encounter={selectedSoap}
          patientName={patientName}
          onClose={() => setSelectedSoap(null)}
        />
      ) : null}
    </div>
  );
}
