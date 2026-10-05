import React from 'react';
import type { PortalProvider } from '../../api/clientPortal';
import { PortalModal } from './PortalPrimitives';
import { possessive, providerEmailFromName, providerShortName } from './portalShared';

export default function ProviderBioModal({
  provider,
  fallbackName,
  petName,
  onClose,
  onRequestVisit,
}: {
  provider: PortalProvider | null;
  fallbackName: string | null;
  petName: string;
  onClose: () => void;
  onRequestVisit: () => void;
}) {
  const baseName = provider?.name || fallbackName || 'Your veterinarian';
  const title = provider?.title?.trim();
  const displayName = title && !/^dr\.?\s/i.test(baseName) ? `${title} ${baseName}` : baseName;
  const initials = baseName
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const credentials = provider?.designation?.trim() || null;
  const email = provider?.email || providerEmailFromName(baseName);
  const shortName = providerShortName(baseName);

  return (
    <PortalModal title={displayName} onClose={onClose} wide labelledBy="pp-bio-title">
      <div className="pp-bio">
        {provider?.imageUrl ? (
          <img src={provider.imageUrl} alt={displayName} />
        ) : (
          <div className="pp-bio-fallback" aria-hidden>
            {initials || '🩺'}
          </div>
        )}
        <div>
          {credentials ? <div className="pp-chip pp-chip--soft" style={{ marginBottom: 10 }}>{credentials}</div> : null}
          <div className="pp-muted pp-small" style={{ marginBottom: 10 }}>
            {possessive(petName)} primary veterinarian
          </div>
          {provider?.bio ? (
            <div className="pp-bio-text">{provider.bio}</div>
          ) : (
            <div className="pp-bio-text pp-muted">
              {shortName} is part of the Vet At Your Door team bringing gentle, fear-free care right to your living room. A full bio
              is coming soon.
            </div>
          )}
        </div>
      </div>
      <div className="pp-modal-foot">
        <a className="pp-btn pp-btn--ghost" href={`mailto:${email}`}>
          Email {shortName}
        </a>
        <button type="button" className="pp-btn pp-btn--primary" onClick={onRequestVisit}>
          Request a visit
        </button>
      </div>
    </PortalModal>
  );
}
