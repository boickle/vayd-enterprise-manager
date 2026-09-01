import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, MessageSquare, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useAuth } from '../../auth/useAuth';
import { fetchEmployee, fetchEmployeeRoles, type EmployeeRole } from '../../api/appointmentSettings';
import { fetchPracticeInfo, fetchPracticeInfoById } from '../../api/clientPortal';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { fetchPatientAppointmentsStaff } from '../../api/pimsAppointments';
import { fetchPatientByIdStaff, fetchPatientMedicalRecordStaff } from '../../api/patients';
import { getCurrentUser } from '../../api/users';
import {
  chatAboutChart,
  deleteMyCaseHistoryChat,
  fetchMyCaseHistoryChat,
  saveMyCaseHistoryChat,
  summarizeChartText,
} from '../../api/soapScribe';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import { pickPracticeMainPhone } from '../../utils/practicePhone';
import { appConfirm } from '../../utils/appDialog';
import {
  listEncounters,
  listPatientPrescriptions,
  listProblems,
  type PatientPrescription,
  type PatientProblem,
  type SoapEncounter,
} from '../../api/visitWorkflow';
import {
  appendCaseHistoryChat,
  clearCaseHistoryChat,
  deleteCaseHistorySummary,
  listCaseHistoryChat,
  listCaseHistorySummaries,
  replaceCaseHistoryChat,
  saveCaseHistorySummary,
} from '../../utils/briefRecordStore';
import {
  buildCaseHistorySource,
  signalmentFromPatient,
  type CaseHistorySource,
} from '../../utils/buildCaseHistorySource';
import type { MedicalRecordBundle } from '../../utils/patientChartFromMedicalRecord';
import type { CaseHistoryCitation } from '../../utils/chartCitation';
import BriefChartCitedText from './BriefChartCitedText';
import { PimsExamDetailModal } from '../pims/PimsExamDetailModal';
import { PimsMedicalNoteModal } from '../pims/PimsMedicalNoteModal';
import PimsSoapNoteModal from '../pims/PimsSoapNoteModal';
import { clientIdFromPatientRow, clientNameFromPatientRow } from '../../utils/briefDisplay';
import {
  fillLetterheadPlaceholders,
  letterheadBlock,
  type ChartIdentity,
} from '../../utils/chartLetterhead';

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

const CLINICAL_ROLE_LABEL: Record<string, string> = {
  Veterinarian: 'Veterinarian',
  LimitedAssignedProvider: 'Veterinarian',
  Technician: 'Veterinary technician',
  TechnicianAssistant: 'Veterinary technician assistant',
  Receptionist: 'Client care coordinator',
  Groomer: 'Groomer',
  KennelWorker: 'Kennel assistant',
};

const CLINICAL_ROLE_PRIORITY = [
  'Veterinarian',
  'LimitedAssignedProvider',
  'Technician',
  'TechnicianAssistant',
  'Receptionist',
  'Groomer',
  'KennelWorker',
];

/** eVet UserRole flag values that map to a client-facing job title. */
const CLINICAL_ROLE_VALUE: Record<number, string> = {
  8: 'Veterinarian',
  16: 'Technician',
  32: 'Receptionist',
  256: 'TechnicianAssistant',
  512: 'KennelWorker',
  65536: 'Groomer',
  262144: 'LimitedAssignedProvider',
};

function jobRoleFromDesignation(designation?: string | null): string | null {
  if (!designation?.trim()) return null;
  const d = designation.toLowerCase();
  if (/\b(dvm|vmd|dacv[a-z]+)\b/.test(d) || d.includes('veterinar')) return 'Veterinarian';
  if (/\b(cvt|lvt|rvt)\b/.test(d) || d.includes('technician')) return 'Veterinary technician';
  return null;
}

