/**
 * LAB-04 follow-up: the "Which pet is this?" control on an unmatched IDEXX result is shown only to
 * people with `lab_result.enter` (admin logins pass on the server, so they see it too).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const granted = new Set<string>();
let loginRole = 'employee';
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({
    effective: {},
    can: (k: string) => granted.has(k),
    hasRole: () => false,
    isLicensed: false,
    licenseType: null,
  }),
  useCan: (k: string) => granted.has(k),
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));
vi.mock('../api/idexx', async () => {
  const actual = await vi.importActual<typeof import('../api/idexx')>('../api/idexx');
  return { ...actual, assignIdexxResultPatient: vi.fn() };
});
vi.mock('../api/patients', () => ({ searchPatientsStaff: vi.fn(async () => []) }));
// The page's result viewer and order frame pull in pdf.js, which the test runner cannot load; MatchPet uses neither.
vi.mock('../components/idexx/IdexxResultView', () => ({ default: () => null, idexxResultStatusLabel: () => '' }));
vi.mock('../components/idexx/IdexxOrderFrame', () => ({ default: () => null }));

import { MatchPet } from './IdexxResultsPage';

const unmatched = {
  id: 31,
  patientId: null,
  patientName: 'Unknown Cat',
  clientLastName: 'Nobody',
} as never;

describe('LAB-04 assign-patient control', () => {
  beforeEach(() => {
    granted.clear();
    loginRole = 'employee';
  });

  it('is not shown without lab_result.enter', () => {
    granted.add('lab_result.review');
    render(
      <MemoryRouter>
        <MatchPet result={unmatched} onMatched={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Which pet is this?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('is shown with lab_result.enter', () => {
    granted.add('lab_result.enter');
    render(
      <MemoryRouter>
        <MatchPet result={unmatched} onMatched={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Which pet is this?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('is shown to an admin login, which passes the server check', () => {
    loginRole = 'admin';
    render(
      <MemoryRouter>
        <MatchPet result={unmatched} onMatched={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Which pet is this?')).toBeTruthy();
  });
});
