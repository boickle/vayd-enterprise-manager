import { useEffect, useMemo, useRef, useState } from 'react';
import { http } from '../api/http';

export type PickedHospital = {
  /** Set when the owner picked us out of the directory. */
  outsideHospitalId?: number;
  name: string;
  /**
   * Which pets this hospital actually saw. One hospital that saw three pets is
   * one request and one email, not three, so the mapping has to be captured
   * here rather than inferred later.
   */
  petIds?: string[];
};

export type PetOption = { id: string; name: string };

type DirectoryHospital = { id: number; name: string; address: string | null };

/** Names typed into the box are kept as-is so nothing an owner tells us is lost. */
export function pickedHospitalsToText(
  picked: PickedHospital[],
  petOptions: PetOption[] = [],
): string {
  const nameById = new Map(petOptions.map((p) => [p.id, p.name]));
  return picked
    .map((h) => {
      const pets = (h.petIds ?? [])
        .map((id) => nameById.get(id))
        .filter((n): n is string => Boolean(n));
      // Staff screens and the liaison email read this string, so the pet mapping
      // has to survive in plain text too, not only in the structured array.
      return pets.length && petOptions.length > 1
        ? `${h.name} (${pets.join(', ')})`
        : h.name;
    })
    .join(', ');
}

/**
 * Searchable multi-select over the practice's outside-hospital directory, with a
 * free-text fallback. Public — pet owners use this before they have an account,
 * so it can only call `/public/*` routes.
 */
export default function OutsideHospitalPicker({
  practiceId,
  value,
  onChange,
  placeholder = 'Start typing a hospital name…',
  compact = false,
  petOptions = [],
}: {
  practiceId?: number | null;
  value: PickedHospital[];
  onChange: (next: PickedHospital[]) => void;
  placeholder?: string;
  compact?: boolean;
  /** When more than one, each hospital asks which of these pets it saw. */
  petOptions?: PetOption[];
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<DirectoryHospital[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!practiceId) return;
    const term = query.trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      http
        .get<DirectoryHospital[]>('/public/outside-hospitals', {
          params: { practiceId, ...(term ? { q: term } : {}) },
        })
        .then(({ data }) => {
          if (!cancelled) setOptions(Array.isArray(data) ? data : []);
        })
        // A directory outage must not block the form; free text still works.
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [practiceId, query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const chosenIds = useMemo(
    () => new Set(value.map((v) => v.outsideHospitalId).filter(Boolean) as number[]),
    [value],
  );
  const chosenNames = useMemo(
    () => new Set(value.map((v) => v.name.trim().toLowerCase())),
    [value],
  );

  const suggestions = options
    .filter((o) => !chosenIds.has(o.id) && !chosenNames.has(o.name.trim().toLowerCase()))
    .slice(0, 8);

  const trimmed = query.trim();
  const exactInList = options.some(
    (o) => o.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const canAddFreeText = trimmed.length > 1 && !exactInList && !chosenNames.has(trimmed.toLowerCase());

  const add = (h: PickedHospital) => {
    // With a single pet there is nothing to ask, so assign it silently. With
    // several, start with all of them checked — the household going to the same
    // ER together is the common case, and unchecking is less work than checking.
    onChange([...value, { ...h, petIds: petOptions.map((p) => p.id) }]);
    setQuery('');
    setOpen(false);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const togglePet = (index: number, petId: string) => {
    onChange(
      value.map((h, i) => {
        if (i !== index) return h;
        const current = h.petIds ?? [];
        return {
          ...h,
          petIds: current.includes(petId)
            ? current.filter((id) => id !== petId)
            : [...current, petId],
        };
      }),
    );
  };

  // Pets added after a hospital was picked would otherwise never be offered.
  useEffect(() => {
    if (petOptions.length === 0 || value.length === 0) return;
    const valid = new Set(petOptions.map((p) => p.id));
    const cleaned = value.map((h) => ({
      ...h,
      petIds: (h.petIds ?? []).filter((id) => valid.has(id)),
    }));
    if (
      cleaned.some((h, i) => h.petIds.length !== (value[i].petIds ?? []).length)
    ) {
      onChange(cleaned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petOptions]);

  const inputPadding = compact ? '8px 10px' : '12px';
  const radius = compact ? 6 : 8;
  /** One pet has nowhere to go wrong; asking would just be noise. */
  const askWhichPets = petOptions.length > 1;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {value.length > 0 && askWhichPets && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {value.map((h, i) => (
            <div
              key={`${h.outsideHospitalId ?? 'text'}-${h.name}-${i}`}
              style={{
                border: '1px solid #10b981',
                background: '#f0fdf4',
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <strong style={{ fontSize: 14, color: '#065f46' }}>{h.name}</strong>
                <button
                  type="button"
                  aria-label={`Remove ${h.name}`}
                  onClick={() => remove(i)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: '#065f46',
                    fontSize: 18,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  &times;
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#047857', margin: '6px 0 5px' }}>
                Which of your pets were seen here?
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {petOptions.map((pet) => {
                  const checked = (h.petIds ?? []).includes(pet.id);
                  return (
                    <label
                      key={pet.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        background: checked ? '#10b981' : '#fff',
                        color: checked ? '#fff' : '#374151',
                        border: `1px solid ${checked ? '#10b981' : '#d1d5db'}`,
                        borderRadius: 999,
                        padding: '4px 11px',
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePet(i, pet.id)}
                        style={{ margin: 0 }}
                      />
                      {pet.name}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {value.length > 0 && !askWhichPets && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {value.map((h, i) => (
            <span
              key={`${h.outsideHospitalId ?? 'text'}-${h.name}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#f0fdf4',
                border: '1px solid #10b981',
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 13,
                color: '#065f46',
              }}
            >
              {h.name}
              <button
                type="button"
                aria-label={`Remove ${h.name}`}
                onClick={() => remove(i)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#065f46',
                  fontSize: 15,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Enter inside a multi-step form would otherwise advance the page.
            e.preventDefault();
            if (suggestions.length === 1) add({ outsideHospitalId: suggestions[0].id, name: suggestions[0].name });
            else if (canAddFreeText) add({ name: trimmed });
          }
        }}
        style={{
          width: '100%',
          padding: inputPadding,
          border: '1px solid #d1d5db',
          borderRadius: radius,
          fontSize: 14,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />

      {open && (trimmed.length > 0 || suggestions.length > 0) && (
        <div
          style={{
            position: 'absolute',
            zIndex: 30,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: radius,
            boxShadow: '0 8px 20px rgba(0,0,0,0.10)',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add({ outsideHospitalId: o.id, name: o.name })}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                border: 'none',
                borderBottom: '1px solid #f1f5f9',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              <span style={{ color: '#111827' }}>{o.name}</span>
              {o.address ? (
                <span style={{ display: 'block', color: '#6b7280', fontSize: 12 }}>
                  {o.address}
                </span>
              ) : null}
            </button>
          ))}

          {canAddFreeText && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add({ name: trimmed })}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                border: 'none',
                background: '#f8fafc',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
            >
              Add &ldquo;{trimmed}&rdquo; &mdash; not in our list
            </button>
          )}

          {!loading && suggestions.length === 0 && !canAddFreeText && (
            <div style={{ padding: '9px 12px', fontSize: 13, color: '#6b7280' }}>
              {trimmed ? 'No matches.' : 'Start typing to search.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
