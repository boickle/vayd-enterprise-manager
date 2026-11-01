import { http } from './http';

export type EmailCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'canceled';
export type EmailCampaignGoalType =
  | 'none'
  | 'appointment_booked'
  | 'membership_enrolled'
  | 'link_click';
export type EmailCampaignSkipReason =
  | 'no_living_pets'
  | 'recent_pet_loss'
  | 'end_of_life_appointment'
  | 'no_email'
  | 'do_not_market'
  | 'unsubscribed_or_bounced'
  | 'email_opted_out'
  | 'recently_emailed'
  | 'duplicate_email'
  | 'campaign_canceled';

export type EmailCampaignAudience = {
  mode: 'segment' | 'specific';
  membership: 'any' | 'members' | 'non_members';
  species: string[];
  lastVisit: { mode: 'any' | 'within' | 'not_within'; months: number };
  upcomingAppointment: 'any' | 'has' | 'none';
  primaryProviderIds: number[];
  zoneIds: number[];
  clientStatusIds: number[];
  clientIds: number[];
  excludeClientIds: number[];
  excludeEmailedWithinDays: number | null;
};

export type EmailCampaignGoal = {
  type: EmailCampaignGoalType;
  windowDays: number;
  appointmentTypeIds: number[];
};

export type EmailCampaignProtections = { petLossWindowDays: number };

export type EmailCampaign = {
  id: string;
  name: string;
  status: EmailCampaignStatus;
  subject: string;
  preheader: string | null;
  fromName: string | null;
  replyTo: string | null;
  editorMode: 'design' | 'html';
  design: unknown;
  html: string;
  audience: EmailCampaignAudience;
  goal: EmailCampaignGoal;
  protections: EmailCampaignProtections;
  /** Sending is spread evenly over this many minutes; 0 sends as fast as possible. */
  spreadMinutes: number;
  scheduledAt: string | null;
  sendStartedAt: string | null;
  sentAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
  lastError: string | null;
  created: string;
  updated: string;
};

export type CampaignHeadline = {
  recipients: number;
  sent: number;
  skipped: number;
  failed: number;
  pending: number;
  opened: number;
  clicked: number;
};

export type EmailCampaignListItem = Pick<
  EmailCampaign,
  | 'id'
  | 'name'
  | 'subject'
  | 'status'
  | 'goal'
  | 'scheduledAt'
  | 'sendStartedAt'
  | 'sentAt'
  | 'canceledAt'
  | 'archivedAt'
  | 'lastError'
  | 'created'
  | 'updated'
> & { stats: CampaignHeadline | null; conversions: number | null };

export type CampaignWrite = Partial<
  Pick<
    EmailCampaign,
    | 'name'
    | 'subject'
    | 'preheader'
    | 'fromName'
    | 'replyTo'
    | 'editorMode'
    | 'design'
    | 'html'
    | 'audience'
    | 'goal'
    | 'protections'
    | 'spreadMinutes'
  >
>;

export type CampaignOptions = {
  providers: Array<{ id: number; name: string }>;
  zones: Array<{ id: number; name: string }>;
  clientStatuses: Array<{ id: number; name: string }>;
  appointmentTypes: Array<{ id: number; name: string }>;
  species: Array<{ value: string; label: string; pets: number }>;
  sendingEnabled: boolean;
  isProduction: boolean;
};

export type CampaignClient = { id: number; name: string; email: string | null; petNames: string[] };

export type AudienceSummary = {
  total: number;
  eligible: number;
  excluded: Partial<Record<EmailCampaignSkipReason, number>>;
  sample: Array<{
    clientId: number;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    petNames: string[];
  }>;
};

export type CampaignAsset = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  created: string;
  url: string;
};

export type CampaignReport = {
  campaign: {
    id: string;
    name: string;
    subject: string;
    status: EmailCampaignStatus;
    sendStartedAt: string | null;
    sentAt: string | null;
    goal: EmailCampaignGoal;
  };
  delivery: CampaignHeadline & {
    skippedByReason: Array<{ reason: EmailCampaignSkipReason | 'unknown'; count: number }>;
  };
  engagement: {
    opened: number;
    openRate: number;
    clicked: number;
    clickRate: number;
    clickToOpenRate: number;
    unsubscribed: number;
    bounced: number;
    complained: number;
  };
  links: Array<{ index: number; url: string; clicks: number; uniqueClicks: number }>;
  timeline: Array<{ day: number; opens: number; clicks: number }>;
  conversions: {
    tracked: boolean;
    converted: number;
    conversionRate: number;
    fromOpeners: number;
    fromNonOpeners: number;
    rows: Array<{
      clientId: number;
      name: string;
      email: string | null;
      convertedAt: string;
      detail: string;
      opened: boolean;
      clicked: boolean;
    }>;
  };
};

export type CampaignRecipient = {
  id: number;
  clientId: number;
  name: string;
  email: string | null;
  status: 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';
  skipReason: EmailCampaignSkipReason | null;
  errorMessage: string | null;
  sentAt: string | null;
  firstOpenedAt: string | null;
  openCount: number;
  firstClickedAt: string | null;
  clickCount: number;
};

