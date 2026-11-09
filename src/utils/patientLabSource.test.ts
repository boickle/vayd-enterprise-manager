/**
 * LAB-A10-1: the AI lab source dates a result by the practice's calendar day (Eastern), not the UTC
 * day. 2026-11-06 21:30 Eastern is 2026-11-07 02:30 UTC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/idexx', () => ({
  listIdexxResults: vi.fn(),
  getIdexxResult: vi.fn(async () => null),
}));
vi.mock('../api/inHouseLabs', () => ({ listPatientLabResults: vi.fn(async () => []) }));
vi.mock('./chartRecordsPdf', () => ({
  labReportBriefText: vi.fn(() => ''),
  labReportFromIdexx: vi.fn(),
  labReportFromInHouse: vi.fn(),
}));

import { listIdexxResults } from '../api/idexx';
import { listPatientLabResults } from '../api/inHouseLabs';
import { fetchPatientLabSource } from './patientLabSource';

beforeEach(() => {
  vi.mocked(listIdexxResults).mockReset().mockResolvedValue({ items: [] } as never);
  vi.mocked(listPatientLabResults).mockReset().mockResolvedValue([]);
});

describe('LAB-A10 practice date for AI lab source', () => {
  it('LAB-A10-1: an IDEXX result resulted 2026-11-06 21:30 Eastern is dated 2026-11-06', async () => {
    vi.mocked(listIdexxResults).mockResolvedValue({
      items: [
        {
          id: 12,
          status: 'COMPLETE',
          testNames: ['CHEM25'],
          specimenCollectionDate: null,
          receivedAt: '2026-11-07T02:30:00Z',
          idexxUpdatedAt: null,
        },
      ],
    } as never);
    const entries = await fetchPatientLabSource(5);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-11-06');
  });

  it('LAB-A10-1: an in-house lab resulted 2026-11-06 21:30 Eastern is dated 2026-11-06', async () => {
    vi.mocked(listPatientLabResults).mockResolvedValue([
      {
        id: 40,
        status: 'pending',
        templateName: 'Glucose',
        resultedAt: '2026-11-07T02:30:00Z',
        serviceDate: '2026-11-06',
      },
    ] as never);
    const entries = await fetchPatientLabSource(5);
    expect(entries[0].date).toBe('2026-11-06');
  });

  it('LAB-A10-1: a date-only service date is kept as written', async () => {
    vi.mocked(listPatientLabResults).mockResolvedValue([
      { id: 41, status: 'pending', templateName: 'UA', resultedAt: null, serviceDate: '2026-11-06' },
    ] as never);
    const entries = await fetchPatientLabSource(5);
    expect(entries[0].date).toBe('2026-11-06');
  });
});
