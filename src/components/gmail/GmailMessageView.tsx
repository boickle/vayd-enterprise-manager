import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  pickDefaultReplyMessage,
  type ComposeContext,
  type GmailComposeDraftSavedInfo,
} from './gmailCompose';
import GmailBulkToolbar, { type GmailLabelApplyUpdate } from './GmailBulkToolbar';
import GmailLabelPicker, {
  type GmailLabelCheckState,
  type GmailLabelDraftState,
} from './GmailLabelPicker';
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
  modifyGmailMessage,
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
  userLabelTree?: GmailLabelNode[];
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
  contactsEnabled?: boolean;
};

export default function GmailMessageView({
  mailbox,
  message,
  threadMessages,
  threadLoading,
  labelById,
  userLabels,
  userLabelTree,
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
  contactsEnabled = true,
}: Props) {
  const removableLabels = getMessageRemovableHeaderLabels(message.labelIds, labelById);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [labelApplying, setLabelApplying] = useState(false);

  const labelState = useCallback(
    (labelId: string): GmailLabelCheckState =>
      message.labelIds.includes(labelId) ? 'all' : 'none',
    [message.labelIds],
  );

  const handleApplyLabels = async (draft: Map<string, GmailLabelDraftState>) => {
    setLabelApplying(true);
    try {
      const addLabelIds: string[] = [];
      const removeLabelIds: string[] = [];
      for (const label of userLabels) {
        const draftState = draft.get(label.id);
        const has = message.labelIds.includes(label.id);
        if (draftState === true && !has) addLabelIds.push(label.id);
        if (draftState === false && has) removeLabelIds.push(label.id);
      }
      if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;
      const result = await modifyGmailMessage(
        mailbox,
        message.id,
        { addLabelIds, removeLabelIds },
        message.threadId,
      );
      onLabelsApplied([
        {
          messageId: result.id,
          threadId: message.threadId,
          labelIds: result.labelIds,
        },
      ]);
    } catch (e) {
      onToolbarError(e instanceof Error ? e.message : 'Failed to update labels.');
      throw e;
    } finally {
      setLabelApplying(false);
    }
  };

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

  /** Prefer latest client message so top/bottom Reply doesn't target an internal staff hop. */
  const defaultReplyMessage = useMemo(
    () => pickDefaultReplyMessage(threadMessages, mailbox) ?? latestThreadMessage,
    [threadMessages, mailbox, latestThreadMessage],
  );

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
        <div className="gmail-message-view__toolbar-start">
          <button
            type="button"
            className="gmail-message-view__back-btn"
            aria-label="Back to inbox"
            onClick={onBack}
          >
            <ArrowLeft size={22} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="gmail-message-view__toolbar-actions gmail-message-view__toolbar-actions--desktop">
          <GmailBulkToolbar
            mailbox={mailbox}
            targetMessages={[message]}
            currentLabelId={currentLabelId}
            userLabels={userLabels}
            userLabelTree={userLabelTree}
            labelById={labelById}
            disabled={actionBusy || labelApplying}
            onComplete={onToolbarComplete}
            onLabelsApplied={onLabelsApplied}
            onError={onToolbarError}
            guardArchive={guardArchive}
            variant="bulk"
          />
        </div>
        <div className="gmail-message-view__toolbar-actions gmail-message-view__toolbar-actions--mobile">
          <GmailBulkToolbar
            mailbox={mailbox}
            targetMessages={[message]}
            currentLabelId={currentLabelId}
            userLabels={userLabels}
            userLabelTree={userLabelTree}
            labelById={labelById}
            disabled={actionBusy || labelApplying}
            onComplete={onToolbarComplete}
            onLabelsApplied={onLabelsApplied}
            onError={onToolbarError}
            guardArchive={guardArchive}
            variant="message"
          />
        </div>
        <div className="gmail-message-view__toolbar-nav">
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
          <div className="gmail-message-view__subject-row">
            <div className="gmail-message-view__subject-block">
              <h1 className="gmail-message-view__subject">{message.subject || '(no subject)'}</h1>
              {removableLabels.length > 0 || userLabels.length > 0 ? (
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
                        disabled={actionBusy || labelApplying}
                        onClick={() => void onRemoveLabel(label.id)}
                      >
                        <X size={12} strokeWidth={2.25} aria-hidden />
                      </button>
                    </span>
                  ))}
                  {userLabels.length > 0 ? (
                    <GmailLabelPicker
                      userLabels={userLabels}
                      labelState={labelState}
                      onApply={handleApplyLabels}
                      disabled={actionBusy || labelApplying}
                      applying={labelApplying}
                      trigger="add-chip"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            {!composeOpen && defaultReplyMessage ? (
              <div className="gmail-message-view__subject-actions">
                <GmailMessageComposeBar
                  threadId={message.threadId}
                  replyTo={defaultReplyMessage}
                  disabled={actionBusy || threadLoading}
                  onCompose={handleCompose}
                  variant="inline"
                />
              </div>
            ) : null}
          </div>
        </div>

        {appointmentRequestSlot}

        {threadLoading ? (
          <div className="gmail-inbox__state">Loading message?</div>
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
            contactsEnabled={contactsEnabled}
            onClose={onCloseCompose}
            onSent={onComposeSent}
            onDraftSaved={onComposeDraftSaved}
            onDraftDeleted={onComposeDraftDeleted}
          />
        ) : null}
      </div>

      {!composeOpen && defaultReplyMessage ? (
        <div className="gmail-message-view__bottom-bar">
          <GmailMessageComposeBar
            threadId={message.threadId}
            replyTo={defaultReplyMessage}
            disabled={actionBusy || threadLoading}
            onCompose={handleCompose}
          />
        </div>
      ) : null}
    </div>
  );
}
