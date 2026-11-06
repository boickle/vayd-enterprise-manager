import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OfflineBanner, { OFFLINE_BANNER_TEXT } from './OfflineBanner';
import { resetNetworkStatusForTests } from '../api/http';

afterEach(() => resetNetworkStatusForTests());

describe('OfflineBanner (EMR-A10)', () => {
  it('shows when the browser goes offline and clears when it is back', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('offline-banner').textContent).toBe(OFFLINE_BANNER_TEXT);
    expect(OFFLINE_BANNER_TEXT).toContain('Offline — not saved.');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});
