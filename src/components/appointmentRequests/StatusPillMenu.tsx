/**
 * A status pill on the Appointments table (Booking, Communication, Records) that opens a short
 * menu to change it. With no menu items it is just the pill.
 */
import { useState } from 'react';
import { Divider, ListSubheader, Menu, MenuItem } from '@mui/material';

export type StatusMenuItem =
  | {
      label: string;
      /** Shown under the label in small text. */
      hint?: string;
      onClick: () => void;
      selected?: boolean;
      disabled?: boolean;
    }
  | { divider: true }
  | { heading: string };

type Props = {
  /** Pill colour class suffix, e.g. "booked" → appt-table-pill--booked. */
  tone: string;
  label: string;
  detail?: string | null;
  items: readonly StatusMenuItem[];
  ariaLabel: string;
  saving?: boolean;
  title?: string;
};

export function StatusPillMenu({ tone, label, detail, items, ariaLabel, saving, title }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pill = (
    <>
      <span>
        {saving ? 'Saving…' : label}
        {items.length > 0 ? <span className="appt-table-pill-caret" aria-hidden="true"> ▾</span> : null}
      </span>
      {detail ? <span className="appt-table-pill-detail">{detail}</span> : null}
    </>
  );
  if (items.length === 0) {
    return (
      <span className={`appt-table-pill appt-table-pill--${tone}`} title={title}>
        {pill}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className={`appt-table-pill appt-table-pill--${tone} appt-table-pill--menu`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={`${ariaLabel}: ${label}${detail ? `, ${detail}` : ''}`}
        title={title}
        disabled={saving}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {pill}
      </button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((item, i) => {
          if ('divider' in item) return <Divider key={`d${i}`} />;
          if ('heading' in item) {
            return (
              <ListSubheader key={`h${i}`} sx={{ lineHeight: '28px', fontSize: '0.75rem' }}>
                {item.heading}
              </ListSubheader>
            );
          }
          return (
            <MenuItem
              key={item.label}
              selected={item.selected}
              disabled={item.disabled}
              onClick={() => {
                setAnchor(null);
                item.onClick();
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>
                  {item.selected ? '✓ ' : ''}
                  {item.label}
                </span>
                {item.hint ? (
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.hint}</span>
                ) : null}
              </span>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
