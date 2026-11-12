import { describe, expect, it } from 'vitest';
import type { SoapAddendum, SoapEncounter } from '../api/visitWorkflow';
import { chartRowsFromSoapEncounters } from './patientChartFromMedicalRecord';

const signedSoap = (addenda?: SoapAddendum[]): SoapEncounter =>
  ({
    id: 'enc-1',
    practiceId: 1,
    appointmentId: 10,
    patientId: 5,
    clientId: null,
    mode: 'full',
    status: 'completed',
    subjective: { history: 'Vomiting x2 days' },
    objectiveVitals: null,
    objectiveExam: null,
    objectiveNotes: null,
    assessmentProblemIds: null,
    assessmentReasoning: 'Gastroenteritis',
    planNotes: 'Bland diet',
    forwardBookingDisposition: null,
    forwardBookingEntryId: null,
    forwardBookingTaskId: null,
    completedByEmployeeId: null,
    completedAt: '2026-11-01T15:00:00Z',
    created: '2026-11-01T14:00:00Z',
    updated: '2026-11-01T15:00:00Z',
    addenda,
  }) as SoapEncounter;

const addendum = (id: string, body: string): SoapAddendum => ({
  id,
  soapEncounterId: 'enc-1',
  body,
  created: '2026-11-02T16:30:00Z',
  createdByEmployeeId: 3,
  createdByName: 'Dr. Frey',
});

describe('SOAP rows on the medical record', () => {
  it('shows plain "SOAP" when there are no addenda', () => {
    const [row] = chartRowsFromSoapEncounters([signedSoap([])]);
    expect(row.typeLabel).toBe('SOAP');
    expect(row.detailText).not.toContain('Addendum');
  });

  it('counts one addendum and adds it under the Plan', () => {
    const [row] = chartRowsFromSoapEncounters([signedSoap([addendum('a1', 'Lab: lipase normal')])]);
    expect(row.typeLabel).toBe('SOAP (+ 1 addendum)');
    expect(row.detailText.indexOf('Plan:')).toBeLessThan(row.detailText.indexOf('Addendum'));
    expect(row.detailText).toContain('Dr. Frey');
    expect(row.detailText).toContain('Lab: lipase normal');
  });

  it('says "addenda" for two or more', () => {
    const [row] = chartRowsFromSoapEncounters([
      signedSoap([addendum('a1', 'First'), addendum('a2', 'Second')]),
    ]);
    expect(row.typeLabel).toBe('SOAP (+ 2 addenda)');
    expect(row.detailText.indexOf('First')).toBeLessThan(row.detailText.indexOf('Second'));
  });
});
