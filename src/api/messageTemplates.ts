import { http } from './http';
import { hydrateMessageTemplateCache } from '../utils/messageTemplateCache';
import {
  localCreateMessageTemplate,
  localDeleteMessageTemplate,
  localListMessageTemplates,
  localPatchMessageTemplate,
  localResetMessageTemplate,
} from '../utils/messageTemplateLocalStore';
import type { MessageTemplate, MessageTemplateWrite } from '../utils/messageTemplateTypes';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

let preferLocal = false;

function remember(rows: MessageTemplate[]): MessageTemplate[] {
  hydrateMessageTemplateCache(rows);
  return rows;
}

async function tryApi<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  if (preferLocal) return fallback();
  try {
    return await fn();
  } catch {
    preferLocal = true;
    return fallback();
  }
}

export async function listMessageTemplates(
  practiceId = PRACTICE_ID,
): Promise<MessageTemplate[]> {
  return tryApi(
    async () => {
      const { data } = await http.get<MessageTemplate[]>('/message-templates', {
        params: { practiceId },
      });
      return remember(Array.isArray(data) ? data : []);
    },
    () => remember(localListMessageTemplates()),
  );
}

export async function createMessageTemplate(
  input: MessageTemplateWrite,
  practiceId = PRACTICE_ID,
): Promise<MessageTemplate> {
  const row = await tryApi(
    async () => {
      const { data } = await http.post<MessageTemplate>('/message-templates', {
        practiceId,
        ...input,
      });
      return data;
    },
    () => localCreateMessageTemplate(input),
  );
  await listMessageTemplates(practiceId);
  return row;
}

export async function patchMessageTemplate(
  id: string,
  input: Partial<MessageTemplateWrite>,
  practiceId = PRACTICE_ID,
): Promise<MessageTemplate> {
  const row = await tryApi(
    async () => {
      const { data } = await http.patch<MessageTemplate>(`/message-templates/${id}`, {
        practiceId,
        ...input,
      });
      return data;
    },
    () => localPatchMessageTemplate(id, input),
  );
  await listMessageTemplates(practiceId);
  return row;
}

export async function deleteMessageTemplate(
  id: string,
  practiceId = PRACTICE_ID,
): Promise<void> {
  await tryApi(
    async () => {
      await http.delete(`/message-templates/${id}`, { params: { practiceId } });
    },
    () => localDeleteMessageTemplate(id),
  );
  await listMessageTemplates(practiceId);
}

export async function resetMessageTemplate(
  id: string,
  practiceId = PRACTICE_ID,
): Promise<MessageTemplate> {
  const row = await tryApi(
    async () => {
      const { data } = await http.post<MessageTemplate>(
        `/message-templates/${id}/reset`,
        { practiceId },
      );
      return data;
    },
    () => localResetMessageTemplate(id),
  );
  await listMessageTemplates(practiceId);
  return row;
}
