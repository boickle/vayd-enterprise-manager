/** SCH-A14: practice closed days can be viewed, added and removed. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsClosedDates, {
  parseClosedDates,
  splitClosedDates,
  summaryText,
} from './SettingsClosedDates';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('../../api/practiceSettings', () => ({
  getPracticeSettings: (...a: unknown[]) => get(...a),
  updatePracticeSettings: (...a: unknown[]) => put(...a),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 1));
  get.mockReset().mockResolvedValue({ 'scheduling.closedDates': '["2026-12-25","2026-11-26"]' });
  put.mockReset().mockImplementation(async (_id: number, s: Record<string, string>) => s);
});

afterEach(() => {
  vi.useRealTimers();
});

it('parses stored values and ignores junk', () => {
  expect(parseClosedDates('["2026-12-25","bad","2026-11-26","2026-11-26"]')).toEqual([
    '2026-11-26',
    '2026-12-25',
  ]);
  expect(parseClosedDates(undefined)).toEqual([]);
  expect(parseClosedDates('not json')).toEqual([]);
});

it('lists the closed days, adds one and removes one', async () => {
  render(<SettingsClosedDates practiceId={1} />);
  expect(await screen.findByLabelText('Remove 2026-11-26')).toBeInTheDocument();
  expect(screen.getByLabelText('Remove 2026-12-25')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Closed day to add'), { target: { value: '2027-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add closed day' }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put.mock.calls[0]![0]).toBe(1);
  expect(JSON.parse(put.mock.calls[0]![1]['scheduling.closedDates'])).toEqual([
    '2026-11-26',
    '2026-12-25',
    '2027-01-01',
  ]);
  expect(await screen.findByLabelText('Remove 2027-01-01')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Remove 2026-12-25'));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  expect(JSON.parse(put.mock.calls[1]![1]['scheduling.closedDates'])).toEqual([
    '2026-11-26',
    '2027-01-01',
  ]);
  await waitFor(() => expect(screen.queryByLabelText('Remove 2026-12-25')).toBeNull());
});

it('shows an empty state', async () => {
  get.mockResolvedValue({});
  render(<SettingsClosedDates practiceId={1} />);
  expect(await screen.findByText('No closed days.')).toBeInTheDocument();
});

it('starts collapsed with the upcoming count and next closed day', async () => {
  const { container } = render(<SettingsClosedDates practiceId={1} />);
  await screen.findByLabelText('Remove 2026-12-25');
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(summaryText(['2026-12-25'])).toMatch(/^1 upcoming closed day · next .*Dec 25, 2026$/);
  expect(summaryText([])).toBe('No upcoming closed days');
});

it('hides past days until asked', async () => {
  vi.setSystemTime(new Date(2026, 11, 1));
  expect(splitClosedDates(['2026-11-26', '2026-12-01', '2026-12-25'])).toEqual({
    upcoming: ['2026-12-01', '2026-12-25'],
    past: ['2026-11-26'],
  });
  render(<SettingsClosedDates practiceId={1} />);
  expect(await screen.findByLabelText('Remove 2026-12-25')).toBeInTheDocument();
  expect(screen.queryByLabelText('Remove 2026-11-26')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 past day' }));
  expect(screen.getByLabelText('Remove 2026-11-26')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Hide past days' }));
  expect(screen.queryByLabelText('Remove 2026-11-26')).toBeNull();
});
