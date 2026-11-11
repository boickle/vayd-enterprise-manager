import { describe, expect, it } from 'vitest';
import { fullSizePhotoUrl } from './snapshotPhotoUrl';

describe('fullSizePhotoUrl', () => {
  it('drops the card size and keeps the access token', () => {
    expect(fullSizePhotoUrl('https://api.example.com/patients/4/images/9/file?t=abc%3D&size=card')).toBe(
      'https://api.example.com/patients/4/images/9/file?t=abc%3D'
    );
  });

  it('leaves a URL without a size alone', () => {
    const src = 'https://api.example.com/patients/4/images/9/file?t=abc';
    expect(fullSizePhotoUrl(src)).toBe(src);
  });
});
