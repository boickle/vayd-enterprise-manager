/**
 * RP-08 (owner decision D3 access): Executives see Marketing without create/edit/send/save buttons;
 * with an individual marketing.manage grant they get them (RP-08-3, frontend part). Admin logins
 * keep every button as before.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'employee' as string, keys: new Set<string>() }));

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ role: state.role, userEmail: 'exec@vayd.test' }),
}));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => state.keys.has(key),
  usePermissions: () => ({ effective: {}, can: (key: string) => state.keys.has(key) }),
}));

const api = vi.hoisted(() => ({
  listEmailCampaigns: vi.fn(),
  fetchAppointmentRequestPromotions: vi.fn(),
  sendEmailCampaignTest: vi.fn(),
}));

vi.mock('../../api/emailCampaigns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/emailCampaigns')>();
  return {
    ...actual,
    listEmailCampaigns: api.listEmailCampaigns,
    sendEmailCampaignTest: api.sendEmailCampaignTest,
    createEmailCampaign: vi.fn(),
    duplicateEmailCampaign: vi.fn(),
    archiveEmailCampaign: vi.fn(),
    deleteEmailCampaign: vi.fn(),
  };
});
vi.mock('../../api/appointmentRequestPromotions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/appointmentRequestPromotions')>();
  return {
    ...actual,
    fetchAppointmentRequestPromotions: api.fetchAppointmentRequestPromotions,
    createAppointmentRequestPromotion: vi.fn(),
    updateAppointmentRequestPromotion: vi.fn(),
  };
});

import EmailCampaignsPage from './EmailCampaignsPage';
import ReviewStep from './ReviewStep';
import AppointmentRequestPromotionsPanel from '../../components/AppointmentRequestPromotionsPanel';
import type { EmailCampaign } from '../../api/emailCampaigns';

const EXECUTIVE = ['marketing.view', 'analytics.view_all', 'report.production'];

const draft = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Fall wellness',
  subject: 'Time for a checkup',
  status: 'draft',
  goal: { type: 'none', windowDays: 30 },
  protections: { petLossWindowDays: 90 },
  spreadMinutes: 0,
  scheduledAt: null,
  sendStartedAt: null,
  sentAt: null,
  canceledAt: null,
  archivedAt: null,
  lastError: null,
  created: '2026-11-01T00:00:00.000Z',
  updated: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  api.listEmailCampaigns.mockResolvedValue([{ ...draft, stats: null, conversions: null }]);
  api.fetchAppointmentRequestPromotions.mockResolvedValue([
    {
      id: 7,
      companyName: 'Acme',
      code: 'ACME',
      linkToken: 'tok',
      discountType: 'description_only',
      description: 'Free trip fee',
      amountOffCents: null,
      percentOff: null,
      isActive: true,
      isDeleted: false,
      expiresAt: null,
      created: '2026-11-01T00:00:00.000Z',
      updated: '2026-11-01T00:00:00.000Z',
    },
  ]);
});

afterEach(() => {
  state.role = 'employee';
  state.keys = new Set();
  vi.clearAllMocks();
});

function as(role: string, keys: string[]) {
  state.role = role;
  state.keys = new Set(keys);
}

function renderCampaigns() {
  return render(
    <MemoryRouter>
      <EmailCampaignsPage />
    </MemoryRouter>
  );
}

function renderReview() {
  return render(<ReviewStepAsEditor />);
}

/** Mirrors EmailCampaignEditorPage: viewOnly is "no marketing.manage and not an admin login". */
function ReviewStepAsEditor() {
  const viewOnly = !(
    state.role === 'admin' ||
    state.role === 'superadmin' ||
    state.keys.has('marketing.manage')
  );
  return (
    <ReviewStep
      campaign={draft as unknown as EmailCampaign}
      options={{ isProduction: true, sendingEnabled: true } as never}
      summary={null}
      checks={[]}
      busy={false}
      viewOnly={viewOnly}
      onFlush={async () => true}
      onSpreadChange={() => undefined}
      onSchedule={async () => undefined}
      onCancel={async () => undefined}
    />
  );
}

describe('Email campaigns', () => {
  it('Executive sees the campaigns with no New campaign, Duplicate or actions buttons', async () => {
    as('employee', EXECUTIVE);
    renderCampaigns();
    expect(await screen.findByText('Fall wellness')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Email campaigns' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new campaign/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
    expect(screen.queryByLabelText('Duplicate')).toBeNull();
  });

  it('Executive with an individual marketing.manage grant gets them', async () => {
    as('employee', [...EXECUTIVE, 'marketing.manage']);
    renderCampaigns();
    expect(await screen.findByText('Fall wellness')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new campaign/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
  });

  it('admin login keeps them, with no staff keys', async () => {
    as('admin', []);
    renderCampaigns();
    expect(await screen.findByText('Fall wellness')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new campaign/i })).toBeInTheDocument();
  });

  it('Review step: Executive sees no Send test, Schedule or Send now', () => {
    as('employee', EXECUTIVE);
    renderReview();
    expect(screen.queryByRole('button', { name: /send test/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^schedule$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /send now/i })).toBeNull();
    expect(screen.getByText(/view only/i)).toBeInTheDocument();
    expect(api.sendEmailCampaignTest).not.toHaveBeenCalled();
  });

  it('Review step: with marketing.manage the send controls are there', () => {
    as('employee', [...EXECUTIVE, 'marketing.manage']);
    renderReview();
    expect(screen.getByRole('button', { name: /send test/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^schedule$/i })).toBeInTheDocument();
  });
});

describe('Appointment Request Promotions', () => {
  it('Executive sees the list with no New promotion, Edit, Deactivate or Archive', async () => {
    as('employee', EXECUTIVE);
    render(<AppointmentRequestPromotionsPanel />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new promotion/i })).toBeNull();
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(screen.queryByLabelText('Deactivate')).toBeNull();
    expect(screen.queryByLabelText('Archive')).toBeNull();
  });

  it('marketing.manage (Practice Manager, or one granted exec) can edit', async () => {
    as('employee', [...EXECUTIVE, 'marketing.manage']);
    render(<AppointmentRequestPromotionsPanel />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new promotion/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Edit')).toBeInTheDocument();
  });

  it('store.coupon.manage still edits, as before', async () => {
    as('employee', ['store.coupon.manage']);
    render(<AppointmentRequestPromotionsPanel />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new promotion/i })).toBeInTheDocument();
  });
});
