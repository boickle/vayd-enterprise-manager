import { useMemo, useState } from 'react';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import {
  applyMergeFields,
  hasMergeTokens,
  type MergeValues,
  type MessageChannel,
} from '../../utils/messageTemplateFields';
import { templateBodyForChannel } from '../../utils/messageTemplateHtml';
import type { MessageTemplate } from '../../utils/messageTemplateTypes';
import './MessageTemplatePicker.css';

type Props = {
  channel: MessageChannel;
  mergeValues?: MergeValues;
  disabled?: boolean;
  onApply: (next: { subject: string; body: string; generated: boolean }) => void;
  currentSubject?: string;
  currentBody?: string;
};

export default function MessageTemplatePicker({
  channel,
  mergeValues,
  disabled,
  onApply,
  currentSubject = '',
  currentBody = '',
}: Props) {
  const { templates, loading } = useMessageTemplates(channel);
  const [selectedId, setSelectedId] = useState('');
  const [applyOnInsert, setApplyOnInsert] = useState(true);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const canGenerate = Boolean(
    mergeValues && (hasMergeTokens(currentSubject) || hasMergeTokens(currentBody) || selected),
  );

  function fill(row: MessageTemplate, generate: boolean): { subject: string; body: string } {
    const subject = generate && mergeValues ? applyMergeFields(row.subject, mergeValues) : row.subject;
    const raw = generate && mergeValues ? applyMergeFields(row.body, mergeValues) : row.body;
    return { subject, body: templateBodyForChannel(raw, channel) };
  }

  function insertSelected() {
    if (!selected) return;
    const next = fill(selected, applyOnInsert && Boolean(mergeValues));
    onApply({ ...next, generated: applyOnInsert && Boolean(mergeValues) });
  }

  function generateNow() {
    if (!mergeValues) return;
    if (selected) {
      const next = fill(selected, true);
      onApply({ ...next, generated: true });
      return;
    }
    onApply({
      subject: applyMergeFields(currentSubject, mergeValues),
      body: templateBodyForChannel(applyMergeFields(currentBody, mergeValues), channel),
      generated: true,
    });
  }

  if (loading && templates.length === 0) return null;

  return (
    <div className="msg-tpl-picker">
      <label className="msg-tpl-picker__select-wrap">
        <span className="msg-tpl-picker__label">Template</span>
        <select
          className="msg-tpl-picker__select"
          value={selectedId}
          disabled={disabled || templates.length === 0}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.isSystem ? `${t.name} (auto)` : t.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn secondary msg-tpl-picker__btn"
        disabled={disabled || !selected}
        onClick={insertSelected}
      >
        Use template
      </button>
      <button
        type="button"
        className="btn secondary msg-tpl-picker__btn"
        disabled={disabled || !canGenerate}
        title={
          mergeValues
            ? 'Replace {{patient_name}}, he/she, and other fields from this record'
            : 'Open a client or patient to fill parameters'
        }
        onClick={generateNow}
      >
        Generate with parameters
      </button>
      <label className="msg-tpl-picker__check">
        <input
          type="checkbox"
          checked={applyOnInsert}
          disabled={disabled || !mergeValues}
          onChange={(e) => setApplyOnInsert(e.target.checked)}
        />
        Fill names when inserting
      </label>
    </div>
  );
}