/** Job role for client-facing mail — never Scout login roles (superadmin, admin, …). */
function staffRoleLabel(
  emp: {
    title?: string;
    designation?: string;
    isProvider?: boolean;
    roleIds?: number[];
  } | null,
  catalog: EmployeeRole[]
): string | null {
  if (!emp) return null;
  const fromDes = jobRoleFromDesignation(emp.designation);
  if (fromDes) return fromDes;
  if (emp.isProvider) return 'Veterinarian';

  const title = emp.title?.trim() ?? '';
  if (title && !/^(dr\.?|mr\.?|ms\.?|mrs\.?)$/i.test(title)) {
    if (/veterinar|doctor/i.test(title)) return 'Veterinarian';
    if (/tech/i.test(title)) return 'Veterinary technician';
  }

  const assigned = (emp.roleIds ?? [])
    .map((id) => catalog.find((r) => r.id === id))
    .filter((r): r is EmployeeRole => Boolean(r));
  const names = assigned.map((r) => r.name).filter(Boolean);
  const values = assigned.map((r) => Number(r.roleValue)).filter((n) => Number.isFinite(n));
  for (const key of CLINICAL_ROLE_PRIORITY) {
    const fromValue = values.some((v) => CLINICAL_ROLE_VALUE[v] === key);
    if (fromValue || names.some((n) => n === key || n.replace(/\s+/g, '') === key)) {
      return CLINICAL_ROLE_LABEL[key] ?? key;
    }
  }
  return null;
}

