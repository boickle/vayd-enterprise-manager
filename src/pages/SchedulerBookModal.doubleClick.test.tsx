/**
 * SCH-A12 (docs/test-plans/scheduling-and-routing.md, SCH-A12-1): a double click on Book
 * creates one appointment, even while the alternate-address and household checks are slow.
 *
 * SchedulerBookModal is ~4,700 lines and needs a dozen APIs to reach its submit, so the
 * behaviour tests use a harness that runs the same order as handleSubmit: the in-flight
 * guard (useSubmitOnce) first, then the awaited checks, then createAppointment. The last
 * test checks the real modal submits through that guard before its first await.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubmitOnce } from '../hooks/useSubmitOnce';

const CHECK_MS = 2000;

type HarnessProps = {
  isReady: () => boolean;
  checkAlternateAddress: () => Promise<void>;
  checkHousehold: () => Promise<void>;
  createAppointment: () => Promise<void>;
};

function BookHarness({
  isReady,
  checkAlternateAddress,
  checkHousehold,
  createAppointment,
}: HarnessProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const submitBookOnce = useSubmitOnce(async () => {
    setFormError(null);
    if (!isReady()) {
      setFormError('Select a provider.');
      return;
    }
    await checkAlternateAddress();
    await checkHousehold();
    try {
      await createAppointment();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Booking failed.');
    }
  });
  return (
    <>
      <button type="button" onClick={() => void submitBookOnce()}>
        Book
      </button>
      {formError ? <p role="alert">{formError}</p> : null}
    </>
  );
}

const slow = () => new Promise<void>((done) => setTimeout(done, CHECK_MS));

describe('SCH-A12: double click on Book books once', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('SCH-A12-1: two clicks on Book with a slow alternate-address check create one appointment', async () => {
    const checkAlternateAddress = vi.fn(slow);
    const checkHousehold = vi.fn(slow);
    const createAppointment = vi.fn(async () => undefined);
    render(
      <BookHarness
        isReady={() => true}
        checkAlternateAddress={checkAlternateAddress}
        checkHousehold={checkHousehold}
        createAppointment={createAppointment}
      />
    );

    const button = screen.getByRole('button', { name: 'Book' });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS * 2 + 100);
    });

    expect(checkAlternateAddress).toHaveBeenCalledTimes(1);
    expect(createAppointment).toHaveBeenCalledTimes(1);
  });

  it('after a validation failure the user can submit again', async () => {
    let ready = false;
    const createAppointment = vi.fn(async () => undefined);
    render(
      <BookHarness
        isReady={() => ready}
        checkAlternateAddress={async () => undefined}
        checkHousehold={async () => undefined}
        createAppointment={createAppointment}
      />
    );

    const button = screen.getByRole('button', { name: 'Book' });
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByRole('alert').textContent).toBe('Select a provider.');
    expect(createAppointment).not.toHaveBeenCalled();

    ready = true;
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(createAppointment).toHaveBeenCalledTimes(1);
  });

  it('after a failed create the user can submit again', async () => {
    const createAppointment = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValueOnce(undefined);
    render(
      <BookHarness
        isReady={() => true}
        checkAlternateAddress={async () => undefined}
        checkHousehold={async () => undefined}
        createAppointment={createAppointment}
      />
    );

    const button = screen.getByRole('button', { name: 'Book' });
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(createAppointment).toHaveBeenCalledTimes(2);
  });

  it('the modal submits through the in-flight guard before its first await', () => {
    const source = readFileSync(resolve(__dirname, 'SchedulerBookModal.tsx'), 'utf8');
    expect(source).toMatch(/const submitBookOnce = useSubmitOnce\(submitBook\)/);
    const handleSubmit = source.slice(
      source.indexOf('async function handleSubmit('),
      source.indexOf('async function submitBook(')
    );
    expect(handleSubmit).toMatch(/await submitBookOnce\(\)/);
    // The only await in handleSubmit is the guarded call, so nothing awaits before the guard is set.
    expect(handleSubmit.match(/\bawait\b/g)).toHaveLength(1);
  });
});
