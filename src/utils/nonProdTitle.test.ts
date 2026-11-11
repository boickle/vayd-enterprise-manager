// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { keepNonProdTitlePrefix, withNonProdTitlePrefix } from './nonProdTitle';

describe('nonProdTitle', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('adds the prefix once', () => {
    expect(withNonProdTitlePrefix('Scout')).toBe('TEST · Scout');
    expect(withNonProdTitlePrefix('TEST · Scout')).toBe('TEST · Scout');
  });

  it('keeps the prefix when a page sets its own title, and removes it when stopped', async () => {
    document.title = 'VAYD Enterprise Manager';
    stop = keepNonProdTitlePrefix();
    expect(document.title).toBe('TEST · VAYD Enterprise Manager');
    document.title = 'Become a One-Team Member';
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe('TEST · Become a One-Team Member');
    stop();
    stop = null;
    expect(document.title).toBe('Become a One-Team Member');
  });
});
