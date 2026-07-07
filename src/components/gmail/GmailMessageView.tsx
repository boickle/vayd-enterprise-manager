import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ComposeContext, GmailComposeDraftSavedInfo } from './gmailCompose';
import GmailBulkToolbar, { type GmailLabelApplyUpdate } from './GmailBulkToolbar';
import GmailMessageComposeBar from './GmailMessageComposeBar';
import GmailComposePanel from './GmailComposePanel';
import {
  GmailThreadMessageArticle,
  partitionThreadForDisplay,
} from './GmailThreadMessage';
import {
  decodeGmailSnippet,
  getMessageRemovableHeaderLabels,
  labelChipStyle,
  labelDisplayName,
  threadLabelIds,
  type GmailAttachmentSummary,
  type GmailLabelNode,
  type GmailMessageSummary,
  type GmailThreadMessage,
} from '../../api/gmail';

type Props = {
  mailbox: string;
  message: GmailMessageSummary;
  threadMessages: GmailThreadMessage[];
  threadLoading: boolean;
  labelById: Map<string, GmailLabelNode>;
  userLabels: GmailLabelNode[];
  currentLabelId: string;
  listMessages: GmailMessageSummary[];
  messagePositionLabel: string;
  actionBusy: boolean;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onToolbarComplete: () => void;
  onToolbarError: (message: string) => void;
  onLabelsApplied: (updates: GmailLabelApplyUpdate[]) => void;
  onCompose: (context: ComposeContext) => void;
  onOpenAttachment: (attachment: GmailAttachmentSummary) => void;
  onRemoveLabel: (labelId: string) => Promise<void>;
  latestThreadMessage: GmailThreadMessage | null;
  /** Optional appointment-request action panel, rendered above the thread. */
  appointmentRequestSlot?: ReactNode;
  /** Optional pre-archive guard forwarded to the message toolbar. */
  guardArchive?: (targets: GmailMessageSummary[]) => string | null;
  composeOpen?: boolean;
  composeContext?: ComposeContext;
  onCloseCompose?: () => void;
  onComposeSent?: () => void;
  onComposeDraftSaved?: (info: GmailComposeDraftSavedInfo) => void;
  onComposeDraftDeleted?: (info: { threadId: string }) => void;
};

