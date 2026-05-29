import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  formatAddressFields,
  placeDetailsToAddressFields,
  publicGeoAutocomplete,
  publicGeoPlaceDetails,
  type GeoAutocompleteSuggestion,
} from '../api/geo';

export type AddressFields = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat?: number;
  lon?: number;
};

type AddressAutocompleteProps = {
  value: AddressFields;
  onChange: (address: AddressFields) => void;
  error?: string;
  placeholder?: string;
  id?: string;
  /** Reset zone/vet lookups when address changes */
  onAddressResolved?: () => void;
  /** Show only line1 in the input (e.g. depot locations resolved from lat/lon). */
  singleLine?: boolean;
  /** Extra class for the text input (e.g. settings-input). */
  inputClassName?: string;
  /** Show green "Address confirmed" hint below the field. */
  showConfirmedMessage?: boolean;
  /** Tighter input padding for dense forms. */
  compact?: boolean;
  /** When true, closes the suggestion list and blocks reopen (e.g. while a modal is open). */
  suppressDropdown?: boolean;
};

function newSessionToken(): string {
  return crypto.randomUUID();
}

function formatDisplayValue(addr: AddressFields, singleLine?: boolean): string {
  if (singleLine) return addr.line1?.trim() || '';
  return formatAddressFields(addr);
}

function isAddressComplete(addr: AddressFields, singleLine?: boolean): boolean {
  if (singleLine) {
    return Boolean(
      addr.line1?.trim() &&
        addr.lat != null &&
        addr.lon != null &&
        Number.isFinite(addr.lat) &&
        Number.isFinite(addr.lon)
    );
  }
  return Boolean(
    addr.line1?.trim() && addr.city?.trim() && addr.state?.trim() && addr.zip?.trim()
  );
}

