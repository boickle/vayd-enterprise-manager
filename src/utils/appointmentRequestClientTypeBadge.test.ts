/** NEW CLIENT / NEW PATIENT on an Appointments line (owner, Nov 12, 2026). */
import { describe, expect, it } from 'vitest';
import { appointmentRequestClientTypeBadge } from './appointmentRequestTableRow';

describe('appointmentRequestClientTypeBadge', () => {
  it('new client', () => {
    expect(appointmentRequestClientTypeBadge('new', [{ isNew: true }])).toBe('new_client');
  });
  it('existing client bringing a new pet', () => {
    expect(appointmentRequestClientTypeBadge('existing', [{ isNew: false }, { isNew: true }])).toBe(
      'new_patient'
    );
  });
  it('existing client, existing pets', () => {
    expect(appointmentRequestClientTypeBadge('existing', [{ isNew: false }])).toBe('existing');
  });
  it('unknown', () => {
    expect(appointmentRequestClientTypeBadge('unknown', [])).toBeNull();
  });
});
