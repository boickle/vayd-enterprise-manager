import { describe, expect, it, vi } from 'vitest';

vi.mock('../RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../../utils/householdChartPdfs', () => ({}));
vi.mock('../records/RecordDocumentsReview', () => ({ default: () => null }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ effective: null }),
}));

import { vaccineDoseRecorded } from './VisitCheckoutPanel';

const shot = { id: 'v1' };

describe('checkout vaccine dose readiness', () => {
  it('SOAP line: not ready until a dose is recorded for its order, then ready', () => {
    const line = { id: 'l1', orderId: 'o1' };
    expect(vaccineDoseRecorded(line, {}, {})).toBe(false);
    expect(vaccineDoseRecorded(line, { o1: shot }, {})).toBe(true);
    expect(vaccineDoseRecorded(line, { other: shot }, {})).toBe(false);
  });
  it('direct invoice line: not ready without a dose, ready with one on the line', () => {
    const line = { id: 'l2', orderId: null } as never;
    expect(vaccineDoseRecorded(line, {}, {})).toBe(false);
    expect(vaccineDoseRecorded(line, {}, { l2: shot })).toBe(true);
    expect(vaccineDoseRecorded(line, {}, { l9: shot })).toBe(false);
  });
});
