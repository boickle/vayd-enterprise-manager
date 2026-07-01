import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Forward, Image as ImageIcon, Reply } from 'lucide-react';
import type { ComposeContext } from './gmailCompose';
import GmailBulkToolbar from './GmailBulkToolbar';
import GmailScheduledSendIcon from './GmailScheduledSendIcon';
import {
  formatGmailAddress,
  decodeGmailSnippet,
  getMessageUserLabels,
  hasScheduledSend,
  labelChipStyle,
  labelDisplayName,
  truncateAttachmentFilename,
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
  onCompose: (context: ComposeContext) => void;
  onOpenAttachment: (attachment: GmailAttachmentSummary) => void;
  latestThreadMessage: GmailThreadMessage | null;
};

function attachmentUsesImageIcon(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function senderInitial(from: GmailMessageSummary['from']): string {
  const name = from.name?.trim();
  if (name) return name.charAt(0).toUpperCase();
  return (from.email.charAt(0) || '?').toUpperCase();
}

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
  onCompose,
  onOpenAttachment,
  latestThreadMessage,
}: Props) {
  const userLabelsOnMessage = getMessageUserLabels(message.labelIds, labelById);

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
          onError={onToolbarError}
        />
        <div className="gmail-message-view__toolbar-spacer" />
        <button
          type="button"
          className="gmail-inbox__list-toolbar-btn"
          aria-label="Reply"
          title="Reply"
          disabled={actionBusy || threadLoading || !latestThreadMessage}
          onClick={() =>
            onCompose({
              mode: 'reply',
              threadId: message.threadId,
              replyTo: latestThreadMessage ?? undefined,
            })
          }
        >
          <Reply size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="gmail-inbox__list-toolbar-btn"
          aria-label="Forward"
          title="Forward"
          disabled={actionBusy || threadLoading || !latestThreadMessage}
          onClick={() =>
            onCompose({
              mode: 'forward',
              replyTo: latestThreadMessage ?? undefined,
            })
          }
        >
          <Forward size={18} strokeWidth={1.75} aria-hidden />
        </button>
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
          {userLabelsOnMessage.length > 0 ? (
            <div className="gmail-message-view__labels">
              {userLabelsOnMessage.map((label) => (
                <span
                  key={label.id}
                  className="gmail-msg-item__label"
                  style={labelChipStyle(label)}
                >
                  {labelDisplayName(label)}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {threadLoading ? (
          <div className="gmail-inbox__state">Loading message…</div>
        ) : threadMessages.length > 0 ? (
          <div className="gmail-message-view__thread">
            {threadMessages.map((msg) => (
              <article key={msg.id} className="gmail-thread-message">
                <div className="gmail-message-view__sender-row">
                  <span className="gmail-message-view__avatar" aria-hidden>
                    {senderInitial(msg.from)}
                  </span>
                  <div className="gmail-message-view__sender-meta">
                    <div className="gmail-message-view__sender-line">
                      <strong>{formatGmailAddress(msg.from)}</strong>
                      <span className="gmail-message-view__date">
                        {hasScheduledSend(msg) ? (
                          <GmailScheduledSendIcon scheduledSendAt={msg.scheduledSendAt} />
                        ) : null}
                        {new Date(msg.date).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                    {hasScheduledSend(msg) ? (
                      <div className="gmail-thread-message__scheduled">
                        Scheduled to send{' '}
                        {msg.scheduledSendAt
                          ? new Date(msg.scheduledSendAt).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : 'later'}
                      </div>
                    ) : null}
                    {msg.headers.to ? (
                      <div className="gmail-message-view__to">to {msg.headers.to}</div>
                    ) : null}
                  </div>
                </div>
                {msg.body.html ? (
                  <div
                    className="gmail-thread-message__body gmail-thread-message__body--html"
                    dangerouslySetInnerHTML={{ __html: msg.body.html }}
                  />
                ) : (
                  <div className="gmail-thread-message__body">
                    {decodeGmailSnippet(msg.body.text ?? msg.snippet)}
                  </div>
                )}
                {msg.attachments && msg.attachments.length > 0 ? (
                  <div className="gmail-thread-message__attachments">
                    <div className="gmail-thread-message__attachments-label">
                      {msg.attachments.length === 1
                        ? 'One attachment'
                        : `${msg.attachments.length} attachments`}
                    </div>
                    <div className="gmail-thread-message__attachments-list">
                      {msg.attachments.map((attachment) => {
                        const Icon = attachmentUsesImageIcon(attachment.mimeType)
                          ? ImageIcon
                          : FileText;
                        return (
                          <button
                            key={`${attachment.messageId}:${attachment.attachmentId}`}
                            type="button"
                            className="gmail-msg-item__attachment gmail-thread-message__attachment"
                            title={attachment.filename}
                            onClick={() => onOpenAttachment(attachment)}
                          >
                            <Icon size={14} strokeWidth={1.75} aria-hidden />
                            {truncateAttachmentFilename(attachment.filename, 24)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="gmail-detail__snippet">{decodeGmailSnippet(message.snippet)}</div>
        )}

        <div className="gmail-message-view__footer">
          <button
            type="button"
            className="gmail-message-view__footer-btn"
            disabled={actionBusy || threadLoading || !latestThreadMessage}
            onClick={() =>
              onCompose({
                mode: 'reply',
                threadId: message.threadId,
                replyTo: latestThreadMessage ?? undefined,
              })
            }
          >
            <Reply size={16} strokeWidth={1.75} aria-hidden />
            Reply
          </button>
          <button
            type="button"
            className="gmail-message-view__footer-btn"
            disabled={actionBusy || threadLoading || !latestThreadMessage}
            onClick={() =>
              onCompose({
                mode: 'forward',
                replyTo: latestThreadMessage ?? undefined,
              })
            }
          >
            <Forward size={16} strokeWidth={1.75} aria-hidden />
            Forward
          </button>
        </div>
      </div>
    </div>
  );
}
