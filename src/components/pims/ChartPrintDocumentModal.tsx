import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, Printer, X } from 'lucide-react';
import { fetchEmployee } from '../../api/appointmentSettings';
import type { GmailComposeAttachment } from '../../api/gmail';
import {
  downloadBlobUrl,
  uploadPatientChartDocument,
} from '../../api/patients';
import { useAuth } from '../../auth/useAuth';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import {
  applyKindDefaults,
  applyProvider,
  applyRabiesSource,
  documentFilename,
  documentTitle,
  generatePatientDocumentPdf,
  loadPatientDocumentContext,
  newVaccinePlanRow,
  PATIENT_DOC_KINDS,
  VACCINE_PLAN_WEEKS,
  type PatientDocContext,
  type PatientDocDraft,
  type PatientDocKind,
} from '../../utils/patientDocuments';
import './ChartPrintDocumentModal.css';

type Props = {
  patientId: number;
  patientName?: string;
  clientId?: number | null;
  clientName?: string;
  clientDefaultEmail?: string | null;
  open: boolean;
  onClose: () => void;
  onFiled?: () => void;
};

function setField<K extends keyof PatientDocDraft>(
  draft: PatientDocDraft,
  key: K,
  value: PatientDocDraft[K],
): PatientDocDraft {
  return { ...draft, [key]: value };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const b64 = result.split(',')[1] || '';
      if (!b64) reject(new Error('Could not read the PDF.'));
      else resolve(b64);
    };
    reader.onerror = () => reject(new Error('Could not read the PDF.'));
    reader.readAsDataURL(blob);
  });
}

function printPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = url;
  const cleanup = () => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    cleanup();
  };
  document.body.appendChild(frame);
}

function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function documentEmailHtml(
  kind: PatientDocKind,
  draft: PatientDocDraft,
  fallbackPatient: string,
  staffName: string,
): string {
  const client = draft.clientName.trim() || 'there';
  const pet = draft.patientName.trim() || fallbackPatient.trim() || 'your pet';
  const staff = staffName.trim() || 'Vet At Your Door';
  const med = [draft.rxName, draft.rxStrength].filter((part) => part.trim()).join(' ').trim();
  const body =
    kind === 'rx'
      ? `Here is ${pet}'s prescription for ${med || 'the medication'}.`
      : kind === 'health'
        ? `Here is ${pet}'s domestic health certificate.`
        : kind === 'vaccineCat' || kind === 'vaccineDog'
          ? `Here is ${pet}'s vaccine / preventatives plan.`
          : kind === 'litterCheck'
            ? `Here is ${pet}'s litter check exam.`
            : `Here is ${pet}'s ${documentTitle(kind).toLowerCase()}.`;
  return [
    `<p>Hi ${escapeEmailHtml(client)},</p>`,
    `<p>${escapeEmailHtml(body)}</p>`,
    `<p>Let me know if you need anything!</p>`,
    `<p>Take care,<br>${escapeEmailHtml(staff)}</p>`,
  ].join('');
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="chart-print-doc__fact">
      <dt>{label}</dt>
      <dd>{value.trim() || '—'}</dd>
    </div>
  );
}