export default function GmailMessageView({
  mailbox,
  message,
  threadMessages,
  threadLoading,
  labelById,
  userLabels,
  currentLabelId,
  messagePositionLabel,
  actionBusy,
  onBack,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onToolbarComplete,
  onToolbarError,
  onLabelsApplied,
  onCompose,
  onOpenAttachment,
  onRemoveLabel,
  latestThreadMessage,
  appointmentRequestSlot,
  guardArchive,
  composeOpen,
  composeContext,
  onCloseCompose,
  onComposeSent,
  onComposeDraftSaved,
  onComposeDraftDeleted,
}: Props) {
  const removableLabels = getMessageRemovableHeaderLabels(message.labelIds, labelById);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());

  const threadPartition = useMemo(
    () =>
      partitionThreadForDisplay(
        threadMessages,
        Boolean(composeOpen),
        composeContext?.replyTo?.id,
      ),
    [threadMessages, composeOpen, composeContext?.replyTo?.id],
  );

  const defaultExpandedIds = useMemo(() => {
    if (threadPartition.mode !== 'stack') return [];
    return threadPartition.defaultExpandedIds;
  }, [threadPartition]);

  useEffect(() => {
    if (defaultExpandedIds.length > 0) {
      setExpandedMessageIds(new Set(defaultExpandedIds));
    } else {
      setExpandedMessageIds(new Set());
    }
  }, [defaultExpandedIds, message.threadId, composeOpen, composeContext?.replyTo?.id]);

  const toggleMessageExpanded = (messageId: string, pinExpanded: boolean) => {
    if (pinExpanded) return;
    setExpandedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const threadInInbox = useMemo(() => {
    if (threadMessages.length > 0) {
      return threadLabelIds(threadMessages).includes('INBOX');
    }
    return message.labelIds.includes('INBOX');
  }, [threadMessages, message.labelIds]);

  const handleCompose = useCallback(
    (ctx: ComposeContext) => {
      onCompose({
        ...ctx,
        threadInInbox: ctx.threadInInbox ?? threadInInbox,
      });
    },
    [onCompose, threadInInbox],
  );

  const sharedMessageProps = {
    threadId: message.threadId,
    actionBusy,
    threadLoading,
    onCompose: handleCompose,
    onOpenAttachment,
    showReplyActions: !composeOpen,
  };

  const renderThreadMessages = () => {
    if (threadPartition.mode === 'all') {
      return threadPartition.messages.map((msg) => (
        <GmailThreadMessageArticle key={msg.id} msg={msg} {...sharedMessageProps} />
      ));
    }

    return threadPartition.messages.map((msg) => {
      const pinExpanded = msg.isUnread;
      const isExpanded = pinExpanded || expandedMessageIds.has(msg.id);
      return (
        <GmailThreadMessageArticle
          key={msg.id}
          msg={msg}
          compact
          expanded={isExpanded}
          pinExpanded={pinExpanded}
          onToggleExpand={() => toggleMessageExpanded(msg.id, pinExpanded)}
          {...sharedMessageProps}
        />
      );
    });
  };

  return (
    <div className="gmail-message-view">
      <div className="gmail-message-view__toolbar">
        <button
          type="button"
          className="gmail-inbox__list-toolbar-btn"
          aria-label="Back to inbox"
          onClick={onBack}
        >
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <GmailBulkToolbar
          mailbox={mailbox}
          targetMessages={[message]}
          currentLabelId={currentLabelId}
          userLabels={userLabels}
          labelById={labelById}
          disabled={actionBusy}
          onComplete={onToolbarComplete}
          onLabelsApplied={onLabelsApplied}
          onError={onToolbarError}
          guardArchive={guardArchive}
        />
        <div className="gmail-message-view__toolbar-spacer" />
        <div className="gmail-inbox__pagination">
          <span className="gmail-inbox__pagination-range">{messagePositionLabel}</span>
          <button
            type="button"
            className="gmail-inbox__list-toolbar-btn"
            aria-label="Previous message"
            disabled={!canPrev || actionBusy}
            onClick={onPrev}
          >
            <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className="gmail-inbox__list-toolbar-btn"
            aria-label="Next message"
            disabled={!canNext || actionBusy}
            onClick={onNext}
          >
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      <div className="gmail-message-view__scroll">
        <div className="gmail-message-view__head">
          <h1 className="gmail-message-view__subject">{message.subject || '(no subject)'}</h1>
          {removableLabels.length > 0 ? (
            <div className="gmail-message-view__labels">
              {removableLabels.map((label) => (
                <span
                  key={label.id}
                  className="gmail-msg-item__label gmail-message-view__label"
                  style={labelChipStyle(label)}
                >
                  <span className="gmail-message-view__label-name" title={label.name}>
                    {labelDisplayName(label)}
                  </span>
                  <button
                    type="button"
                    className="gmail-message-view__label-remove"
                    aria-label={`Remove label ${labelDisplayName(label)}`}
                    title={`Remove label ${labelDisplayName(label)}`}
                    disabled={actionBusy}
                    onClick={() => void onRemoveLabel(label.id)}
                  >
                    <X size={12} strokeWidth={2.25} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {appointmentRequestSlot}

        {threadLoading ? (
          <div className="gmail-inbox__state">Loading message…</div>
        ) : threadMessages.length > 0 ? (
          <div className="gmail-message-view__thread">{renderThreadMessages()}</div>
        ) : (
          <div className="gmail-detail__snippet">{decodeGmailSnippet(message.snippet)}</div>
        )}

        {composeOpen && composeContext && onCloseCompose && onComposeSent ? (
          <GmailComposePanel
            mailbox={mailbox}
            context={composeContext}
            variant="inline"
            threadMessages={threadMessages}
            onClose={onCloseCompose}
            onSent={onComposeSent}
            onDraftSaved={onComposeDraftSaved}
            onDraftDeleted={onComposeDraftDeleted}
          />
        ) : latestThreadMessage ? (
          <GmailMessageComposeBar
            threadId={message.threadId}
            replyTo={latestThreadMessage}
            disabled={actionBusy || threadLoading}
            onCompose={handleCompose}
          />
        ) : null}
      </div>
    </div>
  );
}
