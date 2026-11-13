/**
 * EMR-07-8 (owner decision D2, Nov 2, 2026): the Sign & lock control follows who may sign.
 * A full SOAP: licensed veterinarian only. A quick visit: a vet or a licensed technician.
 * A medical note: anyone on staff (owner, Nov 12, 2026). Anyone else sees the control disabled
 * (or a note) with the reason.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignAndLockButton, { SignOffNotice } from './SignOffGate';
import type { EffectivePermissions } from '../../api/permissions';

type Who = 'liaison' | 'tech' | 'unlicensedTech' | 'vet' | 'superadmin' | 'observer';

const PEOPLE: Record<Who, Pick<EffectivePermissions, 'roles' | 'isLicensed' | 'licenseType' | 'isPlatformAdmin' | 'permissions'>> = {
  // A client liaison holds no record.sign; neither does an unlicensed tech (the licence gate drops it).
  liaison: { roles: ['client_liaison'], isLicensed: false, licenseType: null, isPlatformAdmin: false, permissions: {} },
  unlicensedTech: { roles: ['technician'], isLicensed: false, licenseType: null, isPlatformAdmin: false, permissions: {} },
  tech: { roles: ['technician'], isLicensed: true, licenseType: 'technician', isPlatformAdmin: false, permissions: { 'record.sign': 'all' } },
  vet: { roles: ['veterinarian'], isLicensed: true, licenseType: 'veterinarian', isPlatformAdmin: false, permissions: { 'record.sign': 'all' } },
  superadmin: { roles: [], isLicensed: true, licenseType: null, isPlatformAdmin: true, permissions: { 'record.sign': 'all' } },
  observer: { roles: ['observer'], isLicensed: false, licenseType: null, isPlatformAdmin: false, permissions: {} },
};

let who: Who | null = 'vet';
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => {
    if (!who) {
      return { effective: null, can: () => false, isLicensed: false, licenseType: null };
    }
    const p = PEOPLE[who];
    return {
      effective: { employeeId: 1, sources: {}, ...p },
      can: (key: string) => Boolean(p.permissions[key]),
      isLicensed: p.isLicensed,
      licenseType: p.licenseType,
    };
  },
}));

const onClick = vi.fn();
const renderButton = (modes: Array<'comprehensive' | 'quick' | 'medical_note' | undefined>) =>
  render(
    <SignAndLockButton
      modes={modes}
      notReadyReason={null}
      readyTitle="Sign and lock the medical record for every pet on this visit"
      completing={false}
      onClick={onClick}
    />,
  );
const signButton = () => screen.getByRole('button', { name: /Sign & lock SOAP/ });

beforeEach(() => {
  onClick.mockReset();
  who = 'vet';
});

describe('EMR-07-8: Sign & lock by role', () => {
  it('a client liaison sees Sign & lock disabled, with the reason', () => {
    who = 'liaison';
    renderButton(['comprehensive']);
    expect(signButton()).toBeDisabled();
    expect(signButton()).toHaveAttribute('title', 'Only a licensed veterinarian can sign and lock a SOAP.');
    expect(screen.getByRole('note')).toHaveTextContent('Only a licensed veterinarian can sign and lock a SOAP.');
    fireEvent.click(signButton());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a licensed technician cannot sign a full SOAP', () => {
    who = 'tech';
    renderButton(['comprehensive']);
    expect(signButton()).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(/licensed veterinarian/);
  });

  it('a veterinarian can sign: enabled, no note', () => {
    who = 'vet';
    renderButton(['comprehensive']);
    expect(signButton()).toBeEnabled();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(signButton());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a licensed technician can sign a quick visit or a medical note; an unlicensed tech cannot', () => {
    who = 'tech';
    const { unmount } = renderButton(['quick', 'medical_note']);
    expect(signButton()).toBeEnabled();
    unmount();

    who = 'unlicensedTech';
    renderButton(['quick']);
    expect(signButton()).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Only a licensed veterinarian or licensed technician can sign this record.',
    );
  });

  it('anyone on staff can sign a medical note: a client liaison and an unlicensed tech (owner, Nov 12, 2026)', () => {
    who = 'liaison';
    const { unmount } = renderButton(['medical_note']);
    expect(signButton()).toBeEnabled();
    expect(screen.queryByRole('note')).toBeNull();
    unmount();

    who = 'unlicensedTech';
    const second = renderButton(['medical_note']);
    expect(signButton()).toBeEnabled();
    second.unmount();

    who = 'liaison';
    renderButton(['quick', 'medical_note']);
    expect(signButton()).toBeDisabled();
  });

  it('a read-only observer cannot sign a medical note', () => {
    who = 'observer';
    renderButton(['medical_note']);
    expect(signButton()).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Only staff of this practice can sign a medical note.');
  });

  it('a household with one full SOAP still needs a vet, even for a licensed tech', () => {
    who = 'tech';
    renderButton(['quick', 'comprehensive']);
    expect(signButton()).toBeDisabled();
  });

  it('an older server that sends no record type counts as a full SOAP', () => {
    who = 'tech';
    renderButton([undefined]);
    expect(signButton()).toBeDisabled();
  });

  it('a platform superadmin passes, as with every other permission', () => {
    who = 'superadmin';
    renderButton(['comprehensive']);
    expect(signButton()).toBeEnabled();
  });

  it('before permissions load the button is not hidden (the server decides)', () => {
    who = null;
    renderButton(['comprehensive']);
    expect(signButton()).toBeEnabled();
  });
});

describe('EMR-07-8: the SOAP page note', () => {
  it.each<[Who, boolean]>([
    ['liaison', true],
    ['tech', true],
    ['vet', false],
  ])('as %s: notice shown = %s', (person, shown) => {
    who = person;
    render(<SignOffNotice mode="comprehensive" />);
    if (shown) {
      expect(screen.getByTestId('sign-off-notice')).toHaveTextContent('Only a licensed veterinarian can sign and lock a SOAP.');
    } else {
      expect(screen.queryByTestId('sign-off-notice')).toBeNull();
    }
  });
});
