import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import {
  getMessageLabelsForAppointmentList,
  labelChipStyle,
  labelDisplayName,
  modifyGmailMessage,
  type GmailLabelNode,
} from '../api/gmail';
import GmailLabelPicker, {
  type GmailLabelCheckState,
  type GmailLabelDraftState,
} from './gmail/GmailLabelPicker';
import type { SubmissionGmailThreadLabels } from '../hooks/useAppointmentRequestGmailThreadLabels';

type Props = {
  thread?: SubmissionGmailThreadLabels | null;
  userLabels: GmailLabelNode[];
  labelById: Map<string, GmailLabelNode>;
  loading?: boolean;
  disabled?: boolean;
  onLabelsUpdated: (entry: SubmissionGmailThreadLabels) => void;
  onLabelsAdded?: (addedLabelIds: string[]) => void;
  /** Return false to block removing a label (e.g. ON HOLD while a calendar hold exists). */
  beforeRemoveLabel?: (labelId: string) => Promise<boolean>;
  onError?: (message: string) => void;
};

/** Gmail-style label row for Scout appointment-request cards. */
export function AppointmentRequestGmailThreadLabels({
  thread,
  userLabels,
  labelById,
  loading,
  disabled,
  onLabelsUpdated,
  onLabelsAdded,
  beforeRemoveLabel,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);

  const applyLabelIds = useCallback(
    async (nextLabelIds: string[], addedLabelIds: string[] = []) => {
      if (!thread?.messageId || !thread.threadId) return;
      const labels = getMessageLabelsForAppointmentList(nextLabelIds, labelById);
      onLabelsUpdated({
        ...thread,
        labelIds: nextLabelIds,
        labels,
      });
      if (addedLabelIds.length > 0) {
        onLabelsAdded?.(addedLabelIds);
      }
    },
    [thread, labelById, onLabelsUpdated, onLabelsAdded],
  );

  const handleRemove = useCallback(
    async (labelId: string) => {
      if (!thread?.messageId || !thread.threadId || busy || disabled) return;
      if (beforeRemoveLabel) {
        const allow = await beforeRemoveLabel(labelId);
        if (!allow) return;
      }
      setBusy(true);
      try {
        const result = await modifyGmailMessage(
          thread.mailbox,
          thread.messageId,
          { removeLabelIds: [labelId] },
          thread.threadId,
        );
        await applyLabelIds(result.labelIds);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Could not remove Gmail label.');
      } finally {
        setBusy(false);
      }
    },
    [thread, busy, disabled, beforeRemoveLabel, applyLabelIds, onError],
  );

  const handleApplyPicker = useCallback(
    async (draft: Map<string, GmailLabelDraftState>) => {
      if (!thread?.messageId || !thread.threadId || busy || disabled) return;
      const addLabelIds: string[] = [];
      const removeLabelIds: string[] = [];
      for (const label of userLabels) {
        const draftState = draft.get(label.id);
        const has = thread.labelIds.includes(label.id);
        if (draftState === true && !has) addLabelIds.push(label.id);
        if (draftState === false && has) removeLabelIds.push(label.id);
      }
      if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;

      if (beforeRemoveLabel) {
        for (const labelId of removeLabelIds) {
          const allow = await beforeRemoveLabel(labelId);
          if (!allow) return;
        }
      }

      setBusy(true);
      try {
        const result = await modifyGmailMessage(
          thread.mailbox,
          thread.messageId,
          {
            ...(addLabelIds.length ? { addLabelIds } : {}),
            ...(removeLabelIds.length ? { removeLabelIds } : {}),
          },
          thread.threadId,
        );
        await applyLabelIds(result.labelIds, addLabelIds);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Could not update Gmail labels.');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [thread, userLabels, busy, disabled, beforeRemoveLabel, applyLabelIds, onError],
  );

  const labelState = useCallback(
    (labelId: string): GmailLabelCheckState =>
      thread?.labelIds.includes(labelId) ? 'all' : 'none',
    [thread?.labelIds],
  );

  const canEdit = Boolean(thread?.messageId && thread.threadId);
  const isDisabled = disabled || busy || !canEdit;

  if (loading) {
    return (
      <div className="appt-request-gmail-labels-row" aria-busy="true">
        <span className="appt-request-gmail-labels-heading">Gmail labels:</span>
        <span className="appt-request-gmail-labels-loading">Loading…</span>
      </div>
    );
  }

  if (!thread) return null;

  return (
    <div className="appt-request-gmail-labels-row" aria-label="Gmail labels">
      <span className="appt-request-gmail-labels-heading">Gmail labels:</span>
      <div className="appt-request-gmail-labels-chips">
        {thread.labels.map((label) => (
          <span
            key={label.id}
            className="appt-request-gmail-label appt-request-gmail-label--editable"
            style={labelChipStyle(label)}
          >
            <span className="appt-request-gmail-label-name" title={labelDisplayName(label)}>
              {labelDisplayName(label)}
            </span>
            <button
              type="button"
              className="appt-request-gmail-label-remove"
              aria-label={`Remove label ${labelDisplayName(label)}`}
              title={`Remove label ${labelDisplayName(label)}`}
              disabled={isDisabled}
              onClick={() => void handleRemove(label.id)}
            >
              <X size={12} strokeWidth={2.25} aria-hidden />
            </button>
          </span>
        ))}
        {userLabels.length > 0 ? (
          <GmailLabelPicker
            userLabels={userLabels}
            labelState={labelState}
            onApply={handleApplyPicker}
            disabled={isDisabled}
            applying={busy}
            trigger="add-chip"
          />
        ) : null}
      </div>
    </div>
  );
}
