/** EMR-MODE: when "Switch to medical note" shows on a SOAP (nothing entered yet). */
import { describe, expect, it } from 'vitest';
import {
  chartNoteBelongsToEncounter,
  soapHasEnteredContent,
  subjectiveWrittenText,
  type SoapDraftForSwitch,
} from './encounterModeSwitch';
import { vitalsFromValue } from './soapVitals';
import { defaultPeExamState } from '../components/soap/peTemplate';
import { PRE_EXAM_CHECKIN_NOT_FILLED } from './roomLoaderSubjectiveText';

const blank = (): SoapDraftForSwitch => ({
  subjective: '',
  vitals: vitalsFromValue(null),
  exam: defaultPeExamState(),
  objectiveNotes: '',
  reasoning: '',
  planNotes: '',
});

describe('EMR-MODE: SOAP content check', () => {
  it('a fresh SOAP, or one with only the check-in block, has nothing entered', () => {
    expect(soapHasEnteredContent(blank())).toBe(false);
    expect(soapHasEnteredContent({ ...blank(), subjective: PRE_EXAM_CHECKIN_NOT_FILLED })).toBe(false);
    expect(
      soapHasEnteredContent({
        ...blank(),
        subjective: 'Pre-Visit Check-in Information:\n\nEating well; some vomiting.',
      })
    ).toBe(false);
  });

  it('any written section, vital or exam finding counts', () => {
    expect(
      soapHasEnteredContent({
        ...blank(),
        subjective: `${PRE_EXAM_CHECKIN_NOT_FILLED}\n\nVisit discussion:\n\nLimping.`,
      })
    ).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), subjective: 'Owner says limping.' })).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), vitals: { ...vitalsFromValue(null), weight: '12' } })).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), vitals: { ...vitalsFromValue(null), weightNotTaken: true } })).toBe(true);
    expect(
      soapHasEnteredContent({ ...blank(), exam: { ...defaultPeExamState(), ears: { status: 'abnormal' } } })
    ).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), objectiveNotes: 'BAR' })).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), reasoning: 'Otitis' })).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), planNotes: '<p>Drops</p>' })).toBe(true);
    expect(soapHasEnteredContent({ ...blank(), planNotes: '<p>&nbsp;</p>' })).toBe(false);
  });

  it('keeps clinician pre-visit notes as written text', () => {
    expect(
      subjectiveWrittenText('Pre-Visit Check-in Information:\n\nX\n\nClinician pre-visit notes:\n\nCheck ears')
    ).toBe('Check ears');
  });

  it('matches the medical note’s chart note to its encounter by date', () => {
    const created = '2026-11-04T15:00:00.000Z';
    expect(chartNoteBelongsToEncounter('2026-11-04T15:00:00.400Z', created)).toBe(true);
    expect(chartNoteBelongsToEncounter('2026-11-03T15:00:00.000Z', created)).toBe(false);
    expect(chartNoteBelongsToEncounter(null, created)).toBe(false);
  });
});
