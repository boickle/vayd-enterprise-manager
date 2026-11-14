/** SCH-A14: practice closed days can be viewed, added and removed (Settings → Scheduling → Manage Closed Days). */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsClosedDates, { parseClosedDates, splitClosedDates } from './SettingsClosedDates';

const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('../../api/practiceSettings', () => ({
  getPracticeSettings: (...a: unknown[]) => get(...a),
  updatePracticeSettings: (...a: unknown[]) => put(...a),
}));
const counts = vi.hoisted(() => vi.fn());
const closeStaff = vi.hoisted(() => vi.fn());
const reopenStaff = vi.hoisted(() => vi.fn());
vi.mock('../../api/closedDays', () => ({
  listClosedDayStaffCounts: (...a: unknown[]) => counts(...a),
  closeStaffSchedules: (...a: unknown[]) => closeStaff(...a),
  reopenStaffSchedules: (...a: unknown[]) => reopenStaff(...a),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 1));
  get.mockReset().mockResolvedValue({ 'scheduling.closedDates': '["2026-12-25","2026-11-26"]' });
  put.mockReset().mockImplementation(async (_id: number, s: Record<string, string>) => s);
  counts.mockReset().mockResolvedValue([]);
  closeStaff.mockReset();
  reopenStaff.mockReset();
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

it('without schedule permission, adds a day for online booking only (no checkbox)', async () => {
  render(<SettingsClosedDates practiceId={1} />);
  await screen.findByLabelText('Remove 2026-11-26');
  expect(screen.queryByLabelText('Also give all staff the day off')).toBeNull();
  fireEvent.change(screen.getByLabelText('Closed day to add'), { target: { value: '2027-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add closed day' }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(closeStaff).not.toHaveBeenCalled();
});

it('also gives all staff the day off, and lists who kept custom hours', async () => {
  closeStaff.mockResolvedValue({
    date: '2027-01-01',
    markedOff: 11,
    alreadyOff: 1,
    skipped: [{ employeeId: 7, name: 'Bo Ng', workStartLocal: '09:00', workEndLocal: '13:00' }],
  });
  counts.mockResolvedValueOnce([]).mockResolvedValue([{ date: '2027-01-01', staffOff: 11 }]);
  const onMessage = vi.fn();
  render(<SettingsClosedDates practiceId={1} canCloseSchedules onMessage={onMessage} />);
  await screen.findByLabelText('Remove 2026-11-26');
  expect(screen.getByLabelText('Also give all staff the day off')).toBeChecked();
  fireEvent.change(screen.getByLabelText('Closed day to add'), { target: { value: '2027-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add closed day' }));
  await waitFor(() => expect(closeStaff).toHaveBeenCalledWith('2027-01-01'));
  await waitFor(() =>
    expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining(
        '11 staff given the day off, 1 already off, 1 kept their custom hours'
      ),
      'success'
    )
  );
  expect(screen.getByText(/Bo Ng · 09:00–13:00/)).toBeInTheDocument();
  expect(await screen.findByText('Online booking · 11 staff days off')).toBeInTheDocument();
});

it('removing a closed day also removes the staff days off it added', async () => {
  counts.mockResolvedValue([{ date: '2026-11-26', staffOff: 12 }]);
  reopenStaff.mockResolvedValue({ date: '2026-11-26', reopened: 12 });
  const onMessage = vi.fn();
  render(<SettingsClosedDates practiceId={1} canCloseSchedules onMessage={onMessage} />);
  expect(await screen.findByText('Online booking · 12 staff days off')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Remove 2026-11-26'));
  await waitFor(() => expect(reopenStaff).toHaveBeenCalledWith('2026-11-26'));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(JSON.parse(put.mock.calls[0]![1]['scheduling.closedDates'])).toEqual(['2026-12-25']);
  await waitFor(() =>
    expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining('12 staff days off removed'),
      'success'
    )
  );
});

it('an existing online-only closed day can give all staff the day off later', async () => {
  closeStaff.mockResolvedValue({ date: '2026-12-25', markedOff: 12, alreadyOff: 0, skipped: [] });
  render(<SettingsClosedDates practiceId={1} canCloseSchedules />);
  fireEvent.click(await screen.findByLabelText('Give all staff 2026-12-25 off'));
  await waitFor(() => expect(closeStaff).toHaveBeenCalledWith('2026-12-25'));
  expect(put).not.toHaveBeenCalled();
});
