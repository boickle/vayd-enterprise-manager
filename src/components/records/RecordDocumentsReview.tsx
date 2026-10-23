import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileText,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { createScoutChartNote, finalizeScoutChartNote } from '../../api/scoutChart';
import {
  fetchPatientChartDocumentFile,
  fetchPatientChartDocuments,
  renamePatientChartDocument,
  uploadPatientChartDocument,
} from '../../api/patients';
import { fetchEmployee } from '../../api/appointmentSettings';
import {
  summarizeOutsideRecords,
  type OutsideRecordDeclined,
  type OutsideRecordReminder,
} from '../../api/soapScribe';
import { useAuth } from '../../auth/useAuth';
import type { OutsideRecordAcceptResult } from '../../utils/briefRecordStore';
import { extractTextFromUpload } from '../../utils/extractUploadText';
import RecordReviewWorkspace from './RecordReviewWorkspace';
import './RecordDocumentsReview.css';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The summarize endpoint caps source text at 200k characters. */
const MAX_SOURCE_CHARS = 190_000;
const KEEP_HEAD_CHARS = 60_000;
/** Medical history exports are often 50+ pages; the newest visits are at the end. */
const MAX_PDF_PAGES = 400;
/** The summarize endpoint reads at most 12 page images for outside records. */
const MAX_IMAGES = 12;
const ACCEPT = 'application/pdf,image/*,text/plain,.txt,.md,.html,.doc,.docx';

type DocItem = {
  key: string;
  name: string;
  /** Name last saved on the chart — only for documents already filed. */
  savedName: string | null;
  fileName: string;
  mimeType: string;
  file: File | null;
  documentId: number | null;
  previewUrl: string | null;
  previewOpen: boolean;
  loadingPreview: boolean;
};

type Props = {
  patientId: string | number;
  patientName?: string | null;
  clientId?: string | number | null;
  /** Documents already on the chart (Records → Received). Without it, staff upload new files. */
  documentIds?: number[];
  hospitalName?: string | null;
  /** Set when the host already shows a title, so the heading isn't repeated. */
  hideHeading?: boolean;
  /** Start reading the linked documents as soon as they load (chart "Summarize selected"). */
  autoSummarize?: boolean;
  onAccepted?: (result?: OutsideRecordAcceptResult) => void;
};

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nameFromFile(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .trim() || fileName
  );
}

/**
 * "Alfred Veterinary Hospital - Henry-16444_ph.pdf".
 * Spaces in the hospital name are kept; a name that already starts with it is left alone.
 */
function withHospitalPrefix(fileName: string, hospitalName?: string | null): string {
  const hospital = hospitalName?.replace(/\s+/g, ' ').trim() ?? '';
  const base = fileName.trim();
  if (!hospital || !base) return base;
  const prefix = `${hospital} - `;
  if (base.toLowerCase().startsWith(prefix.toLowerCase())) return base;
  return `${prefix}${base}`.slice(0, 512);
}

