/**
 * SCR-A13. Invented names only.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import VisitWrapUpPage from './VisitWrapUpPage';
import { sendGmailMessage } from '../api/gmail';

type Reply = { data?: unknown; error?: Error };
const state: {
  wrapUp: Record<string, unknown>;
  recap: Reply;
  decision: Reply;
  calls: Array<{ method: string; url: string; body?: unknown }>;
} = { wrapUp: {}, recap: {}, decision: {}, calls: [] };

function route(method: string, url: string, body?: unknown): Reply {
  state.calls.push({ method, url, body });
  if (url.endsWith('/wrap-up')) return { data: state.wrapUp };
  if (url.endsWith('/scribe/client-recap')) return state.recap;
  if (url.endsWith('/reminders')) return { data: { pets: [] } };
  if (url.endsWith('/client-email') && method !== 'get') return state.decision;
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
  fetchGmailMailboxes: async () => ({ mailboxes: [{ email: 'field@vayd.test', connected: true }] }),
  fetchGmailSendAs: async () => ({ aliases: [] }),
  fetchGmailSendAsAlias: async () => null,
  sendGmailMessage: vi.fn(async () => ({ id: 'gm-1', threadId: 'th-1' })),
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
  state.decision = { error: new Error('Request failed') };
  vi.mocked(sendGmailMessage).mockClear();
});

// SCR-A13-1: Gmail sends, recording the decision fails; a second click must not email again.
describe('SCR-A13 recap sent but not recorded', () => {
  it('says so, locks Send, and sends only one email', async () => {
    renderPage();
    const send = (await screen.findByRole('button', { name: /send to client/i })) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    expect(await screen.findByText(/Sent, but not recorded/)).toBeTruthy();
    expect(screen.getByText(/don.t send again/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /send to client/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
  });
});
