import { beforeEach, describe, expect, it } from 'vitest';
import {
  holdUnsavedSoapDraft,
  readSoapChartDraft,
  soapChartDraftIsNewer,
  soapChartDraftKey,
  type SoapChartDraft,
} from './soapChartDraft';

const base = (over: Partial<SoapChartDraft> = {}): SoapChartDraft =>
  ({
    subjective: '',
    emailSubject: '',
    emailBody: '',
    objectiveNotes: '',
    reasoning: '',
    planNotes: '',
    vitals: {},
    exam: {},
    linkedProblemIds: [],
    at: new Date().toISOString(),
    ...over,
  }) as unknown as SoapChartDraft;

describe('EMR-A10-1: unsaved SOAP text held on the device', () => {
  beforeEach(() => localStorage.clear());

  it('writes the typed plan under the encounter key after a failed save', () => {
    const saved = base({ at: '2026-01-01T00:00:00.000Z' });
    holdUnsavedSoapDraft('enc-1', base({ planNotes: 'Recheck in two weeks' }), saved);
    expect(localStorage.getItem(soapChartDraftKey('enc-1'))).toBeTypeOf('string');
    const d = readSoapChartDraft('enc-1');
    expect(d?.planNotes).toBe('Recheck in two weeks');
    expect(soapChartDraftIsNewer(d!, '2026-01-01T00:00:00.000Z')).toBe(true);
  });
});
