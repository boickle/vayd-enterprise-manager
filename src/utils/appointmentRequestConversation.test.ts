/** Appointments list conversation panel: emails + texts + calls in one thread (owner, Nov 11, 2026). */
import { describe, expect, it } from 'vitest';
import type { GmailThreadMessage } from '../api/gmail';
import {
  buildRequestConversation,
  conversationSummary,
  emailHtmlToText,
  stripQuotedEmailText,
} from './appointmentRequestConversation';

function email(
  o: Partial<GmailThreadMessage> & { id: string; fromEmail: string; date: string; text: string }
): GmailThreadMessage {
  return {
    id: o.id,
    threadId: 't1',
    snippet: o.text.slice(0, 40),
    from: { email: o.fromEmail, name: o.from?.name ?? null },
    to: [],
    subject: o.subject ?? 'Re: Appointment Request: Laura Hayden for Ruby',
    date: o.date,
    isUnread: false,
    isStarred: false,
    labelIds: o.labelIds ?? [],
    hasAttachments: false,
    headers: {
      from: '',
      to: '',
      cc: '',
      subject: '',
      messageId: '',
      references: '',
      inReplyTo: '',
    },
    body: { html: null, text: o.text },
  };
}

describe('stripQuotedEmailText', () => {
  it('keeps only the new part of a reply', () => {
    const text =
      'Tomorrow works!\n\nOn Tue, Nov 10, 2026 at 9:10 AM Lindsey <info@vetatyourdoor.com> wrote:\n> Hi Laura';
    expect(stripQuotedEmailText(text)).toBe('Tomorrow works!');
  });
  it('handles Gmail wrapping "wrote:" onto the next line and Outlook headers', () => {
    expect(
      stripQuotedEmailText(
        'Yes\nOn Tue, Nov 10, 2026 at 9:10 AM Lindsey\n<info@x.com> wrote:\n> hi'
      )
    ).toBe('Yes');
    expect(stripQuotedEmailText('Sounds good\nFrom: Lindsey\nSent: Tuesday')).toBe('Sounds good');
  });
});

describe('emailHtmlToText', () => {
  it('turns breaks into lines and drops tags', () => {
    expect(emailHtmlToText('<div>Hi&nbsp;Laura,<br>See you <b>Tue</b></div>')).toBe(
      'Hi Laura,\nSee you Tue'
    );
  });
});

describe('buildRequestConversation', () => {
  const base = {
    submittedAt: '2026-11-10T01:54:00Z',
    clientEmail: 'Laura@Example.com',
  };

  it('puts emails, texts and calls in time order after "Request received", without the internal notification', () => {
    const items = buildRequestConversation({
      ...base,
      emails: [
        email({
          id: 'n',
          fromEmail: 'forms@vetatyourdoor.com',
          subject: 'Appointment Request: Laura Hayden for Ruby',
          date: '2026-11-10T01:55:00Z',
          text: 'internal',
        }),
        email({
          id: 'o',
          fromEmail: 'info@vetatyourdoor.com',
          from: { email: 'info@vetatyourdoor.com', name: 'Lindsey' },
          date: '2026-11-10T14:10:00Z',
          text: 'Hi Laura',
        }),
        email({
          id: 'i',
          fromEmail: 'laura@example.com',
          date: '2026-11-10T14:30:00Z',
          text: 'Thanks!',
        }),
      ],
      texts: [
        {
          id: 's1',
          direction: 'in',
          body: 'Tomorrow works',
          at: '2026-11-10T14:24:00Z',
          beforeRequest: false,
        },
      ],
      calls: [
        {
          id: 1,
          at: '2026-11-10T13:00:00Z',
          outcome: 'voicemail',
          note: 'Left a message',
          employee: { firstName: 'Lindsey', lastName: 'Park' },
        },
      ],
    });
    expect(items.map((i) => `${i.channel}:${i.direction}`)).toEqual([
      'event:none',
      'call:out',
      'email:out',
      'text:in',
      'email:in',
    ]);
    expect(items[1]).toEqual(
      expect.objectContaining({ title: 'Left voicemail', author: 'Lindsey Park' })
    );
    expect(items[2].author).toBe('Lindsey');
  });

  it('skips drafts', () => {
    const items = buildRequestConversation({
      ...base,
      emails: [
        email({
          id: 'd',
          fromEmail: 'info@x.com',
          date: '2026-11-10T14:00:00Z',
          text: 'draft',
          labelIds: ['DRAFT'],
        }),
      ],
      texts: [],
      calls: [],
    });
    expect(items).toHaveLength(1);
  });
});

describe('conversationSummary', () => {
  it('says not contacted when nothing has happened since the request', () => {
    expect(
      conversationSummary([{ key: 'e', channel: 'event', direction: 'none', at: 'x', body: '' }])
        .label
    ).toBe('Not contacted yet');
  });
  it('ignores texts from before the request', () => {
    expect(
      conversationSummary([
        {
          key: 't',
          channel: 'text',
          direction: 'in',
          at: '2026-01-01',
          body: 'old',
          beforeRequest: true,
        },
      ]).tone
    ).toBe('none');
  });
  it('flags a client reply and an unanswered message', () => {
    expect(
      conversationSummary([
        { key: 't', channel: 'text', direction: 'in', at: '2026-11-10', body: 'hi' },
      ]).label
    ).toBe('Owner texted back');
    expect(
      conversationSummary([
        { key: 'e', channel: 'email', direction: 'out', at: '2026-11-10', body: 'hi' },
      ]).tone
    ).toBe('waiting');
  });
});

describe('quoCallTitle', () => {
  it('describes answered, missed and unanswered calls', async () => {
    const { quoCallTitle } = await import('./appointmentRequestConversation');
    expect(quoCallTitle({ direction: 'in', status: 'completed', durationSeconds: 240 })).toBe(
      'Incoming call · 4 min'
    );
    expect(quoCallTitle({ direction: 'out', status: 'completed', durationSeconds: 30 })).toBe(
      'Outgoing call · 30 sec'
    );
    expect(quoCallTitle({ direction: 'in', status: 'missed', durationSeconds: 0 })).toBe(
      'Missed call'
    );
    expect(quoCallTitle({ direction: 'out', status: 'no-answer', durationSeconds: 0 })).toBe(
      'No answer'
    );
  });
});
