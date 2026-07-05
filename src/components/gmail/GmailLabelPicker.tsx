import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Tag } from 'lucide-react';
import { labelDisplayName, type GmailLabelNode } from '../../api/gmail';

export type GmailLabelCheckState = 'none' | 'some' | 'all';
export type GmailLabelDraftState = boolean | 'some';

type Props = {
  userLabels: GmailLabelNode[];
  labelState: (labelId: string) => GmailLabelCheckState;
  onApply: (draft: Map<string, GmailLabelDraftState>) => Promise<void>;
  disabled?: boolean;
  applying?: boolean;
  trigger?: 'toolbar-icon' | 'detail-button';
};

function initialDraftState(state: GmailLabelCheckState): GmailLabelDraftState {
  if (state === 'all') return true;
  if (state === 'some') return 'some';
  return false;
}

function draftHasChanges(
  userLabels: GmailLabelNode[],
  draft: Map<string, GmailLabelDraftState>,
  labelState: (labelId: string) => GmailLabelCheckState,
): boolean {
  for (const label of userLabels) {
    const next = draft.get(label.id);
    const initial = labelState(label.id);
    if (next === 'some') continue;
    if (initial === 'all' && next === false) return true;
    if (initial === 'none' && next === true) return true;
    if (initial === 'some' && (next === true || next === false)) return true;
  }
  return false;
}

export default function GmailLabelPicker({
  userLabels,
  labelState,
  onApply,
  disabled,
  applying = false,
  trigger = 'detail-button',
}: Props) {
  const [open, setOpen] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [orderTick, setOrderTick] = useState(0);
  const [draft, setDraft] = useState<Map<string, GmailLabelDraftState>>(() => new Map());
  const rootRef = useRef<HTMLDivElement>(null);
  const orderSnapshotRef = useRef<Map<string, number>>(new Map());

  const closeMenu = useCallback(() => {
    setOpen(false);
    setLabelFilter('');
  }, []);

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
    const nextDraft = new Map<string, GmailLabelDraftState>();
    for (const l of userLabels) {
      const state = labelState(l.id);
      nextDraft.set(l.id, initialDraftState(state));
      if (state !== 'none') checked.push(l.id);
      else unchecked.push(l.id);
    }
    setDraft(nextDraft);
    const order = [...checked, ...unchecked];
    orderSnapshotRef.current = new Map(order.map((id, i) => [id, i]));
    setOrderTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, closeMenu]);

  const hasChanges = draftHasChanges(userLabels, draft, labelState);

  const toggleDraftLabel = (labelId: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const current = next.get(labelId) ?? false;
      next.set(labelId, current === true ? false : true);
      return next;
    });
  };

  const handleApply = async () => {
    if (!hasChanges || applying) return;
    try {
      await onApply(draft);
      closeMenu();
    } catch {
      /* parent surfaces errors */
    }
  };

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
        disabled={disabled || applying}
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
                const state = draft.get(label.id) ?? false;
                return (
                  <li key={label.id}>
                    <label className="gmail-bulk-menu__check-item">
                      <input
                        type="checkbox"
                        checked={state === true}
                        ref={(el) => {
                          if (el) el.indeterminate = state === 'some';
                        }}
                        onChange={() => toggleDraftLabel(label.id)}
                      />
                      <span>{labelDisplayName(label)}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
          <div className="gmail-bulk-menu__footer">
            <button
              type="button"
              className="gmail-bulk-menu__apply"
              disabled={!hasChanges || applying}
              onClick={() => void handleApply()}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
