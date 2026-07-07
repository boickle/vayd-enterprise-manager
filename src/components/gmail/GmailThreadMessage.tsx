import GmailAttachmentIcon from './GmailAttachmentIcon';
import GmailMessageComposeBar from './GmailMessageComposeBar';
import GmailScheduledSendIcon from './GmailScheduledSendIcon';
import type { ComposeContext } from './gmailCompose';
import {
  decodeGmailSnippet,
  formatGmailAddress,
  hasScheduledSend,
  truncateAttachmentFilename,
  type GmailAttachmentSummary,
  type GmailThreadMessage,
} from '../../api/gmail';

function senderInitial(from: GmailThreadMessage['from']): string {
  const name = from.name?.trim();
  if (name) return name.charAt(0).toUpperCase();
  return (from.email.charAt(0) || '?').toUpperCase();
}

function collapsedSenderLabel(from: GmailThreadMessage['from']): string {
  const name = from.name?.trim();
  if (name) return name;
  return from.email;
}

function collapsedMessageDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

type ThreadMessageProps = {
  msg: GmailThreadMessage;
  threadId: string;
  compact?: boolean;
  expanded?: boolean;
  /** When true, message cannot be collapsed (e.g. unread). */
  pinExpanded?: boolean;
  onToggleExpand?: () => void;
  showReplyActions?: boolean;
  actionBusy: boolean;
  threadLoading: boolean;
  onCompose: (context: ComposeContext) => void;
  onOpenAttachment: (attachment: GmailAttachmentSummary) => void;
};

export function GmailThreadMessageArticle({
  msg,
  threadId,
  compact = false,
  expanded = true,
  pinExpanded = false,
  onToggleExpand,
  showReplyActions = true,
  actionBusy,
  threadLoading,
  onCompose,
  onOpenAttachment,
}: ThreadMessageProps) {
  const isExpanded = pinExpanded || expanded;
  const showBody = !compact || isExpanded;
  const collapsed = compact && !isExpanded;
  const headerToggleable = compact && Boolean(onToggleExpand) && !pinExpanded;

  return (
    <article
      className={[
        'gmail-thread-message',
        collapsed ? 'gmail-thread-message--collapsed-row' : '',
        headerToggleable && isExpanded ? 'gmail-thread-message--was-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {collapsed ? (
        <button
          type="button"
          className="gmail-thread-message__collapsed-row"
          onClick={onToggleExpand}
        >
          <span className="gmail-message-view__avatar" aria-hidden>
            {senderInitial(msg.from)}
          </span>
          <span className="gmail-thread-message__collapsed-main">
            <span className="gmail-thread-message__collapsed-from">
              {collapsedSenderLabel(msg.from)}
            </span>
            <span className="gmail-thread-message__collapsed-snippet">
              {decodeGmailSnippet(msg.snippet)}
            </span>
          </span>
          <span className="gmail-thread-message__collapsed-date">
            {collapsedMessageDate(msg.date)}
          </span>
        </button>
      ) : (
        <>
          <div
            className={[
              'gmail-message-view__sender-row',
              headerToggleable ? 'gmail-message-view__sender-row--toggle' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role={headerToggleable ? 'button' : undefined}
            tabIndex={headerToggleable ? 0 : undefined}
            aria-expanded={headerToggleable ? true : undefined}
            onClick={headerToggleable ? onToggleExpand : undefined}
            onKeyDown={
              headerToggleable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleExpand?.();
                    }
                  }
                : undefined
            }
          >
            <span className="gmail-message-view__avatar" aria-hidden>
              {senderInitial(msg.from)}
            </span>
            <div className="gmail-message-view__sender-meta">
              <div className="gmail-message-view__sender-line">
                <strong>{formatGmailAddress(msg.from)}</strong>
                <div
                  className="gmail-message-view__sender-actions"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <span className="gmail-message-view__date">
                    {hasScheduledSend(msg) ? (
                      <GmailScheduledSendIcon scheduledSendAt={msg.scheduledSendAt} />
                    ) : null}
                    {new Date(msg.date).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  {showReplyActions ? (
                    <GmailMessageComposeBar
                      variant="inline"
                      threadId={threadId}
                      replyTo={msg}
                      disabled={actionBusy || threadLoading}
                      onCompose={onCompose}
                    />
                  ) : null}
                </div>
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

          {showBody ? (
            <>
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
                    {msg.attachments.map((attachment) => (
                      <button
                        key={`${attachment.messageId}:${attachment.attachmentId}`}
                        type="button"
                        className="gmail-msg-item__attachment gmail-thread-message__attachment"
                        title={attachment.filename}
                        onClick={() => onOpenAttachment(attachment)}
                      >
                        <GmailAttachmentIcon
                          mimeType={attachment.mimeType}
                          filename={attachment.filename}
                        />
                        {truncateAttachmentFilename(attachment.filename, 24)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </article>
  );
}

export type ThreadDisplayPartition =
  | { mode: 'all'; messages: GmailThreadMessage[] }
  | {
      mode: 'stack';
      messages: GmailThreadMessage[];
      /** Messages expanded by default (unread, latest, reply target while composing). */
      defaultExpandedIds: string[];
    };

/** Gmail-style stack: older messages collapsed in place; unread + latest stay expanded. */
export function partitionThreadForDisplay(
  threadMessages: GmailThreadMessage[],
  composeOpen = false,
  replyToId?: string,
): ThreadDisplayPartition {
  const visible = threadMessages.filter((m) => !m.labelIds.includes('DRAFT'));
  if (visible.length <= 1) {
    return { mode: 'all', messages: visible };
  }

  const defaultExpandedIds = new Set<string>();
  defaultExpandedIds.add(visible[visible.length - 1]!.id);
  if (composeOpen && replyToId) {
    const replyTo = visible.find((m) => m.id === replyToId);
    if (replyTo) defaultExpandedIds.add(replyTo.id);
  }
  for (const msg of visible) {
    if (msg.isUnread) defaultExpandedIds.add(msg.id);
  }

  return { mode: 'stack', messages: visible, defaultExpandedIds: [...defaultExpandedIds] };
}

/** @deprecated Use partitionThreadForDisplay */
export type ThreadComposePartition = ThreadDisplayPartition;

/** @deprecated Use partitionThreadForDisplay */
export function partitionThreadForCompose(
  threadMessages: GmailThreadMessage[],
  composeOpen: boolean,
  replyToId?: string,
): ThreadDisplayPartition {
  return partitionThreadForDisplay(threadMessages, composeOpen, replyToId);
}
