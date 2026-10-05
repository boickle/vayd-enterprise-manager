import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import html2canvas from 'html2canvas';
import { Heart } from 'lucide-react';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchPortalSnapshots,
  togglePatientLove,
  PORTAL_SNAPSHOT_FACT_TOTAL,
  type PortalSnapshot,
  type SnapshotPage,
  type SnapshotSort,
} from '../api/patients';
import { currentPracticeId } from '../utils/practiceIdFromToken';
import { petSexLabel } from './clientPortal/portalShared';
import './PatientSnapshotsPage.css';

const FACTS: Array<{ key: keyof PortalSnapshot; label: string }> = [
  { key: 'superpower', label: 'Superpower' },
  { key: 'favoriteThing', label: 'Favorite thing' },
  { key: 'nemesis', label: 'Nemesis' },
  { key: 'keyToMyHeart', label: 'The key to my heart' },
  { key: 'funFact', label: 'Fun fact' },
];

type Fill = 'any' | 'photos' | 'started' | 'mostly' | 'complete';

const SNAPSHOT_PAGE_SIZE = 30;

function ageLabel(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const years = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
  if (years < 0) return null;
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} mo`;
  return `${Math.floor(years)} yr`;
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.round((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/**
 * Snapshot the whole card (photo, name, signalment, doctor, every answer) as a PNG.
 * Photos come from the API on another origin, so each one is pre-fetched and
 * swapped in as a data URL on the html2canvas clone — otherwise the canvas would
 * be tainted and `toBlob` would fail silently. (html2canvas skips `blob:` URLs,
 * so data URLs it is.)
 */
async function renderCardPng(card: HTMLElement): Promise<Blob> {
  const imgs = Array.from(card.querySelectorAll<HTMLImageElement>('img'));
  const swaps = new Map<string, string>();
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src || swaps.has(src)) return;
      try {
        const blob = await withTimeout(fetch(src).then((r) => (r.ok ? r.blob() : Promise.reject())), 8000, 'photo');
        swaps.set(src, await blobToDataUrl(blob));
      } catch {
        /* leave the original — html2canvas will try CORS */
      }
    })
  );
  const canvas = await withTimeout(
    html2canvas(card, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: 8000,
      onclone: (doc) => {
        const clone = doc.querySelector<HTMLElement>('[data-snap-capturing="1"]');
        if (!clone) return;
        clone.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
          const key = img.getAttribute('src') || '';
          const abs = new URL(key, window.location.href).href;
          const dataUrl = swaps.get(abs) ?? swaps.get(key);
          if (dataUrl) img.setAttribute('src', dataUrl);
        });
        clone.querySelectorAll<HTMLElement>('[data-snap-hide]').forEach((el) => {
          el.style.display = 'none';
        });
        clone.style.boxShadow = 'none';
      },
    }),
    20_000,
    'image'
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not save the snapshot.');
  return blob;
}

function SnapshotCard({
  row,
  onToast,
  onLoves,
}: {
  row: PortalSnapshot;
  onToast: (text: string) => void;
  onLoves: (patientId: number, loves: PortalSnapshot['loves']) => void;
}) {
  const primary = row.photos.find((p) => p.isPrimary) ?? row.photos[0] ?? null;
  const [photoId, setPhotoId] = useState<number | null>(primary?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [loving, setLoving] = useState(false);
  const [pop, setPop] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const photo = row.photos.find((p) => p.id === photoId) ?? primary;
  const updated = whenLabel(row.portalProfileUpdatedAt) ?? whenLabel(row.photos[0]?.created ?? null);
  const signalment = [row.species, row.breed, ageLabel(row.dob), petSexLabel(row.sex)].filter(Boolean).join(' · ');

  async function save() {
    const el = cardRef.current;
    if (!el) return;
    setSaving(true);
    el.setAttribute('data-snap-capturing', '1');
    try {
      const blob = await renderCardPng(el);
      const fileName = `${row.name.replace(/\s+/g, '-').toLowerCase()}-snapshot.png`;
      let copied = false;
      try {
        if (navigator.clipboard && 'ClipboardItem' in window) {
          await withTimeout(
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
            4000,
            'clipboard'
          );
          copied = true;
        }
      } catch {
        copied = false;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      onToast(copied ? `Copied and downloaded ${row.name}'s snapshot.` : `Downloaded ${row.name}'s snapshot.`);
    } catch (e: any) {
      onToast(e?.message ? `Couldn't save: ${e.message}` : "Couldn't build that image — try a screenshot of the card.");
    } finally {
      el.removeAttribute('data-snap-capturing');
      setSaving(false);
    }
  }

  async function love() {
    if (loving) return;
    setLoving(true);
    const next = !row.loves.mine;
    // optimistic
    onLoves(row.id, { mine: next, count: Math.max(0, row.loves.count + (next ? 1 : -1)) });
    if (next) {
      setPop(true);
      window.setTimeout(() => setPop(false), 500);
    }
    try {
      const loves = await togglePatientLove(row.id, next);
      onLoves(row.id, loves);
    } catch {
      onLoves(row.id, row.loves);
      onToast("Couldn't save that love — try again.");
    } finally {
      setLoving(false);
    }
  }

  return (
    <article className="snap-card" ref={cardRef}>
      <div className="snap-card__photo">
        {photo ? <img src={photo.url} alt="" /> : <div className="snap-card__ph">No photo yet</div>}
        {row.socialMediaConsent ? (
          <span className="snap-card__flag snap-card__flag--yes">OK to share</span>
        ) : (
          <span className="snap-card__flag" data-snap-hide>
            No social consent
          </span>
        )}
        <button
          type="button"
          className={`snap-love${row.loves.mine ? ' is-on' : ''}${pop ? ' is-pop' : ''}`}
          onClick={() => void love()}
          aria-pressed={row.loves.mine}
          aria-label={row.loves.mine ? `Un-love ${row.name}` : `Love ${row.name}`}
          title={row.loves.mine ? 'You love this one' : 'Love this snapshot'}
          data-snap-hide
        >
          <Heart size={16} strokeWidth={2.25} fill={row.loves.mine ? 'currentColor' : 'none'} aria-hidden />
          <span>{row.loves.count}</span>
        </button>
      </div>
      {row.photos.length > 1 ? (
        <div className="snap-card__thumbs" data-snap-hide>
          {row.photos.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === photo?.id ? 'is-on' : undefined}
              onClick={() => setPhotoId(p.id)}
              aria-label="Show this photo"
            >
              <img src={p.url} alt="" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="snap-card__body">
        <header>
          <h2>
            {row.name}
            {row.nickname ? <span className="snap-card__aka"> aka “{row.nickname}”</span> : null}
          </h2>
          {signalment ? <p className="snap-card__meta">{signalment}</p> : null}
          <p className="snap-card__meta">
            {row.provider ? `Dr. ${row.provider.name}` : 'No primary doctor'}
            {updated ? ` · updated ${updated}` : ''}
            {row.photos.length ? ` · ${row.photos.length} photo${row.photos.length === 1 ? '' : 's'}` : ''}
          </p>
        </header>
        <div
          className="snap-card__fill"
          aria-label={`${row.filledCount} of ${PORTAL_SNAPSHOT_FACT_TOTAL} profile answers`}
          data-snap-hide
        >
          {Array.from({ length: PORTAL_SNAPSHOT_FACT_TOTAL }, (_, i) => (
            <span key={i} className={i < row.filledCount ? 'is-on' : undefined} />
          ))}
          <em>
            {row.filledCount}/{PORTAL_SNAPSHOT_FACT_TOTAL} filled in
          </em>
        </div>
        <dl>
          {FACTS.map((f) => {
            const value = row[f.key];
            if (typeof value !== 'string' || !value.trim()) return null;
            return (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{value}</dd>
              </div>
            );
          })}
        </dl>
        {!row.filledCount && !row.nickname ? (
          <p className="snap-card__meta" data-snap-hide>
            Photos only — the owner hasn’t answered the about-me questions yet.
          </p>
        ) : null}
        {row.loves.count > 0 ? (
          <p className="snap-card__loved">
            <Heart size={12} fill="currentColor" strokeWidth={0} aria-hidden /> Loved by {row.loves.count}{' '}
            {row.loves.count === 1 ? 'person' : 'people'}
          </p>
        ) : null}
        <div className="snap-card__actions" data-snap-hide>
          <Link to={`/schedule/patients?patientId=${row.id}`}>Open chart</Link>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : row.socialMediaConsent ? 'Copy for social' : 'Save image'}
          </button>
        </div>
        {!row.socialMediaConsent ? (
          <p className="snap-card__warn" data-snap-hide>
            No consent on file — don’t post this one.
          </p>
        ) : null}
        <p className="snap-card__brand" aria-hidden>
          Vet At Your Door
        </p>
      </div>
    </article>
  );
}

