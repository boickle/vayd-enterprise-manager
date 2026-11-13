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

describe('consent before every room or phone recording (B2, B5)', () => {
  it('a medical note asks the same question and says what Write up visit does', () => {
    render(<ScribeConsentModal variant="note" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/I’ve informed the client this visit is being recorded/);
    expect(text).toMatch(/Write up visit/);
    expect(text).toMatch(/kept with this note and in a learning table/);
    expect((screen.getByRole('button', { name: /start recording/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['callback', /I’ve told the client this call is being recorded/],
    ['huddle', /I’ve told everyone in this meeting they’re being recorded/],
    ['previsit', /Anyone who can hear me knows I’m recording/],
  ] as const)('a %s Jot asks its own question and says where the words go', (kind, line) => {
    render(<ScribeConsentModal variant="jot" jotKind={kind} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(line);
    expect(text).toMatch(/saved with this Jot/);
    expect(text).toMatch(/audio itself is never stored/);
  });
});
