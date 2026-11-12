/**
 * Owner decisions, Nov 11, 2026:
 *  - Send from starts on the visit's or primary doctor's own Quo line (else the line the family
 *    last texted with) and names whose line it is.
 *  - Practice managers see Survey Results (survey.results.view), not only admins.
 *  - Settings → Communication → Calls: "Call dock starts on", admin logins only.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { visibleAnalyticsTabs } from '../../analytics-tabs';
import { allowedSettingsTabs } from '../../permissions/settingsTabAccess';

const preferred = vi.hoisted(() => ({
  value: { phone: null, providerName: null, source: null } as {
    phone: string | null;
    providerName: string | null;
    source: 'appointment' | 'patient' | 'client' | null;
  },
}));
const history = vi.hoisted(() => ({ messages: [] as Array<Record<string, unknown>> }));
const settings = vi.hoisted(() => ({
  get: vi.fn(async () => ({ 'calls.dockStartsOn': '2026-12-01' })),
  put: vi.fn(async () => ({})),
}));

vi.mock('../../api/clientSms', async (orig) => ({
  ...(await orig<typeof import('../../api/clientSms')>()),
  fetchPreferredSmsFrom: vi.fn(async () => preferred.value),
  sendClientSms: vi.fn(),
}));
vi.mock('../../utils/clientMessagesCache', () => ({
  fetchClientMessagesCached: vi.fn(async () => history.messages),
  getCachedClientMessages: () => null,
}));
vi.mock('../../api/clientsStaff', () => ({ fetchClientByIdStaff: vi.fn(async () => ({})) }));
vi.mock('../../hooks/useOpenPhoneLineDirectory', async (orig) => ({
  ...(await orig<typeof import('../../hooks/useOpenPhoneLineDirectory')>()),
  useOpenPhoneLineDirectory: () => ({
    directory: new Map(),
    lines: [
      { phone: '+12075550103', name: 'Field team' },
      { phone: '+12075550100', name: 'VAYD Main' },
      { phone: '+12075550111', name: 'Dr. Lloyd' },
    ],
  }),
}));
vi.mock('../messageTemplates/MessageTemplatePicker', () => ({ default: () => null }));
vi.mock('../../api/practiceSettings', async (orig) => ({
  ...(await orig<typeof import('../../api/practiceSettings')>()),
  getPracticeSettings: settings.get,
  updatePracticeSettings: settings.put,
}));

import { ClientSmsWorkspaceModal } from './ClientSmsWorkspaceModal';
import SettingsCallDock from '../settings/SettingsCallDock';

const openSms = () =>
  render(
    <ClientSmsWorkspaceModal
      open
      clientId={7}
      clientLabel="Maria Rivera"
      phones={[{ label: 'Mobile', phone: '+12075550101', sms: true }]}
      pets={[{ id: 3, name: 'Maple' }]}
      defaultPatientIds={[3]}
      onClose={() => undefined}
    />
  );
const fromSelect = () => screen.findByRole('combobox', { name: /Send from/i });

describe('Send from', () => {
  beforeEach(() => {
    history.messages = [];
  });

  it('starts on the primary doctor’s own Quo line and says whose it is', async () => {
    preferred.value = { phone: '(207) 555-0111', providerName: 'Hailey Lloyd', source: 'patient' };
    openSms();
    await waitFor(async () => expect(((await fromSelect()) as HTMLSelectElement).value).toBe('+12075550111'));
    expect(screen.getByTestId('send-from-provider').textContent).toBe("Hailey Lloyd's line (primary doctor)");
  });

  it('names the visit’s doctor when the line comes from the visit', async () => {
    preferred.value = { phone: '+12075550111', providerName: 'Hailey Lloyd', source: 'appointment' };
    openSms();
    expect(await screen.findByTestId('send-from-provider')).toHaveTextContent(
      "Hailey Lloyd's line (the visit's doctor)"
    );
  });

  it('falls back to the first line when the doctor has no Quo line, with no note', async () => {
    preferred.value = { phone: null, providerName: null, source: null };
    openSms();
    await waitFor(async () => expect(((await fromSelect()) as HTMLSelectElement).value).toBe('+12075550103'));
    expect(screen.queryByTestId('send-from-provider')).toBeNull();
  });

  it('still lets staff pick another line', async () => {
    preferred.value = { phone: '+12075550111', providerName: 'Hailey Lloyd', source: 'client' };
    openSms();
    const select = (await fromSelect()) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('+12075550111'));
    fireEvent.change(select, { target: { value: '+12075550100' } });
    expect(select.value).toBe('+12075550100');
    expect(screen.queryByTestId('send-from-provider')).toBeNull();
  });
});

describe('Survey Results for practice managers', () => {
  it('shows Survey Results to staff holding survey.results.view, not to others', () => {
    const paths = (keys: string[]) =>
      visibleAnalyticsTabs(['employee'], false, (k) => keys.includes(k)).map((t) => t.path);
    expect(paths(['survey.results.view'])).toContain('survey-results');
    expect(paths(['report.communication'])).not.toContain('survey-results');
    expect(paths(['report.communication'])).toContain('email-tracking');
  });
});

describe('Settings → Communication → Calls', () => {
  it('is for admin logins only', () => {
    expect(allowedSettingsTabs({ isAdminLogin: true, can: () => false, hasRole: () => false })).toContain('call-dock');
    expect(
      allowedSettingsTabs({ isAdminLogin: false, can: () => true, hasRole: () => true })
    ).not.toContain('call-dock');
  });

  it('shows the saved date, saves a new one, and clears it', async () => {
    const onMessage = vi.fn();
    render(<SettingsCallDock practiceId={1} onMessage={onMessage} />);
    const input = (await screen.findByLabelText('Call dock starts on')) as HTMLInputElement;
    expect(input.value).toBe('2026-12-01');
    fireEvent.change(input, { target: { value: '2026-12-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(settings.put).toHaveBeenCalledWith(1, { 'calls.dockStartsOn': '2026-12-08' }));
    expect(onMessage).toHaveBeenCalledWith('Call dock start date saved.', 'success');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(settings.put).toHaveBeenLastCalledWith(1, { 'calls.dockStartsOn': '' }));
  });
});
