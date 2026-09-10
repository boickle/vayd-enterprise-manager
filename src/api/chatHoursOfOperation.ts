import { http } from './http';
import { fetchPracticeInfo } from './clientPortal';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';
import {
  defaultChatHoursOfOperation,
  parseChatHoursOfOperation,
  serializeChatHoursOfOperation,
  type ChatHoursOfOperation,
} from '../utils/chatHours';

export const CHAT_HOURS_OF_OPERATION_KEY = 'chat.hoursOfOperation';

export {
  defaultChatHoursOfOperation,
  parseChatHoursOfOperation,
  type ChatHoursOfOperation,
};

export async function fetchChatHoursOfOperation(
  practiceId: number,
): Promise<ChatHoursOfOperation> {
  const settings = await getPracticeSettings(practiceId);
  return parseChatHoursOfOperation(
    settings[CHAT_HOURS_OF_OPERATION_KEY as keyof typeof settings],
  );
}

export async function saveChatHoursOfOperation(
  practiceId: number,
  hours: ChatHoursOfOperation,
): Promise<ChatHoursOfOperation> {
  const payload = {
    [CHAT_HOURS_OF_OPERATION_KEY]: serializeChatHoursOfOperation(hours),
  } as const;
  const updated = await updatePracticeSettings(practiceId, payload);
  return parseChatHoursOfOperation(
    updated[CHAT_HOURS_OF_OPERATION_KEY as keyof typeof updated],
  );
}

/** Public read for client-facing pages (no admin auth required). */
export async function fetchPublicChatHoursOfOperation(
  practiceId: number,
): Promise<ChatHoursOfOperation> {
  const { data } = await http.get('/public/practice/chat-hours', {
    params: { practiceId },
  });
  return parseChatHoursOfOperation(data);
}

/**
 * Resolve chat hours for client-facing pages.
 * Uses the API resolver endpoint first so legacy practice column values
 * cannot leak through practice/info before settings are synced.
 */
export async function fetchClientChatHoursOfOperation(
  practiceId?: number,
): Promise<ChatHoursOfOperation> {
  const pid = practiceId ?? (Number(import.meta.env.VITE_PRACTICE_ID) || 1);

  try {
    return await fetchPublicChatHoursOfOperation(pid);
  } catch {
    // fall through
  }

  try {
    const info = await fetchPracticeInfo();
    if (info?.chatHoursOfOperation) {
      return parseChatHoursOfOperation(info.chatHoursOfOperation);
    }
  } catch {
    // fall through
  }

  try {
    return await fetchChatHoursOfOperation(pid);
  } catch {
    // fall through
  }

  return defaultChatHoursOfOperation();
}
