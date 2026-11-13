// @vitest-environment jsdom
// SCR-A8-1: consent wording matches what Process really does and what is kept.
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ScribeConsentModal from './ScribeConsentModal';

describe('ScribeConsentModal wording (SCR-A8)', () => {
  it('says Process fills O/A/P, household pets, and that transcripts are kept', () => {
    render(<ScribeConsentModal onConfirm={vi.fn()} onClose={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/nothing is saved to the record/i);
    expect(text).toMatch(/fills Objective, Assessment and Plan/);
    expect(text).toMatch(/Review them before you sign/);
    expect(text).toMatch(/every ticked pet/);
    expect(text).toMatch(/already have notes/);
    expect(text).toMatch(/kept on the chart and in a learning table/);
    expect(screen.getByRole('button', { name: /start recording/i })).toBeTruthy();
  });
});
