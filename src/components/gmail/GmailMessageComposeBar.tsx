import { Forward, Reply, ReplyAll } from 'lucide-react';
import type { ComposeContext } from './gmailCompose';
import type { GmailThreadMessage } from '../../api/gmail';

type Props = {
  threadId: string;
  replyTo: GmailThreadMessage | null;
  disabled?: boolean;
  onCompose: (context: ComposeContext) => void;
  /** Pill buttons below the thread, or icon buttons inline on a message header. */
  variant?: 'bar' | 'inline';
};

export default function GmailMessageComposeBar({
  threadId,
  replyTo,
  disabled,
  onCompose,
  variant = 'bar',
}: Props) {
  const blocked = disabled || !replyTo;

  const open = (mode: ComposeContext['mode']) => {
    onCompose({
      mode,
      threadId,
      replyTo: replyTo ?? undefined,
    });
  };

  if (variant === 'inline') {
    return (
      <div className="gmail-message-compose-bar gmail-message-compose-bar--inline">
        <button
          type="button"
          className="gmail-message-view__inline-action"
          aria-label="Reply"
          title="Reply"
          disabled={blocked}
          onClick={() => open('reply')}
        >
          <Reply size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="gmail-message-view__inline-action"
          aria-label="Reply all"
          title="Reply all"
          disabled={blocked}
          onClick={() => open('replyAll')}
        >
          <ReplyAll size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="gmail-message-view__inline-action"
          aria-label="Forward"
          title="Forward"
          disabled={blocked}
          onClick={() => open('forward')}
        >
          <Forward size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="gmail-message-compose-bar">
      <button
        type="button"
        className="gmail-message-view__footer-btn"
        disabled={blocked}
        onClick={() => open('reply')}
      >
        <Reply size={16} strokeWidth={1.75} aria-hidden />
        Reply
      </button>
      <button
        type="button"
        className="gmail-message-view__footer-btn"
        disabled={blocked}
        onClick={() => open('replyAll')}
      >
        <ReplyAll size={16} strokeWidth={1.75} aria-hidden />
        Reply all
      </button>
      <button
        type="button"
        className="gmail-message-view__footer-btn"
        disabled={blocked}
        onClick={() => open('forward')}
      >
        <Forward size={16} strokeWidth={1.75} aria-hidden />
        Forward
      </button>
    </div>
  );
}
