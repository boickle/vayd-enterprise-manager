import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./practiceIdFromToken', () => ({
  currentPracticeId: () => 1,
  resolvePracticeIdFromToken: () => 1,
}));

import { chartRecordRows, recordDetailText, withoutHandlingSection } from './chartRecordsPdf';
import {
  buildChartRowsFromMedicalRecord,
  chartRowsFromScoutNotes,
  chartRowsFromSoapEncounters,
} from './patientChartFromMedicalRecord';

const soap = (over: Record<string, unknown>) =>
  ({
    id: 's1', practiceId: 1, appointmentId: 501, patientId: 9021, clientId: 4411, mode: 'comprehensive',
    status: 'completed',
    subjective: { history: 'Presenting complaint: limping' },
    objectiveVitals: { weight: '24', weightUnit: 'lb', tempF: '101.5' },
    objectiveExam: null,
    objectiveNotes: 'Right hind lame',
    assessmentProblemIds: [],
    assessmentReasoning: 'Cruciate strain',
    planNotes: 'Rest and carprofen',
    forwardBookingDisposition: null, forwardBookingEntryId: null, forwardBookingTaskId: null,
    completedByEmployeeId: 12, completedAt: '2026-11-01T15:00:00Z',
    created: '2026-11-01T14:00:00Z', updated: '2026-11-01T15:00:00Z',
    ...over,
  }) as never;

const note = (over: Record<string, unknown>) =>
  ({
    id: 'n1', patientId: 9021, status: 'finalized', body: 'Phone follow-up: eating well.',
    noteDate: '2026-11-02', created: '2026-11-02T10:00:00Z', updated: '2026-11-02T10:00:00Z',
    ...over,
  }) as never;

describe('EMR-A13-1: records sent to an outside hospital', () => {
  it('include the whole signed SOAP: all four sections', () => {
    const rows = chartRecordRows(chartRowsFromSoapEncounters([soap({})]));
    expect(rows).toHaveLength(1);
    const text = recordDetailText(rows[0].detailText);
    for (const f of [
      'Subjective:', 'limping', 'Objective:', 'Weight: 24 lb', 'Temp: 101.5', 'Right hind lame',
      'Assessment:', 'Cruciate strain', 'Plan:', 'Rest and carprofen',
    ]) expect(text, f).toContain(f);
  });

  it('leave out an unsigned SOAP draft and an unfinalized note', () => {
    const rows = chartRecordRows([
      ...chartRowsFromSoapEncounters([soap({ id: 's2', status: 'draft', planNotes: 'AI scribe draft plan' })]),
      ...chartRowsFromScoutNotes([note({ id: 'n2', status: 'draft', body: 'Draft internal thought' })]),
    ]);
    expect(rows).toEqual([]);
  });

  it('leave out communication logs and documents marked internal use or not for printing', () => {
    const mr = {
      communicationLogs: [
        { id: 1, subject: 'Recheck reminder', serviceDate: '2026-10-01', internalUse: false, notes: 'Sent reminder' },
        { id: 2, subject: 'STAFF ONLY billing dispute', serviceDate: '2026-10-02', internalUse: true, notes: 'Owner upset about bill' },
        { id: 3, subject: 'Hidden from print', serviceDate: '2026-10-03', includeOnMedicalRecordPrinting: false, notes: 'No print' },
      ],
    };
    const rows = chartRecordRows(buildChartRowsFromMedicalRecord(mr as never, null, null, null, true));
    const all = JSON.stringify(rows);
    expect(all).toContain('Recheck reminder');
    expect(all).not.toContain('STAFF ONLY');
    expect(all).not.toContain('Owner upset');
    expect(all).not.toContain('Hidden from print');
  });

  it('drop billing lines and the HANDLING section from outside-records summaries', () => {
    const rows = chartRecordRows([
      { id: 'a', source: 'visitCharge', typeLabel: 'Charge', description: 'Professional courtesy discount', provider: '—', serviceDateIso: '2026-10-01', sortTime: 1, detailText: '' },
    ] as never);
    expect(rows).toEqual([]);
    const summary = 'PROBLEMS\nLimping\n\nHANDLING\nBites when restrained\n\nMEDICATIONS\nCarprofen';
    const out = withoutHandlingSection(summary);
    expect(out).not.toContain('Bites');
    expect(out).toContain('Limping');
    expect(out).toContain('Carprofen');
  });
});