export default function PatientSnapshotsPage() {
  const practiceId = currentPracticeId();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [fill, setFill] = useState<Fill>('any');
  const [consentOnly, setConsentOnly] = useState(false);
  const [lovedOnly, setLovedOnly] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [species, setSpecies] = useState('');
  const [sort, setSort] = useState<SnapshotSort>('recent');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SnapshotPage<PortalSnapshot> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rows = result?.items ?? null;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [providerId, debouncedQ, fill, consentOnly, lovedOnly, species, sort]);

  useEffect(() => {
    void fetchPrimaryProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchPortalSnapshots({
      practiceId,
      providerId: providerId ? Number(providerId) : null,
      q: debouncedQ,
      fill,
      consentOnly,
      lovedOnly,
      species,
      sort,
      page,
      pageSize: SNAPSHOT_PAGE_SIZE,
    })
      .then((data) => {
        if (alive) setResult(data);
      })
      .catch(() => {
        if (alive) {
          setResult({ items: [], total: 0, page: 1, pageSize: SNAPSHOT_PAGE_SIZE, pageCount: 1, speciesOptions: [] });
          setError('Could not load snapshots.');
        }
      });
    return () => {
      alive = false;
    };
  }, [practiceId, providerId, debouncedQ, fill, consentOnly, lovedOnly, species, sort, page]);

  function goToPage(next: number) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const countLabel = useMemo(() => {
    if (!result) return 'Loading…';
    return `${result.total} pet${result.total === 1 ? '' : 's'}`;
  }, [result]);

  function applyLoves(patientId: number, loves: PortalSnapshot['loves']) {
    setResult((prev) =>
      prev ? { ...prev, items: prev.items.map((r) => (r.id === patientId ? { ...r, loves } : r)) } : prev
    );
  }

  const speciesOptions = result?.speciesOptions ?? [];

  return (
    <div className="snap-page">
      <header className="snap-head">
        <div>
          <h1>Pet Snapshots</h1>
          <p>What owners have told us — nicknames, photos, and the little things. Scroll when it’s quiet.</p>
        </div>
        <Link to="/schedule/patients">Back to patients</Link>
      </header>

      <div className="snap-filters">
        <input
          type="search"
          placeholder="Search by name or nickname"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search pets"
        />
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>
          {providers.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={fill} onChange={(e) => setFill(e.target.value as Fill)} aria-label="How filled in">
          <option value="any">Any story</option>
          <option value="photos">Has photos</option>
          <option value="started">At least one answer</option>
          <option value="mostly">Mostly filled in (3+)</option>
          <option value="complete">All {PORTAL_SNAPSHOT_FACT_TOTAL} answers</option>
        </select>
        <label className="snap-check">
          <input type="checkbox" checked={consentOnly} onChange={(e) => setConsentOnly(e.target.checked)} />
          OK to share
        </label>
        <label className="snap-check">
          <input type="checkbox" checked={lovedOnly} onChange={(e) => setLovedOnly(e.target.checked)} />
          <Heart size={13} fill={lovedOnly ? '#e11d48' : 'none'} color="#e11d48" aria-hidden /> Ones I love
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as SnapshotSort)} aria-label="Sort">
          <option value="recent">Recently updated</option>
          <option value="loves">Most loved</option>
        </select>
        <span className="snap-count">{countLabel}</span>
      </div>

      {speciesOptions.length > 1 || species ? (
        <div className="snap-species" role="group" aria-label="Species">
          <button type="button" className={!species ? 'is-on' : ''} onClick={() => setSpecies('')}>
            All species
          </button>
          {speciesOptions.map((s) => (
            <button
              key={s.name}
              type="button"
              className={species.toLowerCase() === s.name.toLowerCase() ? 'is-on' : ''}
              onClick={() => setSpecies(s.name)}
            >
              {s.name} <span>{s.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="snap-error">{error}</p> : null}

      {rows === null ? (
        <div className="snap-grid">
          <div className="snap-skel" />
          <div className="snap-skel" />
          <div className="snap-skel" />
        </div>
      ) : rows.length === 0 ? (
        <p className="snap-empty">
          {lovedOnly
            ? 'You haven’t loved any snapshots yet — tap the heart on a card.'
            : 'Nothing matches. Owners’ photos and about-me answers show up here as they add them.'}
        </p>
      ) : (
        <div className="snap-grid">
          {rows.map((row) => (
            <SnapshotCard key={row.id} row={row} onToast={setToast} onLoves={applyLoves} />
          ))}
        </div>
      )}

      {result && result.pageCount > 1 ? (
        <nav className="snap-pager" aria-label="Snapshot pages">
          <button type="button" disabled={result.page <= 1} onClick={() => goToPage(result.page - 1)}>
            ‹ Previous
          </button>
          <span>
            Page {result.page} of {result.pageCount}
          </span>
          <button
            type="button"
            disabled={result.page >= result.pageCount}
            onClick={() => goToPage(result.page + 1)}
          >
            Next ›
          </button>
        </nav>
      ) : null}

      {toast ? <div className="snap-toast">{toast}</div> : null}
    </div>
  );
}
