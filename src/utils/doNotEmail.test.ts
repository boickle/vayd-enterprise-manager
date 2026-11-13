import { describe, expect, it } from 'vitest';
import { clientHasDoNotEmail, doNotEmailMessage, toLineHitsClient } from './doNotEmail';

describe('doNotEmail (CP-T5)', () => {
  const maria = { firstName: 'Maria', email: 'Maria.Rivera@example.com', secondEmail: 'daniel@example.com', doNotEmail: true };

  it('reads the flag', () => {
    expect(clientHasDoNotEmail(maria)).toBe(true);
    expect(clientHasDoNotEmail({ doNotEmail: false })).toBe(false);
    expect(clientHasDoNotEmail(null)).toBe(false);
  });

  it('blocks only the client’s own addresses, any case, in a list', () => {
    expect(toLineHitsClient('maria.rivera@example.com', maria)).toBe(true);
    expect(toLineHitsClient('vet@otherclinic.com, DANIEL@example.com', maria)).toBe(true);
    expect(toLineHitsClient('vet@otherclinic.com', maria)).toBe(false);
  });

  it('says what to do', () => {
    expect(doNotEmailMessage('Maria Rivera')).toBe(
      'Maria Rivera has "Do not email" on, so Scout won\'t email them. Call or text instead. ' +
        'If they ask for email again, clear "Do not email" on the client page.',
    );
    expect(doNotEmailMessage(null)).toMatch(/^This client has/);
  });
});
