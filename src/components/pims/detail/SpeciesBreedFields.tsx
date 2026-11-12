import { useEffect, useMemo, useState } from 'react';
import {
  fetchBreedsForSpeciesPublic,
  fetchSpeciesListPublic,
  type SpeciesBreedsBreed,
  type SpeciesBreedsSpecies,
} from '../../../api/speciesBreedsPublic';
import './SpeciesBreedFields.css';

/**
 * Species and breed pickers for the patient detail card.
 *
 * Both are backed by the practice catalog rather than free text, because a typo here quietly
 * breaks species-scoped pricing and protocols. Records imported from eVet can still hold a
 * species or breed that isn't in the catalog, so each control keeps the stored value selectable
 * instead of silently dropping it.
 */

const FREE_TEXT = '__free_text__';

function speciesLabel(s: SpeciesBreedsSpecies): string {
  return s.prettyName || s.name;
}

export function useSpeciesCatalog(practiceId: number): SpeciesBreedsSpecies[] {
  const [options, setOptions] = useState<SpeciesBreedsSpecies[]>([]);
  useEffect(() => {
    let on = true;
    fetchSpeciesListPublic(practiceId)
      .then((rows) => {
        if (on) setOptions(rows);
      })
      .catch(() => {
        if (on) setOptions([]);
      });
    return () => {
      on = false;
    };
  }, [practiceId]);
  return options;
}

export function SpeciesSelect({
  speciesName,
  speciesId,
  options,
  onPick,
  id,
}: {
  speciesName: string;
  speciesId: string;
  options: SpeciesBreedsSpecies[];
  /** Clears the breed too — a breed from the old species would no longer be valid. */
  onPick: (next: { speciesId: string; speciesName: string }) => void;
  id?: string;
}) {
  const matched = options.some((s) => String(s.id) === speciesId.trim());
  const unlisted = !matched && speciesName.trim() !== '';
  const value = matched ? speciesId.trim() : unlisted ? FREE_TEXT : '';

  return (
    <select
      id={id}
      className="input"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || v === FREE_TEXT) {
          onPick({ speciesId: '', speciesName: v === FREE_TEXT ? speciesName : '' });
          return;
        }
        const found = options.find((s) => String(s.id) === v);
        onPick({ speciesId: v, speciesName: found ? speciesLabel(found) : '' });
      }}
    >
      <option value="">Not recorded</option>
      {unlisted ? <option value={FREE_TEXT}>{speciesName} (not in catalog)</option> : null}
      {options.map((s) => (
        <option key={s.id} value={String(s.id)}>
          {speciesLabel(s)}
        </option>
      ))}
    </select>
  );
}

export function BreedPicker({
  practiceId,
  speciesId,
  breedName,
  onPick,
  id,
}: {
  practiceId: number;
  speciesId: string;
  breedName: string;
  onPick: (next: { breedId: string; breedName: string }) => void;
  id?: string;
}) {
  const [options, setOptions] = useState<SpeciesBreedsBreed[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const sid = useMemo(() => {
    const n = parseInt(speciesId.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }, [speciesId]);

  useEffect(() => {
    if (sid == null) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let on = true;
    setLoading(true);
    setOptions([]);
    fetchBreedsForSpeciesPublic(practiceId, sid)
      .then((rows) => {
        if (on) setOptions(rows);
      })
      .catch(() => {
        if (on) setOptions([]);
      })
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
  }, [practiceId, sid]);

  const matches = useMemo(() => {
    const q = breedName.trim().toLowerCase();
    const list = q ? options.filter((b) => b.name.toLowerCase().includes(q)) : options;
    return list.slice(0, 60);
  }, [options, breedName]);

  const placeholder =
    sid == null
      ? 'Choose a species first'
      : loading
        ? 'Loading breeds…'
        : options.length
          ? 'Type to search breeds…'
          : 'No breeds listed for this species';

  return (
    <div className="pims-breed">
      <input
        id={id}
        className="input"
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={breedName}
        placeholder={placeholder}
        disabled={loading}
        onChange={(e) => {
          onPick({ breedId: '', breedName: e.target.value });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
      />
      {open && matches.length ? (
        <ul className="pims-breed__list" role="listbox">
          {matches.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                role="option"
                aria-selected={b.name === breedName}
                className="pims-breed__option"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  onPick({ breedId: String(b.id), breedName: b.name });
                  setOpen(false);
                }}
              >
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
