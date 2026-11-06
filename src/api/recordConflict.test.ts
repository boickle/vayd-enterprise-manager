import { describe, expect, it } from 'vitest';
import { recordConflictFrom } from './visitWorkflow';

describe('recordConflictFrom (EMR-13)', () => {
  it('reads who changed a dose and the current version from a 409', () => {
    const err = {
      response: {
        status: 409,
        data: {
          code: 'RECORD_CONFLICT',
          message: 'Changed by Odile Brackenridge: they saved this vaccine dose after you opened it.',
          changedBy: { employeeId: 4, name: 'Odile Brackenridge' },
          updated: '2026-11-03T15:00:00.000Z',
        },
      },
    };
    expect(recordConflictFrom(err)).toEqual({
      message: 'Changed by Odile Brackenridge: they saved this vaccine dose after you opened it.',
      changedByName: 'Odile Brackenridge',
      updated: '2026-11-03T15:00:00.000Z',
    });
  });

  it('ignores other 409s and other errors', () => {
    expect(recordConflictFrom({ response: { status: 409, data: { code: 'SOAP_FIELD_CONFLICT' } } })).toBeNull();
    expect(recordConflictFrom({ response: { status: 400, data: { code: 'RECORD_CONFLICT' } } })).toBeNull();
    expect(recordConflictFrom(new Error('boom'))).toBeNull();
  });
});
