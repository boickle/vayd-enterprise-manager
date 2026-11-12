/**
 * PAY-A8 (owner decision D3): screens hide the money controls the server now refuses.
 * Void a deposit, payment types, bank accounts and promotions are for practice managers and admins;
 * the bank deposit page is for people who may create a deposit.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const granted = new Set<string>();
let loginRole = 'employee';
vi.mock('../permissions/PermissionContext', () => ({
  useCan: (key: string) => granted.has(key),
  useScope: () => 'none',
  usePermissions: () => ({ effective: {}, can: (k: string) => granted.has(k) }),
  PermissionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));

const deposit = {
  id: 'd1', practiceId: 1, status: 'posted', bankAccountId: 1, bankName: 'Test Bank',
  bankAccountNumber: '0000', total: 10, lineCount: 0, createdByEmployeeId: null, createdByLabel: null,
  postedAt: '2026-11-01T00:00:00Z', voidedAt: null, voidReason: null, note: null,
  created: '2026-11-01T00:00:00Z', lines: [],
};
vi.mock('../api/deposits', () => ({
  listDeposits: vi.fn(async () => [deposit]),
  listUndepositedTenders: vi.fn(async () => []),
  createDeposit: vi.fn(),
  voidDeposit: vi.fn(),
}));
vi.mock('../api/depositBankAccounts', () => ({
  listDepositBankAccounts: vi.fn(async () => [
    { id: 1, practiceId: 1, name: 'Test Bank', accountNumber: '0000', isActive: true, sortOrder: 0 },
  ]),
  createDepositBankAccount: vi.fn(),
  patchDepositBankAccount: vi.fn(),
}));
vi.mock('../api/employee', () => ({ fetchPrimaryProviders: vi.fn(async () => []) }));
vi.mock('../api/paymentTypes', () => ({
  PAYMENT_OPTION_TYPES: ['cash', 'other'],
  PAYMENT_OPTION_TYPE_LABELS: { cash: 'Cash', other: 'Other' },
  listPaymentTypes: vi.fn(async () => [
    { id: 1, practiceId: 1, name: 'Petty drawer', optionType: 'cash', isDefault: true, isDiscountCategory: false,
      discountPercent: 0, excludeFromIncome: false, getsDeposited: true, isActive: true },
  ]),
  createPaymentType: vi.fn(),
  patchPaymentType: vi.fn(),
}));
vi.mock('../api/payments', () => ({
  fetchMembershipDiscounts: vi.fn(async () => [
    { id: 'm1', name: 'Spring', code: 'SPRING', active: true, archived: false, linkToken: null,
      createdAt: '2026-11-01T00:00:00Z', expiresAt: null, maxRedemptions: null, redemptions: 0 },
  ]),
  createMembershipDiscount: vi.fn(),
  createMembershipDiscountLink: vi.fn(),
  updateMembershipDiscount: vi.fn(),
}));

import BankDepositsPage from './BankDepositsPage';
import SettingsPaymentTypes from '../components/settings/SettingsPaymentTypes';
import SettingsDepositBankAccounts from '../components/settings/SettingsDepositBankAccounts';
import MembershipStripeDiscountsPanel from '../components/MembershipStripeDiscountsPanel';

afterEach(() => {
  granted.clear();
  loginRole = 'employee';
});

describe('PAY-A8 bank deposits page', () => {
  it('a technician (can create, cannot void) sees the page but no Void button', async () => {
    granted.add('deposit.create');
    render(<BankDepositsPage />);
    await screen.findByText('Test Bank', { selector: 'td' }).catch(() => undefined);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /^slip$/i }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /^void$/i })).toBeNull();
  });

  it('a practice manager sees Void', async () => {
    granted.add('deposit.create');
    granted.add('deposit.void');
    render(<BankDepositsPage />);
    expect(await screen.findByRole('button', { name: /^void$/i })).toBeTruthy();
  });

  it('a client liaison (no deposit.create) is told the page is not part of their access', () => {
    render(<BankDepositsPage />);
    expect(screen.getByText(/isn’t part of your access/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /create deposit/i })).toBeNull();
  });
});

describe('PAY-A8 payment types and bank accounts', () => {
  it('hides add and edit for non-managers, shows them for payment_type.manage', async () => {
    const { unmount } = render(<SettingsPaymentTypes />);
    await screen.findByText('Petty drawer');
    expect(screen.queryByRole('button', { name: /add a payment option/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    unmount();
    granted.add('payment_type.manage');
    render(<SettingsPaymentTypes />);
    await screen.findByText('Petty drawer');
    expect(screen.getByRole('button', { name: /add a payment option/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
  });

  it('hides add and edit bank account for non-managers, shows them for deposit_account.manage', async () => {
    const { unmount } = render(<SettingsDepositBankAccounts />);
    await screen.findByText('Test Bank');
    expect(screen.queryByRole('button', { name: /add bank account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    unmount();
    granted.add('deposit_account.manage');
    render(<SettingsDepositBankAccounts />);
    await screen.findByText('Test Bank');
    expect(screen.getByRole('button', { name: /add bank account/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
  });

  it('an admin login with no staff role still sees the controls (the server lets admin logins through)', async () => {
    loginRole = 'admin';
    render(<SettingsPaymentTypes />);
    await screen.findByText('Petty drawer');
    expect(screen.getByRole('button', { name: /add a payment option/i })).toBeTruthy();
  });
});

describe('PAY-A8 membership promotions', () => {
  it('non-managers cannot create, edit, pause or archive; managers can', async () => {
    const { unmount } = render(<MembershipStripeDiscountsPanel />);
    await screen.findByText('SPRING');
    expect(screen.queryByRole('button', { name: /new promotion/i })).toBeNull();
    expect(screen.queryByLabelText(/^edit$/i)).toBeNull();
    expect(screen.queryByLabelText(/^archive$/i)).toBeNull();
    unmount();
    granted.add('payment_type.manage');
    render(<MembershipStripeDiscountsPanel />);
    await screen.findByText('SPRING');
    expect(screen.getByRole('button', { name: /new promotion/i })).toBeTruthy();
    expect(screen.getByLabelText(/^edit$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^archive$/i)).toBeTruthy();
  });
});
