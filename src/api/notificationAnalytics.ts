// src/api/notificationAnalytics.ts
import { http } from './http';

export const NOTIFICATION_ANALYTICS_TIMEZONE = 'America/New_York';

export type NotificationKind =
  | 'appointment'
  | 'reminder'
  | 'membership_promotion'
  | 'post_appointment_membership'
  | 'new_client_invite'
  | 'appoint_request';

export type NotificationStatus = 'pending' | 'processing' | 'sent' | 'failed';

export type NotificationChannel = 'email' | 'sms';

export type NotificationOutboxAnalyticsSummary = {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  processing: number;
  emailsSent: number;
  smsSent: number;
  emailsTrackable: number;
  emailsOpened: number;
  emailOpenRate: number | null;
};

export type NotificationOutboxByKindAndChannel = {
  kind: NotificationKind;
  channel: NotificationChannel;
  sent: number;
  failed: number;
  pending: number;
  processing: number;
  emailsOpened: number;
  emailOpenRate: number | null;
};

export type NotificationOutboxByStatus = {
  status: NotificationStatus;
  count: number;
};

export type NotificationOutboxDaily = {
  date: string;
  sent: number;
  emailsSent: number;
  smsSent: number;
  emailsOpened: number;
};

export type NotificationOutboxAnalyticsResponse = {
  timeZone: string;
  startDate: string | null;
  endDate: string | null;
  practiceId: number | null;
  summary: NotificationOutboxAnalyticsSummary;
  byKindAndChannel: NotificationOutboxByKindAndChannel[];
  byStatus: NotificationOutboxByStatus[];
  daily: NotificationOutboxDaily[];
};

export type NotificationOutboxRecord = {
  id: number;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  practiceId: number | null;
  clientId: number | null;
  patientId: number | null;
  appointmentId: number | null;
  reminderId: number | null;
  email: string | null;
  phone: string | null;
  dueInDays: number;
  scheduledAt: string;
  sentAt: string | null;
  emailOpenedAt: string | null;
  errorMessage: string | null;
  created: string;
};

export type NotificationOutboxRecordsResponse = {
  timeZone: string;
  startDate: string | null;
  endDate: string | null;
  practiceId: number | null;
  page: number;
  limit: number;
  total: number;
  records: NotificationOutboxRecord[];
};

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  appointment: 'Appointment reminder',
  reminder: 'Health reminder',
  membership_promotion: 'Pre-appointment membership promo',
  post_appointment_membership: 'Post-appointment follow-up',
  new_client_invite: 'New client portal invite',
  appoint_request: 'Appointment request',
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  sent: 'Sent',
  failed: 'Failed',
};

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  sms: 'SMS',
};

export function formatNotificationKindLabel(kind: string): string {
  const k = kind as NotificationKind;
  return NOTIFICATION_KIND_LABELS[k] ?? kind;
}

export function formatOpenRate(rate: number | null): string {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

export type FetchNotificationAnalyticsParams = {
  allTime?: boolean;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  practiceId?: string | number;
};

function buildDateQuery(params: FetchNotificationAnalyticsParams): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (!params.allTime && params.startDate && params.endDate) {
    query.startDate = params.startDate;
    query.endDate = params.endDate;
    query.timeZone = params.timeZone ?? NOTIFICATION_ANALYTICS_TIMEZONE;
  }
  if (params.practiceId != null && params.practiceId !== '') {
    query.practiceId = params.practiceId;
  }
  return query;
}

/**
 * GET /analytics/notifications
 */
export async function fetchNotificationAnalytics(
  params: FetchNotificationAnalyticsParams
): Promise<NotificationOutboxAnalyticsResponse> {
  const query = buildDateQuery(params);
  const { data } = await http.get<NotificationOutboxAnalyticsResponse>('/analytics/notifications', {
    params: Object.keys(query).length ? query : undefined,
  });
  return data;
}

export type FetchNotificationRecordsParams = FetchNotificationAnalyticsParams & {
  page?: number;
  limit?: number;
  kind?: NotificationKind;
  channel?: NotificationChannel;
  status?: NotificationStatus;
};

/**
 * GET /analytics/notifications/records
 */
export async function fetchNotificationRecords(
  params: FetchNotificationRecordsParams
): Promise<NotificationOutboxRecordsResponse> {
  const query = buildDateQuery(params);
  if (params.page != null) query.page = params.page;
  if (params.limit != null) query.limit = params.limit;
  if (params.kind) query.kind = params.kind;
  if (params.channel) query.channel = params.channel;
  if (params.status) query.status = params.status;

  const { data } = await http.get<NotificationOutboxRecordsResponse>(
    '/analytics/notifications/records',
    { params: query }
  );
  return data;
}
