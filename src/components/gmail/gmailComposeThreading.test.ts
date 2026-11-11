import { describe, expect, it } from 'vitest';
import {
  composeDraftThreadingReady,
  loadComposeFromThreadDraft,
  resolveComposeThreading,
} from './gmailCompose';
import type { GmailThreadMessage } from '../../api/gmail';

function msg(
  partial: Partial<GmailThreadMessage> & Pick<GmailThreadMessage, 'id' | 'threadId'>,
): GmailThreadMessage {
  return {
    snippet: '',
    from: { email: 'a@b.com', name: null },
    to: [],
    subject: 'Appointment Request',
    date: new Date().toISOString(),
    isUnread: false,
    isStarred: false,
    labelIds: [],
    hasAttachments: false,
    headers: {
      from: 'a@b.com',
      to: 'info@vetatyourdoor.com',
      cc: '',
      subject: 'Appointment Request',
      messageId: '<parent@mail.gmail.com>',
      references: '',
      inReplyTo: '',
      replyTo: '',
    },
    body: { text: 'hi', html: null },
    ...partial,
    headers: {
      from: 'a@b.com',
      to: 'info@vetatyourdoor.com',
      cc: '',
      subject: 'Appointment Request',
      messageId: '<parent@mail.gmail.com>',
      references: '',
      inReplyTo: '',
      replyTo: '',
      ...(partial.headers ?? {}),
    },
  };
}

describe('gmail compose draft threading', () => {
  const parent = msg({
    id: 'msg-parent',
    threadId: 'thread-1622',
    labelIds: ['INBOX'],
  });

  const nativeDraft = msg({
    id: 'msg-draft',
    draftId: 'draft-r1',
    threadId: 'thread-1622',
    labelIds: ['DRAFT'],
    headers: {
      inReplyTo: '<parent@mail.gmail.com>',
      references: '<parent@mail.gmail.com>',
    },
  });

  it('loads threadId from an existing thread draft', () => {
    const loaded = loadComposeFromThreadDraft([parent, nativeDraft]);
    expect(loaded?.threadId).toBe('thread-1622');
    expect(loaded?.inReplyTo).toBe('<parent@mail.gmail.com>');
  });

  it('resolves threading from context before aliases load', () => {
    expect(
      resolveComposeThreading({ mode: 'reply', threadId: 'thread-1622', replyTo: parent }, []),
    ).toMatchObject({
      threadId: 'thread-1622',
      inReplyTo: '<parent@mail.gmail.com>',
    });
  });

  it('falls back to the native draft thread when context is incomplete', () => {
    expect(resolveComposeThreading({ mode: 'reply' }, [parent, nativeDraft]).threadId).toBe(
      'thread-1622',
    );
  });

  it('blocks reply autosave without threadId', () => {
    expect(composeDraftThreadingReady('reply', { inReplyTo: '<x>' })).toBe(false);
    expect(composeDraftThreadingReady('reply', { threadId: 'thread-1622' })).toBe(true);
    expect(composeDraftThreadingReady('new', {})).toBe(true);
  });
});
