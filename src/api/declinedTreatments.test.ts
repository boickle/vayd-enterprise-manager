/**
 * Wave 8 (bug 8a): the server stamps who declined an item as a trailing "[staff:NNNN]" on the note.
 * Staff should see the reason without that tag.
 */
import { describe, expect, it } from 'vitest';
import { declineNoteForDisplay } from './declinedTreatments';

describe('declineNoteForDisplay', () => {
  it('drops the trailing staff tag', () => {
    expect(declineNoteForDisplay('Declined (pre-visit accept): Owner wants to wait [staff:7671]')).toBe(
      'Declined (pre-visit accept): Owner wants to wait',
    );
  });
  it('leaves a note without a tag alone, and handles empty notes', () => {
    expect(declineNoteForDisplay('Declined (off record): cost')).toBe('Declined (off record): cost');
    expect(declineNoteForDisplay(null)).toBe('');
    expect(declineNoteForDisplay('  [staff:12]  ')).toBe('');
  });
});
