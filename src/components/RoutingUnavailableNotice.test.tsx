import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RoutingUnavailableNotice, {
  ROUTING_UNAVAILABLE_ONLINE_MESSAGE,
} from './RoutingUnavailableNotice';

describe('RoutingUnavailableNotice (SCH-A3)', () => {
  it('tells the client to call or text, not "no times"', () => {
    render(<RoutingUnavailableNotice />);
    expect(screen.getByRole('alert').textContent).toBe(
      "Online booking is unavailable right now. Please call or text us at (207) 536-8387 and we'll find you a time."
    );
    expect(ROUTING_UNAVAILABLE_ONLINE_MESSAGE).not.toMatch(/no times/i);
  });
});
