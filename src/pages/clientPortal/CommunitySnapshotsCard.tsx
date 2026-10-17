import { useEffect, useState } from 'react';
import {
  fetchCommunitySnapshots,
  togglePetLove,
  type CommunitySnapshot,
  type CommunitySnapshotPage,
  type Pet,
  type PetLoves,
} from '../../api/clientPortal';
import { CardHead, PortalModal } from './PortalPrimitives';
import { PRACTICE_NAME, petImg, possessive } from './portalShared';

const FACTS: Array<{ key: 'superpower' | 'favoriteThing' | 'nemesis' | 'keyToMyHeart' | 'funFact'; label: string; icon: string }> = [
  { key: 'superpower', label: 'Superpower', icon: '⚡' },
  { key: 'favoriteThing', label: 'Favorite thing', icon: '💛' },
  { key: 'keyToMyHeart', label: 'The key to my heart', icon: '🔑' },
  { key: 'nemesis', label: 'Nemesis', icon: '😾' },
  { key: 'funFact', label: 'Fun fact', icon: '✨' },
];

function primaryPhoto(row: CommunitySnapshot): string | null {
  return (row.photos.find((p) => p.isPrimary) ?? row.photos[0])?.url ?? null;
}

function lovesLabel(count: number): string {
  return `${count} love${count === 1 ? '' : 's'}`;
}

/**
 * Sits under "Make {pet} famous": shows the selected pet's own snapshot and
 * love count, and opens the gallery of other families' shared, active pets.
 */
