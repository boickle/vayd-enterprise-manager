import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Tag } from 'lucide-react';
import { labelDisplayName, type GmailLabelNode } from '../../api/gmail';

export type GmailLabelCheckState = 'none' | 'some' | 'all';

type Props = {
  userLabels: GmailLabelNode[];
  labelState: (labelId: string) => GmailLabelCheckState;
  onToggleLabel: (labelId: string) => void;
  disabled?: boolean;
  trigger?: 'toolbar-icon' | 'detail-button';
};

export default function GmailLabelPicker({
  userLabels,
  labelState,
  onToggleLabel,
  disabled,
  trigger = 'detail-button',
}: Props) {
  const [open, setOpen] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [orderTick, setOrderTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // Checked-first order snapshotted when the menu opens, so rows don't jump while toggling.
  const orderSnapshotRef = useRef<Map<string, number>>(new Map());

  const filteredUserLabels = useMemo(() => {
    const q = labelFilter.trim().toLowerCase();
    const base = q
      ? userLabels.filter((l) => labelDisplayName(l).toLowerCase().includes(q))
      : [...userLabels];
    const snap = orderSnapshotRef.current;
    if (snap.size > 0) {
      base.sort(
        (a, b) =>
          (snap.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (snap.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return base;
    // orderTick forces re-sort when a fresh snapshot is taken on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLabels, labelFilter, orderTick]);

  useEffect(() => {
    if (!open) return;
    const checked: string[] = [];
    const unchecked: string[] = [];
    for (const l of userLabels) {
      if (labelState(l.id) !== 'none') checked.push(l.id);
      else unchecked.push(l.id);
    }
    const order = [...checked, ...unchecked];
    orderSnapshotRef.current = new Map(order.map((id, i) => [id, i]));
    setOrderTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setLabelFilter('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div
      className={`gmail-label-picker-wrap${trigger === 'toolbar-icon' ? ' gmail-bulk-toolbar__menu-wrap' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={
          trigger === 'toolbar-icon'
            ? `gmail-inbox__list-toolbar-btn${open ? ' gmail-inbox__list-toolbar-btn--active' : ''}`
            : 'gmail-btn'
        }
        aria-label="Label message"
        aria-expanded={open}
        title="Label"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Tag
          size={trigger === 'toolbar-icon' ? 18 : 14}
          strokeWidth={1.75}
          style={trigger === 'detail-button' ? { verticalAlign: -2, marginRight: 4 } : undefined}
          aria-hidden
        />
        {trigger === 'detail-button' ? 'Label' : null}
      </button>
      {open ? (
        <div className="gmail-bulk-menu gmail-bulk-menu--wide" role="menu" aria-label="Label as">
          <div className="gmail-bulk-menu__title">Label as:</div>
          <div className="gmail-bulk-menu__search">
            <input
              type="search"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              placeholder="Search labels"
              aria-label="Search labels"
              autoFocus
            />
            <Search size={16} strokeWidth={1.75} aria-hidden />
          </div>
          <ul className="gmail-bulk-menu__list gmail-bulk-menu__list--scroll">
            {filteredUserLabels.length === 0 ? (
              <li className="gmail-bulk-menu__empty">No labels found</li>
            ) : (
              filteredUserLabels.map((label) => {
                const state = labelState(label.id);
                return (
                  <li key={label.id}>
                    <label className="gmail-bulk-menu__check-item">
                      <input
                        type="checkbox"
                        checked={state === 'all'}
                        ref={(el) => {
                          if (el) el.indeterminate = state === 'some';
                        }}
                        onChange={() => onToggleLabel(label.id)}
                      />
                      <span>{labelDisplayName(label)}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
