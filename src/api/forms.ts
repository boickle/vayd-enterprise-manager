import { http } from './http';

const pid = () => Number(import.meta.env.VITE_PRACTICE_ID) || 1;

// ─── Field types ──────────────────────────────────────────────────────────────

export type FormFieldType =
  | 'heading'
  | 'paragraph'
  | 'checkbox'
  | 'text'
  | 'textarea'
  | 'signature';

export type FormField = {
  key: string;
  type: FormFieldType;
  label: string;
  checkboxLabel?: string;
  required?: boolean;
  hint?: string;
};

// ─── Templates ────────────────────────────────────────────────────────────────

export type FormTemplate = {
  id: number;
  name: string;
  description: string | null;
  fields: FormField[];
  isPublished: boolean;
  allowEditBeforeSend?: boolean;
  created: string;
  updated: string;
};

export async function listFormTemplates(): Promise<FormTemplate[]> {
  const { data } = await http.get<FormTemplate[]>('/forms/templates', {
    params: { practiceId: pid() },
  });
  return data;
}

export async function getFormTemplate(id: number): Promise<FormTemplate> {
  const { data } = await http.get<FormTemplate>(`/forms/templates/${id}`, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function createFormTemplate(body: {
  name: string;
  description?: string | null;
  fields: FormField[];
  isPublished?: boolean;
  allowEditBeforeSend?: boolean;
}): Promise<FormTemplate> {
  const { data } = await http.post<FormTemplate>('/forms/templates', {
    ...body,
    practiceId: pid(),
  });
  return data;
}

export async function updateFormTemplate(
  id: number,
  body: Partial<{
    name: string;
    description: string | null;
    fields: FormField[];
    isPublished: boolean;
    allowEditBeforeSend: boolean;
  }>,
): Promise<FormTemplate> {
  const { data } = await http.patch<FormTemplate>(`/forms/templates/${id}`, body, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function archiveFormTemplate(id: number): Promise<void> {
  await http.delete(`/forms/templates/${id}`, { params: { practiceId: pid() } });
}

// ─── Invites ──────────────────────────────────────────────────────────────────

export type FormInvite = {
  id: number;
  formTemplateId: number;
  formTemplate?: FormTemplate;
  clientId: number | null;
  patientId: number | null;
  token: string;
  sentToEmail: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  signedName: string | null;
  staffNote: string | null;
  communicationLogId?: number | null;
  chartDocumentId?: number | null;
  created: string;
};

export async function sendFormInvite(body: {
  formTemplateId: number;
  toEmail: string;
  clientId?: number | null;
  patientId?: number | null;
  staffNote?: string | null;
  fieldsSnapshot?: FormField[] | null;
}): Promise<FormInvite> {
  const { data } = await http.post<FormInvite>('/forms/invites', {
    ...body,
    practiceId: pid(),
  });
  return data;
}

export async function listFormInvites(params: {
  patientId?: number;
  clientId?: number;
}): Promise<FormInvite[]> {
  const { data } = await http.get<FormInvite[]>('/forms/invites', {
    params: { practiceId: pid(), ...params },
  });
  return data;
}

// ─── Public (no auth) ─────────────────────────────────────────────────────────

export type PublicFormPayload = {
  inviteId: number;
  formName: string;
  fields: FormField[];
  clientName: string | null;
  patientName: string | null;
  practiceName: string | null;
  alreadySubmitted: boolean;
  expired: boolean;
};

export async function getPublicForm(token: string): Promise<PublicFormPayload> {
  const { data } = await http.get<PublicFormPayload>(`/public/forms/${encodeURIComponent(token)}`);
  return data;
}

export async function submitPublicForm(
  token: string,
  body: {
    answers: Record<string, unknown>;
    signatureDataUrl: string;
    signedName: string;
  },
): Promise<{ ok: true }> {
  const { data } = await http.post<{ ok: true }>(
    `/public/forms/${encodeURIComponent(token)}/submit`,
    body,
  );
  return data;
}