export default function CommunitySnapshotsCard({
  pet,
  onPetLoves,
  onToast,
}: {
  pet: Pet;
  onPetLoves: (patientDbId: number, loves: PetLoves) => void;
  onToast: (text: string) => void;
}) {
  const [teaser, setTeaser] = useState<CommunitySnapshot[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const shared = pet.portalProfile?.socialMediaConsent === true;
  const loves = pet.loves ?? { count: 0, mine: false };

  useEffect(() => {
    let alive = true;
    fetchCommunitySnapshots({ sort: 'recent', page: 1 })
      .then((res) => {
        if (!alive) return;
        setTeaser(res.items.filter((r) => !r.isViewersPet && primaryPhoto(r)).slice(0, 4));
        setTotal(res.total);
      })
      .catch(() => {
        if (alive) setTotal(0);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="pp-card pp-community" aria-label="Pet Snapshots">
      <CardHead
        icon="🎉"
        tone="sun"
        title={`Look at other ${PRACTICE_NAME} Pet Snapshots!`}
        sub="Meet the pets we visit — and send them some love."
      />

      <div className="pp-community-mine">
        <div className="pp-community-mine-photo">
          <img src={petImg(pet)} alt="" />
        </div>
        <div className="pp-community-mine-body">
          <strong>{possessive(pet.name)} snapshot</strong>
          <span className="pp-community-loves">
            <span aria-hidden>{loves.count > 0 ? '❤️' : '🤍'}</span> {lovesLabel(loves.count)}
          </span>
          <span className="pp-muted pp-community-mine-note">
            {shared
              ? `${pet.name} is in the gallery for other families to love.`
              : `Only you and our team see ${pet.name} — turn on sharing to join the gallery.`}
          </span>
        </div>
      </div>

      {teaser.length > 0 ? (
        <button type="button" className="pp-community-teaser" onClick={() => setOpen(true)} aria-label="Browse Pet Snapshots">
          {teaser.map((row) => (
            <img key={row.id} src={primaryPhoto(row)!} alt="" loading="lazy" />
          ))}
        </button>
      ) : null}

      <button
        type="button"
        className="pp-btn pp-btn--primary pp-btn--sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
        disabled={total === 0}
      >
        {total ? `Browse ${total} Pet Snapshot${total === 1 ? '' : 's'}` : 'Browse Pet Snapshots'}
      </button>

      {open ? (
        <CommunityGalleryModal
          onClose={() => setOpen(false)}
          onToast={onToast}
          onLoves={(id, next) => {
            if (pet.dbId && Number(pet.dbId) === id) onPetLoves(id, next);
          }}
        />
      ) : null}
    </section>
  );
}

function CommunityGalleryModal({
  onClose,
  onToast,
  onLoves,
}: {
  onClose: () => void;
  onToast: (text: string) => void;
  onLoves: (patientId: number, loves: PetLoves) => void;
}) {
  const [sort, setSort] = useState<'recent' | 'loves'>('recent');
  const [species, setSpecies] = useState('');
  const [lovedOnly, setLovedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CommunitySnapshotPage | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    setPage(1);
  }, [sort, species, lovedOnly]);

  useEffect(() => {
    let alive = true;
    setError(false);
    fetchCommunitySnapshots({ sort, species, lovedOnly, page })
      .then((res) => {
        if (alive) setResult(res);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [sort, species, lovedOnly, page]);

  function setRowLoves(id: number, loves: PetLoves) {
    setResult((prev) => (prev ? { ...prev, items: prev.items.map((r) => (r.id === id ? { ...r, loves } : r)) } : prev));
    onLoves(id, loves);
  }

  async function love(row: CommunitySnapshot) {
    if (busy === row.id) return;
    setBusy(row.id);
    const before = row.loves;
    const next = !before.mine;
    setRowLoves(row.id, { mine: next, count: Math.max(0, before.count + (next ? 1 : -1)) });
    try {
      setRowLoves(row.id, await togglePetLove(row.id, next));
      if (next) onToast(`${row.name} feels the love ❤️`);
    } catch {
      setRowLoves(row.id, before);
      onToast("Couldn't save that — try again.");
    } finally {
      setBusy(null);
    }
  }

  function goTo(next: number) {
    setPage(next);
    document.querySelector('.pp-gallery-modal')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const speciesOptions = result?.speciesOptions ?? [];

  return (
    <PortalModal title={`${PRACTICE_NAME} Pet Snapshots`} onClose={onClose} wide className="pp-gallery-modal">
      <div className="pp-gallery-filters">
        <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'loves')} aria-label="Sort">
          <option value="recent">Recently updated</option>
          <option value="loves">Most loved</option>
        </select>
        <label className="pp-gallery-check">
          <input type="checkbox" checked={lovedOnly} onChange={(e) => setLovedOnly(e.target.checked)} />
          Ones I love
        </label>
        {result ? (
          <span className="pp-muted pp-gallery-count">
            {result.total} pet{result.total === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      {speciesOptions.length > 1 || species ? (
        <div className="pp-gallery-species" role="group" aria-label="Species">
          <button type="button" className={!species ? 'is-on' : ''} onClick={() => setSpecies('')}>
            All
          </button>
          {speciesOptions.map((s) => (
            <button
              key={s.name}
              type="button"
              className={species.toLowerCase() === s.name.toLowerCase() ? 'is-on' : ''}
              onClick={() => setSpecies(s.name)}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="pp-empty">Couldn’t load snapshots right now.</div>
      ) : !result ? (
        <div className="pp-empty">Loading…</div>
      ) : result.items.length === 0 ? (
        <div className="pp-empty">
          {lovedOnly ? 'You haven’t loved any snapshots yet — tap a heart.' : 'No snapshots here yet.'}
        </div>
      ) : (
        <div className="pp-gallery-grid">
          {result.items.map((row) => {
            const photo = primaryPhoto(row);
            const facts = FACTS.filter((f) => row[f.key]).slice(0, 2);
            const meta = [row.species, row.breed, row.ageYears != null ? `${row.ageYears} yr` : null].filter(Boolean).join(' · ');
            return (
              <article key={row.id} className="pp-gallery-card">
                <div className="pp-gallery-photo">
                  {photo ? <img src={photo} alt={row.name} loading="lazy" /> : <span aria-hidden>🐾</span>}
                  {row.isViewersPet ? <span className="pp-gallery-yours">Your pet</span> : null}
                </div>
                <div className="pp-gallery-body">
                  <h4>
                    {row.name}
                    {row.nickname ? <span className="pp-muted"> “{row.nickname}”</span> : null}
                  </h4>
                  {meta ? <p className="pp-muted pp-gallery-meta">{meta}</p> : null}
                  {row.provider ? <p className="pp-muted pp-gallery-meta">Dr. {row.provider.name}</p> : null}
                  {facts.length ? (
                    <ul className="pp-gallery-facts">
                      {facts.map((f) => (
                        <li key={f.key}>
                          <span aria-hidden>{f.icon}</span> <strong>{f.label}:</strong> {row[f.key]}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    className={`pp-chip pp-love${row.loves.mine ? ' pp-love--on' : ''}`}
                    onClick={() => void love(row)}
                    aria-pressed={row.loves.mine}
                    aria-label={row.loves.mine ? `Un-love ${row.name}` : `Love ${row.name}`}
                    disabled={busy === row.id}
                  >
                    <span className="pp-chip-icon" aria-hidden>
                      {row.loves.mine ? '❤️' : '🤍'}
                    </span>
                    {row.loves.count ? row.loves.count : ''} {row.loves.mine ? 'Loved' : 'Love'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {result && result.pageCount > 1 ? (
        <nav className="pp-gallery-pager" aria-label="Snapshot pages">
          <button type="button" className="pp-btn pp-btn--sm" disabled={result.page <= 1} onClick={() => goTo(result.page - 1)}>
            ‹ Previous
          </button>
          <span className="pp-muted">
            Page {result.page} of {result.pageCount}
          </span>
          <button
            type="button"
            className="pp-btn pp-btn--sm"
            disabled={result.page >= result.pageCount}
            onClick={() => goTo(result.page + 1)}
          >
            Next ›
          </button>
        </nav>
      ) : null}
    </PortalModal>
  );
}
