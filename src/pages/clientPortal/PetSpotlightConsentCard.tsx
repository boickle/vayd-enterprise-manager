import React, { useState } from 'react';
import type { PetPortalProfilePatch } from '../../api/clientPortal';
import { CardHead } from './PortalPrimitives';
import type { PetWithWellness } from './portalShared';
import { fmtShortDate, possessive } from './portalShared';

export default function PetSpotlightConsentCard({
  pet,
  onSave,
  className,
}: {
  pet: PetWithWellness;
  onSave: (pet: PetWithWellness, patch: PetPortalProfilePatch) => Promise<void>;
  className?: string;
}) {
  const consent = Boolean(pet.portalProfile?.socialMediaConsent);
  const consentAt = pet.portalProfile?.socialMediaConsentAt ?? null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      await onSave(pet, { socialMediaConsent: !consent });
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Could not update. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`pp-card pp-card--sun${className ? ` ${className}` : ''}`} aria-label="Pet of the Month">
      <CardHead
        icon="🌟"
        tone="sun"
        title={`Make ${pet.name} famous`}
        sub="Pet of the Month, social media shout-outs & more"
      />
      <div className="pp-consent">
        <div className="pp-consent-text">
          <strong>{consent ? `${pet.name} is in the spotlight! 🎉` : `Can we share ${possessive(pet.name)} adorable face?`}</strong>
          Yes, Vet At Your Door may share {possessive(pet.name)} photos, first name, and the fun facts above on our social media,
          newsletter, and website — including as a <em>Pet of the Month</em> feature. You can change this anytime.
          {consent && consentAt ? <div className="pp-consent-meta">Opted in {fmtShortDate(consentAt)}</div> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={consent}
          aria-label={`Allow social media sharing for ${pet.name}`}
          className="pp-switch-toggle"
          onClick={() => void toggle()}
          disabled={saving}
        />
      </div>
      {error ? <div className="pp-error">{error}</div> : null}
    </section>
  );
}
