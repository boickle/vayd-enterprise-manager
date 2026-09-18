import type { MessageCategory, MessageChannel } from './messageTemplateFields';

export type MessageTemplate = {
  id: string;
  practiceId: number;
  name: string;
  description: string;
  channel: MessageChannel;
  category: MessageCategory;
  subject: string;
  body: string;
  systemKey: string | null;
  isSystem: boolean;
  isCustomized: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MessageTemplateWrite = {
  name: string;
  description?: string;
  channel: MessageChannel;
  category?: MessageCategory;
  subject?: string;
  body: string;
  isActive?: boolean;
};
