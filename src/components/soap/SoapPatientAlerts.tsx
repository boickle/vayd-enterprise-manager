import './SoapPatientAlerts.css';

/**
 * Patient alerts (allergies, "bites", needs a muzzle) at the top of the SOAP page, so the vet sees
 * them before charting. Same text as the "Patient alerts" box on the patient record (EMR-A13-4).
 */
export function patientAlertText(profile: Record<string, unknown> | null | undefined): string {
  if (!profile) return '';
  for (const key of ['alerts', 'alert']) {
    const v = profile[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

type Props = {
  profile: Record<string, unknown> | null | undefined;
  patientName?: string;
};

export default function SoapPatientAlerts({ profile, patientName }: Props) {
  const text = patientAlertText(profile);
  if (!text) return null;
  const by =
    typeof profile?.alertsUpdatedByName === 'string' ? profile.alertsUpdatedByName.trim() : '';
  return (
    <div className="soap-patient-alerts" role="alert" data-testid="soap-patient-alerts">
      <span className="soap-patient-alerts__label">
        Patient alerts{patientName ? ` — ${patientName}` : ''}
      </span>
      <span className="soap-patient-alerts__text">{text}</span>
      {by ? <span className="soap-patient-alerts__by"> — {by}</span> : null}
    </div>
  );
}
