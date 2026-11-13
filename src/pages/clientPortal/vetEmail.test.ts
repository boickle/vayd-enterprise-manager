import { describe, expect, it } from 'vitest';
import { vetEmail } from './portalShared';

describe('vetEmail (portal "Email your vet")', () => {
  it("uses the doctor's own email", () => {
    expect(vetEmail({ email: 'avery.lane@vetatyourdoor.com' })).toBe('avery.lane@vetatyourdoor.com');
  });
  it('falls back to the practice inbox, never a guess from the name', () => {
    expect(vetEmail(null)).toBe('info@vetatyourdoor.com');
    expect(vetEmail({ email: null })).toBe('info@vetatyourdoor.com');
    expect(vetEmail({ email: '  ' })).toBe('info@vetatyourdoor.com');
  });
});
