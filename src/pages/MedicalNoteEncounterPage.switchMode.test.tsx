/**
 * EMR-MODE (owner decision Nov 4, 2026): an unsigned medical note offers "Switch to SOAP". The
 * note text is saved first and the SOAP page opens after the switch. Hidden once the note is
 * wrapped up (finalized) or the encounter is signed. Invented names only.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CREATED = '2026-11-04T15:00:00.000Z';
const state = {
  encounter: { id: 'enc-1', mode: 'medical_note', status: 'draft', clientId: 3, created: CREATED } as Record<string, unknown>,
  drafts: [] as Array<Record<string, unknown>>,
  finalized: [] as Array<Record<string, unknown>>,
};
const switchEncounterMode = vi.fn();
const updateScoutChartNote = vi.fn(async () => ({}));
const createScoutChartNote = vi.fn(async () => ({ id: 'note-new', body: '' }));

vi.mock('../api/visitWorkflow', () => ({
  VISIT_WORKFLOW_PRACTICE_ID: 1,
  createEncounter: async () => state.encounter,
  getHouseholdRoster: async () => [],
  getInvoiceByAppointment: async () => null,
  listOrders: async () => [],
  switchEncounterMode: (...a: unknown[]) => switchEncounterMode(...a),
}));
vi.mock('../api/scoutChart', () => ({
  listScoutChartNotes: async (_p: number, status: string) =>
    status === 'finalized' ? state.finalized : state.drafts,
  createScoutChartNote: (...a: unknown[]) => createScoutChartNote(...(a as [])),
  updateScoutChartNote: (...a: unknown[]) => updateScoutChartNote(...(a as [])),
  finalizeScoutChartNote: vi.fn(),
}));
vi.mock('../api/soapScribe', () => ({ listScribeSessions: async () => [], writeVisitWriteup: vi.fn() }));
vi.mock('../api/appointments', () => ({ fetchAppointmentById: async () => null }));
vi.mock('../api/appointmentSettings', () => ({ fetchEmployee: async () => ({}) }));
vi.mock('../api/patients', () => ({ fetchPatientProfileForRow: async () => ({ name: 'Juniper' }) }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ employeeId: null }) }));
vi.mock('../hooks/useBriefRecorder', () => ({
  useBriefRecorder: () => ({
    recording: false,
    transcript: '',
    interim: '',
    elapsed: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    setTranscript: vi.fn(),
    restoreTranscript: vi.fn(),
  }),
}));
vi.mock('../utils/roomLoaderSubjectiveText', async (orig) => ({
  ...(await orig<typeof import('../utils/roomLoaderSubjectiveText')>()),
  findSubmittedRoomLoaderForAppointment: async () => null,
}));
vi.mock('../components/soap/VisitCheckoutPanel', () => ({ default: () => null }));
vi.mock('../components/soap/ScribeSuggestedPlanItems', () => ({ default: () => null }));
vi.mock('../components/soap/PlanOrdersSection', () => ({ default: () => null }));
vi.mock('../components/soap/SignOffGate', () => ({ SignOffNotice: () => null, useSignOffBlock: () => null }));

import MedicalNoteEncounterPage from './MedicalNoteEncounterPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/schedule/note/11/7?clientId=3']}>
      <Routes>
        <Route path="/schedule/note/:appointmentId/:patientId" element={<MedicalNoteEncounterPage />} />
        <Route path="/schedule/soap/:appointmentId/:patientId" element={<p>SOAP page opened</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.encounter = { id: 'enc-1', mode: 'medical_note', status: 'draft', clientId: 3, created: CREATED };
  state.drafts = [{ id: 'note-1', body: 'History\nEar recheck.', status: 'draft', noteDate: CREATED }];
  state.finalized = [];
  switchEncounterMode.mockReset();
  updateScoutChartNote.mockClear();
  createScoutChartNote.mockClear();
});

describe('EMR-MODE: Switch to SOAP on the medical note page', () => {
  it('saves the note, switches with its chart note, and opens the SOAP page', async () => {
    switchEncounterMode.mockResolvedValue({ ...state.encounter, mode: 'comprehensive' });
    renderPage();
    const history = await screen.findByPlaceholderText(/Why they are here/);
    fireEvent.change(history, { target: { value: 'Ear recheck. Much better.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to SOAP' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Switch this medical note to a SOAP? The note text moves into the SOAP.'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch to SOAP' })[1]);

    expect(await screen.findByText('SOAP page opened')).toBeInTheDocument();
    expect(updateScoutChartNote).toHaveBeenCalledWith('note-1', 'History\nEar recheck. Much better.');
    expect(switchEncounterMode).toHaveBeenCalledWith('enc-1', 'comprehensive', { chartNoteId: 'note-1' });
  });

  it('is hidden once this visit’s note is wrapped up (finalized)', async () => {
    state.finalized = [{ id: 'note-0', body: 'History\nDone.', status: 'finalized', noteDate: CREATED }];
    renderPage();
    await screen.findByPlaceholderText(/Why they are here/);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Switch to SOAP' })).toBeNull());
  });

  it('a finalized note from another visit does not hide it', async () => {
    state.finalized = [{ id: 'note-old', body: 'History\nLast year.', status: 'finalized', noteDate: '2025-10-01T15:00:00.000Z' }];
    renderPage();
    expect(await screen.findByRole('button', { name: 'Switch to SOAP' })).toBeInTheDocument();
  });

  it('is hidden when the encounter is signed', async () => {
    state.encounter = { ...state.encounter, status: 'completed' };
    renderPage();
    await screen.findByPlaceholderText(/Why they are here/);
    expect(screen.queryByRole('button', { name: 'Switch to SOAP' })).toBeNull();
  });
});
