/**
 * Forms admin — create, edit, and archive client-facing form templates.
 * Route: Settings → Communication → Forms (`/schedule/settings?tab=forms`)
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Plus, Pencil, Archive, ChevronDown, ChevronUp, Eye, GripVertical, Trash2 } from 'lucide-react';
import {
  listFormTemplates,
  createFormTemplate,
  updateFormTemplate,
  archiveFormTemplate,
  type FormField,
  type FormFieldType,
  type FormTemplate,
} from '../api/forms';
import { FORM_MERGE_FIELDS, mergeToken } from '../utils/formMergeFields';
import FormOwnerPreview from '../components/forms/FormOwnerPreview';
import './FormsAdmin.css';

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  heading: 'Section heading',
  paragraph: 'Paragraph / waiver text',
  checkbox: 'Agreement checkbox',
  text: 'Short text answer',
  textarea: 'Long text answer',
  signature: 'Signature',
};

function generateKey(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function emptyField(type: FormFieldType): FormField {
  return {
    key: generateKey(),
    type,
    label: '',
    required: type !== 'heading' && type !== 'paragraph',
  };
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 3,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? localRef;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = 22;
    const min = minRows * line;
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, [value, minRows, ref]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={minRows}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function MergeFieldInsert({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups = ['Practice', 'Client', 'Patient', 'Date'] as const;

  return (
    <div className="forms-merge" ref={rootRef}>
      <button type="button" className="forms-btn ghost small" onClick={() => setOpen((v) => !v)}>
        Insert merge field
      </button>
      {open ? (
        <div className="forms-merge__menu" role="listbox">
          {groups.map((group) => (
            <div key={group} className="forms-merge__group">
              <div className="forms-merge__group-label">{group}</div>
              {FORM_MERGE_FIELDS.filter((f) => f.group === group).map((f) => (
                <button
                  key={f.token}
                  type="button"
                  className="forms-merge__item"
                  onClick={() => {
                    onInsert(mergeToken(f.token));
                    setOpen(false);
                  }}
                >
                  <span>{f.label}</span>
                  <code>{mergeToken(f.token)}</code>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  value: string,
  token: string,
  onChange: (next: string) => void,
) {
  if (!el) {
    onChange(`${value}${token}`);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

// ── Field editor row ──────────────────────────────────────────────────────────

function FieldEditor({
  field,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  index: number;
  total: number;
  onChange: (updated: FormField) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const patch = (p: Partial<FormField>) => onChange({ ...field, ...p });
  const paragraphRef = useRef<HTMLTextAreaElement>(null);
  const checkboxRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);

  return (
    <div className="forms-field-editor">
      <div className="forms-field-editor__drag">
        <GripVertical size={16} />
      </div>

      <div className="forms-field-editor__body">
        <div className="forms-field-editor__row">
          <select
            value={field.type}
            onChange={(e) =>
              patch({
                type: e.target.value as FormFieldType,
                required: e.target.value !== 'heading' && e.target.value !== 'paragraph',
              })
            }
          >
            {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>

          {field.type !== 'heading' && field.type !== 'paragraph' && field.type !== 'signature' && (
            <label className="forms-field-editor__required">
              <input
                type="checkbox"
                checked={Boolean(field.required)}
                onChange={(e) => patch({ required: e.target.checked })}
              />
              Required
            </label>
          )}
        </div>

        {field.type === 'heading' && (
          <>
            <div className="forms-field-editor__merge-row">
              <MergeFieldInsert
                onInsert={(token) =>
                  insertAtCursor(headingRef.current, field.label, token, (next) =>
                    patch({ label: next }),
                  )
                }
              />
            </div>
            <input
              ref={headingRef}
              className="forms-input"
              placeholder="Section heading text"
              value={field.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </>
        )}

        {field.type === 'paragraph' && (
          <>
            <div className="forms-field-editor__merge-row">
              <MergeFieldInsert
                onInsert={(token) =>
                  insertAtCursor(paragraphRef.current, field.label, token, (next) =>
                    patch({ label: next }),
                  )
                }
              />
            </div>
            <AutoTextarea
              textareaRef={paragraphRef}
              className="forms-input forms-input--grow"
              minRows={6}
              placeholder="Waiver or disclosure text… Use Insert merge field for patient/client/practice details."
              value={field.label}
              onChange={(v) => patch({ label: v })}
            />
            <p className="forms-field-editor__hint">
              HTML ok: <code>&lt;strong&gt;</code>, <code>&lt;em&gt;</code>, <code>&lt;p&gt;</code>,{' '}
              <code>&lt;br&gt;</code>, <code>&lt;h3&gt;</code>, <code>&lt;ul&gt;</code>/
              <code>&lt;li&gt;</code>, <code>&lt;a href=&quot;…&quot;&gt;</code>. Plain text still
              works — line breaks are kept.
            </p>
          </>
        )}

        {field.type === 'checkbox' && (
          <>
            <input
              className="forms-input"
              placeholder='Short field label (e.g. "Acknowledgement")'
              value={field.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
            <div className="forms-field-editor__merge-row">
              <MergeFieldInsert
                onInsert={(token) =>
                  insertAtCursor(
                    checkboxRef.current,
                    field.checkboxLabel ?? '',
                    token,
                    (next) => patch({ checkboxLabel: next }),
                  )
                }
              />
            </div>
            <AutoTextarea
              textareaRef={checkboxRef}
              className="forms-input forms-input--grow"
              minRows={4}
              placeholder="Agreement statement shown next to the checkbox (can be multiple paragraphs)…"
              value={field.checkboxLabel ?? ''}
              onChange={(v) => patch({ checkboxLabel: v })}
            />
            <p className="forms-field-editor__hint">
              Same HTML tags as paragraph text are allowed here.
            </p>
          </>
        )}

        {(field.type === 'text' || field.type === 'textarea') && (
          <>
            <input
              className="forms-input"
              placeholder="Field label"
              value={field.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
            <input
              className="forms-input forms-input--hint"
              placeholder="Placeholder / hint (optional)"
              value={field.hint ?? ''}
              onChange={(e) => patch({ hint: e.target.value })}
            />
          </>
        )}

        {field.type === 'signature' && (
          <input
            className="forms-input"
            placeholder='Label (e.g. "Client signature")'
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        )}
      </div>

      <div className="forms-field-editor__actions">
        <button type="button" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          title="Move down"
        >
          <ChevronDown size={14} />
        </button>
        <button type="button" className="danger" onClick={onRemove} title="Remove field">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Template editor ───────────────────────────────────────────────────────────

function TemplateEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: FormTemplate;
  onSave: (t: FormTemplate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [allowEditBeforeSend, setAllowEditBeforeSend] = useState(
    initial?.allowEditBeforeSend ?? false,
  );
  const [fields, setFields] = useState<FormField[]>(
    initial?.fields ?? [
      { key: generateKey(), type: 'paragraph', label: '', required: false },
      { key: generateKey(), type: 'checkbox', label: '', checkboxLabel: '', required: true },
      { key: generateKey(), type: 'signature', label: 'Client signature', required: true },
    ],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  function addField(type: FormFieldType) {
    setFields((prev) => [...prev, emptyField(type)]);
  }

  function updateField(index: number, updated: FormField) {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)));
  }

  function moveField(index: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Form name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      let saved: FormTemplate;
      const payload = {
        name,
        description: description || null,
        fields,
        allowEditBeforeSend,
      };
      if (initial) {
        saved = await updateFormTemplate(initial.id, payload);
      } else {
        saved = await createFormTemplate(payload);
      }
      onSave(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save form');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="forms-editor" onSubmit={handleSave}>
      <div className="forms-editor__header">
        <h2>{initial ? 'Edit form' : 'New form'}</h2>
      </div>

      <div className="forms-editor__meta">
        <div className="forms-field">
          <label>Form name</label>
          <input
            className="forms-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Heartworm Test Waiver"
            required
          />
        </div>
        <div className="forms-field">
          <label>Internal notes (not shown to clients)</label>
          <input
            className="forms-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>
        <label className="forms-field forms-field--check">
          <input
            type="checkbox"
            checked={allowEditBeforeSend}
            onChange={(e) => setAllowEditBeforeSend(e.target.checked)}
          />
          <span>
            Allow edit prior to print/email
            <span className="forms-hint">
              Staff can tweak wording for this send before the client gets the link.
            </span>
          </span>
        </label>
      </div>

      <div className="forms-editor__fields-head">
        <strong>Form fields</strong>
        <span className="forms-hint">Fields appear in the order listed.</span>
      </div>

      <div className="forms-editor__fields">
        {fields.map((field, i) => (
          <FieldEditor
            key={field.key}
            field={field}
            index={i}
            total={fields.length}
            onChange={(u) => updateField(i, u)}
            onMove={(d) => moveField(i, d)}
            onRemove={() => removeField(i)}
          />
        ))}
      </div>

      <div className="forms-editor__add-field">
        {(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map((type) => (
          <button
            key={type}
            type="button"
            className="forms-btn ghost small"
            onClick={() => addField(type)}
          >
            <Plus size={13} /> {FIELD_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {error && <p className="forms-error">{error}</p>}

      <div className="forms-editor__footer">
        <button type="button" className="forms-btn ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="forms-btn ghost"
          disabled={saving || fields.length === 0}
          onClick={() => setPreviewOpen(true)}
        >
          <Eye size={14} /> Preview as owner
        </button>
        <button type="submit" className="forms-btn primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create form'}
        </button>
      </div>

      {previewOpen ? (
        <FormOwnerPreview
          formName={name}
          fields={fields}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FormsAdmin() {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FormTemplate | null | 'new'>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [listPreview, setListPreview] = useState<FormTemplate | null>(null);

  useEffect(() => {
    listFormTemplates()
      .then(setTemplates)
      .catch(() => setError('Could not load form templates'))
      .finally(() => setLoading(false));
  }, []);

  async function handleArchive(t: FormTemplate) {
    if (!confirm(`Archive "${t.name}"? Existing responses are kept but no new invites can be sent.`)) return;
    setArchivingId(t.id);
    try {
      await archiveFormTemplate(t.id);
      setTemplates((prev) => prev.map((f) => (f.id === t.id ? { ...f, isPublished: false } : f)));
    } catch {
      alert('Could not archive form');
    } finally {
      setArchivingId(null);
    }
  }

  function handleSaved(t: FormTemplate) {
    setTemplates((prev) => {
      const idx = prev.findIndex((f) => f.id === t.id);
      if (idx >= 0) return prev.map((f) => (f.id === t.id ? t : f));
      return [t, ...prev];
    });
    setEditing(null);
  }

  if (editing) {
    return (
      <div className="forms-page">
        <TemplateEditor
          initial={editing === 'new' ? undefined : editing}
          onSave={handleSaved}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="forms-page">
      <div className="forms-page__head">
        <div>
          <h1>Client forms</h1>
          <p className="forms-hint">
            Create forms (waivers, consents, questionnaires) that clients sign from a link
            in an email. Their signature and answers are captured and stored.
          </p>
        </div>
        <button
          type="button"
          className="forms-btn primary"
          onClick={() => setEditing('new')}
        >
          <Plus size={15} /> New form
        </button>
      </div>

      {loading && <p className="forms-hint">Loading…</p>}
      {error && <p className="forms-error">{error}</p>}

      {!loading && templates.length === 0 && (
        <div className="forms-empty">
          <p>No forms yet. Create your first form above.</p>
        </div>
      )}

      <div className="forms-list">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`forms-list-row${!t.isPublished ? ' forms-list-row--archived' : ''}`}
          >
            <div className="forms-list-row__info">
              <strong>{t.name}</strong>
              {!t.isPublished && (
                <span className="forms-badge forms-badge--muted">Archived</span>
              )}
              {t.description && <span className="forms-list-row__desc">{t.description}</span>}
              <span className="forms-hint">
                {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                {t.allowEditBeforeSend ? ' · Editable before send' : ''}
              </span>
            </div>
            <div className="forms-list-row__actions">
              <button
                type="button"
                className="forms-btn ghost small"
                onClick={() => setListPreview(t)}
                title="Preview as the owner sees it"
              >
                <Eye size={13} /> Preview
              </button>
              <button
                type="button"
                className="forms-btn ghost small"
                onClick={() => setEditing(t)}
              >
                <Pencil size={13} /> Edit
              </button>
              {t.isPublished && (
                <button
                  type="button"
                  className="forms-btn ghost small danger"
                  disabled={archivingId === t.id}
                  onClick={() => void handleArchive(t)}
                >
                  <Archive size={13} /> Archive
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {listPreview ? (
        <FormOwnerPreview
          formName={listPreview.name}
          fields={listPreview.fields}
          onClose={() => setListPreview(null)}
        />
      ) : null}
    </div>
  );
}