export default function ChartPrintDocumentModal({
  patientId,
  patientName,
  clientId,
  clientName,
  clientDefaultEmail,
  open,
  onClose,
  onFiled,
}: Props) {
  const auth = useAuth();
  const [kind, setKind] = useState<PatientDocKind | null>(null);
  const [ctx, setCtx] = useState<PatientDocContext | null>(null);
  const [draft, setDraft] = useState<PatientDocDraft | null>(null);
  const [staffName, setStaffName] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [emailAtt, setEmailAtt] = useState<GmailComposeAttachment[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setError(null);
    setOk(null);
    setEmailAtt(null);
    setLoading(true);
    loadPatientDocumentContext(patientId)
      .then((next) => {
        setCtx(next);
        setDraft(next.draft);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load patient details.');
      })
      .finally(() => setLoading(false));
  }, [open, patientId]);

  useEffect(() => {
    if (!open) return;
    const id = Number(auth.employeeId);
    if (!Number.isFinite(id) || id <= 0) {
      setStaffName('');
      return;
    }
    let cancelled = false;
    void fetchEmployee(id)
      .then((emp) => {
        if (cancelled) return;
        const name = [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim();
        setStaffName(name);
      })
      .catch(() => {
        if (!cancelled) setStaffName('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, auth.employeeId]);

  async function makePdf(): Promise<{ blob: Blob; filename: string; title: string }> {
    if (!kind || !draft || !ctx) throw new Error('Pick a document type first.');
    const blob = await generatePatientDocumentPdf(kind, draft, ctx.letterhead);
    return {
      blob,
      filename: documentFilename(kind, draft.patientName || patientName || 'patient'),
      title: documentTitle(kind),
    };
  }

  async function fileOnChart(blob: Blob, filename: string, title: string) {
    if (!draft) return;
    const file = new File([blob], filename, { type: 'application/pdf' });
    await uploadPatientChartDocument(patientId, file, {
      name: `${title} — ${draft.patientName || patientName || 'Patient'}`,
      description: title,
      documentType: 'other',
      serviceDate:
        kind === 'rabies'
          ? draft.vaccinationDate
          : kind === 'death'
            ? draft.dateOfDeath
            : kind === 'spayNeuter'
              ? draft.surgeryDate
              : kind === 'rx'
                ? draft.rxDate
                : kind === 'health' || kind === 'litterCheck'
                  ? draft.examDate
                  : undefined,
    });
    onFiled?.();
  }

  async function handleDownload(alsoFile: boolean) {
    if (!kind || !draft) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { blob, filename, title } = await makePdf();
      const objectUrl = URL.createObjectURL(blob);
      downloadBlobUrl(objectUrl, filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      if (alsoFile) {
        await fileOnChart(blob, filename, title);
        setOk('PDF downloaded and filed on the chart.');
      } else {
        setOk('PDF downloaded.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that PDF.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrint() {
    if (!kind || !draft) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { blob, filename, title } = await makePdf();
      await fileOnChart(blob, filename, title);
      printPdfBlob(blob);
      setOk('Sent to the printer and filed on the chart.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not print that PDF.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail() {
    if (!kind || !draft) return;
    if (clientId == null) {
      setError('This pet has no client on file, so the document cannot be emailed.');
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { blob, filename } = await makePdf();
      setEmailAtt([
        {
          filename,
          mimeType: 'application/pdf',
          contentBase64: await blobToBase64(blob),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that PDF.');
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;

  const heading = patientName ? `Print document · ${patientName}` : 'Print document';
  const emailSubject =
    kind && draft
      ? kind === 'rx'
        ? `${draft.patientName || patientName || 'Your pet'}'s prescription`
        : kind === 'vaccineCat' || kind === 'vaccineDog'
          ? `${draft.patientName || patientName || 'Your pet'}'s vaccine plan`
          : kind === 'litterCheck'
            ? `${draft.patientName || patientName || 'Your pet'}'s litter check exam`
            : `${documentTitle(kind)} — ${draft.patientName || patientName || 'your pet'}`
      : '';
  const isVaccinePlan = kind === 'vaccineCat' || kind === 'vaccineDog';
  const isLitterCheck = kind === 'litterCheck';
  const needsSigner = kind === 'rx' || kind === 'rabies' || kind === 'health';
  const needsDeathDate = kind === 'death' && !draft?.dateOfDeath.trim();
  const showVetPicker = Boolean(kind) && !isVaccinePlan && (kind !== 'rabies' || (ctx?.source.rabiesLogs.length ?? 0) > 0);
  const actionDisabled = busy || (needsSigner && !draft?.veterinarianEmployeeId) || needsDeathDate;

  return createPortal(
    <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="chart-print-doc-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card chart-send-form chart-send-form--dialog chart-print-doc">
        <div className="pims-chart-pick__head chart-send-form__header">
          <h3 id="chart-print-doc-title">{heading}</h3>
          <button type="button" onClick={onClose} className="chart-send-form__close" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <p className="pims-chart-pick__empty chart-send-form__intro chart-print-doc__intro">
          Staff PDFs for this patient. A written prescription is for the owner to take elsewhere.
          Certificates print from the chart. Use Send form when the client needs to sign something.
        </p>

        {loading && <p className="chart-send-form__hint" style={{ padding: '0 16px' }}>Loading patient details…</p>}
        {error && !draft && <p className="chart-print-doc__error" style={{ padding: '0 16px 12px' }}>{error}</p>}

        {!loading && (
          <div className="chart-print-doc__kinds">
            {PATIENT_DOC_KINDS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chart-print-doc__kind${kind === item.id ? ' is-selected' : ''}`}
                onClick={() => {
                  setKind(item.id);
                  setOk(null);
                  setError(null);
                  if (draft && ctx) setDraft(applyKindDefaults(item.id, draft, ctx.source));
                }}
              >
                <span className={`chart-print-doc__badge${item.editable ? ' is-edit' : ' is-locked'}`}>
                  {item.editable ? 'Editable' : 'Not editable'}
                </span>
                <strong>{item.title}</strong>
                <span>{item.blurb}</span>
              </button>
            ))}
          </div>
        )}

        {kind && draft && ctx && (
          <div className="chart-print-doc__form">
            <p className="chart-print-doc__mode">
              {kind === 'rx'
                ? 'Write a new prescription the owner can take to another pharmacy. This does not pull from mail-order fills. Printing, emailing, or downloading files it on the chart.'
                : kind === 'rabies'
                  ? 'Only for a rabies vaccine we administered. Signed by the veterinarian who gave it, unless they are no longer on staff.'
                  : kind === 'health'
                    ? 'Travel and boarding health letter. Choose which vaccines to list. The selected veterinarian signs this. Printing, emailing, or downloading files it on the chart.'
                    : isVaccinePlan
                      ? 'Blank vaccine / preventatives grid. Mark the cells you want — nothing is pre-checked. Printing, emailing, or downloading files it on the chart.'
                      : isLitterCheck
                        ? 'Fill in findings for this puppy or kitten, or leave the boxes blank and print to complete by hand. Printing, emailing, or downloading files it on the chart.'
                        : kind === 'death'
                          ? 'Enter the date of death before printing. Printing, emailing, or downloading files it on the chart.'
                          : 'Not editable — this prints from the chart. Pick which record to include if more than one is on file.'}
            </p>

            {kind === 'rabies' && ctx.source.rabiesLogs.length === 0 && (
              <p className="chart-print-doc__blocked">
                We have not administered a rabies vaccine to this patient, so a rabies certificate
                cannot be issued.
              </p>
            )}

            {kind === 'rabies' && ctx.source.rabiesLogs.length > 1 && (
              <label className="chart-print-doc__label">
                Rabies dose we gave
                <select
                  onChange={(e) => setDraft(applyRabiesSource(draft, ctx.source, e.target.value))}
                  defaultValue={String(ctx.source.rabiesLogs[0]?.id ?? '')}
                >
                  {ctx.source.rabiesLogs.map((log) => (
                    <option key={String(log.id)} value={String(log.id)}>
                      {String(log.vaccineName ?? 'Rabies')} · {String(log.dateVaccinated ?? '').slice(0, 10)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {kind === 'rabies' && ctx.source.rabiesLogs.length > 0 && !draft.veterinarianEmployeeId && (
              <p className="chart-print-doc__mode">
                The veterinarian who administered this vaccine is no longer on staff, or was not
                recorded. Choose who should sign.
              </p>
            )}

            {showVetPicker && (
              <label className="chart-print-doc__label">
                Veterinarian
                <select
                  value={draft.veterinarianEmployeeId != null ? String(draft.veterinarianEmployeeId) : ''}
                  onChange={(e) =>
                    setDraft(applyProvider(draft, ctx.source.providers, e.target.value, ctx.source.signatures))
                  }
                >
                  <option value="">Choose a veterinarian</option>
                  {ctx.source.providers
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                        {p.license ? ` · ${p.license}` : ''}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {showVetPicker && draft.veterinarianSignaturePng ? (
              <p className="chart-print-doc__sig-preview">
                <span>Signature on file</span>
                <img src={draft.veterinarianSignaturePng} alt="" />
              </p>
            ) : showVetPicker && draft.veterinarianEmployeeId != null ? (
              <p className="chart-print-doc__mode">
                No signature on file for this veterinarian. Add one in Staff → Staff (Profile or Photo).
              </p>
            ) : null}

            {!(kind === 'rabies' && ctx.source.rabiesLogs.length === 0) && (
              <dl className="chart-print-doc__facts">
                <Fact label="Client" value={draft.clientName} />
                <Fact label="Patient" value={draft.patientName} />
                <Fact label="Address" value={draft.address.replace(/\n/g, ', ')} />
                <Fact label="Phone" value={draft.phone} />
                <Fact label="Species" value={draft.species} />
                <Fact label="Breed" value={draft.breed} />
                {kind !== 'rx' && !isVaccinePlan && !isLitterCheck ? (
                  <>
                    <Fact label="Sex" value={draft.sex} />
                    <Fact label="Color" value={draft.color} />
                    <Fact label="Weight" value={draft.weight} />
                    <Fact label="Microchip" value={draft.microchip} />
                  </>
                ) : null}
                {isLitterCheck ? (
                  <>
                    <Fact label="Sex" value={draft.sex} />
                    <Fact label="Breed" value={draft.breed} />
                  </>
                ) : null}
                {!isVaccinePlan && <Fact label="Veterinarian" value={draft.veterinarianName} />}
                {!isVaccinePlan && <Fact label="License" value={draft.veterinarianLicense} />}
                {kind === 'rabies' && (
                  <>
                    <Fact label="Tag number" value={draft.tagNumber} />
                    <Fact label="Serial number" value={draft.serialNumber} />
                    <Fact label="Vaccination" value={draft.vaccinationName} />
                    <Fact label="Manufacturer" value={draft.manufacturer} />
                    <Fact label="Vaccine type" value={draft.vaccineType} />
                    <Fact label="Vaccination date" value={draft.vaccinationDate} />
                    <Fact label="Expiration" value={draft.expirationDate} />
                  </>
                )}
              </dl>
            )}

            {kind === 'rx' && (
              <div className="chart-print-doc__grid">
                <label className="chart-print-doc__label">
                  Medication
                  <input value={draft.rxName} onChange={(e) => setDraft(setField(draft, 'rxName', e.target.value))} />
                </label>
                <label className="chart-print-doc__label">
                  Strength
                  <input value={draft.rxStrength} onChange={(e) => setDraft(setField(draft, 'rxStrength', e.target.value))} />
                </label>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Directions
                  <textarea
                    rows={3}
                    value={draft.rxInstructions}
                    onChange={(e) => setDraft(setField(draft, 'rxInstructions', e.target.value))}
                  />
                </label>
                <label className="chart-print-doc__label">
                  Quantity
                  <input value={draft.rxQuantity} onChange={(e) => setDraft(setField(draft, 'rxQuantity', e.target.value))} />
                </label>
                <label className="chart-print-doc__label">
                  Refills
                  <input value={draft.rxRefills} onChange={(e) => setDraft(setField(draft, 'rxRefills', e.target.value))} />
                </label>
                <label className="chart-print-doc__label">
                  Date
                  <input type="date" value={draft.rxDate} onChange={(e) => setDraft(setField(draft, 'rxDate', e.target.value))} />
                </label>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Compounding note
                  <input
                    value={draft.rxCompoundingReason}
                    onChange={(e) => setDraft(setField(draft, 'rxCompoundingReason', e.target.value))}
                  />
                </label>
              </div>
            )}

            {kind === 'death' && (
              <div className="chart-print-doc__grid">
                {!draft.dateOfDeath.trim() && (
                  <p className="chart-print-doc__mode chart-print-doc__label--full">
                    Enter the date of death before this certificate can be printed or sent.
                  </p>
                )}
                <label className="chart-print-doc__label">
                  Date of death *
                  <input
                    type="date"
                    value={draft.dateOfDeath}
                    onChange={(e) => setDraft(setField(draft, 'dateOfDeath', e.target.value))}
                    required
                  />
                </label>
                <label className="chart-print-doc__label">
                  Manner
                  <select
                    value={draft.mannerOfDeath}
                    onChange={(e) => setDraft(setField(draft, 'mannerOfDeath', e.target.value))}
                  >
                    <option>Euthanasia</option>
                    <option>Natural</option>
                    <option>Unknown</option>
                  </select>
                </label>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Cause
                  <input
                    value={draft.causeOfDeath}
                    onChange={(e) => setDraft(setField(draft, 'causeOfDeath', e.target.value))}
                  />
                </label>
              </div>
            )}

            {kind === 'spayNeuter' && (
              <div className="chart-print-doc__grid">
                <label className="chart-print-doc__label">
                  Procedure
                  <input
                    value={draft.procedureName}
                    onChange={(e) => setDraft(setField(draft, 'procedureName', e.target.value))}
                  />
                </label>
                <label className="chart-print-doc__label">
                  Surgery date
                  <input
                    type="date"
                    value={draft.surgeryDate}
                    onChange={(e) => setDraft(setField(draft, 'surgeryDate', e.target.value))}
                  />
                </label>
              </div>
            )}

            {isLitterCheck && (
              <div className="chart-print-doc__grid">
                <label className="chart-print-doc__label">
                  Exam date
                  <input
                    type="date"
                    value={draft.examDate}
                    onChange={(e) => setDraft(setField(draft, 'examDate', e.target.value))}
                  />
                </label>
                <label className="chart-print-doc__label">
                  Weight
                  <input
                    value={draft.litterWeight}
                    onChange={(e) => setDraft(setField(draft, 'litterWeight', e.target.value))}
                    placeholder={draft.weight || 'e.g. 4.2 lb'}
                  />
                </label>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Attitude / hydration / subjective
                  <textarea
                    rows={3}
                    value={draft.litterAttitude}
                    onChange={(e) => setDraft(setField(draft, 'litterAttitude', e.target.value))}
                  />
                </label>
                <div className="chart-print-doc__label chart-print-doc__label--full">
                  <span>Physical exam</span>
                  <div className="chart-print-doc__systems">
                    {draft.litterSystems.map((row, idx) => (
                      <div key={row.id} className="chart-print-doc__system">
                        <strong>{row.label}</strong>
                        <label>
                          <input
                            type="radio"
                            name={`litter-${row.id}`}
                            checked={row.mark === 'normal'}
                            onChange={() => {
                              const next = draft.litterSystems.map((r, i) =>
                                i === idx ? { ...r, mark: 'normal' as const } : r,
                              );
                              setDraft({ ...draft, litterSystems: next });
                            }}
                          />
                          Normal
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`litter-${row.id}`}
                            checked={row.mark === 'abnormal'}
                            onChange={() => {
                              const next = draft.litterSystems.map((r, i) =>
                                i === idx ? { ...r, mark: 'abnormal' as const } : r,
                              );
                              setDraft({ ...draft, litterSystems: next });
                            }}
                          />
                          Abnormal
                        </label>
                        <button
                          type="button"
                          className="chart-print-doc__plan-remove"
                          onClick={() => {
                            const next = draft.litterSystems.map((r, i) =>
                              i === idx ? { ...r, mark: '' as const } : r,
                            );
                            setDraft({ ...draft, litterSystems: next });
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Assessment
                  <textarea
                    rows={3}
                    value={draft.litterAssessment}
                    onChange={(e) => setDraft(setField(draft, 'litterAssessment', e.target.value))}
                  />
                </label>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Plan
                  <textarea
                    rows={3}
                    value={draft.litterPlan}
                    onChange={(e) => setDraft(setField(draft, 'litterPlan', e.target.value))}
                  />
                </label>
              </div>
            )}

            {kind === 'health' && (
              <div className="chart-print-doc__grid">
                <label className="chart-print-doc__label">
                  Exam date
                  <input
                    type="date"
                    value={draft.examDate}
                    onChange={(e) => setDraft(setField(draft, 'examDate', e.target.value))}
                  />
                </label>
                <label className="chart-print-doc__label chart-print-doc__label--full">
                  Health statement
                  <textarea
                    rows={4}
                    value={draft.healthStatement}
                    onChange={(e) => setDraft(setField(draft, 'healthStatement', e.target.value))}
                  />
                </label>
              </div>
            )}

            {isVaccinePlan && (
              <div className="chart-print-doc__plan-wrap">
                <div className="chart-print-doc__plan">
                  <table className="chart-print-doc__plan-table">
                    <thead>
                      <tr>
                        <th>Vaccine / medication / procedure</th>
                        {VACCINE_PLAN_WEEKS.map((week) => (
                          <th key={week}>{week}</th>
                        ))}
                        <th aria-label="Remove row" />
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Approximate date</td>
                        {VACCINE_PLAN_WEEKS.map((week, i) => (
                          <td key={week}>
                            <input
                              type="date"
                              value={draft.vaccinePlanDates[i] || ''}
                              onChange={(e) => {
                                const next = [...draft.vaccinePlanDates];
                                next[i] = e.target.value;
                                setDraft({ ...draft, vaccinePlanDates: next });
                              }}
                            />
                          </td>
                        ))}
                        <td />
                      </tr>
                      {draft.vaccinePlanRows.map((row, rowIdx) => (
                        <tr key={row.id}>
                          <td>
                            <input
                              type="text"
                              value={row.label}
                              onChange={(e) => {
                                const next = draft.vaccinePlanRows.map((r, i) =>
                                  i === rowIdx ? { ...r, label: e.target.value } : r,
                                );
                                setDraft({ ...draft, vaccinePlanRows: next });
                              }}
                            />
                          </td>
                          {VACCINE_PLAN_WEEKS.map((week, weekIdx) => (
                            <td key={week}>
                              <input
                                type="checkbox"
                                className="chart-print-doc__plan-check"
                                checked={Boolean(row.weeks[weekIdx])}
                                aria-label={`${row.label || 'Row'} at ${week}`}
                                onChange={(e) => {
                                  const next = draft.vaccinePlanRows.map((r, i) => {
                                    if (i !== rowIdx) return r;
                                    const weeks = [...r.weeks];
                                    weeks[weekIdx] = e.target.checked;
                                    return { ...r, weeks };
                                  });
                                  setDraft({ ...draft, vaccinePlanRows: next });
                                }}
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              type="button"
                              className="chart-print-doc__plan-remove"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  vaccinePlanRows: draft.vaccinePlanRows.filter((_, i) => i !== rowIdx),
                                })
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="brief-btn"
                  onClick={() =>
                    setDraft({ ...draft, vaccinePlanRows: [...draft.vaccinePlanRows, newVaccinePlanRow()] })
                  }
                >
                  Add row
                </button>
                <label className="chart-print-doc__label">
                  Footer note
                  <textarea
                    rows={4}
                    value={draft.vaccinePlanNote}
                    onChange={(e) => setDraft(setField(draft, 'vaccinePlanNote', e.target.value))}
                  />
                </label>
              </div>
            )}

            {(kind === 'vaccination' || kind === 'health') && (
              <div className="chart-print-doc__vaccines">
                <p className="chart-print-doc__mode">
                  {kind === 'health' ? 'Vaccines to list on the certificate' : 'Vaccines to include'}
                </p>
                {draft.vaccineRows.length === 0 && (
                  <p className="chart-send-form__hint">No vaccination logs on this chart yet — you can still print a blank certificate.</p>
                )}
                {draft.vaccineRows.map((row, idx) => (
                  <label key={row.id} className="chart-print-doc__vaccine">
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={(e) => {
                        const next = draft.vaccineRows.map((r, i) =>
                          i === idx ? { ...r, included: e.target.checked } : r,
                        );
                        setDraft({ ...draft, vaccineRows: next });
                      }}
                    />
                    <span>
                      {row.name}
                      <small>
                        {row.date || 'no date'}
                        {row.expires ? ` · expires ${row.expires}` : ''}
                        {row.lot ? ` · lot ${row.lot}` : ''}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {error && <p className="chart-print-doc__error">{error}</p>}
            {ok && <p className="chart-print-doc__ok">{ok}</p>}

            {!(kind === 'rabies' && ctx.source.rabiesLogs.length === 0) && (
            <div className="pims-chart-pick__foot chart-send-form__foot chart-print-doc__foot">
              <button
                type="button"
                className="brief-btn primary"
                disabled={actionDisabled}
                onClick={() => void handlePrint()}
              >
                <Printer size={14} aria-hidden />
                {busy ? 'Creating…' : 'Print'}
              </button>
              <button
                type="button"
                className="brief-btn"
                disabled={actionDisabled}
                onClick={() => void handleEmail()}
              >
                <Mail size={14} aria-hidden />
                Email
              </button>
              <button
                type="button"
                className="brief-btn"
                disabled={actionDisabled}
                onClick={() => void handleDownload(true)}
              >
                Download & file
              </button>
              <button type="button" className="brief-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
            )}
          </div>
        )}
      </div>

      {clientId != null && emailAtt && draft && kind ? (
        <ClientEmailComposeModal
          open
          clientId={clientId}
          clientLabel={clientName || draft.clientName || 'Client'}
          title={`Email ${documentTitle(kind)}`}
          initialTo={clientDefaultEmail ?? undefined}
          initialSubject={emailSubject}
          initialBodyText={documentEmailHtml(kind, draft, patientName || '', staffName)}
          initialAttachments={emailAtt}
          regardingPatients={[{ id: patientId, name: draft.patientName || patientName || 'Patient' }]}
          regardingPatientId={patientId}
          onAfterSend={async () => {
            const { blob, filename, title } = await makePdf();
            await fileOnChart(blob, filename, title);
            setEmailAtt(null);
            setOk('Emailed and filed on the chart.');
          }}
          onClose={() => setEmailAtt(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
