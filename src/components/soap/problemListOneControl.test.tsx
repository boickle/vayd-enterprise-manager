/**
 * EMR-PROBLEMS (owner decisions Nov 4, 2026): one problem list per pet, the same section and the
 * same add control in Manual SOAP and AI Scribe, and in the "Chronic problems on this visit" box.
 * A problem is a name + Acute or Chronic (picked when adding) + Active or Resolved. No
 * Complaint / Rule-out / Diagnosis kind, no Open status.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MasterProblemListSection from './MasterProblemListSection';
import SoapPatientChronicSummary from './SoapPatientChronicSummary';
import ScribeDocumentView from './ScribeDocumentView';
import { http } from '../../api/http';
import type { PatientProblem } from '../../api/visitWorkflow';
import { emptySoapChronicDraft } from '../../utils/soapChronicDraft';

vi.mock('./SoapRichTextField', () => ({
  default: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="rich-text">{placeholder}</div>
  ),
}));

function problem(over: Partial<PatientProblem> & { status?: string } = {}): PatientProblem {
  return {
    id: 'p1',
    practiceId: 1,
    patientId: 7,
    label: 'Hyperthyroidism',
    status: 'active',
    acuity: 'chronic',
    note: null,
    createdInEncounterId: null,
    postedToRecordAt: null,
    resolvedAt: null,
    created: '2026-11-01T00:00:00Z',
    updated: '2026-11-01T00:00:00Z',
    ...over,
  } as PatientProblem;
}

let post: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  post = vi.spyOn(http, 'post');
  vi.spyOn(http, 'get').mockResolvedValue({ data: [] } as any);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function expectTheAddControl(root: HTMLElement) {
  const control = within(root).getByTestId('problem-add-control');
  const input = within(control).getByRole('textbox', { name: 'New problem' });
  const acute = within(control).getByRole('button', { name: /Acute/ });
  const chronic = within(control).getByRole('button', { name: /Chronic/ });
  // Acute or Chronic must be picked; nothing to pick until a name is typed.
  expect(acute).toBeDisabled();
  expect(chronic).toBeDisabled();
  expect(within(root).queryByRole('option', { name: /Complaint|Rule-out|Diagnosis/ })).toBeNull();
  return { control, input, acute, chronic };
}

describe('EMR-PROBLEMS the problem list', () => {
  it('EMR-PROBLEMS-C1 the Problems section adds with Acute/Chronic, no kind, and shows only Active/Resolved', async () => {
    const created = problem({ id: 'p2', label: 'Otitis externa', acuity: 'acute' });
    post.mockResolvedValue({ data: created } as any);
    const onChange = vi.fn();
    const onToggleLink = vi.fn();
    render(
      <MasterProblemListSection
        patientId={7}
        encounterId="enc-1"
        problems={[problem({ status: 'open' as any })]}
        linkedProblemIds={[]}
        onChange={onChange}
        onToggleLink={onToggleLink}
      />
    );
    const root = screen.getByTestId('soap-problem-list');
    const { input, acute } = expectTheAddControl(root);

    // A legacy "open" problem reads as Active; there is no Open status to pick.
    const status = within(root).getByRole('combobox', { name: 'Active or resolved' });
    expect((status as HTMLSelectElement).value).toBe('active');
    expect(
      within(status)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Active', 'Resolved']);
    expect(within(root).queryByText(/^Complaint$|^Rule-out$|^Diagnosis$/)).toBeNull();

    fireEvent.change(input, { target: { value: '  Otitis externa ' } });
    fireEvent.click(acute);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/patient-problems', {
      practiceId: expect.any(Number),
      patientId: 7,
      label: 'Otitis externa',
      acuity: 'acute',
      status: 'active',
      createdInEncounterId: 'enc-1',
    });
    expect(post.mock.calls[0][1]).not.toHaveProperty('kind');
    expect(onToggleLink).toHaveBeenCalledWith('p2', true);
  });

  it('EMR-PROBLEMS-C2 the "Chronic problems on this visit" box uses the same add control and holds eVet suggestions', () => {
    const onDraftChange = vi.fn();
    render(
      <SoapPatientChronicSummary
        patientId={7}
        practiceId={1}
        encounterId="enc-1"
        problems={[problem()]}
        chronicMedications={[]}
        draft={emptySoapChronicDraft()}
        onDraftChange={onDraftChange}
        suggestionsSlot={<div data-testid="slot">eVet cards</div>}
      />
    );
    const box = screen.getByText('Chronic problems on this visit').parentElement!;
    const { input, chronic } = expectTheAddControl(box);
    expect(within(box).getByTestId('slot')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Arthritis' } });
    fireEvent.click(chronic);
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        addProblems: [expect.objectContaining({ label: 'Arthritis', acuity: 'chronic' })],
      })
    );
    // Enter alone no longer picks an acuity.
    onDraftChange.mockClear();
    fireEvent.change(input, { target: { value: 'Limp' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('EMR-PROBLEMS-C3 AI Scribe document view shows the Problems section on the Assessment tab', () => {
    const noop = () => {};
    render(
      <ScribeDocumentView
        disabled={false}
        subjective=""
        onSubjectiveChange={noop}
        onSubjectiveBlur={noop}
        objectiveNotes=""
        onObjectiveNotesChange={noop}
        onObjectiveNotesBlur={noop}
        assessment=""
        onAssessmentChange={noop}
        onAssessmentBlur={noop}
        planNotes=""
        onPlanNotesChange={noop}
        onPlanNotesBlur={noop}
        activeTab="assessment"
        assessmentSlot={
          <MasterProblemListSection
            patientId={7}
            encounterId="enc-1"
            problems={[problem()]}
            linkedProblemIds={[]}
            onChange={noop}
            onToggleLink={noop}
          />
        }
      />
    );
    const panel = screen.getByRole('tabpanel', { name: 'Assessment' });
    const list = within(panel).getByTestId('soap-problem-list');
    expectTheAddControl(list);
    expect(within(list).getByDisplayValue('Hyperthyroidism')).toBeInTheDocument();
    // Only on the Assessment tab.
    expect(screen.getAllByTestId('soap-problem-list')).toHaveLength(1);
  });

  it('EMR-PROBLEMS-C4 the SOAP page renders the same Problems section in Manual and AI Scribe mode', () => {
    const src = readFileSync(resolve(__dirname, '../../pages/SoapEncounterPage.tsx'), 'utf8');
    // One section, defined once…
    expect(src.match(/<MasterProblemListSection\b/g)).toHaveLength(1);
    // …placed in the Manual Assessment tab and on the AI Scribe document's Assessment tab.
    expect(src).toContain('assessmentSlot={problemsSection}');
    expect(src).toMatch(/activeTab === 'assessment' && \([\s\S]{0,400}\{problemsSection\}/);
    // eVet suggestions sit with "Chronic problems on this visit".
    expect(src).toMatch(/suggestionsSlot=\{\s*<EvetProblemSuggestions/);
  });

  it('EMR-PROBLEMS-C5 AI Scribe suggestion cards ask only Acute or Chronic (no kind) and land in the same list', () => {
    const src = readFileSync(resolve(__dirname, './ScribePanel.tsx'), 'utf8');
    expect(src).not.toMatch(/p\.kind\.replace|PatientProblemKind|problem:\$\{norm\(p\.label\)\}\|/);
    expect(src).toMatch(/createProblem\(\{\s*patientId,\s*label,\s*acuity,/);
  });
});
