/**
 * LAB-A10-1 (summary draft): the result's date in the AI prompt is the practice's calendar day.
 * A result collected 2026-11-06 21:30 Eastern (2026-11-07T02:30Z) is "collected 2026-11-06".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/idexx', async () => {
  const actual = await vi.importActual<typeof import('../../api/idexx')>('../../api/idexx');
  return {
    ...actual,
    listIdexxResults: vi.fn(async () => ({ items: [] })),
    getIdexxResult: vi.fn(async () => null),
  };
});
vi.mock('../../api/soapScribe', () => ({ chatAboutChart: vi.fn(async () => 'Draft text') }));
vi.mock('../../api/visitWorkflow', () => ({ VISIT_WORKFLOW_PRACTICE_ID: '1' }));
vi.mock('../../utils/patientHistorySource', () => ({
  loadPatientHistorySource: vi.fn(async () => ({ text: '', owner: null, today: '2026-11-06' })),
}));

import { chatAboutChart } from '../../api/soapScribe';
import type { IdexxResultDetail } from '../../api/idexx';
import { draftIdexxClientSummary } from './idexxClientSummaryDraft';

function result(over: Record<string, unknown> = {}): IdexxResultDetail {
  return {
    id: 9,
    patientId: 5,
    status: 'COMPLETE',
    specimenCollectionDate: null,
    idexxUpdatedAt: '2026-11-07T02:30:00Z',
    receivedAt: null,
    notes: null,
    categories: [
      {
        name: 'Chemistry',
        code: null,
        notes: [],
        tests: [
          {
            code: 'GLU',
            name: 'Glucose',
            analyte: null,
            result: '95',
            resultNumeric: 95,
            resultType: null,
            qualifier: null,
            units: 'mg/dL',
            referenceRange: '70-140',
            low: 70,
            high: 140,
            criticalLow: null,
            criticalHigh: null,
            outOfRange: false,
            outOfRangeCode: null,
            status: 'COMPLETE',
            notes: [],
          },
        ],
      },
    ],
    ...over,
  } as unknown as IdexxResultDetail;
}

beforeEach(() => {
  vi.mocked(chatAboutChart).mockClear();
});

describe('LAB-A10 summary draft date', () => {
  it('LAB-A10-1: the collected date in the draft prompt is the Eastern day', async () => {
    await draftIdexxClientSummary(result(), 'Max');
    const sent = vi.mocked(chatAboutChart).mock.calls[0][0] as { sourceText: string };
    expect(sent.sourceText).toContain('collected 2026-11-06');
    expect(sent.sourceText).not.toContain('collected 2026-11-07');
  });
});

describe('client summary greeting and placeholders (owner, Nov 8, 2026)', () => {
  it('greets the owner by first name, replacing whatever greeting the draft used', async () => {
    const { withGreeting, ownerFirstName } = await import('./idexxClientSummaryDraft');
    expect(ownerFirstName('Maria Rivera')).toBe('Maria');
    expect(withGreeting('Dear Rivera,\n\nJuniper is fine.', 'Maria')).toBe('Dear Maria,\n\nJuniper is fine.');
    expect(withGreeting('Hi Mrs. Rivera,\nJuniper is fine.', 'Maria')).toBe('Dear Maria,\nJuniper is fine.');
    expect(withGreeting('Juniper is fine.', 'Maria')).toBe('Dear Maria,\n\nJuniper is fine.');
    expect(withGreeting('Dear Rivera,', null)).toBe('Dear Rivera,');
  });

  it('finds a placeholder the doctor still has to fill in', async () => {
    const { summaryPlaceholder } = await import('./idexxClientSummaryDraft');
    expect(summaryPlaceholder('Next steps: [doctor to add]')).toBe('[doctor to add]');
    expect(summaryPlaceholder('Next steps: recheck in two weeks.')).toBeNull();
  });
});
