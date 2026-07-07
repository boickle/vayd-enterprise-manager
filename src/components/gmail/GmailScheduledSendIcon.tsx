import { Clock, Send } from 'lucide-react';
import { formatScheduledSendTooltip } from '../../api/gmail';

type Props = {
  scheduledSendAt?: string | null;
  className?: string;
};

export default function GmailScheduledSendIcon({ scheduledSendAt, className }: Props) {
  const label = formatScheduledSendTooltip(scheduledSendAt);
  return (
    <span
      className={['gmail-scheduled-send-icon', className].filter(Boolean).join(' ')}
      title={label}
      aria-label={label}
    >
      <Send size={14} strokeWidth={1.75} aria-hidden />
      <Clock size={9} strokeWidth={2.25} className="gmail-scheduled-send-icon__clock" aria-hidden />
    </span>
  );
}
