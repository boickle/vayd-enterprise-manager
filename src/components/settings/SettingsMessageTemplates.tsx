import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createMessageTemplate,
  deleteMessageTemplate,
  listMessageTemplates,
  patchMessageTemplate,
  resetMessageTemplate,
} from '../../api/messageTemplates';
import { appConfirm } from '../../utils/appDialog';
import {
  applyMergeFields,
  MERGE_FIELD_GROUPS,
  MERGE_FIELDS,
  sampleMergeValues,
  tokenFor,
  type MessageCategory,
  type MessageChannel,
} from '../../utils/messageTemplateFields';
import type { MessageTemplate } from '../../utils/messageTemplateTypes';
import MessageTemplateHtmlEditor, {
  type HtmlEditorHandle,
} from '../messageTemplates/MessageTemplateHtmlEditor';
import { htmlToMultilinePlain } from '../../utils/messageTemplateHtml';
import {
  looksLikeHtmlFragment,
  sanitizeCommunicationHtml,
} from '../../utils/sanitizeCommunicationHtml';
import './SettingsMessageTemplates.css';

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

type Draft = {
  name: string;
  description: string;
  channel: MessageChannel;
  category: MessageCategory;
  subject: string;
  body: string;
  isActive: boolean;
};

function toDraft(row: MessageTemplate): Draft {
  return {
    name: row.name,
    description: row.description,
    channel: row.channel,
    category: row.category === 'system' ? 'scheduling' : row.category,
    subject: row.subject,
    body: row.body,
    isActive: row.isActive,
  };
}

function emptyDraft(): Draft {
  return {
    name: '',
    description: '',
    channel: 'email',
    category: 'general',
    subject: '',
    body: '',
    isActive: true,
  };
}

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save templates.';
}

function channelLabel(ch: MessageChannel): string {
  if (ch === 'both') return 'Email + text';
  return ch === 'sms' ? 'Text' : 'Email';
}

