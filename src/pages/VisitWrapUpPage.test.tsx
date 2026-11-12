/**
 * EMR-A4-2 (do-not-email client: recipients empty + warning, still sendable after typing an address),
 * F3 (Regenerate from charts must not crash on a malformed or failed AI recap response) and
 * F2 (the draft is saved through the recap-draft endpoint, not the SOAP PATCH).
 * `http` is mocked at the network edge so the real api/visitWrapUp.ts code runs. Invented names only.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import VisitWrapUpPage from './VisitWrapUpPage';

type Reply = { data?: unknown; error?: Error };
const state: {
  wrapUp: Record<string, unknown>;
  recap: Reply;
  calls: Array<{ method: string; url: string; body?: unknown }>;
} = { wrapUp: {}, recap: {}, calls: [] };

function route(method: string, url: string, body?: unknown): Reply {
  state.calls.push({ method, url, body });
  if (url.endsWith('/wrap-up')) return { data: state.wrapUp };
  if (url.endsWith('/scribe/client-recap')) return state.recap;
  if (url.endsWith('/reminders')) return { data: { pets: [] } };
  if (url.endsWith('/recap-draft')) return { data: {} };
  if (url === '/soap-encounters' && method === 'post') return { data: { id: 'enc-1', created: '2026-11-03T15:00:00Z' } };
  return { data: {} };
}
vi.mock('../api/http', () => {
  const call = (method: string) => async (url: string, a?: unknown, b?: unknown) => {
    const r = route(method, url, method === 'get' ? undefined : a);
    void b;
    if (r.error) throw r.error;
    return { data: r.data };
  };
  return {
    http: { get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), delete: call('delete') },
    apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Request failed'),
  };
});
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1, resolvePracticeIdFromToken: () => 1 }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ employeeId: '5', role: ['admin'] }) }));
vi.mock('../api/gmail', () => ({
  fetchGmailMailboxes: async () => ({ mailboxes: [] }),
  fetchGmailSendAs: async () => ({ aliases: [] }),
  fetchGmailSendAsAlias: async () => null,
  sendGmailMessage: vi.fn(),
}));
vi.mock('../api/tasks', () => ({ createTask: vi.fn() }));
vi.mock('../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('../api/declinedTreatments', () => ({ formatDeclinedDate: () => '' }));
vi.mock('../components/soap/WrapUpCallbacks', () => ({ default: () => null }));
vi.mock('../components/soap/WrapUpChronicReview', () => ({ default: () => null }));
vi.mock('../components/soap/ScribePromptOverridesModal', () => ({ default: () => null }));
vi.mock('../components/soap/SignOffGate', () => ({ default: () => null }));
vi.mock('../components/soap/SoapRichTextField', () => ({
  default: () => null,
  soapTextToEditorHtml: (t: string) => t,
}));

const pet = {
  patientId: 7,
  patientName: 'Juniper',
  soapEncounterId: 'enc-1',
  appointmentId: 11,
  status: 'completed',
  completedAt: '2026-11-03T16:00:00Z',
  completedByName: 'Dr Odile',
  subjectiveHistory: 'Itchy ears',
  objectiveVitals: null,
  objectiveNotes: null,
  assessmentReasoning: null,
  planNotes: null,
  forwardBookingDisposition: null,
  forwardBookingEntryId: null,
};
const baseWrapUp = {
  appointmentId: 11,
  clientId: 3,
  clientName: 'Wren Fairweather',
  clientEmails: ['wren@vayd.test'],
  provider: null,
  emailDraft: { subject: 'Saved subject', body: 'Saved body' },
  clientEmailDelivery: null,
  pets: [pet],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/soap/11/7/wrap-up']}>
      <Routes>
        <Route path="soap/:appointmentId/:patientId/wrap-up" element={<VisitWrapUpPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.wrapUp = { ...baseWrapUp };
  state.recap = { data: { subject: 'Hi', body: 'Hello' } };
  state.calls = [];
});

describe('EMR-A4-2 do-not-email client on the wrap-up', () => {
  it('leaves recipients empty and shows the warning', async () => {
    state.wrapUp = { ...baseWrapUp, clientDoNotEmail: true };
    renderPage();
    const to = await screen.findByPlaceholderText(/owner@example.com/);
    expect((to as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('wrapup-do-not-email-warning').textContent).toMatch(/Do not email/);
    // Send stays possible once staff type an address.
    fireEvent.change(to, { target: { value: 'wren.ok@vayd.test' } });
    expect((to as HTMLInputElement).value).toBe('wren.ok@vayd.test');
    expect((screen.getByRole('button', { name: /send to client/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('fills the client address and shows no warning for an ordinary client', async () => {
    renderPage();
    const to = (await screen.findByPlaceholderText(/owner@example.com/)) as HTMLInputElement;
    expect(to.value).toBe('wren@vayd.test');
    expect(screen.queryByTestId('wrapup-do-not-email-warning')).toBeNull();
  });
});

describe('F3 Regenerate from charts survives odd or failed AI responses', () => {
  async function regenerate() {
    renderPage();
    await screen.findByPlaceholderText(/owner@example.com/);
    fireEvent.click(screen.getByRole('button', { name: /regenerate from charts/i }));
  }

  it('realistic response: fills the draft and saves it through the recap-draft endpoint', async () => {
    state.recap = {
      data: {
        subject: 'Juniper visit recap',
        body: 'Thanks for visiting.',
        pets: [{ patientId: 7, summary: 'ears' }],
        usage: { inputTokens: 100 },
      },
    };
    await regenerate();
    await waitFor(() =>
      expect(state.calls.some((c) => c.url.endsWith('/recap-draft') && c.method === 'put')).toBe(true)
    );
    const save = state.calls.find((c) => c.url.endsWith('/recap-draft'))!;
    expect(save.body).toMatchObject({ subject: 'Juniper visit recap', body: 'Thanks for visiting.' });
    expect(state.calls.some((c) => c.method === 'patch')).toBe(false);
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it.each([
    ['an empty object', {}],
    ['only a pets list, empty', { pets: [] }],
    ['null', null],
    ['text where fields should be', { subject: 42, body: ['x'] }],
    ['a plain string', 'oops'],
  ])('%s: shows an error and keeps the page up', async (_label, data) => {
    state.recap = { data };
    await regenerate();
    expect(await screen.findByText(/recap writer returned nothing usable/i)).toBeTruthy();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
    expect(screen.getByRole('button', { name: /regenerate from charts/i })).toBeTruthy();
  });

  it('subject only (no body): page stays up, body stays editable', async () => {
    state.recap = { data: { subject: 'Just a subject' } };
    await regenerate();
    await waitFor(() => expect(screen.getByDisplayValue('Just a subject')).toBeTruthy());
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('a failed request shows the error and keeps the page up', async () => {
    state.recap = { error: new Error('Request failed with status code 502') };
    await regenerate();
    expect(await screen.findByText(/502/)).toBeTruthy();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });
});

describe('malformed wrap-up response', () => {
  it('missing lists do not crash the page', async () => {
    state.wrapUp = { appointmentId: 11, clientEmailDelivery: null };
    state.recap = { data: { subject: 'S', body: 'B' } };
    renderPage();
    await waitFor(() => expect(screen.queryByText(/something went wrong/i)).toBeNull());
    expect(await screen.findByPlaceholderText(/owner@example.com/)).toBeTruthy();
  });
});

describe('SCR-02 stale recap draft', () => {
  const BANNER = /Charts changed after this recap was written/;

  it('SCR-02-2: a stale draft shows the banner and is not rewritten until Regenerate is clicked', async () => {
    state.wrapUp = { ...baseWrapUp, emailDraftStale: true };
    renderPage();
    expect(await screen.findByText(BANNER)).toBeTruthy();
    const subject = screen.getByDisplayValue('Saved subject') as HTMLInputElement;
    expect(subject.value).toBe('Saved subject');
    await new Promise((r) => setTimeout(r, 1000)); // past the autosave delay
    expect(state.calls.some((c) => c.url.endsWith('/scribe/client-recap'))).toBe(false);
    expect(state.calls.some((c) => c.url.endsWith('/recap-draft') && (c.body as { fromCharts?: boolean }).fromCharts)).toBe(false);

    fireEvent.click(screen.getByTestId('recap-stale-regenerate'));
    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
    expect((screen.getByDisplayValue('Hi') as HTMLInputElement).value).toBe('Hi');
    const put = state.calls.find((c) => c.method === 'put' && c.url.endsWith('/recap-draft') && (c.body as { fromCharts?: boolean }).fromCharts);
    expect(put).toBeTruthy();
  });

  it('SCR-02-3: a fresh draft shows no banner', async () => {
    state.wrapUp = { ...baseWrapUp, emailDraftStale: false };
    renderPage();
    await screen.findByPlaceholderText(/owner@example.com/);
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});
