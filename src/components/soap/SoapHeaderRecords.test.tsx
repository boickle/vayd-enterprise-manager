/**
 * Owner request Nov 4, 2026: on the SOAP header the pet name / View details open the active pet's
 * chart in a pop-up over the SOAP, and the client name opens the client record in a pop-up.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import SoapHeaderRecords from './SoapHeaderRecords';

vi.mock('../pims/PimsPatientDetailView', () => ({
  default: (p: { patientId: string; embedded?: boolean }) => (
    <div data-testid="embedded-chart" data-patient={p.patientId} data-embedded={String(!!p.embedded)}>
      chart
    </div>
  ),
}));
vi.mock('../pims/PimsClientDetailView', () => ({
  default: (p: {
    clientId: string;
    embedded?: boolean;
    onOpenPatient?: (id: string, name: string | null) => void;
  }) => (
    <div data-testid="embedded-client" data-client={p.clientId} data-embedded={String(!!p.embedded)}>
      <button type="button" onClick={() => p.onOpenPatient?.('8', 'Pickle')}>
        pet link
      </button>
    </div>
  ),
}));

afterEach(cleanup);

function mount(over: Partial<Parameters<typeof SoapHeaderRecords>[0]> = {}) {
  const onRecordClosed = vi.fn();
  render(
    <MemoryRouter>
      <h1>
        <SoapHeaderRecords
          patientId={7}
          patientName="Biscuit"
          clientId={9}
          clientName="Ana Rivera"
          onRecordClosed={onRecordClosed}
          {...over}
        />
      </h1>
    </MemoryRouter>,
  );
  return { onRecordClosed };
}

describe('SOAP header record pop-ups', () => {
  it('clicking the pet name opens the embedded chart in a pop-up', async () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Biscuit' }));
    const dialog = await screen.findByRole('dialog', { name: /Biscuit — medical record/ });
    const chart = await screen.findByTestId('embedded-chart');
    expect(dialog).toContainElement(chart);
    expect(chart).toHaveAttribute('data-patient', '7');
    expect(chart).toHaveAttribute('data-embedded', 'true');
  });

  it('View details next to the pet name opens the same chart', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'View details for Biscuit' }));
    expect(await screen.findByTestId('embedded-chart')).toHaveAttribute('data-patient', '7');
  });

  it('clicking the client name opens the embedded client record; its pet links open the pet in the pop-up', async () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: /Ana Rivera/ }));
    await screen.findByRole('dialog', { name: /Ana Rivera — client record/ });
    const client = await screen.findByTestId('embedded-client');
    expect(client).toHaveAttribute('data-client', '9');
    expect(client).toHaveAttribute('data-embedded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'pet link' }));
    expect(await screen.findByTestId('embedded-chart')).toHaveAttribute('data-patient', '8');
    fireEvent.click(screen.getByRole('button', { name: /Back to Ana Rivera/ }));
    expect(await screen.findByTestId('embedded-client')).toBeInTheDocument();
  });

  it('Esc closes the pop-up, focus returns to the header, and the SOAP is told to refresh', async () => {
    const { onRecordClosed } = mount();
    const name = screen.getByRole('link', { name: 'Biscuit' });
    fireEvent.click(name);
    await screen.findByTestId('embedded-chart');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRecordClosed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(name).toHaveFocus());
  });

  it('the Close button closes it too', async () => {
    const { onRecordClosed } = mount();
    fireEvent.click(screen.getByRole('link', { name: /Ana Rivera/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRecordClosed).toHaveBeenCalledTimes(1);
  });

  it('Esc inside one of the chart’s own pop-ups does not close the record', async () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Biscuit' }));
    await screen.findByTestId('embedded-chart');
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    inner.appendChild(input);
    document.body.appendChild(inner);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('soap-record-modal')).toBeInTheDocument();
    inner.remove();
  });

  it('Cmd-click keeps the browser’s new-tab behaviour (no pop-up)', () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Biscuit' }), { metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('multi-pet visit: the pop-up shows the pet whose tab is active', async () => {
    mount({ patientId: 12, patientName: 'Mochi' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Mochi' }));
    expect(await screen.findByTestId('embedded-chart')).toHaveAttribute('data-patient', '12');
  });

  it('the SOAP page passes the active pet (route patient, which the pet tabs switch) to the header', () => {
    const src = readFileSync(resolve(__dirname, '../../pages/SoapEncounterPage.tsx'), 'utf8');
    expect(src).toMatch(/<SoapHeaderRecords\s+patientId=\{patientId\}/);
    expect(src).toContain('onRecordClosed={refreshAfterRecordModal}');
    // Pet tabs mark the route patient as current, so the header's pet is the active tab's pet.
    expect(src).toMatch(/aria-selected=\{r\.isCurrent\}/);
  });
});