export default function SettingsMessageTemplates({ onMessage }: Props) {
  const [rows, setRows] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | MessageChannel>('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlHandleRef = useRef<HtmlEditorHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listMessageTemplates()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((e) => onMessage?.(extractErr(e), 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.channel !== filter && r.channel !== 'both') return false;
      if (!needle) return true;
      return `${r.name} ${r.description} ${r.body}`.toLowerCase().includes(needle);
    });
  }, [rows, filter, q]);

  const selected = selectedId && selectedId !== 'new' ? rows.find((r) => r.id === selectedId) : null;

  function openRow(row: MessageTemplate) {
    setSelectedId(row.id);
    setDraft(toDraft(row));
  }

  function startNew() {
    setSelectedId('new');
    setDraft(emptyDraft());
  }

  function insertToken(id: string) {
    const token = tokenFor(id);
    if (draft.channel === 'email') {
      htmlHandleRef.current?.insertText(token);
      return;
    }
    const el = bodyRef.current;
    if (!el) {
      setDraft((d) => ({ ...d, body: `${d.body}${token}` }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = `${el.value.slice(0, start)}${token}${el.value.slice(end)}`;
    setDraft((d) => ({ ...d, body: next }));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      onMessage?.('Give the template a name.', 'error');
      return;
    }
    if (!draft.body.trim() && !draft.subject.trim()) {
      onMessage?.('Add a subject or message.', 'error');
      return;
    }
    const payload = {
      ...draft,
      body:
        draft.channel === 'email' && looksLikeHtmlFragment(draft.body)
          ? sanitizeCommunicationHtml(draft.body)
          : draft.body,
    };
    setSaving(true);
    try {
      if (selectedId === 'new') {
        const created = await createMessageTemplate(payload);
        setRows((cur) => [created, ...cur.filter((r) => r.id !== created.id)]);
        setSelectedId(created.id);
        setDraft(toDraft(created));
        onMessage?.('Template added.', 'success');
      } else if (selectedId) {
        const updated = await patchMessageTemplate(selectedId, payload);
        setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
        setDraft(toDraft(updated));
        onMessage?.('Template saved.', 'success');
      }
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: MessageTemplate) {
    try {
      const updated = await patchMessageTemplate(row.id, { isActive: !row.isActive });
      setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    }
  }

  async function remove() {
    if (!selected || selected.isSystem) return;
    const ok = await appConfirm({
      title: 'Delete template',
      message: `Delete “${selected.name}”? Staff will no longer see it when emailing or texting a client.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteMessageTemplate(selected.id);
      setRows((cur) => cur.filter((r) => r.id !== selected.id));
      setSelectedId(null);
      onMessage?.('Template deleted.', 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function resetSystem() {
    if (!selected?.isSystem) return;
    const ok = await appConfirm({
      title: 'Reset automatic template',
      message: 'Restore the original Scout wording for this automatic message?',
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const updated = await resetMessageTemplate(selected.id);
      setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
      setDraft(toDraft(updated));
      onMessage?.('Restored original wording.', 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  const previewSubject = applyMergeFields(draft.subject, sampleMergeValues());
  const previewBody = applyMergeFields(draft.body, sampleMergeValues());

  return (
    <div className="settings-card msg-tpl">
      <div className="msg-tpl__intro">
        <div>
          <h3 className="settings-card-title">Email &amp; text templates</h3>
          <p className="settings-muted">
            Write once, then pick the template when you email or text a client. Nest fields like
            patient name and he/she, then generate the message from the record you are on.
            Automatic Scout texts (care outreach, on my way, pay links, and the rest) live here
            too — edit them and the next send uses your wording.
          </p>
        </div>
        <button type="button" className="btn" onClick={startNew}>
          Add a template
        </button>
      </div>

      <div className="msg-tpl__toolbar">
        <input
          className="settings-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search templates…"
        />
        <div className="msg-tpl__filters">
          {(['all', 'email', 'sms'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`msg-tpl__chip${filter === f ? ' is-on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'sms' ? 'Text' : 'Email'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="settings-muted">Loading templates…</p>
      ) : (
        <div className="msg-tpl__split">
          <div className="msg-tpl__list-wrap">
            <table className="settings-table msg-tpl__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Channel</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === selectedId ? 'is-selected' : ''}
                    onClick={() => openRow(row)}
                  >
                    <td>
                      <div className="msg-tpl__name">{row.name}</div>
                      <div className="msg-tpl__desc">
                        {row.isSystem ? 'Automatic · ' : ''}
                        {row.description || row.category}
                      </div>
                    </td>
                    <td>{channelLabel(row.channel)}</td>
                    <td>
                      <button
                        type="button"
                        className={`msg-tpl__dot${row.isActive ? ' is-on' : ''}`}
                        title={row.isActive ? 'Active — click to hide' : 'Inactive — click to show'}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleActive(row);
                        }}
                      >
                        {row.isActive ? 'On' : 'Off'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedId ? (
            <div className="msg-tpl__editor">
              <h4 className="msg-tpl__editor-title">
                {selectedId === 'new' ? 'New template' : selected?.name}
                {selected?.isSystem ? <span className="msg-tpl__badge">Automatic</span> : null}
              </h4>

              <label className="msg-tpl__field">
                <span>Name</span>
                <input
                  className="settings-input"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <label className="msg-tpl__field">
                <span>Description</span>
                <input
                  className="settings-input"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </label>
              <div className="msg-tpl__row">
                <label className="msg-tpl__field">
                  <span>Channel</span>
                  <select
                    className="settings-input"
                    value={draft.channel}
                    onChange={(e) => {
                      const channel = e.target.value as MessageChannel;
                      setDraft((d) => ({
                        ...d,
                        channel,
                        body:
                          channel === 'sms' && looksLikeHtmlFragment(d.body)
                            ? htmlToMultilinePlain(d.body)
                            : d.body,
                      }));
                    }}
                  >
                    <option value="email">Email</option>
                    <option value="sms">Text</option>
                    <option value="both">Email + text</option>
                  </select>
                </label>
                <label className="msg-tpl__field">
                  <span>Category</span>
                  <select
                    className="settings-input"
                    value={draft.category}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, category: e.target.value as MessageCategory }))
                    }
                  >
                    <option value="clinical">Clinical</option>
                    <option value="billing">Billing</option>
                    <option value="scheduling">Scheduling</option>
                    <option value="general">General</option>
                  </select>
                </label>
              </div>

              {draft.channel !== 'sms' ? (
                <label className="msg-tpl__field">
                  <span>Subject</span>
                  <input
                    ref={subjectRef}
                    className="settings-input"
                    value={draft.subject}
                    onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                  />
                </label>
              ) : null}

              <div className="msg-tpl__field">
                <span>Message</span>
                <div className="msg-tpl__chips" aria-label="Insert a parameter">
                  {MERGE_FIELD_GROUPS.map((group) => (
                    <div key={group} className="msg-tpl__chip-group">
                      <span className="msg-tpl__chip-group-label">{group}</span>
                      {MERGE_FIELDS.filter((f) => f.group === group).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className="msg-tpl__insert"
                          title={`Insert ${tokenFor(f.id)}`}
                          onClick={() => insertToken(f.id)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                {draft.channel === 'email' ? (
                  <MessageTemplateHtmlEditor
                    value={draft.body}
                    editorHandleRef={htmlHandleRef}
                    onChange={(body) => setDraft((d) => ({ ...d, body }))}
                  />
                ) : (
                  <textarea
                    ref={bodyRef}
                    className="msg-tpl__body"
                    rows={10}
                    value={draft.body}
                    onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                    placeholder="Write the message. Click a parameter to nest it."
                  />
                )}
                {draft.channel !== 'email' ? (
                  <div className="msg-tpl__count">{draft.body.length} characters</div>
                ) : null}
              </div>

              <div className="msg-tpl__preview-head">
                <strong>Preview with sample parameters</strong>
                <button type="button" className="btn-link" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? 'Hide' : 'Show'}
                </button>
              </div>
              {showPreview ? (
                <div className="msg-tpl__preview">
                  {previewSubject ? <div className="msg-tpl__preview-sub">{previewSubject}</div> : null}
                  {looksLikeHtmlFragment(previewBody) ? (
                    <div
                      className="msg-tpl__preview-body"
                      dangerouslySetInnerHTML={{ __html: sanitizeCommunicationHtml(previewBody) }}
                    />
                  ) : (
                    <div className="msg-tpl__preview-body">{previewBody || '—'}</div>
                  )}
                </div>
              ) : null}

              <div className="msg-tpl__actions">
                <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save template'}
                </button>
                {selected?.isSystem ? (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving || !selected.isCustomized}
                    onClick={() => void resetSystem()}
                  >
                    Restore original
                  </button>
                ) : null}
                {selected && !selected.isSystem ? (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving}
                    onClick={() => void remove()}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="msg-tpl__empty-editor settings-muted">
              Select a template to edit, or add one for the list staff see when they click Email
              client or Text client.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
