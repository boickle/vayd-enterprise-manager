import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchPatient = vi.fn();
const httpGet = vi.fn();
vi.mock('../../api/patients', () => ({ fetchPatientByIdStaff: (id: number) => fetchPatient(id) }));
vi.mock('../../api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/http')>()),
  http: { get: (url: string) => httpGet(url) },
}));

import CheckoutPetSignalment, { clearPetSignalmentCache } from './CheckoutPetSignalment';

const cat = {
  species: 'Feline',
  breedEntity: { name: 'Domestic Shorthair' },
  sex: 'female',
  neuterStatus: 'neutered',
  dob: '2019-09-01',
};

beforeEach(() => {
  clearPetSignalmentCache();
  fetchPatient.mockReset();
  httpGet.mockReset();
});

describe('checkout pet signalment line', () => {
  it('shows signalment and the latest weight with its date', async () => {
    fetchPatient.mockResolvedValue(cat);
    httpGet.mockResolvedValue({
      data: {
        points: [
          { serviceDate: '2026-01-10T15:00:00.000Z', weight: 9.2 },
          { serviceDate: '2026-11-04T15:00:00.000Z', weight: 9.8 },
        ],
      },
    });
    render(<CheckoutPetSignalment patientId={1} />);
    const el = await screen.findByTestId('checkout-pet-signalment-1');
    expect(el.textContent).toContain('Feline · Domestic Shorthair · Female spayed');
    expect(el.textContent).toContain('9.8 lb (Nov 4, 2026)');
    expect(el.textContent).not.toContain('9.2');
  });

  it('says "No weight on file" when there is none', async () => {
    fetchPatient.mockResolvedValue(cat);
    httpGet.mockResolvedValue({ data: { points: [] } });
    render(<CheckoutPetSignalment patientId={2} />);
    const el = await screen.findByTestId('checkout-pet-signalment-2');
    expect(el.textContent).toMatch(/Feline · Domestic Shorthair .*· No weight on file$/);
  });

  it("today's SOAP weight wins over history", async () => {
    fetchPatient.mockResolvedValue(cat);
    httpGet.mockResolvedValue({ data: { points: [{ serviceDate: '2026-01-10T15:00:00.000Z', weight: 9.2 }] } });
    render(<CheckoutPetSignalment patientId={3} todayWeight={{ value: '10.1', unit: 'lb' }} />);
    const el = await screen.findByTestId('checkout-pet-signalment-3');
    expect(el.textContent).toContain('10.1 lb (');
    expect(el.textContent).not.toContain('9.2');
  });

  it('each pet shows its own data and is fetched once', async () => {
    fetchPatient.mockImplementation(async (id: number) =>
      id === 4 ? cat : { species: 'Canine', breed: 'Beagle', sex: 'male', neuterStatus: 'intact', dob: '2020-01-01' },
    );
    httpGet.mockImplementation(async (url: string) => ({
      data: {
        points: [
          url.includes('/4/')
            ? { serviceDate: '2026-11-04T15:00:00.000Z', weight: 9.8 }
            : { serviceDate: '2026-10-01T15:00:00.000Z', weight: 24 },
        ],
      },
    }));
    const { rerender } = render(
      <>
        <CheckoutPetSignalment patientId={4} />
        <CheckoutPetSignalment patientId={5} />
      </>,
    );
    const a = await screen.findByTestId('checkout-pet-signalment-4');
    const b = await screen.findByTestId('checkout-pet-signalment-5');
    expect(a.textContent).toContain('Feline');
    expect(a.textContent).toContain('9.8 lb');
    expect(b.textContent).toContain('Canine · Beagle');
    expect(b.textContent).toContain('24 lb (Oct 1, 2026)');
    rerender(
      <>
        <CheckoutPetSignalment patientId={4} />
        <CheckoutPetSignalment patientId={5} />
      </>,
    );
    expect(fetchPatient).toHaveBeenCalledTimes(2);
    expect(httpGet).toHaveBeenCalledTimes(2);
  });
});
