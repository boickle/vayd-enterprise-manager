/**
 * AI-scribe Wave 1 (plan: docs/test-plans/ai-scribe.md): SCR-01-1..3 household Process confirm,
 * SCR-04-1..2 reopening a chart, SCR-05-2 device copy of a deleted transcript.
 * The API modules and the confirm dialogs are mocked; nothing leaves the test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScribePanel from './ScribePanel';
import { vitalsFromValue } from '../../utils/soapVitals';

const mocks = vi.hoisted(() => ({
  listScribeSessions: vi.fn(),
  structureTranscript: vi.fn(),
  clearScribeTranscript: vi.fn(),
  getHouseholdRoster: vi.fn(),
  getEncounter: vi.fn(),
  updateEncounter: vi.fn(),
  appConfirm: vi.fn(),
  appConfirmChoice: vi.fn(),
}));

vi.mock('../../api/soapScribe', () => ({
  listScribeSessions: mocks.listScribeSessions,
  structureTranscript: mocks.structureTranscript,
  clearScribeTranscript: mocks.clearScribeTranscript,
  createScribeSocket: vi.fn(),
}));
vi.mock('../../api/visitWorkflow', () => ({
  getHouseholdRoster: mocks.getHouseholdRoster,
  getEncounter: mocks.getEncounter,
  updateEncounter: mocks.updateEncounter,
  listProblems: vi.fn().mockResolvedValue([]),
  listOrders: vi.fn().mockResolvedValue([]),
  createProblem: vi.fn(),
}));
vi.mock('../../utils/appDialog', () => ({
  appConfirm: mocks.appConfirm,
  appConfirmChoice: mocks.appConfirmChoice,
}));
vi.mock('../../utils/keepAwake', () => ({ requestKeepAwake: vi.fn() }));
vi.mock('../../utils/scribeAudioCapture', () => ({ startScribeAudioCapture: vi.fn() }));

const ROSTER = [
  { patientId: 1, patientName: 'Aster', species: 'dog', appointmentId: 11, soapEncounterId: 'enc-a', isCurrent: true },
  { patientId: 2, patientName: 'Basil', species: 'cat', appointmentId: 12, soapEncounterId: 'enc-b', isCurrent: false },
];

function entry(patientId: number, tag: string) {
  return {
    patientId,
    subjectiveHistory: null,
    vitals: {},
    exam: {},
    assessmentReasoning: `AI assessment ${tag}`,
    problems: [],
    planItems: [],
    objectiveNotes: `AI objective ${tag}`,
    planNotes: `AI plan ${tag}`,
  };
}
const MULTI = {
  multiPatient: true,
  patients: [entry(1, 'A'), entry(2, 'B')],
  clientEmailSubject: null,
  clientEmailBody: null,
};

function encounter(over: Record<string, unknown> = {}) {
  return {
    id: 'enc-b',
    mode: 'quick',
    subjective: {},
    objectiveVitals: {},
    objectiveExam: {},
    objectiveNotes: '',
    assessmentReasoning: '',
    planNotes: '',
    ...over,
  };
}

function renderPanel(over: Record<string, unknown> = {}) {
  const props = {
    soapEncounterId: 'enc-a',
    patientId: 1,
    disabled: false,
    examEnabled: false,
    currentSubjective: '',
    currentVitals: vitalsFromValue({}),
    currentExam: {},
    currentObjectiveNotes: '',
    currentReasoning: '',
    currentPlanNotes: '',
    problems: [],
    orders: [],
    onApplySubjective: vi.fn(),
    onApplyVitals: vi.fn(),
    onApplyExam: vi.fn(),
    onApplyObjectiveNotes: vi.fn(),
    onApplyReasoning: vi.fn(),
    onApplyPlanNotes: vi.fn(),
    onApplyChart: vi.fn(),
    onProblemCreated: vi.fn(),
    onOrderCreated: vi.fn(),
    ...over,
  };
  render(<ScribePanel {...(props as any)} />);
  return props;
}

async function processHousehold() {
  fireEvent.click(await screen.findByRole('button', { name: /Paste transcript/ }));
  await screen.findByText(/Which pets are covered/);
  fireEvent.change(screen.getByPlaceholderText(/Paste a visit transcript/), {
    target: { value: 'Doctor: both pets are fine.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Process' }));
}

beforeEach(() => {
  localStorage.clear();
  mocks.listScribeSessions.mockResolvedValue([]);
  mocks.getHouseholdRoster.mockResolvedValue(ROSTER);
  mocks.structureTranscript.mockResolvedValue(MULTI);
  mocks.updateEncounter.mockResolvedValue({});
  mocks.appConfirm.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SCR-01 household Process asks before replacing a sibling chart', () => {
  it('SCR-01-1 names Pet B; "Skip those pets" leaves B unchanged and fills A', async () => {
    mocks.getEncounter.mockResolvedValue(
      encounter({ objectiveNotes: 'Hand-written exam', planNotes: 'Hand-written plan' })
    );
    mocks.appConfirmChoice.mockResolvedValue('alt');
    const props = renderPanel();
    await processHousehold();

    await waitFor(() => expect(mocks.structureTranscript).toHaveBeenCalled());
    const ask = mocks.appConfirmChoice.mock.calls[0][0];
    expect(ask.listItems).toEqual(['Basil']);
    expect(ask.confirmLabel).toBe('Overwrite all');
    expect(ask.altLabel).toBe('Skip those pets');
    await waitFor(() => expect(props.onApplyPlanNotes).toHaveBeenCalledWith('AI plan A'));
    expect(mocks.updateEncounter).not.toHaveBeenCalled();
  });

  it('SCR-01-2 "Overwrite all" replaces B and fills A', async () => {
    mocks.getEncounter.mockResolvedValue(
      encounter({ objectiveNotes: 'Hand-written exam', planNotes: 'Hand-written plan' })
    );
    mocks.appConfirmChoice.mockResolvedValue('confirm');
    const props = renderPanel();
    await processHousehold();

    await waitFor(() => expect(mocks.updateEncounter).toHaveBeenCalled());
    const [id, patch] = mocks.updateEncounter.mock.calls[0];
    expect(id).toBe('enc-b');
    expect(patch.objectiveNotes).toContain('AI objective B');
    expect(patch.planNotes).toContain('AI plan B');
    await waitFor(() => expect(props.onApplyPlanNotes).toHaveBeenCalledWith('AI plan A'));
  });

  it('SCR-01-3 empty siblings: no extra confirm, both charts filled', async () => {
    mocks.getEncounter.mockResolvedValue(encounter());
    const props = renderPanel();
    await processHousehold();

    await waitFor(() => expect(mocks.updateEncounter).toHaveBeenCalled());
    expect(mocks.appConfirmChoice).not.toHaveBeenCalled();
    expect(mocks.updateEncounter.mock.calls[0][1].planNotes).toContain('AI plan B');
    await waitFor(() => expect(props.onApplyPlanNotes).toHaveBeenCalledWith('AI plan A'));
  });

  it('cancel stops Process before the AI is called', async () => {
    mocks.getEncounter.mockResolvedValue(encounter({ planNotes: 'Hand-written plan' }));
    mocks.appConfirmChoice.mockResolvedValue('cancel');
    renderPanel();
    await processHousehold();
    await waitFor(() => expect(mocks.appConfirmChoice).toHaveBeenCalled());
    expect(mocks.structureTranscript).not.toHaveBeenCalled();
    expect(mocks.updateEncounter).not.toHaveBeenCalled();
  });
});

describe('SCR-04 reopening a chart never refills what the doctor cleared', () => {
  const session = {
    id: 's1',
    practiceId: 1,
    soapEncounterId: 'enc-a',
    status: 'stopped',
    transcript: '',
    lastSuggestion: {
      vitals: {},
      exam: {},
      problems: [],
      planItems: [],
      narrativeObjective: 'AI objective',
      assessmentReasoning: 'AI assessment',
      narrativePlan: 'AI plan',
    },
    errorMessage: null,
    endedAt: null,
    created: '2026-11-11T10:00:00Z',
    updated: '2026-11-11T10:00:00Z',
  };

  it('SCR-04-1 a run that was applied: blank Plan stays blank, no save', async () => {
    mocks.listScribeSessions.mockResolvedValue([session]);
    // First open: chart holds all three fields; the run is applied (or already present).
    const first = renderPanel({
      currentObjectiveNotes: 'AI objective',
      currentReasoning: 'AI assessment',
      currentPlanNotes: 'AI plan',
    });
    await waitFor(() => expect(mocks.listScribeSessions).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(first.onApplyChart).not.toHaveBeenCalled();
    cleanup();

    // The doctor blanked Plan (saved blank) and reopens.
    const second = renderPanel({
      currentObjectiveNotes: 'AI objective',
      currentReasoning: 'AI assessment',
      currentPlanNotes: '',
    });
    await waitFor(() => expect(mocks.listScribeSessions).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(second.onApplyChart).not.toHaveBeenCalled();
    expect(second.onApplyPlanNotes).not.toHaveBeenCalled();
  });

  it('SCR-04-2 a suggestion that never reached the chart still fills the blank fields once', async () => {
    mocks.listScribeSessions.mockResolvedValue([session]);
    const first = renderPanel();
    await waitFor(() =>
      expect(first.onApplyChart).toHaveBeenCalledWith({
        objectiveNotes: 'AI objective',
        reasoning: 'AI assessment',
        planNotes: 'AI plan',
      })
    );
    cleanup();

    // Reopen with the fields blank again: it was applied once, so it is not applied twice.
    const second = renderPanel();
    await waitFor(() => expect(mocks.listScribeSessions).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(second.onApplyChart).not.toHaveBeenCalled();
  });
});

describe('SCR-05 delete transcript', () => {
  it('SCR-05-2 removes the device copy and does not bring it back', async () => {
    localStorage.setItem('scout.scribe.liveTranscript:enc-a', 'Doctor: private talk.');
    localStorage.setItem('scout.scribe.liveTranscript:enc-b', 'Doctor: private talk.');
    mocks.clearScribeTranscript.mockResolvedValue(undefined);
    mocks.appConfirm.mockResolvedValue(true);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Combined transcript/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete transcript/ }));

    await waitFor(() => expect(mocks.clearScribeTranscript).toHaveBeenCalledWith('enc-a'));
    const message = mocks.appConfirm.mock.calls[0][0].message as string;
    expect(message).toMatch(/every pet/);
    expect(message).toMatch(/this device/);
    await waitFor(() =>
      expect(localStorage.getItem('scout.scribe.liveTranscript:enc-a')).toBeNull()
    );
    expect(localStorage.getItem('scout.scribe.liveTranscript:enc-b')).toBeNull();

    cleanup();
    renderPanel();
    await waitFor(() => expect(mocks.listScribeSessions).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /Combined transcript/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Paste transcript/ })).toBeTruthy();
  });
});

describe('SCR-A3-1 signed sibling and SCR-A14 warning', () => {
  it('SCR-A3-1 shows the signed pet unticked and disabled, marked signed', async () => {
    mocks.getHouseholdRoster.mockResolvedValue([
      ROSTER[0],
      { ...ROSTER[1], status: 'completed' },
    ]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Paste transcript/ }));
    const box = (await screen.findByLabelText(/Basil/)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/\(signed\)/)).toBeTruthy();
  });

  it('SCR-A14 shows the server warning after Process', async () => {
    mocks.getHouseholdRoster.mockResolvedValue([ROSTER[0]]);
    mocks.structureTranscript.mockResolvedValue({
      ...entry(1, 'A'),
      subjectiveHistory: 'x',
      narrativeObjective: null,
      narrativePlan: null,
      clientEmailSubject: null,
      clientEmailBody: null,
      warnings: ['This visit was very long, so the start of the visit was cut.'],
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Paste transcript/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Paste a visit transcript/), {
      target: { value: 'Doctor: long visit.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Process' }));
    expect(await screen.findByText(/start of the visit was cut/)).toBeTruthy();
  });
});
