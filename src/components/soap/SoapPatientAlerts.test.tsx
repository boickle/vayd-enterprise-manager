import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SoapPatientAlerts from './SoapPatientAlerts';

describe('EMR-A13-4: patient alerts at the top of the SOAP', () => {
  it('shows an allergy and a bites alert', () => {
    render(
      <SoapPatientAlerts
        patientName="Pippin"
        profile={{ alerts: 'ALLERGY: penicillin (hives)\nBITES - muzzle for nail trims', alertsUpdatedByName: 'Deirdre F.' }}
      />
    );
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('ALLERGY: penicillin (hives)');
    expect(box).toHaveTextContent('BITES - muzzle for nail trims');
    expect(box).toHaveTextContent('Patient alerts');
    expect(box).toHaveTextContent('Deirdre F.');
  });

  it('shows nothing when the pet has no alerts', () => {
    const { container } = render(<SoapPatientAlerts profile={{ alerts: '  ' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
