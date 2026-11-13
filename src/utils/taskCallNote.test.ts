import { describe, expect, it } from 'vitest';
import {
  CALL_NOTE_DRAFT_HEADING,
  fileCallTaskCallId,
  householdPetsFromClient,
  isFileCallTask,
  readCallNoteDraft,
  writeCallNoteDraft,
} from './taskCallNote';

describe('File call task notes (owner, Nov 13, 2026)', () => {
  it('finds the Quo call a File call task was made for', () => {
    expect(fileCallTaskCallId({ idempotencyKey: 'openphone-call:ACde7d20' })).toBe('ACde7d20');
    expect(fileCallTaskCallId({ idempotencyKey: 'rule:3:call:9' })).toBeNull();
    expect(fileCallTaskCallId({})).toBeNull();
  });

  it('tells File call tasks from other tasks', () => {
    expect(isFileCallTask({ title: 'File call with Smokey Eule', source: 'system' })).toBe(true);
    expect(isFileCallTask({ title: 'File call with Smokey Eule', source: 'manual' })).toBe(false);
    expect(isFileCallTask({ title: 'Call Mrs. Smith', idempotencyKey: 'openphone-call:AC1' })).toBe(
      true
    );
    expect(isFileCallTask({ title: 'Recheck Bear', source: 'system' })).toBe(false);
  });

  it('lists the household’s active pets, sorted, without duplicates', () => {
    const raw = {
      patients: [
        { id: 3, name: 'Zuzu' },
        { id: 1, name: 'Bear', isActive: true },
        { id: 2, name: 'Old Tom', isActive: false },
        { id: 1, name: 'Bear' },
        { id: 'x', name: 'Bad id' },
      ],
    };
    expect(householdPetsFromClient(raw)).toEqual([
      { id: 1, name: 'Bear' },
      { id: 3, name: 'Zuzu' },
    ]);
    expect(householdPetsFromClient(null)).toEqual([]);
  });

  it('keeps one saved note at the end of the body, replaced on each Save', () => {
    const body =
      'Owner asked about a refill.\n\nQuo transcribed this call and nobody filed it to a chart.';
    const once = writeCallNoteDraft(body, 'Called back, LMOM.');
    expect(once).toBe(`${body}\n\n${CALL_NOTE_DRAFT_HEADING}\nCalled back, LMOM.`);
    expect(readCallNoteDraft(once)).toBe('Called back, LMOM.');

    const twice = writeCallNoteDraft(once, 'Reached owner; refill sent.');
    expect(twice.split(CALL_NOTE_DRAFT_HEADING)).toHaveLength(2);
    expect(readCallNoteDraft(twice)).toBe('Reached owner; refill sent.');

    expect(writeCallNoteDraft(twice, '  ')).toBe(body);
    expect(readCallNoteDraft(body)).toBe('');
    expect(writeCallNoteDraft(null, 'Note')).toBe(`${CALL_NOTE_DRAFT_HEADING}\nNote`);
  });
});
