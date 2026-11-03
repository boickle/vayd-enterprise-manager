import type { AppointmentType } from '../../api/appointmentSettings';
import type { AvgMinutesByTypeRow } from '../../analytics/appointmentTypeTimeStats';
import {
  estimateAddedMinutes,
  estimateVisitMinutes,
  plannerBookableTypes,
  suggestTypeIdForInterval,
} from './plannerTiming';

const type = (id: number, name: string, extra: Partial<AppointmentType> = {}) =>
  ({
    id,
    name,
    prettyName: name,
    isActive: true,
    isDeleted: false,
    isBoardingType: false,
    defaultDuration: 30,
    allowClient: true,
    ...extra,
  }) as unknown as AppointmentType;

const wellness = type(1, 'Wellness');
const recheck = type(2, 'Recheck', { defaultDuration: 20 });
const hold = type(3, 'Hold', { isHold: true });
const boarding = type(4, 'Boarding', { isBoardingType: true });
const types = [wellness, recheck, hold, boarding];

// Dr. Patel's last 30 days: wellness 50 min alone, 35 min per pet in a household.
const rows: AvgMinutesByTypeRow[] = [
  { typeName: 'Wellness', avgMinutes: 50, count: 20, multipetAvgMinutes: 35, multipetCount: 12 },
  { typeName: 'Recheck', avgMinutes: 25, count: 2, multipetAvgMinutes: null, multipetCount: 0 },
];

describe('plannerTiming', () => {
  it('lists bookable types without holds or boarding', () => {
    expect(
      plannerBookableTypes(types)
        .map((t) => t.name)
        .sort()
    ).toEqual(['Recheck', 'Wellness']);
  });

  it('suggests wellness for long intervals and recheck for short ones', () => {
    expect(suggestTypeIdForInterval({ kind: 'preset', key: '1y' }, types)).toBe(1);
    expect(suggestTypeIdForInterval({ kind: 'preset', key: '2w' }, types)).toBe(2);
    expect(suggestTypeIdForInterval({ kind: 'custom', amount: 2, unit: 'years' }, types)).toBe(1);
  });

  it('uses the provider history, with multi-pet averages for households', () => {
    expect(estimateVisitMinutes([1], rows, types)).toEqual({ minutes: 50, source: 'stats' });
    expect(estimateVisitMinutes([1, 1], rows, types).minutes).toBe(70);
  });

  it('falls back to the type default when there is too little history', () => {
    expect(estimateVisitMinutes([2], rows, types)).toEqual({ minutes: 20, source: 'default' });
  });

  it('adds the difference the extra pet makes to the visit', () => {
    // 1 wellness (50) → 2 wellness (2 × 35 = 70): adds 20 minutes.
    expect(estimateAddedMinutes([1], [1], rows, types).minutes).toBe(20);
  });
});
