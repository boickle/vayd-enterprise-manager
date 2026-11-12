/**
 * SCR-07: on a household medical note the AI write-up fills every pet, but Wrap up only signs pets whose
 * tab was opened. Invented names only.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CREATED = '2026-11-11T15:00:00.000Z';
const encounter = { id: 'enc-1', mode: 'medical_note', status: 'draft', clientId: 3, created: CREATED };
const finalizeScoutChartNote = vi.fn(async () => ({}));
const createScoutChartNote = vi.fn(async (a: { patientId: number }) => ({ id: `note-${a.patientId}`, body: '' }));
const updateScoutChartNote = vi.fn(async () => ({}));
const writeVisitWriteup = vi.fn();

vi.mock('../api/visitWorkflow', () => ({
  VISIT_WORKFLOW_PRACTICE_ID: 1,
  createEncounter: async () => encounter,
  getHouseholdRoster: async () => [
    { patientId: 7, patientName: 'Aster', species: 'Dog' },
    { patientId: 8, patientName: 'Basil', species: 'Cat' },
  ],
  getInvoiceByAppointment: async () => null,
  listOrders: async () => [],
  switchEncounterMode: vi.fn(),
}));
vi.mock('../api/scoutChart', () => ({
  listScoutChartNotes: async () => [],
  createScoutChartNote: (...a: unknown[]) => createScoutChartNote(...(a as [{ patientId: number }])),
  updateScoutChartNote: (...a: unknown[]) => updateScoutChartNote(...(a as [])),
  finalizeScoutChartNote: (...a: unknown[]) => finalizeScoutChartNote(...(a as [])),
}));
vi.mock('../api/soapScribe', () => ({
  listScribeSessions: async () => [],
  writeVisitWriteup: (...a: unknown[]) => writeVisitWriteup(...a),
}));
vi.mock('../api/appointments', () => ({ fetchAppointmentById: async () => null }));
vi.mock('../api/appointmentSettings', () => ({ fetchEmployee: async () => ({}) }));
vi.mock('../api/patients', () => ({ fetchPatientProfileForRow: async () => ({ name: 'Aster' }) }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ employeeId: null }) }));
const recorderState = { transcript: 'Aster and Basil rechecks.' };
vi.mock('../hooks/useBriefRecorder', () => ({
  useBriefRecorder: () => ({
    recording: false,
    transcript: recorderState.transcript,
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
        <Route path="/schedule/home" element={<p>Home opened</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function writeUp() {
  renderPage();
  const button = await screen.findByRole('button', { name: 'Write up visit' });
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Basil' })).toBeInTheDocument());
  fireEvent.click(button);
  await screen.findByText(/Visit write-up is ready for all 2 pets/);
}

beforeEach(() => {
  finalizeScoutChartNote.mockClear();
  createScoutChartNote.mockClear();
  writeVisitWriteup.mockReset();
  writeVisitWriteup.mockResolvedValue({
    history: 'History A',
    plan: 'Plan A',
    clientEmailSubject: '',
    clientEmailBody: '',
    patients: [
      { patientId: 7, patientName: 'Aster', history: 'AI history for Aster', plan: 'AI plan for Aster' },
      { patientId: 8, patientName: 'Basil', history: 'AI history for Basil', plan: 'AI plan for Basil' },
    ],
  });
});

describe('SCR-07 Wrap up needs every AI-filled pet opened', () => {
  it('SCR-07-1: blocks, names the unviewed pet, and the link opens that tab', async () => {
    await writeUp();
    fireEvent.click(screen.getByRole('button', { name: 'Wrap up' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Review Basil before signing');
    expect(finalizeScoutChartNote).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole('button', { name: 'Basil' }));
    expect(screen.getByRole('tab', { name: 'Basil' })).toHaveAttribute('aria-selected', 'true');
  });

  it('SCR-07-2: both tabs opened, both notes are finalized', async () => {
    await writeUp();
    fireEvent.click(screen.getByRole('tab', { name: 'Basil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wrap up' }));
    await screen.findByText('Home opened');
    expect(finalizeScoutChartNote).toHaveBeenCalledTimes(2);
    expect(finalizeScoutChartNote.mock.calls.map((c) => c[0]).sort()).toEqual(['note-7', 'note-8']);
  });
});
