/**
 * SCH-06-3 (docs/test-plans/scheduling-and-routing.md): a double click on the public
 * appointment form's Submit sends one request, even while the zone check is slow.
 *
 * The full form is a 10k-line page that needs a dozen APIs to reach its last step, so the
 * button here runs the same guard (useSubmitOnce) around the same sequence: an awaited zone
 * check, then the POST. The last test checks the form's submit really goes through the guard.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubmitOnce } from '../hooks/useSubmitOnce';

const ZONE_CHECK_MS = 2000;

function SubmitButton({
  zoneCheck,
  post,
}: {
  zoneCheck: () => Promise<boolean>;
  post: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = useSubmitOnce(async () => {
    setSubmitting(true);
    try {
      if (!(await zoneCheck())) return;
      await post();
    } finally {
      setSubmitting(false);
    }
  });
  return (
    <button type="button" onClick={() => void handleSubmit()}>
      {submitting ? 'Submitting...' : 'Submit Appointment Request'}
    </button>
  );
}

describe('SCH-06-3: one click, one request', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one request when Submit is clicked twice during a 2 s zone check', async () => {
    const zoneCheck = vi.fn(
      () => new Promise<boolean>((done) => setTimeout(() => done(true), ZONE_CHECK_MS))
    );
    const post = vi.fn(async () => undefined);
    render(<SubmitButton zoneCheck={zoneCheck} post={post} />);

    const button = screen.getByRole('button', { name: 'Submit Appointment Request' });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ZONE_CHECK_MS + 100);
    });

    expect(zoneCheck).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('allows a new submit after the first one finishes (e.g. after an error)', async () => {
    const zoneCheck = vi.fn(
      () => new Promise<boolean>((done) => setTimeout(() => done(true), ZONE_CHECK_MS))
    );
    const post = vi.fn(async () => undefined);
    render(<SubmitButton zoneCheck={zoneCheck} post={post} />);

    const button = screen.getByRole('button', { name: 'Submit Appointment Request' });
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ZONE_CHECK_MS + 100);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Appointment Request' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ZONE_CHECK_MS + 100);
    });

    expect(post).toHaveBeenCalledTimes(2);
  });

  it('the appointment form submits through the guard, before the zone check', () => {
    const source = readFileSync(resolve(__dirname, 'AppointmentRequestForm.tsx'), 'utf8');
    expect(source).toMatch(/const handleSubmit = useSubmitOnce\(/);
    expect(source).not.toMatch(/const handleSubmit = async/);
    // The zone check runs inside the guarded function, not before it.
    const guarded = source.slice(source.indexOf('const submitAppointmentRequest = async'));
    expect(guarded.indexOf('ensureVisitZoneInService()')).toBeGreaterThan(-1);
    expect(guarded.indexOf('ensureVisitZoneInService()')).toBeLessThan(
      guarded.indexOf("http.post('/public/appointments/form'")
    );
  });
});
