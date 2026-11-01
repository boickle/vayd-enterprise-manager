import { Chip } from '@mui/material';
import { EmailCampaignStatus, STATUS_LABELS } from '../../api/emailCampaigns';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const SPREAD_OPTIONS = [0, 5, 10, 15, 30, 60, 120];

/** Roughly how fast the server sends when nothing slows it down. */
const MAX_SENDS_PER_SECOND = 10;

export function spreadLabel(minutes: number): string {
  if (minutes <= 0) return 'As fast as possible';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** When sending should finish: the spread window, or longer if the audience can't be sent that fast. */
export function sendWindowEnd(start: Date, spreadMinutes: number, recipients: number): Date {
  const fastestMs = (recipients / MAX_SENDS_PER_SECOND) * 1000;
  return new Date(start.getTime() + Math.max(spreadMinutes * 60_000, fastestMs));
}

export function formatSendWindow(start: Date, end: Date): string {
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = start.toDateString() === end.toDateString();
  return `${formatDateTime(start.toISOString())} – ${sameDay ? time(end) : formatDateTime(end.toISOString())}`;
}

export function percent(part: number, whole: number, digits = 1): string {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

const STATUS_COLORS: Record<
  EmailCampaignStatus,
  'default' | 'info' | 'warning' | 'success' | 'error'
> = {
  draft: 'default',
  scheduled: 'info',
  sending: 'warning',
  sent: 'success',
  canceled: 'error',
};

export function StatusChip({ status }: { status: EmailCampaignStatus }) {
  return <Chip size="small" color={STATUS_COLORS[status]} label={STATUS_LABELS[status]} />;
}
