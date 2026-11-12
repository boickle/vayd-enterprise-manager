import { describe, expect, it } from 'vitest';
import { historyHeadline, historyLines, staffNoteAuditLines } from './appointmentHistoryFormat';

const tz = 'America/New_York';
const ch = (field: string, label: string, from: string | null, to: string | null) => ({
  field,
  label,
  from,
  to,
});

describe('appointment History lines', () => {
  it('a move to another day and time reads as one Date & time line', () => {
    const lines = historyLines(
      [
        ch('appointmentStart', 'Start', '2026-09-22T14:00:00Z', '2026-09-23T15:55:00Z'),
        ch('appointmentEnd', 'End', '2026-09-22T14:45:00Z', '2026-09-23T16:40:00Z'),
        ch('primaryProvider', 'Provider', 'Heather Crispell', 'Abigail Messina'),
      ],
      tz
    );
    expect(lines).toEqual([
      {
        label: 'Date & time',
        from: 'Tue 9/22 10:00 AM–10:45 AM',
        to: 'Wed 9/23 11:55 AM–12:40 PM',
      },
      { label: 'Provider', from: 'Heather Crispell', to: 'Abigail Messina', long: false },
    ]);
  });

  it('names a same-day move "Time" and a same-time move "Date"', () => {
    expect(
      historyLines(
        [ch('appointmentStart', 'Start', '2026-09-22T14:00:00Z', '2026-09-22T17:00:00Z')],
        tz
      )[0].label
    ).toBe('Time');
    expect(
      historyLines(
        [ch('appointmentStart', 'Start', '2026-09-22T14:00:00Z', '2026-09-25T14:00:00Z')],
        tz
      )[0].label
    ).toBe('Date');
  });

  it('a longer visit with the same start shows the end time', () => {
    const [line] = historyLines(
      [ch('appointmentEnd', 'End', '2026-09-22T14:45:00Z', '2026-09-22T15:15:00Z')],
      tz
    );
    expect(line).toEqual({ label: 'End time', from: 'Tue 9/22 10:45 AM', to: 'Tue 9/22 11:15 AM' });
  });

  it('says who did it', () => {
    const e = { id: 1, changes: [], note: null, createdAt: '', actorName: 'Morgan Saunders' };
    expect(historyHeadline({ ...e, action: 'created' })).toBe('Booked by Morgan Saunders');
    expect(historyHeadline({ ...e, action: 'updated' })).toBe('Changed by Morgan Saunders');
    expect(historyHeadline({ ...e, action: 'deleted', actorName: null })).toBe(
      'Deleted by Someone'
    );
  });
});

describe('earlier changes from staff notes', () => {
  it('picks out the old audit lines and leaves real notes alone', () => {
    const notes = [
      'Arrive 10:40-12:40 Annual, squinty eye, declines EDP',
      'Edited appt time by taylor on 08/20/2026',
      'Edited appointment description by karen on 09/02/2026',
      'Booked on 09/21/2026 at 9:20 PM by taylor',
      'Rescheduled by morgan on 09/22/2026 from 09/22/2026 at 10:00 AM',
      'Owner says gate code 1234',
    ].join('\n');
    expect(staffNoteAuditLines(notes)).toEqual([
      'Edited appt time by taylor on 08/20/2026',
      'Edited appointment description by karen on 09/02/2026',
      'Booked on 09/21/2026 at 9:20 PM by taylor',
      'Rescheduled by morgan on 09/22/2026 from 09/22/2026 at 10:00 AM',
    ]);
  });
});
