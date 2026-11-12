/** Appointments step 3: unread client replies, red for mine or unassigned, blue for others (owner, Nov 11, 2026). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReplyBadges } from './ReplyBadges';
import { replyTimeLabel } from '../../utils/appointmentRequestTableRow';

describe('ReplyBadges', () => {
  it('shows nothing with no unread replies', () => {
    const { container } = render(<ReplyBadges mine={0} others={0} />);
    expect(container.textContent).toBe('');
  });

  it('shows a red count for mine and a blue count for others', () => {
    render(<ReplyBadges mine={2} others={150} />);
    const mine = screen.getByLabelText('2 with unread replies for you');
    const others = screen.getByLabelText('150 with unread replies for others');
    expect(mine.className).toContain('appt-reply-badge--mine');
    expect(others.className).toContain('appt-reply-badge--others');
    expect(others.textContent).toBe('99+');
  });
});

describe('replyTimeLabel', () => {
  const now = new Date('2026-11-11T19:00:00Z');
  it('shows the time for a reply today and the date before that', () => {
    expect(replyTimeLabel('2026-11-11T18:14:00Z', 'America/New_York', now)).toBe('1:14 PM');
    expect(replyTimeLabel('2026-11-09T18:14:00Z', 'America/New_York', now)).toBe('Nov 9');
    expect(replyTimeLabel(null, 'America/New_York', now)).toBe('');
  });
});