const BASE = '/email-campaigns';

export async function listEmailCampaigns(
  includeArchived = false
): Promise<EmailCampaignListItem[]> {
  const { data } = await http.get(BASE, { params: { includeArchived } });
  if (!Array.isArray(data)) {
    throw new Error(
      'The API did not return a campaign list. Make sure it is running a version with email campaigns.'
    );
  }
  return data;
}

export async function getEmailCampaign(id: string): Promise<EmailCampaign> {
  const { data } = await http.get(`${BASE}/${id}`);
  return data;
}

export async function createEmailCampaign(body: CampaignWrite = {}): Promise<EmailCampaign> {
  const { data } = await http.post(BASE, body);
  return data;
}

export async function updateEmailCampaign(id: string, body: CampaignWrite): Promise<EmailCampaign> {
  const { data } = await http.put(`${BASE}/${id}`, body);
  return data;
}

export async function deleteEmailCampaign(id: string): Promise<void> {
  await http.delete(`${BASE}/${id}`);
}

export async function duplicateEmailCampaign(id: string): Promise<EmailCampaign> {
  const { data } = await http.post(`${BASE}/${id}/duplicate`);
  return data;
}

export async function archiveEmailCampaign(id: string, archived: boolean): Promise<EmailCampaign> {
  const { data } = await http.post(`${BASE}/${id}/archive`, { archived });
  return data;
}

export async function sendEmailCampaignTest(
  id: string,
  to: string[]
): Promise<{ sentTo: string[]; sampleClientId: number | null }> {
  const { data } = await http.post(`${BASE}/${id}/test`, { to });
  return data;
}

/** `sendAt` null sends as soon as the next minute's run picks it up. */
export async function scheduleEmailCampaign(
  id: string,
  sendAt: string | null
): Promise<EmailCampaign> {
  const { data } = await http.post(`${BASE}/${id}/schedule`, { sendAt });
  return data;
}

export async function cancelEmailCampaign(id: string): Promise<EmailCampaign> {
  const { data } = await http.post(`${BASE}/${id}/cancel`);
  return data;
}

export async function getEmailCampaignOptions(): Promise<CampaignOptions> {
  const { data } = await http.get(`${BASE}/options`);
  return data;
}

export async function previewEmailCampaignAudience(body: {
  audience: EmailCampaignAudience;
  protections: EmailCampaignProtections;
  campaignId?: string | null;
}): Promise<AudienceSummary> {
  const { data } = await http.post(`${BASE}/audience/preview`, body);
  return data;
}

export async function searchEmailCampaignClients(q: string): Promise<CampaignClient[]> {
  const { data } = await http.get(`${BASE}/clients/search`, { params: { q } });
  return data;
}

export async function getEmailCampaignClientsByIds(ids: number[]): Promise<CampaignClient[]> {
  if (!ids.length) return [];
  const { data } = await http.post(`${BASE}/clients/by-ids`, { ids });
  return data;
}

export async function listEmailCampaignAssets(): Promise<CampaignAsset[]> {
  const { data } = await http.get(`${BASE}/assets`);
  return data;
}

export async function uploadEmailCampaignAsset(file: File): Promise<CampaignAsset> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post(`${BASE}/assets`, form);
  return data;
}

export async function getEmailCampaignReport(id: string): Promise<CampaignReport> {
  const { data } = await http.get(`${BASE}/${id}/report`);
  return data;
}

export async function getEmailCampaignRecipients(
  id: string,
  params: { status?: string; page?: number; pageSize?: number }
): Promise<{ total: number; rows: CampaignRecipient[] }> {
  const { data } = await http.get(`${BASE}/${id}/recipients`, { params });
  return data;
}

export const SKIP_REASON_LABELS: Record<EmailCampaignSkipReason | 'unknown', string> = {
  no_living_pets: 'No living pets',
  recent_pet_loss: 'Recent pet loss',
  end_of_life_appointment: 'End-of-life visit',
  no_email: 'No email address',
  do_not_market: 'Do not market',
  unsubscribed_or_bounced: 'Unsubscribed or bounced',
  email_opted_out: 'Opted out of email',
  recently_emailed: 'Emailed recently',
  duplicate_email: 'Shares an email with another client',
  campaign_canceled: 'Campaign canceled before sending',
  unknown: 'Other',
};

export const PET_LOSS_REASONS: EmailCampaignSkipReason[] = [
  'no_living_pets',
  'recent_pet_loss',
  'end_of_life_appointment',
];

export const GOAL_LABELS: Record<EmailCampaignGoalType, string> = {
  none: 'No goal (opens and clicks only)',
  appointment_booked: 'Book an appointment',
  membership_enrolled: 'Join a membership',
  link_click: 'Click a link',
};

export const STATUS_LABELS: Record<EmailCampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  canceled: 'Canceled',
};

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return msg || e?.message || fallback;
}
