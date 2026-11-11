import { useState } from 'react';
import { Menu, MenuItem } from '@mui/material';

type Props = {
  /** True once the request has a visit or hold on the calendar. */
  hasVisit: boolean;
  /** Not routed yet: open Routing to book. */
  onRoute?: () => void;
  /** Move the existing visit to a new time. */
  onReschedule?: () => void;
  /** Look for other times while keeping the current one until a new one is picked. */
  onExploreAlternatives?: () => void;
  disabled?: boolean;
  /** Sit inline with other action buttons instead of filling a table cell. */
  inline?: boolean;
};

/** Route Visit column: "Route" before anything is booked, "Re-Route" (Reschedule / Explore alternatives) after. */
export function RouteButton({
  hasVisit,
  onRoute,
  onReschedule,
  onExploreAlternatives,
  disabled,
  inline,
}: Props) {
  const inlineClass = inline ? ' appt-table-route-btn--inline' : '';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (!hasVisit) {
    return (
      <button
        type="button"
        className={`appt-table-route-btn${inlineClass}`}
        disabled={disabled || !onRoute}
        onClick={(e) => {
          e.stopPropagation();
          onRoute?.();
        }}
      >
        Route
      </button>
    );
  }

  const canChoose = Boolean(onReschedule || onExploreAlternatives);
  return (
    <>
      <button
        type="button"
        className={`appt-table-route-btn appt-table-route-btn--reroute${inlineClass}`}
        disabled={disabled || !canChoose}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
      >
        <span aria-hidden>↗</span> Re-Route
      </button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          disabled={!onReschedule}
          onClick={() => {
            setAnchor(null);
            onReschedule?.();
          }}
        >
          Reschedule
        </MenuItem>
        <MenuItem
          disabled={!onExploreAlternatives}
          onClick={() => {
            setAnchor(null);
            onExploreAlternatives?.();
          }}
        >
          Explore alternatives
        </MenuItem>
      </Menu>
    </>
  );
}
