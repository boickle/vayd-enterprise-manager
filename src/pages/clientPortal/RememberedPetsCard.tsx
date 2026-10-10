import { useState } from 'react';
import { togglePetLove, type PetLoves, type RememberedPet } from '../../api/clientPortal';
import { CardHead, Icon, PortalModal } from './PortalPrimitives';
import { possessive } from './portalShared';

const STORIES: Array<{ key: 'superpower' | 'favoriteThing' | 'nemesis' | 'keyToMyHeart' | 'funFact'; label: string; icon: string }> = [
  { key: 'superpower', label: 'Superpower', icon: '⚡' },
  { key: 'favoriteThing', label: 'Favorite thing', icon: '💛' },
  { key: 'nemesis', label: 'Nemesis', icon: '😾' },
  { key: 'keyToMyHeart', label: 'The key to my heart', icon: '🔑' },
  { key: 'funFact', label: 'Fun fact', icon: '✨' },
];

function yearOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : String(d.getFullYear());
}

function lifeSpan(pet: RememberedPet): string | null {
  const from = yearOf(pet.dob);
  const to = yearOf(pet.inactiveAt);
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (to) return `Until ${to}`;
  if (from) return `Born ${from}`;
  return null;
}

/**
 * Pets the family has lost. They leave the active list so reminders and
 * bookings stop, but their photos and stories stay here for the family.
 */
export default function RememberedPetsCard({
  pets,
  onLoves,
  onToast,
}: {
  pets: RememberedPet[];
  onLoves: (petId: number, loves: PetLoves) => void;
  onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState<RememberedPet | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);

  async function love(pet: RememberedPet) {
    if (busy === pet.id) return;
    setBusy(pet.id);
    const before = pet.loves;
    const next = !before.mine;
    onLoves(pet.id, { mine: next, count: Math.max(0, before.count + (next ? 1 : -1)) });
    try {
      onLoves(pet.id, await togglePetLove(pet.id, next));
    } catch {
      onLoves(pet.id, before);
      onToast("Couldn't save that — try again.");
    } finally {
      setBusy(null);
    }
  }

  const current = open ? pets.find((p) => p.id === open.id) ?? open : null;
  const photos = current?.photos ?? [];

  return (
    <section className="pp-card pp-remember" aria-label="Pets we remember">
      <CardHead
        icon="🕯️"
        title={pets.length === 1 ? `Remembering ${pets[0]!.name}` : 'Pets we remember'}
        sub="Their photos and stories stay here with you, always."
      />
      <div className="pp-remember-grid">
        {pets.map((pet) => {
          const primary = pet.photos.find((p) => p.isPrimary) ?? pet.photos[0] ?? null;
          const span = lifeSpan(pet);
          const stories = STORIES.filter((s) => pet.profile?.[s.key]);
          return (
            <article key={pet.id} className="pp-remember-pet">
              <button
                type="button"
                className="pp-remember-photo"
                onClick={() => {
                  setOpen(pet);
                  setIndex(Math.max(0, pet.photos.findIndex((p) => p.id === primary?.id)));
                }}
                aria-label={pet.photos.length ? `View ${possessive(pet.name)} photos` : pet.name}
                disabled={pet.photos.length === 0}
              >
                {primary ? <img src={primary.url} alt={pet.name} /> : <span aria-hidden>🐾</span>}
                {pet.photos.length > 1 ? (
                  <span className="pp-pill">
                    <Icon name="camera" size={13} /> {pet.photos.length}
                  </span>
                ) : null}
              </button>
              <div className="pp-remember-body">
                <h3>
                  {pet.name}
                  {pet.nickname ? <span className="pp-remember-aka"> “{pet.nickname}”</span> : null}
                </h3>
                <p className="pp-muted pp-remember-meta">
                  {[pet.species, pet.breed].filter(Boolean).join(' • ')}
                  {span ? ` · ${span}` : ''}
                </p>
                {pet.primaryProviderName ? (
                  <p className="pp-muted pp-remember-meta">Cared for by Dr. {pet.primaryProviderName}</p>
                ) : null}
                {stories.length > 0 ? (
                  <ul className="pp-remember-stories">
                    {stories.slice(0, 3).map((s) => (
                      <li key={s.key}>
                        <span aria-hidden>{s.icon}</span> <strong>{s.label}:</strong> {pet.profile![s.key]}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="pp-remember-actions">
                  <button
                    type="button"
                    className={`pp-chip pp-love${pet.loves.mine ? ' pp-love--on' : ''}`}
                    onClick={() => void love(pet)}
                    aria-pressed={pet.loves.mine}
                    disabled={busy === pet.id}
                  >
                    <span className="pp-chip-icon" aria-hidden>
                      {pet.loves.mine ? '❤️' : '🤍'}
                    </span>
                    {pet.loves.count ? pet.loves.count : ''} {pet.loves.mine ? 'Loved' : 'Love'}
                  </button>
                  {pet.photos.length > 0 ? (
                    <button
                      type="button"
                      className="pp-link-btn"
                      onClick={() => {
                        setOpen(pet);
                        setIndex(0);
                      }}
                    >
                      View photos
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {current && photos.length > 0 ? (
        <PortalModal onClose={() => setOpen(null)} className="pp-lightbox" wide>
          <img src={photos[Math.min(index, photos.length - 1)]!.url} alt={`${current.name} photo ${index + 1}`} />
          <div className="pp-lightbox-bar">
            {photos.length > 1 ? (
              <>
                <button type="button" className="pp-btn pp-btn--sm" onClick={() => setIndex((index - 1 + photos.length) % photos.length)}>
                  ‹ Prev
                </button>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
                  {index + 1} / {photos.length}
                </span>
                <button type="button" className="pp-btn pp-btn--sm" onClick={() => setIndex((index + 1) % photos.length)}>
                  Next ›
                </button>
              </>
            ) : null}
            <a
              className="pp-btn pp-btn--sm"
              href={photos[Math.min(index, photos.length - 1)]!.url}
              download
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="download" size={15} /> Save
            </a>
            <button type="button" className="pp-btn pp-btn--sm" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </PortalModal>
      ) : null}
    </section>
  );
}
