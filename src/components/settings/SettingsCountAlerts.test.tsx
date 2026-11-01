/** CAT-10: the stale-lot thresholds show their defaults, can be changed, and are saved. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsCountAlerts from './SettingsCountAlerts';

const patch = vi.hoisted(() => vi.fn());
const base = {
  enabled: true,
  aUnits: 0,
  aUsd: 0,
  bUnits: 2,
  bUsd: 50,
  cUnits: 5,
  cUsd: 25,
  shrinkTaskEnabled: true,
  shrinkPctLimit: 3,
  accuracyPctLimit: 85,
  weeklyCountCap: 20,
  staleSkipDraws: 2,
  staleLowUnits: 2,
  staleLowPct: 10,
  staleLowDays: 30,
  staleLowDaysControlled: 14,
  staleNoMoveDays: 90,
};
vi.mock('../../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));
vi.mock('../../api/inventoryCounts', () => ({
  getCountAlertSettings: async () => base,
  patchCountAlertSettings: (...a: unknown[]) => patch(...a),
}));

it('shows the stale-lot defaults and saves a change', async () => {
  patch.mockReset().mockResolvedValue({ ...base, staleNoMoveDays: 60 });
  render(<SettingsCountAlerts />);
  expect(await screen.findByLabelText('Times a newer lot was drawn')).toHaveValue(2);
  expect(screen.getByLabelText('Nearly empty units')).toHaveValue(2);
  expect(screen.getByLabelText('Nearly empty percent')).toHaveValue(10);
  expect(screen.getByLabelText('Days without a draw')).toHaveValue(30);
  expect(screen.getByLabelText('Days without a draw, controlled drugs')).toHaveValue(14);
  expect(screen.getByLabelText('Days with no movement')).toHaveValue(90);

  fireEvent.change(screen.getByLabelText('Days with no movement'), { target: { value: '60' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(patch).toHaveBeenCalled());
  expect(patch.mock.calls[0]![1]).toMatchObject({
    staleSkipDraws: 2,
    staleLowUnits: 2,
    staleLowPct: 10,
    staleLowDays: 30,
    staleLowDaysControlled: 14,
    staleNoMoveDays: 60,
  });
});
