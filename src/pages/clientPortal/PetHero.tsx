import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PortalProvider } from '../../api/clientPortal';
import {
  listPatientImages,
  PATIENT_PHOTO_GALLERY_MAX,
  uploadPatientGalleryImage,
  type PatientGalleryImage,
} from '../../api/patients';
import { Icon, PortalModal } from './PortalPrimitives';
import type { MembershipView, PetWithWellness } from './portalShared';
import { petAgeLabel, petHasUploadedPhoto, petImg, petSexLabel, possessive, providerShortName } from './portalShared';

const NEW_PHOTO_DAYS = 14;

function isNew(img: PatientGalleryImage): boolean {
  if (!img.created) return false;
  const t = Date.parse(img.created);
  return Number.isFinite(t) && Date.now() - t < NEW_PHOTO_DAYS * 86_400_000;
}

export type HeroStat = {
  icon: string;
  k: string;
  l: string;
  tone?: 'warn' | 'danger';
  onClick?: () => void;
};

export default function PetHero({
  pet,
  membership,
  provider,
  stats,
  chatOpen,
  chatIsMember,
  onRequestVisit,
  onChat,
  onCertificate,
  onShop,
  onExploreMembership,
  onLove,
  onProviderBio,
  onEditNickname,
  onOpenGalleryManager,
  onPrimaryPhotoChange,
  autoOpenPhotos,
  onAutoOpenHandled,
  galleryRefreshKey,
}: {
  pet: PetWithWellness;
  membership: MembershipView;
  provider: PortalProvider | null;
  stats: HeroStat[];
  chatOpen: boolean;
  chatIsMember: boolean;
  onRequestVisit: () => void;
  onChat: () => void;
  onCertificate: () => void;
  onShop: () => void;
  /** Non-members only: opens membership plans. */
  onExploreMembership?: () => void;
  /** Toggle the owner's "love" on this pet's snapshot. */
  onLove?: () => void;
  onProviderBio: () => void;
  onEditNickname: () => void;
  onOpenGalleryManager: () => void;
  onPrimaryPhotoChange: (url: string | null) => void;
  autoOpenPhotos?: boolean;
  onAutoOpenHandled?: () => void;
  galleryRefreshKey?: number;
}) {
  const [images, setImages] = useState<PatientGalleryImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dbId = pet.dbId;

  const load = useCallback(async () => {
    if (!dbId) {
      setImages([]);
      setLoadedOnce(true);
      return;
    }
    setLoadingImages(true);
    try {
      const rows = await listPatientImages(dbId);
      // Primary first, then newest first.
      const sorted = [...rows].sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        const ta = a.created ? Date.parse(a.created) : 0;
        const tb = b.created ? Date.parse(b.created) : 0;
        return tb - ta;
      });
      setImages(sorted);
    } catch {
      setImages([]);
    } finally {
      setLoadingImages(false);
      setLoadedOnce(true);
    }
  }, [dbId]);

  useEffect(() => {
    setViewIndex(null);
    setLightbox(false);
    setUploadError(null);
    void load();
  }, [load, galleryRefreshKey]);

  // Deep link from the "new picture" email: open on the newest photo.
  useEffect(() => {
    if (!autoOpenPhotos || loadingImages || !loadedOnce) return;
    if (images.length > 0) {
      let newestIdx = 0;
      let newestT = -1;
      images.forEach((img, i) => {
        const t = img.created ? Date.parse(img.created) : 0;
        if (t > newestT) {
          newestT = t;
          newestIdx = i;
        }
      });
      setViewIndex(newestIdx);
      setLightbox(true);
    }
    onAutoOpenHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenPhotos, loadingImages, loadedOnce, images.length]);

  const hasUploaded = petHasUploadedPhoto(pet) || images.length > 0;
  const primarySrc = petImg(pet);
  const displaySrc = viewIndex != null && images[viewIndex] ? images[viewIndex].url : primarySrc;
  const newCount = images.filter(isNew).length;

  const nickname = pet.portalProfile?.nickname ?? null;
  const age = petAgeLabel(pet.dob);
  const sex = petSexLabel(pet.sex);
  const breedLine = [pet.species, pet.breed].filter(Boolean).join(' • ');

  const providerBaseName = provider?.name || pet.primaryProviderName || null;
  const providerName =
    providerBaseName && provider?.title && !/^dr\.?\s/i.test(providerBaseName)
      ? `${provider.title.trim()} ${providerBaseName}`
      : providerBaseName;
  const providerInitials = (providerBaseName || '')
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const thumbsToShow = useMemo(() => {
    const max = 4;
    return images.slice(0, max);
  }, [images]);
  const hiddenCount = Math.max(0, images.length - thumbsToShow.length);
  const canAdd = images.length < PATIENT_PHOTO_GALLERY_MAX && Boolean(dbId);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !dbId) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const res = await uploadPatientGalleryImage(dbId, file);
      if (res?.imageUrl) onPrimaryPhotoChange(res.imageUrl);
      await load();
    } catch (err: any) {
      setUploadError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function openLightbox(idx: number | null) {
    setViewIndex(idx);
    setLightbox(true);
  }

  const lightboxImages = images.length > 0 ? images.map((i) => i.url) : [primarySrc];
  const lbIndex = viewIndex ?? 0;

  return (
    <section className="pp-hero pp-pop" aria-label={`${pet.name} overview`}>
      <div className="pp-hero-photo-wrap">
        <div
          className={`pp-hero-photo${hasUploaded ? '' : ' pp-hero-photo--placeholder'}`}
          role="button"
          tabIndex={0}
          aria-label={hasUploaded ? `View ${possessive(pet.name)} photos` : `Add a photo of ${pet.name}`}
          onClick={() => (hasUploaded ? openLightbox(viewIndex ?? 0) : fileRef.current?.click())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              hasUploaded ? openLightbox(viewIndex ?? 0) : fileRef.current?.click();
            }
          }}
        >
          <img src={displaySrc} alt={pet.name} />
          {membership.badgeLabel ? (
            <span className={`pp-badge pp-badge--${membership.state}`}>{membership.badgeLabel}</span>
          ) : null}
          <div className="pp-hero-photo-hint">
            {images.length > 0 ? (
              <span className="pp-pill">
                <Icon name="camera" size={14} />
                {images.length} photo{images.length === 1 ? '' : 's'}
                {newCount > 0 ? <span style={{ color: '#ef6f5a' }}>· {newCount} new</span> : null}
              </span>
            ) : (
              <span className="pp-pill">
                <Icon name="camera" size={14} /> {hasUploaded ? 'View photo' : 'Add a photo'}
              </span>
            )}
            {canAdd ? (
              <button
                type="button"
                className="pp-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                }}
                disabled={uploading}
              >
                <Icon name="plus" size={14} /> {uploading ? 'Uploading…' : 'Add'}
              </button>
            ) : null}
          </div>
        </div>

        {images.length > 0 ? (
          <div className="pp-thumbs" aria-label="Photo gallery">
            {thumbsToShow.map((img, i) => (
              <button
                key={img.id}
                type="button"
                className={`pp-thumb${(viewIndex ?? 0) === i && images.length > 0 ? ' pp-thumb--active' : ''}${
                  isNew(img) ? ' pp-thumb--new' : ''
                }`}
                onClick={() => setViewIndex(i)}
                onDoubleClick={() => openLightbox(i)}
                aria-label={`Photo ${i + 1}${img.isPrimary ? ' (profile photo)' : ''}`}
              >
                <img src={img.url} alt="" loading="lazy" />
              </button>
            ))}
            {hiddenCount > 0 ? (
              <button type="button" className="pp-thumb pp-thumb--more" onClick={onOpenGalleryManager}>
                +{hiddenCount}
              </button>
            ) : null}
            {canAdd && thumbsToShow.length + (hiddenCount > 0 ? 1 : 0) < 5 ? (
              <button
                type="button"
                className="pp-thumb pp-thumb--add"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label="Add a photo"
                title="Add a photo"
              >
                +
              </button>
            ) : null}
          </div>
        ) : null}
        {uploadError ? <div className="pp-error">{uploadError}</div> : null}
        {images.length > 0 ? (
          <button type="button" className="pp-link-btn" onClick={onOpenGalleryManager} style={{ justifySelf: 'start' }}>
            Manage photos · choose profile picture
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPickFile(e)} />
      </div>

      <div className="pp-hero-body">
        <div>
          <div className="pp-pet-title">
            <h1 className="pp-pet-name">{pet.name}</h1>
            <span className="pp-pet-nick">
              {nickname ? (
                <>
                  a.k.a. “{nickname}”
                  <button type="button" className="pp-link-btn" onClick={onEditNickname} aria-label="Edit nickname">
                    edit
                  </button>
                </>
              ) : (
                <button type="button" className="pp-link-btn" onClick={onEditNickname}>
                  + add a nickname
                </button>
              )}
            </span>
          </div>
          <div className="pp-chips" style={{ marginTop: 10 }}>
            {breedLine ? <span className="pp-chip">{breedLine}</span> : null}
            {age ? (
              <span className="pp-chip pp-chip--soft">
                <span className="pp-chip-icon">🎂</span> {age}
              </span>
            ) : null}
            {sex ? <span className="pp-chip">{sex}</span> : null}
            {onLove ? (
              <button
                type="button"
                className={`pp-chip pp-love${pet.loves?.mine ? ' pp-love--on' : ''}`}
                onClick={onLove}
                aria-pressed={Boolean(pet.loves?.mine)}
                title={
                  pet.loves?.mine
                    ? `You love ${pet.name}. ${pet.loves.count} ${pet.loves.count === 1 ? 'heart' : 'hearts'} so far.`
                    : `Send ${pet.name} some love`
                }
              >
                <span className="pp-chip-icon" aria-hidden>
                  {pet.loves?.mine ? '❤️' : '🤍'}
                </span>
                {pet.loves?.count ? pet.loves.count : ''} {pet.loves?.mine ? 'Loved' : 'Love'}
              </button>
            ) : null}
            {membership.planText ? (
              <span className={`pp-chip ${membership.state === 'active' ? 'pp-chip--soft' : 'pp-chip--sun'}`}>
                <span className="pp-chip-icon">{membership.state === 'active' ? '💚' : '⏳'}</span>
                {membership.planText}
                {membership.state === 'processing' ? ' · processing' : ''}
              </span>
            ) : null}
          </div>
        </div>

        <button type="button" className="pp-provider" onClick={onProviderBio} aria-label={`About ${providerName || 'your vet'}`}>
          {provider?.imageUrl ? (
            <img className="pp-provider-avatar" src={provider.imageUrl} alt="" />
          ) : (
            <div className="pp-provider-avatar" aria-hidden>
              {providerInitials || '🩺'}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="pp-provider-label">{possessive(pet.name)} veterinarian</div>
            <div className="pp-provider-name">{providerName || 'Vet At Your Door team'}</div>
            <div className="pp-provider-link">
              {providerName ? `Meet ${providerShortName(providerName)}` : 'Meet the team'} <Icon name="arrow" size={12} />
            </div>
          </div>
        </button>

        {stats.length > 0 ? (
          <div className="pp-hero-status">
            {stats.map((s) => (
              <button
                key={s.l}
                type="button"
                className={`pp-stat${s.tone ? ` pp-stat--${s.tone}` : ''}`}
                onClick={s.onClick}
                style={s.onClick ? undefined : { cursor: 'default' }}
              >
                <span className="pp-stat-icon" aria-hidden>
                  {s.icon}
                </span>
                <span>
                  <div className="pp-stat-k">{s.k}</div>
                  <div className="pp-stat-l">{s.l}</div>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="pp-hero-actions">
          <button type="button" className="pp-btn pp-btn--primary" onClick={onRequestVisit}>
            <Icon name="calendar" /> Request a visit
          </button>
          <button
            type="button"
            className={`pp-btn ${chatOpen ? (chatIsMember ? 'pp-btn--sky' : 'pp-btn--ghost') : 'pp-btn--muted'}`}
            onClick={onChat}
            aria-disabled={!chatOpen}
            title={chatOpen ? (chatIsMember ? 'Chat with our team now' : 'After-hours chat is a member perk') : 'Chat is currently closed'}
          >
            <span className={`pp-chat-dot${chatOpen ? ' pp-chat-dot--open' : ''}`} />
            {chatOpen ? 'Chat now' : 'Chat closed'}
          </button>
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onCertificate}>
            <Icon name="shield" /> Vaccine certificate
          </button>
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onShop}>
            <Icon name="cart" /> Shop for {pet.name}
          </button>
          {onExploreMembership ? (
            <button type="button" className="pp-btn pp-btn--sun pp-btn--explore" onClick={onExploreMembership}>
              <Icon name="heart" /> Explore membership plans
            </button>
          ) : null}
        </div>
      </div>

      {lightbox ? (
        <PortalModal onClose={() => setLightbox(false)} className="pp-lightbox" wide>
          <img src={lightboxImages[Math.min(lbIndex, lightboxImages.length - 1)]} alt={`${pet.name} photo ${lbIndex + 1}`} />
          <div className="pp-lightbox-bar">
            {lightboxImages.length > 1 ? (
              <>
                <button
                  type="button"
                  className="pp-btn pp-btn--sm"
                  onClick={() => setViewIndex((lbIndex - 1 + lightboxImages.length) % lightboxImages.length)}
                >
                  ‹ Prev
                </button>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
                  {lbIndex + 1} / {lightboxImages.length}
                </span>
                <button type="button" className="pp-btn pp-btn--sm" onClick={() => setViewIndex((lbIndex + 1) % lightboxImages.length)}>
                  Next ›
                </button>
              </>
            ) : null}
            <a className="pp-btn pp-btn--sm" href={lightboxImages[lbIndex]} download target="_blank" rel="noopener noreferrer">
              <Icon name="download" size={15} /> Save
            </a>
            <button
              type="button"
              className="pp-btn pp-btn--sm"
              onClick={() => {
                setLightbox(false);
                onOpenGalleryManager();
              }}
            >
              <Icon name="camera" size={15} /> Manage photos
            </button>
            <button type="button" className="pp-btn pp-btn--sm" onClick={() => setLightbox(false)}>
              Close
            </button>
          </div>
        </PortalModal>
      ) : null}
    </section>
  );
}