function kindOf(
  item: Pick<DocItem, 'mimeType' | 'fileName'>
): 'pdf' | 'image' | 'text' | 'word' | 'other' {
  const ext = item.fileName.toLowerCase().split('.').pop() ?? '';
  if (item.mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (item.mimeType.startsWith('image/')) return 'image';
  if (item.mimeType.startsWith('text/') || ['txt', 'md', 'html'].includes(ext)) return 'text';
  if (item.mimeType.includes('word') || ext === 'doc' || ext === 'docx') return 'word';
  return 'other';
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function staffLabel(
  emp: {
    title?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    designation?: string | null;
    email?: string | null;
  } | null
): string | null {
  if (!emp) return null;
  const parts = [emp.title, emp.firstName, emp.lastName, emp.designation].filter(
    (p) => typeof p === 'string' && p.trim()
  );
  const name = parts.join(' ').replace(/\s+/g, ' ').trim();
  return name || emp.email?.trim() || null;
}

function errorText(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: { message?: unknown } } })?.response;
  const message = response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function RecordDocumentsReview({
  patientId,
  patientName,
  clientId,
  documentIds,
  hospitalName,
  hideHeading = false,
  autoSummarize = false,
  onAccepted,
}: Props) {
  const { employeeId, userEmail } = useAuth();
  const existingMode = documentIds != null;
  const pid = Number(patientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const [items, setItems] = useState<DocItem[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState<'loading' | 'summarizing' | 'saving' | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [staffName, setStaffName] = useState<string | null>(null);
  const [found, setFound] = useState<{
    version: number;
    reminders: OutsideRecordReminder[];
    declined: OutsideRecordDeclined[];
  } | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const noteResultRef = useRef<OutsideRecordAcceptResult | null>(null);
  const idsKey = (documentIds ?? []).join(',');

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const id = Number(employeeId);
    if (!Number.isFinite(id) || id <= 0) {
      setStaffName(userEmail);
      return;
    }
    let cancelled = false;
    void fetchEmployee(id)
      .then((emp) => {
        if (!cancelled) setStaffName(staffLabel(emp) || userEmail);
      })
      .catch(() => {
        if (!cancelled) setStaffName(userEmail);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, userEmail]);

  useEffect(() => {
    setSummary('');
    setFound(null);
    setError(null);
    setFlash(null);
    if (!existingMode) {
      setItems([]);
      return;
    }
    const ids = idsKey ? idsKey.split(',').map(Number) : [];
    if (!ids.length || !Number.isFinite(pid) || pid <= 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setBusy('loading');
    void fetchPatientChartDocuments(pid)
      .then((docs) => {
        if (cancelled) return;
        const byId = new Map(docs.map((d) => [Number(d.id), d]));
        setItems(
          ids
            .map((id) => byId.get(id))
            .filter((d): d is NonNullable<typeof d> => Boolean(d) && !d?.removedAt)
            .map((d) => ({
              key: `doc-${d.id}`,
              name: withHospitalPrefix(d.name, hospitalName),
              savedName: d.name,
              fileName: d.extension ? `${nameFromFile(d.name)}.${d.extension}` : d.name,
              mimeType: d.contentType || '',
              file: null,
              documentId: Number(d.id),
              previewUrl: null,
              previewOpen: false,
              loadingPreview: false,
            }))
        );
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, 'Could not load these documents.'));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [existingMode, idsKey, pid, hospitalName]);

  const patch = (key: string, next: Partial<DocItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...next } : it)));
  };

  const trackUrl = (url: string) => {
    urlsRef.current.add(url);
    return url;
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list?.length) return;
    setError(null);
    setFlash(null);
    const tooBig: string[] = [];
    const added: DocItem[] = [];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) {
        tooBig.push(file.name);
        continue;
      }
      added.push({
        key: newKey(),
        name: withHospitalPrefix(nameFromFile(file.name), hospitalName),
        savedName: null,
        fileName: file.name,
        mimeType: file.type,
        file,
        documentId: null,
        previewUrl: trackUrl(URL.createObjectURL(file)),
        previewOpen: false,
        loadingPreview: false,
      });
    }
    if (added.length) {
      setItems((prev) => [...prev, ...added]);
      setSummary('');
      setFound(null);
    }
    if (tooBig.length) setError(`Larger than 25 MB, not added: ${tooBig.join(', ')}.`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeItem = (item: DocItem) => {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      urlsRef.current.delete(item.previewUrl);
    }
    setItems((prev) => prev.filter((it) => it.key !== item.key));
    setSummary('');
    setFound(null);
  };

  /** Documents already on the chart are downloaded on first preview or summarize. */
  const ensureFile = async (item: DocItem): Promise<{ file: File; url: string }> => {
    if (item.file && item.previewUrl) return { file: item.file, url: item.previewUrl };
    if (item.documentId == null) throw new Error(`${item.fileName} is missing its file.`);
    const res = await fetchPatientChartDocumentFile(pid, item.documentId, item.fileName);
    const file = new File([res.blob], item.fileName, {
      type: res.blob.type || item.mimeType || 'application/octet-stream',
    });
    const url = trackUrl(res.objectUrl);
    patch(item.key, { file, previewUrl: url, mimeType: file.type || item.mimeType });
    return { file, url };
  };

  const togglePreview = async (item: DocItem) => {
    if (item.previewOpen) {
      patch(item.key, { previewOpen: false });
      return;
    }
    if (item.previewUrl) {
      patch(item.key, { previewOpen: true });
      return;
    }
    patch(item.key, { loadingPreview: true });
    try {
      await ensureFile(item);
      patch(item.key, { previewOpen: true, loadingPreview: false });
    } catch (err) {
      patch(item.key, { loadingPreview: false });
      setError(errorText(err, `Could not open ${item.name}.`));
    }
  };

  /**
   * Files new uploads on the chart under their names and renames edited ones.
   * Returns the list with document ids filled in, or null when something failed.
   */
  const saveNames = async (): Promise<DocItem[] | null> => {
    if (!Number.isFinite(pid) || pid <= 0) {
      setError('Could not resolve this patient.');
      return null;
    }
    const working = [...items];
    try {
      for (const [i, item] of working.entries()) {
        const name = item.name.trim();
        if (item.documentId == null) {
          if (!item.file) continue;
          const doc = await uploadPatientChartDocument(pid, item.file, {
            name,
            documentType: 'previousRecords',
          });
          const docId = Number(doc?.id);
          if (Number.isFinite(docId) && docId > 0) {
            working[i] = { ...item, name, documentId: docId, savedName: name };
            patch(item.key, { name, documentId: docId, savedName: name });
          }
        } else if (name !== item.savedName) {
          await renamePatientChartDocument(pid, item.documentId, { name });
          working[i] = { ...item, name, savedName: name };
          patch(item.key, { name, savedName: name });
        }
      }
      return working;
    } catch (err) {
      setError(
        errorText(err, 'Could not save these documents.') +
          ' Anything that already saved will not be sent twice.'
      );
      return null;
    }
  };

  const saveNamesOnly = async () => {
    setBusy('saving');
    setError(null);
    setFlash(null);
    const working = await saveNames();
    setBusy(null);
    if (!working) return;
    const count = working.filter((it) => it.documentId != null).length;
    setFlash(
      existingMode
        ? 'Names saved.'
        : `Saved ${count} document${count === 1 ? '' : 's'} to the chart under Documents.`
    );
    if (!existingMode) {
      onAccepted?.({
        chartDocumentId: working.find((it) => it.documentId != null)?.documentId ?? null,
        scoutNoteId: null,
      });
    }
  };

  const saveAndSummarize = async () => {
    setBusy('saving');
    setError(null);
    setFlash(null);
    const working = await saveNames();
    if (!working) {
      setBusy(null);
      return;
    }
    await summarize(working);
  };

  const summarize = async (list: DocItem[]) => {
    setBusy('summarizing');
    setError(null);
    setFlash(null);
    try {
      const parts: string[] = [];
      const images: { mimeType: string; base64: string }[] = [];
      const unreadable: string[] = [];
      for (const [i, item] of list.entries()) {
        setProgress(`Reading document ${i + 1} of ${list.length}: ${item.name.trim()}…`);
        const label = `=== Document ${i + 1}: ${item.name.trim()} (${item.fileName}) ===`;
        if (kindOf(item) === 'word') {
          parts.push(`${label}\n[Word document — cannot be read here. Open the original.]`);
          unreadable.push(item.name.trim());
          continue;
        }
        const { file } = await ensureFile(item);
        const extracted = await extractTextFromUpload(file, { maxPages: MAX_PDF_PAGES });
        if (extracted.text.trim()) {
          parts.push(`${label}\n${extracted.text.trim()}`);
        } else if (extracted.images.length) {
          parts.push(`${label}\n[Scanned pages — see the attached images for Document ${i + 1}.]`);
        } else {
          parts.push(`${label}\n[Could not read this file.]`);
          unreadable.push(item.name.trim());
        }
        for (const img of extracted.images) {
          if (images.length < MAX_IMAGES) images.push(img);
        }
      }
      let sourceText = parts.join('\n\n');
      if (sourceText.length > MAX_SOURCE_CHARS) {
        // Exports run oldest to newest and open with the reminder page, so keep both ends.
        const head = sourceText.slice(0, KEEP_HEAD_CHARS);
        const tail = sourceText.slice(-(MAX_SOURCE_CHARS - KEEP_HEAD_CHARS));
        sourceText = `${head}\n\n[Middle of the records cut — the documents are longer than one summary can read.]\n\n${tail}`;
        unreadable.push('the middle of the history (too long to read in one summary)');
      }
      setProgress(
        `Writing the summary from ${list.length} document${list.length === 1 ? '' : 's'}. Large record sets can take 1–3 minutes.`
      );
      const today = new Date();
      const result = await summarizeOutsideRecords({
        sourceText,
        images,
        patientName,
        patientId: pid,
        asOfDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
        fileName: list
          .map((it) => it.name.trim())
          .join('; ')
          .slice(0, 250),
      });
      if (!result.summary.trim()) throw new Error('The summary came back empty. Try again.');
      setSummary(result.summary.trim());
      setFound((prev) => ({
        version: (prev?.version ?? 0) + 1,
        reminders: result.reminders,
        declined: result.declined,
      }));
      noteResultRef.current = null;
      setWorkspaceOpen(true);
      setFlash(
        unreadable.length
          ? `Names saved and summary ready. Couldn’t read: ${unreadable.join(', ')}.`
          : 'Names saved and summary ready.'
      );
    } catch (err) {
      setError(errorText(err, 'Could not summarize these documents.'));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /** Adds the Previous Medical Records note to the Timeline. */
  const writeSummaryNote = async (): Promise<boolean> => {
    if (noteResultRef.current) return true;
    if (!Number.isFinite(pid) || pid <= 0) {
      setError('Could not resolve this patient.');
      return false;
    }
    setError(null);
    setFlash(null);
    const working = await saveNames();
    if (!working) return false;
    try {
      const cid = Number(clientId);
      const who = staffName?.trim();
      const when = new Date().toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      const body = [
        'Previous Medical Records',
        hospitalName?.trim() ? `From ${hospitalName.trim()}` : '',
        who ? `Summarized by ${who} · ${when}` : `Summarized ${when}`,
        '',
        'Documents:',
        ...working.map((it) => `- ${it.name.trim()}`),
        '',
        summary.trim(),
      ]
        .filter((part, i) => i !== 1 || part)
        .join('\n');
      const draft = await createScoutChartNote({
        patientId: pid,
        clientId: Number.isFinite(cid) && cid > 0 ? cid : null,
        body,
      });
      const finalized = await finalizeScoutChartNote(draft.id);
      noteResultRef.current = {
        chartDocumentId: working.find((it) => it.documentId != null)?.documentId ?? null,
        scoutNoteId: finalized?.id ?? draft.id,
      };
      return true;
    } catch (err) {
      setError(
        errorText(err, 'Could not add the summary to the medical record.') +
          ' The documents are already saved to the chart.'
      );
      return false;
    }
  };

  const finishEntered = (counts: { summary: boolean; reminders: number; declined: number }) => {
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    setWorkspaceOpen(false);
    const parts = [
      counts.summary ? 'the Previous Medical Records note' : null,
      counts.reminders || !counts.summary ? plural(counts.reminders, 'reminder') : null,
      counts.declined ? plural(counts.declined, 'declined item') : null,
    ].filter(Boolean);
    setFlash(`Entered in the medical record: ${parts.join(', ')}.`);
    setSummary('');
    setFound(null);
    if (!existingMode) {
      for (const it of items) {
        if (it.previewUrl) {
          URL.revokeObjectURL(it.previewUrl);
          urlsRef.current.delete(it.previewUrl);
        }
      }
      setItems([]);
    }
    const result = noteResultRef.current;
    noteResultRef.current = null;
    onAccepted?.(result ?? undefined);
  };

  const loadPreview = async (key: string) => {
    const item = items.find((it) => it.key === key);
    if (item) await ensureFile(item);
  };

  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!autoSummarize || !existingMode || autoRanRef.current) return;
    if (busy != null || !items.length || summary) return;
    autoRanRef.current = true;
    void saveAndSummarize();
    // Runs once, after the linked documents finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSummarize, existingMode, busy, items.length, summary]);

  const disabled = busy != null;
  const namesMissing = items.some((it) => !it.name.trim());
  const isUnsaved = (it: DocItem) => it.documentId == null || it.name.trim() !== it.savedName;
  const unsavedCount = items.filter(isUnsaved).length;
  const canSave = items.length > 0 && !namesMissing && !disabled && unsavedCount > 0;
  const canSummarize = items.length > 0 && !namesMissing && !disabled;
  const canReview = !disabled && !namesMissing && Boolean(summary.trim());

  return (
    <div className="rdr">
      <div className="rdr__head">
        <FileText size={16} aria-hidden />
        <div>
          {hideHeading ? null : (
            <h3>
              {existingMode ? 'Review received records' : 'Upload records'}
              {patientName ? ` · ${patientName}` : ''}
            </h3>
          )}
          <p>
            {existingMode
              ? 'These documents are already on the chart. Rename them if needed, then save the names, or save and summarize them together for the medical record.'
              : 'Add one or more documents and name each one. Save the names to file them on the chart, or save and summarize them together for the medical record.'}
          </p>
        </div>
      </div>

      {existingMode ? null : (
        <label
          className={`rdr__drop${dragOver ? ' is-drop' : ''}${disabled ? ' is-disabled' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!disabled) addFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={16} aria-hidden />
          <span>
            {dragOver ? 'Drop to add' : items.length ? 'Add more files' : 'Choose files'}
            <em> or drag them here · PDF, images, text, or Word · up to 25 MB each</em>
          </span>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            accept={ACCEPT}
            disabled={disabled}
            onChange={(e) => addFiles(e.currentTarget.files)}
          />
        </label>
      )}

      {error ? <p className="rdr__error">{error}</p> : null}
      {flash ? <p className="rdr__flash">{flash}</p> : null}
      {busy === 'loading' ? <p className="rdr__muted">Loading documents…</p> : null}
      {progress ? (
        <p className="rdr__progress" role="status">
          <span className="rdr__spinner" aria-hidden />
          {progress}
        </p>
      ) : null}
      {existingMode && busy !== 'loading' && items.length === 0 && !error ? (
        <p className="rdr__muted">No documents are linked to this request.</p>
      ) : null}

      {items.length ? (
        <ul className="rdr__list">
          {items.map((item, i) => {
            const kind = kindOf(item);
            return (
              <li key={item.key} className="rdr__item">
                <div className="rdr__row">
                  <span className="rdr__num">{i + 1}</span>
                  {kind === 'image' && item.previewUrl ? (
                    <img className="rdr__thumb" src={item.previewUrl} alt="" />
                  ) : (
                    <span className="rdr__thumb rdr__thumb--icon" aria-hidden>
                      <FileText size={18} />
                      <small>{kind === 'other' ? 'file' : kind}</small>
                    </span>
                  )}
                  <div className="rdr__fields">
                    <input
                      className="rdr__name"
                      value={item.name}
                      disabled={disabled}
                      aria-label={`Name for ${item.fileName}`}
                      placeholder="Describe this document (e.g. 2024 vaccine history)"
                      onChange={(e) => patch(item.key, { name: e.target.value })}
                    />
                    <span className="rdr__meta">
                      {item.fileName}
                      {item.file ? ` · ${formatSize(item.file.size)}` : ''}
                      {item.documentId == null ? (
                        <em className="rdr__unsaved"> · not saved yet</em>
                      ) : isUnsaved(item) ? (
                        <em className="rdr__unsaved"> · name not saved</em>
                      ) : (
                        ' · on chart'
                      )}
                    </span>
                  </div>
                  <div className="rdr__actions">
                    <button
                      type="button"
                      className="rdr__btn"
                      disabled={item.loadingPreview}
                      onClick={() => void togglePreview(item)}
                    >
                      {item.previewOpen ? (
                        <EyeOff size={13} aria-hidden />
                      ) : (
                        <Eye size={13} aria-hidden />
                      )}
                      {item.loadingPreview ? 'Opening…' : item.previewOpen ? 'Hide' : 'Preview'}
                    </button>
                    {item.documentId != null ? null : (
                      <button
                        type="button"
                        className="rdr__btn rdr__btn--danger"
                        disabled={disabled}
                        aria-label={`Remove ${item.name}`}
                        onClick={() => removeItem(item)}
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
                {item.previewOpen && item.previewUrl ? (
                  <div className="rdr__preview">
                    {kind === 'image' ? (
                      <img src={item.previewUrl} alt={item.name} />
                    ) : kind === 'pdf' || kind === 'text' ? (
                      <iframe src={item.previewUrl} title={item.name} />
                    ) : (
                      <p className="rdr__muted">
                        No preview for this file type.{' '}
                        <a href={item.previewUrl} download={item.fileName}>
                          Download it
                        </a>{' '}
                        to look.
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {items.length ? (
        <div className="rdr__bar">
          <button
            type="button"
            className="rdr__btn"
            disabled={!canSave}
            title={namesMissing ? 'Give every document a name first' : undefined}
            onClick={() => void saveNamesOnly()}
          >
            <Save size={14} aria-hidden />
            {busy === 'saving' && !summary ? 'Saving…' : 'Save names only'}
          </button>
          <button
            type="button"
            className="rdr__btn rdr__btn--primary"
            disabled={!canSummarize}
            title={namesMissing ? 'Give every document a name first' : undefined}
            onClick={() => void saveAndSummarize()}
          >
            <Sparkles size={14} aria-hidden />
            {busy === 'summarizing'
              ? 'Summarizing…'
              : summary
                ? 'Save names & summarize again'
                : 'Save names & summarize records'}
          </button>
          <span className="rdr__muted">
            {namesMissing
              ? 'Give every document a name first.'
              : unsavedCount
                ? `${unsavedCount} ${unsavedCount === 1 ? 'change' : 'changes'} not saved yet.`
                : 'All names saved.'}
          </span>
        </div>
      ) : null}

      {items.length && summary && found ? (
        <div className="rdr__ready">
          <div>
            <strong>Summary ready — not in the medical record yet</strong>
            <span className="rdr__muted">
              {found.reminders.length} reminder{found.reminders.length === 1 ? '' : 's'}
              {found.declined.length ? ` · ${found.declined.length} declined` : ''} to review
              against the documents.
            </span>
          </div>
          <button
            type="button"
            className="rdr__btn rdr__btn--primary"
            disabled={!canReview}
            onClick={() => setWorkspaceOpen(true)}
          >
            <ClipboardCheck size={14} aria-hidden />
            Review &amp; enter in record
          </button>
        </div>
      ) : null}

      {found ? (
        <RecordReviewWorkspace
          key={found.version}
          open={workspaceOpen}
          patientId={pid}
          patientName={patientName}
          docs={items.map((it) => ({
            key: it.key,
            name: it.name.trim() || it.fileName,
            fileName: it.fileName,
            kind: kindOf(it),
            previewUrl: it.previewUrl,
          }))}
          loadPreview={loadPreview}
          summary={summary}
          onSummaryChange={setSummary}
          reminders={found.reminders}
          declined={found.declined}
          writeSummaryNote={writeSummaryNote}
          onEntered={finishEntered}
          onClose={() => setWorkspaceOpen(false)}
        />
      ) : null}

      {items.length ? (
        <p className="rdr__disclaimer">
          <AlertTriangle size={13} aria-hidden /> Summaries can miss details. Confirm important
          facts against the original documents before adding.
        </p>
      ) : null}
    </div>
  );
}
