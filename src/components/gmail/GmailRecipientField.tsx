import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { fetchGmailContactSuggestions, type GmailAddress } from '../../api/gmail';

type Props = {
  label: string;
  mailbox: string;
  value: string;
  disabled?: boolean;
  contactsEnabled?: boolean;
  onChange: (value: string) => void;
};

function splitRecipientField(value: string): { prefix: string; active: string } {
  const lastSep = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
  if (lastSep === -1) {
    return { prefix: '', active: value.trimStart() };
  }
  return {
    prefix: value.slice(0, lastSep + 1),
    active: value.slice(lastSep + 1).trimStart(),
  };
}

export function formatRecipientSuggestion(contact: GmailAddress): string {
  const email = contact.email.trim();
  const name = contact.name?.trim();
  if (name && !name.includes('<')) return `${name} <${email}>`;
  return email;
}

export default function GmailRecipientField({
  label,
  mailbox,
  value,
  disabled,
  contactsEnabled = true,
  onChange,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<GmailAddress[]>([]);
  const [scopeHint, setScopeHint] = useState(false);

  const { prefix, active } = splitRecipientField(value);

  const applySuggestion = useCallback(
    (contact: GmailAddress) => {
      const formatted = formatRecipientSuggestion(contact);
      const nextPrefix = prefix ? `${prefix} ` : '';
      onChange(`${nextPrefix}${formatted}, `);
      setOpen(false);
      setSuggestions([]);
      setActiveIndex(0);
    },
    [onChange, prefix],
  );

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (disabled || !contactsEnabled) {
      setSuggestions([]);
      setOpen(false);
      setScopeHint(!contactsEnabled);
      return;
    }

    const query = active.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setScopeHint(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetchGmailContactSuggestions(mailbox, query)
        .then((result) => {
          if (cancelled) return;
          setScopeHint(result.contactsEnabled === false);
          setSuggestions(result.contacts);
          setActiveIndex(0);
          setOpen(result.contacts.length > 0);
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, contactsEnabled, disabled, mailbox]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((idx) => (idx + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((idx) => (idx - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && suggestions[activeIndex]) {
      event.preventDefault();
      applySuggestion(suggestions[activeIndex]!);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="gmail-recipient-field">
      <span className="gmail-compose-panel__row-label">{label}</span>
      <div className="gmail-recipient-field__input-wrap">
        <input
          className="gmail-compose-panel__input"
          value={value}
          disabled={disabled}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {loading ? (
          <span className="gmail-recipient-field__status" aria-live="polite">
            Searching…
          </span>
        ) : null}
        {scopeHint ? (
          <span className="gmail-recipient-field__hint">
            Reconnect Gmail for this mailbox to enable contact suggestions.
          </span>
        ) : null}
        {open && suggestions.length > 0 ? (
          <ul id={listId} className="gmail-recipient-field__list" role="listbox">
            {suggestions.map((contact, index) => {
              const primary = contact.name?.trim() || contact.email;
              const secondary =
                contact.name?.trim() && contact.name.trim() !== contact.email
                  ? contact.email
                  : null;
              return (
                <li key={`${contact.email}-${index}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`gmail-recipient-field__option${
                      index === activeIndex ? ' gmail-recipient-field__option--active' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySuggestion(contact)}
                  >
                    <span className="gmail-recipient-field__option-primary">{primary}</span>
                    {secondary ? (
                      <span className="gmail-recipient-field__option-secondary">{secondary}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