export function AddressAutocomplete({
  value,
  onChange,
  error,
  placeholder = 'Start typing your address',
  id: idProp,
  onAddressResolved,
  singleLine = false,
  inputClassName,
  showConfirmedMessage = true,
  compact = false,
  suppressDropdown = false,
}: AddressAutocompleteProps) {
  const autoId = useId();
  const inputId = idProp ?? `address-autocomplete-${autoId}`;
  const listboxId = `${inputId}-listbox`;

  const [inputValue, setInputValue] = useState(() => formatDisplayValue(value, singleLine));
  const [suggestions, setSuggestions] = useState<GeoAutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [placeSelected, setPlaceSelected] = useState(() => isAddressComplete(value, singleLine));

  const sessionTokenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const skipSyncRef = useRef(false);
  const suppressDropdownRef = useRef(suppressDropdown);
  suppressDropdownRef.current = suppressDropdown;

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const formatted = formatDisplayValue(value, singleLine);
    if (formatted) {
      setInputValue(formatted);
      setPlaceSelected(isAddressComplete(value, singleLine));
    }
  }, [value.line1, value.line2, value.city, value.state, value.zip, value.lat, value.lon, singleLine]);

  const ensureSessionToken = useCallback(() => {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = newSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setOpen(false);
    setHighlightIndex(-1);
  }, []);

  useEffect(() => {
    if (suppressDropdown) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearSuggestions();
    }
  }, [suppressDropdown, clearSuggestions]);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (suppressDropdownRef.current) {
        clearSuggestions();
        return;
      }
      if (query.trim().length < 3) {
        clearSuggestions();
        return;
      }
      setLoading(true);
      try {
        const token = ensureSessionToken();
        const results = await publicGeoAutocomplete(query.trim(), token, { country: 'US' });
        if (suppressDropdownRef.current) {
          clearSuggestions();
          return;
        }
        setSuggestions(results);
        setOpen(results.length > 0);
        setHighlightIndex(-1);
      } catch {
        clearSuggestions();
      } finally {
        setLoading(false);
      }
    },
    [clearSuggestions, ensureSessionToken]
  );

  const handleInputChange = (text: string) => {
    setInputValue(text);
    setPlaceSelected(false);
    sessionTokenRef.current = newSessionToken();

    skipSyncRef.current = true;
    onChange({
      line1: '',
      line2: undefined,
      city: '',
      state: '',
      zip: '',
      country: 'US',
      lat: undefined,
      lon: undefined,
    });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(text);
    }, 300);
  };

  const handleFocus = () => {
    if (suppressDropdownRef.current) return;
    ensureSessionToken();
    if (inputValue.trim().length >= 3 && suggestions.length > 0) {
      setOpen(true);
    } else if (inputValue.trim().length >= 3) {
      void fetchSuggestions(inputValue);
    }
  };

  const selectSuggestion = async (suggestion: GeoAutocompleteSuggestion) => {
    setLoadingPlace(true);
    setOpen(false);
    setInputValue(suggestion.description);
    try {
      const token = sessionTokenRef.current ?? newSessionToken();
      const details = await publicGeoPlaceDetails(suggestion.placeId, token);
      const fields = placeDetailsToAddressFields(details);
      skipSyncRef.current = true;
      if (singleLine) {
        onChange({
          line1: details.formattedAddress,
          city: '',
          state: '',
          zip: '',
          country: fields.country,
          lat: fields.lat,
          lon: fields.lon,
        });
      } else {
        onChange(fields);
      }
      setInputValue(details.formattedAddress);
      setPlaceSelected(true);
      sessionTokenRef.current = newSessionToken();
      onAddressResolved?.();
    } catch {
      setPlaceSelected(false);
    } finally {
      setLoadingPlace(false);
      clearSuggestions();
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && containerRef.current?.contains(related)) return;
    setTimeout(() => {
      if (suppressDropdownRef.current) {
        clearSuggestions();
        return;
      }
      setOpen(false);
      // Browser autofill can populate the input without selecting a suggestion.
      if (!placeSelected && inputValue.trim().length >= 3 && !isAddressComplete(value, singleLine)) {
        void fetchSuggestions(inputValue);
      }
    }, 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIndex]);
    } else if (e.key === 'Escape') {
      clearSuggestions();
    }
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const showHint = inputValue.trim().length > 0 && inputValue.trim().length < 3;
  const busy = loading || loadingPlace;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        name={`${inputId}-search`}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        className={inputClassName}
        value={inputValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onInput={(e) => {
          const next = e.currentTarget.value;
          if (next !== inputValue) handleInputChange(next);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={
          inputClassName
            ? {
                width: '100%',
                maxWidth: 'none',
                borderColor: error ? '#ef4444' : undefined,
              }
            : {
                width: '100%',
                padding: compact ? '8px 10px' : '12px',
                border: `1px solid ${error ? '#ef4444' : '#d1d5db'}`,
                borderRadius: compact ? '6px' : '8px',
                fontSize: '14px',
              }
        }
      />
      {busy && (
        <div
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '12px',
            color: '#6b7280',
          }}
        >
          …
        </div>
      )}
      {showHint && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
          Type at least 3 characters to search
        </div>
      )}
      {open && !suppressDropdown && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 9999,
            top: '100%',
            left: 0,
            right: 0,
            margin: '4px 0 0',
            padding: 0,
            listStyle: 'none',
            backgroundColor: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            maxHeight: '240px',
            overflowY: 'auto',
          }}
        >
          {suggestions.map((s, index) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={index === highlightIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                backgroundColor: index === highlightIndex ? '#f0fdf4' : '#fff',
                borderBottom: index < suggestions.length - 1 ? '1px solid #f3f4f6' : undefined,
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>{s.mainText}</div>
              {s.secondaryText && (
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                  {s.secondaryText}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {showConfirmedMessage && placeSelected && isAddressComplete(value, singleLine) && !error && (
        <div style={{ fontSize: '12px', color: '#059669', marginTop: '6px' }}>
          Address confirmed
        </div>
      )}
      {error && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>{error}</div>
      )}
    </div>
  );
}
