/**
 * EMR-PROBLEMS (owner decision Nov 4, 2026): active eVet diagnoses and eVet master problems not
 * on the pet's list show as suggestion cards. Accept adds a Chronic, Active problem; X dismisses
 * it for good; ignoring it is fine.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EvetProblemSuggestions, { evetSuggestionText } from './EvetProblemSuggestions';
import { http } from '../../api/http';
import type { EvetProblemSuggestion, PatientProblem } from '../../api/visitWorkflow';

const DX: EvetProblemSuggestion = {
  key: 'hyperthyroidism',
  label: 'Hyperthyroidism',
  source: 'diagnosis',
  date: '2025-03-14T15:00:00.000Z',
  doctorName: 'Dr. Ada Quill',
  statusLabel: null,
  comments: null,
  recordCount: 2,
};
const MP: EvetProblemSuggestion = {
  key: 'iris stage 2, prehypertensive, proteinuric - unknown cause',
  label: 'Iris Stage 2, prehypertensive, proteinuric - unknown cause',
  source: 'master_problem',
  date: '2024-09-03T12:00:00.000Z',
  doctorName: null,
  statusLabel: 'Onset',
  comments: null,
  recordCount: 1,
};

const created: PatientProblem = {
  id: 'p9',
  practiceId: 1,
  patientId: 7,
  label: 'Hyperthyroidism',
  status: 'active',
  acuity: 'chronic',
  note: null,
  createdInEncounterId: 'enc-1',
  postedToRecordAt: null,
  resolvedAt: null,
  created: '2026-11-04T00:00:00Z',
  updated: '2026-11-04T00:00:00Z',
};

let get: ReturnType<typeof vi.spyOn>;
let post: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  get = vi.spyOn(http, 'get').mockResolvedValue({ data: [DX, MP] } as any);
  post = vi.spyOn(http, 'post');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EMR-PROBLEMS eVet suggestion cards', () => {
  it('EMR-PROBLEMS-E1 words a diagnosis and a master problem the way the owner asked', () => {
    expect(evetSuggestionText(DX)).toBe('From eVet: Hyperthyroidism (Dr. Ada Quill, Mar 2025)');
    expect(evetSuggestionText(MP)).toBe(
      'From eVet master problems: Iris Stage 2, prehypertensive, proteinuric - unknown cause (Onset, Sep 2024)'
    );
    expect(evetSuggestionText({ ...DX, doctorName: null, date: null })).toBe(
      'From eVet: Hyperthyroidism'
    );
  });

  it('EMR-PROBLEMS-E2 shows a card per suggestion, styled like the AI Scribe cards', async () => {
    const { container } = render(
      <EvetProblemSuggestions patientId={7} problems={[]} onAccepted={() => {}} />
    );
    expect(
      await screen.findByText('From eVet: Hyperthyroidism (Dr. Ada Quill, Mar 2025)')
    ).toBeInTheDocument();
    expect(container.querySelectorAll('.soap-scribe-card')).toHaveLength(2);
    expect(get).toHaveBeenCalledWith('/patient-problems/evet-suggestions', {
      params: { practiceId: expect.any(Number), patientId: 7 },
    });
  });

  it('EMR-PROBLEMS-E3 hides a suggestion whose name is already on the list', async () => {
    render(
      <EvetProblemSuggestions
        patientId={7}
        problems={[{ ...created, label: '  HYPERthyroidism ' }]}
        onAccepted={() => {}}
      />
    );
    expect(await screen.findByText(/From eVet master problems/)).toBeInTheDocument();
    expect(screen.queryByText(/From eVet: Hyperthyroidism/)).toBeNull();
  });

  it('EMR-PROBLEMS-E4 Accept adds a Chronic, Active problem for the visit and the card goes', async () => {
    post.mockResolvedValue({ data: created } as any);
    const onAccepted = vi.fn();
    render(
      <EvetProblemSuggestions
        patientId={7}
        encounterId="enc-1"
        problems={[]}
        onAccepted={onAccepted}
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept Hyperthyroidism as a chronic problem' })
    );
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(created));
    expect(post).toHaveBeenCalledWith('/patient-problems/evet-suggestions/accept', {
      practiceId: expect.any(Number),
      patientId: 7,
      key: 'hyperthyroidism',
      createdInEncounterId: 'enc-1',
    });
    await waitFor(() => expect(screen.queryByText(/From eVet: Hyperthyroidism/)).toBeNull());
  });

  it('EMR-PROBLEMS-E5 X dismisses it (remembered by the server) and the card goes', async () => {
    post.mockResolvedValue({ data: { ok: true } } as any);
    const onAccepted = vi.fn();
    render(<EvetProblemSuggestions patientId={7} problems={[]} onAccepted={onAccepted} />);
    fireEvent.click(await screen.findByRole('button', { name: `Dismiss ${MP.label}` }));
    await waitFor(() => expect(screen.queryByText(/From eVet master problems/)).toBeNull());
    expect(post).toHaveBeenCalledWith('/patient-problems/evet-suggestions/dismiss', {
      practiceId: expect.any(Number),
      patientId: 7,
      key: MP.key,
    });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(screen.getByText(/From eVet: Hyperthyroidism/)).toBeInTheDocument();
  });

  it('EMR-PROBLEMS-E6 shows nothing when there are no suggestions or the request is refused', async () => {
    get.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
    const { container } = render(
      <EvetProblemSuggestions patientId={7} problems={[]} onAccepted={() => {}} />
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="evet-problem-suggestions"]')).toBeNull();
  });
});