function practiceAddressLine(info: {
  address?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  zipcode?: string;
}): string | null {
  const street = [info.address1, info.address, info.address2].filter(Boolean).join(', ').trim();
  const cityLine = [info.city, info.state, info.zip ?? info.zipcode].filter(Boolean).join(', ').trim();
  const joined = [street, cityLine].filter(Boolean).join(', ');
  return joined || null;
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

function ownerNameFromClient(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  return clientNameFromPatientRow(raw as Record<string, unknown>);
}

function pickField(rec: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!rec) return null;
  for (const key of keys) {
    const v = rec[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function findRecordById(rows: unknown[] | undefined, id: string): Record<string, unknown> | null {
  if (!rows?.length) return null;
  const found = rows.find((e) => e && typeof e === 'object' && String((e as Record<string, unknown>).id) === id);
  return found && typeof found === 'object' ? (found as Record<string, unknown>) : null;
}

function patientAgeLabel(rec: Record<string, unknown> | null): string | null {
  const dob = pickField(rec, 'dateOfBirth', 'dob');
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  if (years < 0) return null;
  return `${years}y / ${dob.slice(0, 10)}`;
}

function patientWeightLabel(rec: Record<string, unknown> | null): string | null {
  const lb = pickField(rec, 'weight', 'weightLbs');
  const kg = pickField(rec, 'weightKg');
  if (!lb && !kg) return null;
  return [lb ? `${lb} lbs` : null, kg ? `${kg} kg` : null].filter(Boolean).join(' / ');
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STARTERS = [
  'When was this patient treated for parasites or worms?',
  'What vaccines are current, and when were they last given?',
  'Any clinic behavior or escape notes I should know before I walk in?',
  'Any products we carry that would help today?',
];

type Props = {
  patientId: string;
  patientName?: string | null;
  practiceTz: string;
  onNewEpiphany?: () => void;
  /** Increment to start (or queue) a today-as-of summary from the chart work bar. */
  summarizeRequestId?: number;
  /** When the chart work bar already has Summarize / Epiphany. */
  hideChromeActions?: boolean;
};

export default function BriefCaseHistoryPanel({
  patientId,
  patientName,
  practiceTz,
  onNewEpiphany,
  summarizeRequestId = 0,
  hideChromeActions = false,
}: Props) {
  const auth = useAuth();
  const asOfDate = useMemo(
    () => DateTime.now().setZone(practiceTz).toFormat('yyyy-LL-dd'),
    [practiceTz]
  );
  const asOfLabel = useMemo(
    () => DateTime.fromISO(asOfDate, { zone: practiceTz }).toFormat('LLLL d, yyyy'),
    [asOfDate, practiceTz]
  );
  const chatOwner = auth.userId || auth.employeeId || 'local';
  const [rows, setRows] = useState(() => listCaseHistorySummaries(patientId));
  const [chat, setChat] = useState(() => listCaseHistoryChat(patientId, chatOwner));
  const [source, setSource] = useState<CaseHistorySource | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [identity, setIdentity] = useState<ChartIdentity | null>(null);
  const [medicalRecord, setMedicalRecord] = useState<MedicalRecordBundle | null>(null);
  const [encounters, setEncounters] = useState<SoapEncounter[]>([]);
  const [patientRecord, setPatientRecord] = useState<Record<string, unknown> | null>(null);
  const [selectedExam, setSelectedExam] = useState<Record<string, unknown> | null>(null);
  const [selectedNote, setSelectedNote] = useState<{
    title: string;
    record: Record<string, unknown>;
  } | null>(null);
  const [selectedSoap, setSelectedSoap] = useState<SoapEncounter | null>(null);
  const pendingRun = useRef(false);

  const refresh = () => {
    setRows(listCaseHistorySummaries(patientId));
    setChat(listCaseHistoryChat(patientId, chatOwner));
  };

  const persistChat = () => {
    const messages = listCaseHistoryChat(patientId, chatOwner);
    void saveMyCaseHistoryChat(patientId, messages).catch(() => {
      /* stay on this device if the server is down */
    });
  };

  const removeMyChats = () => {
    void (async () => {
      const ok = await appConfirm({
        title: 'Remove chat?',
        message:
          'Remove your Case history chat for this patient? Other staff never saw it. This cannot be undone.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      clearCaseHistoryChat(patientId, chatOwner);
      refresh();
      void deleteMyCaseHistoryChat(patientId).catch(() => {
        /* local copy is already gone */
      });
    })();
  };

  useEffect(() => {
    let canceled = false;
    setSource(null);
    setSourceError(null);
    setMedicalRecord(null);
    setEncounters([]);
    setPatientRecord(null);
    setSelectedExam(null);
    setSelectedNote(null);
    setSelectedSoap(null);
    setRows(listCaseHistorySummaries(patientId));
    setChat(listCaseHistoryChat(patientId, chatOwner));
    void fetchMyCaseHistoryChat(patientId)
      .then((remote) => {
        if (canceled) return;
        if (remote.length) {
          replaceCaseHistoryChat(patientId, remote, chatOwner);
          setChat(remote);
          return;
        }
        const local = listCaseHistoryChat(patientId, chatOwner);
        if (local.length) {
          void saveMyCaseHistoryChat(patientId, local).catch(() => undefined);
        }
      })
      .catch(() => {
        /* keep the device copy */
      });
    void (async () => {
      try {
        const empId = Number(auth.employeeId || auth.doctorId);
        const apptStart = DateTime.now().minus({ years: 20 }).toUTC().toISO();
        const apptEnd = DateTime.now().plus({ years: 2 }).toUTC().toISO();
        const [profile, problems, meds, encounters, medicalRecord, practice, practiceById, employee, me, appointments, roleCatalog] =
          await Promise.all([
            fetchPatientByIdStaff(patientId).catch(() => null),
            listProblems(Number(patientId)).catch(() => [] as PatientProblem[]),
            listPatientPrescriptions(Number(patientId), { activeChronicOnly: true }).catch(
              () => [] as PatientPrescription[]
            ),
            listEncounters({ patientId: Number(patientId) }).catch(() => [] as SoapEncounter[]),
            fetchPatientMedicalRecordStaff(patientId).catch(() => null),
            fetchPracticeInfo().catch(() => null),
            fetchPracticeInfoById(VISIT_WORKFLOW_PRACTICE_ID).catch(() => null),
            Number.isFinite(empId) && empId > 0
              ? fetchEmployee(empId).catch(() => null)
              : Promise.resolve(null),
            getCurrentUser()
              .then((res) => (res as { data?: unknown })?.data ?? res)
              .catch(() => null),
            fetchPatientAppointmentsStaff(patientId, {
              practiceId: VISIT_WORKFLOW_PRACTICE_ID,
              start: apptStart ?? undefined,
              end: apptEnd ?? undefined,
              includeInactivePatient: true,
            }).catch(() => []),
            fetchEmployeeRoles().catch(() => [] as EmployeeRole[]),
          ]);
        if (canceled) return;
        const rec = unwrapPatientRecord(profile);
        let owner = rec ? clientNameFromPatientRow(rec) : null;
        const clientId = rec ? clientIdFromPatientRow(rec) : null;
        if (!owner && clientId != null) {
          const clientRow = await fetchClientByIdStaff(clientId).catch(() => null);
          owner = ownerNameFromClient(clientRow);
        }
        const clinic = practiceById ?? practice;
        const meRec = me && typeof me === 'object' ? (me as Record<string, unknown>) : null;
        const nextIdentity: ChartIdentity = {
          clientName: owner,
          staffName:
            (employee ? staffDisplayName(employee) : null) ||
            (typeof meRec?.employeeName === 'string' ? meRec.employeeName : null) ||
            (typeof meRec?.doctorName === 'string' ? meRec.doctorName : null),
          staffRole: staffRoleLabel(employee, roleCatalog),
          staffEmail: employee?.email?.trim() || auth.userEmail || null,
          practiceName: clinic?.name?.trim() || null,
          practicePhone: pickPracticeMainPhone(clinic),
          practiceEmail: clinic?.email?.trim() || null,
          practiceAddress: clinic ? practiceAddressLine(clinic) : null,
          practiceWebsite: clinic?.website?.trim() || null,
        };
        setIdentity(nextIdentity);
        setPatientRecord(rec);
        setEncounters(encounters);
        setMedicalRecord((medicalRecord as MedicalRecordBundle | null) ?? null);
        setSource(
          buildCaseHistorySource({
            patientId,
            patientName,
            clientName: owner,
            signalment: signalmentFromPatient(rec),
            problems,
            meds,
            encounters,
            appointments,
            patientRecord: rec,
            medicalRecord: medicalRecord as MedicalRecordBundle | null,
            asOfDate,
          })
        );
      } catch (err) {
        if (!canceled) {
          setSourceError(err instanceof Error ? err.message : 'Could not load the chart.');
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [patientId, patientName, asOfDate, auth.employeeId, auth.doctorId, auth.userEmail, chatOwner]);

  const run = async () => {
    if (busy) {
      pendingRun.current = true;
      return;
    }
    if (!source) {
      if (sourceError) {
        setError(sourceError);
        return;
      }
      pendingRun.current = true;
      return;
    }
    if (!source.text.trim()) {
      setError('No chart text to summarize yet.');
      return;
    }
    pendingRun.current = false;
    setError(null);
    setBusy(true);
    try {
      const summary = await summarizeChartText({
        mode: 'case-history',
        sourceText: source.text,
        patientName,
        asOfDate,
      });
      if (!summary.trim()) throw new Error('No summary came back.');
      saveCaseHistorySummary({ patientId, asOfDate, summary });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not summarize the chart.');
    } finally {
      setBusy(false);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (summarizeRequestId > 0) {
      void runRef.current();
    }
  }, [summarizeRequestId]);

  useEffect(() => {
    if (pendingRun.current && source?.text.trim() && !busy) {
      pendingRun.current = false;
      void runRef.current();
    }
  }, [source, busy]);

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || !source?.text.trim() || chatBusy) return;
    setError(null);
    setChatBusy(true);
    setQuestion('');
    appendCaseHistoryChat(patientId, { role: 'user', content: q }, chatOwner);
    persistChat();
    refresh();
    try {
      const prior = listCaseHistoryChat(patientId, chatOwner)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      const headed = `${letterheadBlock(identity, patientName)}\n\n${source.text}`;
      const rawAnswer = await chatAboutChart({
        sourceText: headed,
        question: q,
        history: prior,
        patientName,
        asOfDate,
        ...identity,
      });
      const answer = fillLetterheadPlaceholders(rawAnswer, identity);
      if (!answer.trim()) throw new Error('No answer came back.');
      appendCaseHistoryChat(patientId, { role: 'assistant', content: answer }, chatOwner);
      persistChat();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer from the chart.');
    } finally {
      setChatBusy(false);
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

  return (
    <div className="brief-review">
      <div className="brief-review__head">
        <CalendarClock size={16} aria-hidden />
        <div>
          <h3>Case history{patientName ? ` · ${patientName}` : ''}</h3>
          <p>
            Snapshot for walking in the room, then ask follow-ups. Answers cite the exam, SOAP, or
            medical note they came from.
          </p>
        </div>
        {hideChromeActions ? null : (
          <div className="brief-review__head-actions">
            <button
              type="button"
              className="brief-btn primary"
              disabled={busy}
              aria-busy={busy || !source}
              onClick={() => void run()}
            >
              <Sparkles size={15} aria-hidden />
              {busy ? 'Summarizing…' : `Summarize as of ${asOfLabel}`}
            </button>
            {onNewEpiphany ? (
              <button type="button" className="brief-btn" onClick={onNewEpiphany}>
                <Plus size={15} aria-hidden />
                Epiphany
              </button>
            ) : null}
          </div>
        )}
      </div>

      {error ? <p className="brief-error">{error}</p> : null}
      {sourceError ? <p className="brief-error">{sourceError}</p> : null}

      {rows.length === 0 && !busy ? (
        <div className="brief-review__empty">
          <Sparkles size={22} aria-hidden />
          <h4>Create a case summary</h4>
          <p>
            One snapshot of this chart as of today. You can still ask follow-up questions below.
          </p>
          <div className="brief-review__empty-actions">
            <button
              type="button"
              className="brief-btn primary"
              disabled={busy}
              aria-busy={busy || !source}
              onClick={() => void run()}
            >
              <Sparkles size={15} aria-hidden />
              {busy ? 'Summarizing…' : `Summarize as of ${asOfLabel}`}
            </button>
          </div>
        </div>
      ) : null}

      {rows.map((row) => (
        <section key={row.id} className="brief-review__block">
          <div className="brief-review__block-head">
            <h4>As of {row.asOfDate}</h4>
            <button
              type="button"
              className="brief-text-btn"
              onClick={() => {
                deleteCaseHistorySummary(row.id);
                refresh();
              }}
            >
              <Trash2 size={13} aria-hidden /> Remove
            </button>
          </div>
          <p className="brief-muted">{formatWhen(row.createdAt)}</p>
          <BriefChartCitedText
            className="brief-review__summary"
            text={row.summary}
            citations={citations}
            onOpenCitation={openCitation}
          />
        </section>
      ))}

      <section className="brief-chat">
        <div className="brief-review__head">
          <MessageSquare size={16} aria-hidden />
          <div>
            <h3>Ask about this chart</h3>
            <p>
              Private to your Scout login — other Vet At Your Door staff cannot see this thread,
              and it is not saved to the patient chart. It follows you to another browser. Chart
              facts come from Scout. Product suggestions use our inventory. Medical advice may use
              only peer-reviewed literature and established bodies (AVMA, AAHA, AAFP, ACVIM, CDC,
              FDA, and similar).
            </p>
          </div>
        </div>

        <div className="brief-chat__starters">
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              className="brief-chat__starter"
              disabled={chatBusy || !source}
              onClick={() => void ask(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {chat.length > 0 ? (
          <div className="brief-chat__log">
            {chat.map((m) => (
              <div
                key={m.id}
                className={`brief-chat__bubble brief-chat__bubble--${m.role}`}
              >
                <span className="brief-chat__who">{m.role === 'user' ? 'You' : 'Chart'}</span>
                {m.role === 'assistant' ? (
                  <BriefChartCitedText
                    className="brief-chat__body"
                    text={m.content}
                    citations={citations}
                    onOpenCitation={openCitation}
                  />
                ) : (
                  <p>{m.content}</p>
                )}
              </div>
            ))}
            {chatBusy ? <p className="brief-muted">Looking in the record…</p> : null}
          </div>
        ) : null}

        <form
          className="brief-chat__compose"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            className="brief-input brief-chat__input"
            rows={3}
            value={question}
            disabled={chatBusy || !source}
            placeholder={
              source
                ? 'Ask anything in the record — worms, vaccines, last weight…'
                : 'Loading the chart…'
            }
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="brief-chat__actions">
            <button
              type="submit"
              className="brief-btn primary"
              disabled={chatBusy || !source || !question.trim()}
            >
              <Send size={14} aria-hidden />
              {chatBusy ? 'Asking…' : 'Ask'}
            </button>
            {chat.length > 0 ? (
              <button type="button" className="brief-text-btn" onClick={removeMyChats}>
                Remove my chats
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <p className="brief-review__disclaimer">
        <AlertTriangle size={13} aria-hidden /> This is what Scout has today, not a complete legal
        record. Confirm details on the full chart before acting.
      </p>

      {selectedExam ? (
        <PimsExamDetailModal
          exam={selectedExam}
          weightHistory={medicalRecord?.weightHistory ?? []}
          patientAgeLabel={patientAgeLabel(patientRecord)}
          patientWeightDisplay={patientWeightLabel(patientRecord)}
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
          patientName={patientName || pickField(patientRecord, 'name', 'patientName')}
          onClose={() => setSelectedSoap(null)}
        />
      ) : null}
    </div>
  );
}
