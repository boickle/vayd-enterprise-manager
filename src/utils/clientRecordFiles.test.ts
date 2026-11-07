import { describe, expect, it } from 'vitest';
import {
  type ClientRecordFileCheck,
  clientRecordCheckTokens,
  clientRecordsVerified,
  petsMissingQualifyingRecords,
} from './clientRecordFiles';

const file = (formPetId: string, check: ClientRecordFileCheck) => ({ formPetId, check });
const qualifies = (token: string): ClientRecordFileCheck => ({
  state: 'qualifies',
  token,
  message: 'ok',
});

describe('client record checks', () => {
  it('sends tokens for kept files only', () => {
    expect(
      clientRecordCheckTokens([
        file('a', qualifies('t1')),
        file('a', { state: 'accepted', token: 't2', message: 'page 2' }),
        file('a', { state: 'rejected', message: 'invoice' }),
        file('a', { state: 'checking' }),
      ]),
    ).toEqual(['t1', 't2']);
  });

  it('opens earlier booking only when every new pet qualifies', () => {
    const files = [file('a', qualifies('t1')), file('b', { state: 'accepted', token: 't2', message: '' })];
    expect(clientRecordsVerified(files, ['a'])).toBe(true);
    expect(clientRecordsVerified(files, ['a', 'b'])).toBe(false);
    expect(petsMissingQualifyingRecords(files, ['a', 'b'])).toEqual(['b']);
  });

  it('needs at least one qualifying file', () => {
    expect(clientRecordsVerified([], [])).toBe(false);
    expect(clientRecordsVerified([file('a', { state: 'rejected', message: '' })], [])).toBe(false);
  });
});
