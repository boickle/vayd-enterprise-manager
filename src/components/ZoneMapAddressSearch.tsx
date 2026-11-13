import { useEffect, useId, useRef, useState } from 'react';
import {
  forwardGeocode,
  geoAutocomplete,
  geoPlaceDetails,
  type GeoAutocompleteSuggestion,
} from '../api/geo';

export type ZoneMapSearchResult = {
  label: string;
  lat: number;
  lon: number;
};

type Props = {
  onFound: (result: ZoneMapSearchResult) => void;
  onClear: () => void;
};

const MIN_QUERY = 3;

function newSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * Address or town search for the Work Zones map. Suggestions come from the
 * signed-in Places autocomplete; pressing Enter with nothing highlighted takes
 * the first suggestion, or falls back to a forward geocode.
 */
export function ZoneMapAddressSearch({ onFound, onClear }: Props) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<GeoAutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<string>(newSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ignores autocomplete responses that arrive after a newer keystroke. */
  const requestSeq = useRef(0);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  function closeList() {
    setOpen(false);
    setHighlight(-1);
  }

  async function loadSuggestions(q: string) {
    const seq = ++requestSeq.current;
    try {
      const list = await geoAutocomplete(q, sessionRef.current, { country: 'US' });
      if (seq !== requestSeq.current) return;
      setSuggestions(list);
      setOpen(list.length > 0);
      setHighlight(-1);
    } catch {
      if (seq !== requestSeq.current) return;
      setSuggestions([]);
      closeList();
    }
  }

  function handleChange(next: string) {
    setText(next);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < MIN_QUERY) {
      requestSeq.current++;
      setSuggestions([]);
      closeList();
      return;
    }
    debounceRef.current = setTimeout(() => void loadSuggestions(next.trim()), 300);
  }

  async function choose(s: GeoAutocompleteSuggestion) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestSeq.current++;
    closeList();
    setText(s.description);
    setBusy(true);
    setError(null);
    try {
      const d = await geoPlaceDetails(s.placeId, sessionRef.current);
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) throw new Error('no coordinates');
      const label = d.formattedAddress || s.description;
      setText(label);
      onFound({ label, lat: d.lat, lon: d.lon });
    } catch {
      setError('Could not find that place. Try a fuller address.');
    } finally {
      sessionRef.current = newSessionToken();
      setBusy(false);
    }
  }

  async function searchTyped() {
    const q = text.trim();
    if (q.length < MIN_QUERY) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestSeq.current++;
    closeList();
    setBusy(true);
    setError(null);
    try {
      const r = await forwardGeocode(q, { country: 'US' });
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) throw new Error('no coordinates');
      const label = r.formattedAddress || q;
      setText(label);
      onFound({ label, lat: r.lat, lon: r.lon });
    } catch {
      setError('No match for that address or town.');
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHighlight((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight >= 0) void choose(suggestions[highlight]);
      else if (open && suggestions.length > 0) void choose(suggestions[0]);
      else void searchTyped();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      closeList();
    }
  }

  function clear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestSeq.current++;
    setText('');
    setSuggestions([]);
    setError(null);
    closeList();
    sessionRef.current = newSessionToken();
    onClear();
  }

  return (
    <div className="work-zones-map-modal__search">
      <label htmlFor={inputId} className="work-zones-map-modal__heading">
        Find an address or town
      </label>
      <div className="work-zones-map-modal__search-row">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listboxId}-${highlight}` : undefined}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          className="work-zones-map-modal__search-input"
          placeholder="e.g. 12 Main St, Bridgton"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => setTimeout(closeList, 150)}
        />
        {text ? (
          <button
            type="button"
            className="work-zones-map-modal__search-clear"
            aria-label="Clear search"
            title="Clear"
            onClick={clear}
          >
            ×
          </button>
        ) : null}
        {open && suggestions.length > 0 ? (
          <ul id={listboxId} role="listbox" className="work-zones-map-modal__suggestions">
            {suggestions.map((s, i) => (
              // Keyboard selection is handled on the combobox input (arrows + Enter).
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={s.placeId}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                className={i === highlight ? 'is-active' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(s)}
              >
                <span className="work-zones-map-modal__suggestion-main">{s.mainText}</span>
                {s.secondaryText ? (
                  <span className="work-zones-map-modal__muted">{s.secondaryText}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {busy ? <p className="work-zones-map-modal__muted">Searching…</p> : null}
      {error ? (
        <p className="work-zones-map-modal__search-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
