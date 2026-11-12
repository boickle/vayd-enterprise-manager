import { useState } from 'react';
import { Menu, MenuItem } from '@mui/material';

export type MoreAction = { label: string; onClick: () => void };

/** "More ▾" for the rarer actions on an open request. Renders nothing when there are none. */
export function MoreActionsMenu({ items }: { items: readonly MoreAction[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (items.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="req-action req-action--quiet"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        More ▾
      </button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((a) => (
          <MenuItem
            key={a.label}
            onClick={() => {
              setAnchor(null);
              a.onClick();
            }}
          >
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
