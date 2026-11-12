import { useMemo, useState } from 'react';

/** A suggested address for the To line. An empty `to` is listed but cannot be picked. */
export type EmailRecipientChoice = {
  key: string;
  label: string;
  to: string;
  group?: string;
  bodyText?: string;
};

type Props = {
  value: string;
  onChange: (next: string) => void;
  onPick: (choice: EmailRecipientChoice) => void;
  choices: EmailRecipientChoice[];
  disabled?: boolean;
  placeholder?: string;
};

const MAX_SHOWN = 8;

/** The address being typed — the part after the last comma. */
function currentTerm(value: string): string {
  const i = value.lastIndexOf(',');
  return (i < 0 ? value : value.slice(i + 1)).trim().toLowerCase();
}

function matches(choice: EmailRecipientChoice, term: string): boolean {
  const hay = `${choice.label} ${choice.to} ${choice.group ?? ''}`.toLowerCase();
  return term.split(/\s+/).every((word) => hay.includes(word));
}

export default function EmailRecipientInput({
  value,
  onChange,
  onPick,
  choices,
  disabled,
  placeholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = currentTerm(value);

  const shown = useMemo(() => {
    if (!term) return [];
    return choices.filter((c) => matches(c, term)).slice(0, MAX_SHOWN);
  }, [choices, term]);

  const pick = (choice: EmailRecipientChoice) => {
    if (!choice.to.trim()) return;
    const i = value.lastIndexOf(',');
    const before = i < 0 ? '' : `${value.slice(0, i + 1)} `;
    onChange(`${before}${choice.to}`);
    onPick(choice);
    setOpen(false);
  };

  const listOpen = open && shown.length > 0;

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className="settings-input"
        style={{ width: '100%', boxSizing: 'border-box' }}
        role="combobox"
        aria-expanded={listOpen}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!listOpen) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((n) => Math.min(n + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((n) => Math.max(n - 1, 0));
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            const choice = shown[active];
            if (choice?.to.trim()) {
              e.preventDefault();
              pick(choice);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {listOpen ? (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 5,
            left: 0,
            right: 0,
            top: 'calc(100% + 4px)',
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {shown.map((c, i) => {
            const usable = Boolean(c.to.trim());
            return (
              <li
                key={c.key}
                role="option"
                aria-selected={i === active}
                aria-disabled={!usable}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  cursor: usable ? 'pointer' : 'default',
                  background: i === active && usable ? '#ecfdf3' : 'transparent',
                  opacity: usable ? 1 : 0.55,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{c.label}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {[
                    c.group,
                    usable ? c.to : 'No email on file — add it under Settings → Outside Hospitals',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
