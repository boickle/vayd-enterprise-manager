import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { http } from '../api/http';

export type BreedOption = { id: number; name: string };

type BreedComboboxProps = {
  speciesId?: number;
  /** When true, show a plain text field only (no breed list). */
  freeTextOnly?: boolean;
  value: string;
  breedId?: number;
  onChange: (breed: string, breedId?: number) => void;
  practiceId?: number;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  inputPadding?: string;
  inputRadius?: string;
  fontSize?: string;
};

export function BreedCombobox({
  speciesId,
  freeTextOnly = false,
  value,
  breedId,
  onChange,
  practiceId = 1,
  error,
  disabled = false,
  placeholder = 'Start typing breed',
  inputPadding = '8px 10px',
  inputRadius = '6px',
  fontSize = '14px',
}: BreedComboboxProps) {
  const autoId = useId();
  const inputId = `breed-combobox-${autoId}`;
  const listboxId = `${inputId}-listbox`;

  const [breeds, setBreeds] = useState<BreedOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [inputValue, setInputValue] = useState(value);

  const containerRef = useRef<HTMLDivElement>(null);
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (freeTextOnly || !speciesId) {
      setBreeds([]);
      return;
    }

    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await http.get('/public/species-breeds', {
          params: { practiceId, speciesId },
        });
        if (!alive) return;
        const rows = Array.isArray(data?.breeds) ? data.breeds : [];
        setBreeds(
          rows
            .filter((b: { isDeleted?: boolean; isActive?: boolean }) => b.isDeleted !== true && b.isActive !== false)
            .map((b: { id: number; name: string }) => ({ id: b.id, name: b.name }))
            .sort((a: BreedOption, b: BreedOption) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (alive) setBreeds([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [speciesId, practiceId, freeTextOnly]);

  const filtered = useMemo(() => {
    if (freeTextOnly || !speciesId) return [];
    const q = inputValue.trim().toLowerCase();
    if (!q) return breeds.slice(0, 40);
    return breeds.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 40);
  }, [breeds, inputValue, freeTextOnly, speciesId]);

  const closeList = useCallback(() => {
    setOpen(false);
    setHighlightIndex(-1);
  }, []);

  const applySelection = useCallback(
    (option: BreedOption) => {
      skipSyncRef.current = true;
      setInputValue(option.name);
      onChange(option.name, option.id);
      closeList();
    },
    [onChange, closeList],
  );

  const applyFreeText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const exact = breeds.find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
      onChange(trimmed, exact?.id);
    },
    [breeds, onChange],
  );

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) closeList();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [closeList]);

  const showList = open && !freeTextOnly && !!speciesId && filtered.length > 0 && !disabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      applySelection(filtered[highlightIndex]);
    } else if (e.key === 'Escape') {
      closeList();
    }
  };

  const inputDisabled = disabled || (!freeTextOnly && !speciesId);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-autocomplete="list"
        disabled={inputDisabled}
        value={inputValue}
        placeholder={
          inputDisabled && !freeTextOnly ? 'Select species first' : placeholder
        }
        onChange={(e) => {
          const next = e.target.value;
          setInputValue(next);
          applyFreeText(next);
          if (!freeTextOnly && speciesId) {
            setOpen(true);
            setHighlightIndex(0);
          }
        }}
        onFocus={() => {
          if (!freeTextOnly && speciesId && filtered.length > 0) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => closeList(), 150);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: inputPadding,
          border: `1px solid ${error ? '#ef4444' : '#d1d5db'}`,
          borderRadius: inputRadius,
          fontSize,
          backgroundColor: inputDisabled ? '#f3f4f6' : '#fff',
          cursor: inputDisabled ? 'not-allowed' : 'text',
        }}
      />
      {loading && !freeTextOnly && speciesId && (
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Loading breeds…</div>
      )}
      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            margin: '4px 0 0',
            padding: '4px 0',
            listStyle: 'none',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: inputRadius,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          {filtered.map((option, index) => (
            <li
              key={option.id}
              role="option"
              aria-selected={breedId === option.id || highlightIndex === index}
              onMouseDown={(e) => {
                e.preventDefault();
                applySelection(option);
              }}
              onMouseEnter={() => setHighlightIndex(index)}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                backgroundColor:
                  highlightIndex === index || breedId === option.id ? '#f0fdf4' : 'transparent',
                color: '#111827',
              }}
            >
              {option.name}
            </li>
          ))}
        </ul>
      )}
      {!freeTextOnly && speciesId && inputValue.trim() && !loading && filtered.length === 0 && open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            margin: '4px 0 0',
            padding: '8px 12px',
            fontSize: '12px',
            color: '#6b7280',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: inputRadius,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          No match in our list — your entry will still be saved.
        </div>
      )}
    </div>
  );
}
