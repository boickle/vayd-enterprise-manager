import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import type { PropagationResult } from '../../api/memberships';
import '../AppDialog.css';
import './MembershipApplyReviewDialog.css';

export type MembershipApplyReviewInfo = {
  planName: string;
  preview: PropagationResult;
  totalMembers: number;
  /** Client name per membership, when known. */
  clientByPlanId?: Map<number, string | null>;
};

type Kind = 'choice' | 'add' | 'change' | 'match' | 'remove';

const KIND_ORDER: Kind[] = ['remove', 'change', 'add', 'choice', 'match'];

const KIND_LABEL: Record<Kind, string> = {
  choice: 'New OR choices',
  add: 'Benefits added',
  change: 'Benefits changed',
  match: 'Matched to a recreated plan line (used counts kept)',
  remove: 'Benefits taken away (unused only)',
};

function kindOf(change: string): Kind {
  if (/^New choice |^Choice |^Add to choice /.test(change)) return 'choice';
  if (/^Add /.test(change)) return 'add';
  if (/^Remove /.test(change)) return 'remove';
  if (/matched to the new plan line/.test(change)) return 'match';
  return 'change';
}

/** Same change for different members, ignoring how many each has used. */
function summaryKey(change: string): string {
  return change.replace(/, \d+ used kept/, ', used kept');
}

function byKind<T>(rows: T[], textOf: (row: T) => string): [Kind, T[]][] {
  const map = new Map<Kind, T[]>();
  for (const row of rows) {
    const k = kindOf(textOf(row));
    map.set(k, [...(map.get(k) ?? []), row]);
  }
  return KIND_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!]);
}

function MembershipApplyReviewDialog({
  info,
  onDone,
}: {
  info: MembershipApplyReviewInfo;
  onDone: (ok: boolean) => void;
}) {
  const { preview, planName, totalMembers, clientByPlanId } = info;
  const members = useMemo(() => preview.members ?? [], [preview]);
  const [query, setQuery] = useState('');
  const [onlyChange, setOnlyChange] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      for (const key of new Set(m.changes.map(summaryKey))) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  }, [members]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .map((m) => ({ ...m, clientName: clientByPlanId?.get(m.wellnessPlanId) ?? null }))
      .filter((m) => !onlyChange || m.changes.some((c) => summaryKey(c) === onlyChange))
      .filter(
        (m) =>
          !q ||
          (m.patientName ?? '').toLowerCase().includes(q) ||
          (m.clientName ?? '').toLowerCase().includes(q) ||
          m.changes.some((c) => c.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.patientName ?? '').localeCompare(b.patientName ?? ''));
  }, [members, clientByPlanId, query, onlyChange]);

  const groupingOnly = preview.membershipsGroupingOnly ?? 0;
  const withChanges = preview.membershipsUpdated - groupingOnly;
  const unlisted = withChanges - members.length;

  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDone(false);
      }}
    >
      <div
        className="app-dialog mship-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mship-review-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="mship-review__head">
          <h2 id="mship-review-title" className="app-dialog__title">
            Review: apply the whole {planName} plan
          </h2>
          <p className="mship-review__summary">
            <strong>{withChanges}</strong> of {totalMembers} current members get benefit changes
            {groupingOnly > 0
              ? `; ${groupingOnly} more only get a behind-the-scenes grouping update`
              : ''}
            . Used counts are never changed or reduced. Nothing is saved until you press Apply.
          </p>
          <p className="mship-review__stats">
            {preview.benefitsAdded} added · {preview.benefitsUpdated} changed
            {preview.benefitsRelinked ? ` · ${preview.benefitsRelinked} matched` : ''} ·{' '}
            {preview.benefitsRemoved} removed
          </p>
        </header>

        <div className="mship-review__body">
          <section className="mship-review__section">
            <p className="app-dialog__hint">
              Every change, and how many members get it — click one to see those members
            </p>
            <div className="mship-review__common">
              {byKind(summary, (s) => s.text).map(([kind, items]) => (
                <div key={kind} className="mship-review__kind">
                  <p className={`mship-review__kind-label mship-review__kind-label--${kind}`}>
                    {KIND_LABEL[kind]}
                  </p>
                  <ul className="mship-review__changes">
                    {items.map((s) => (
                      <li key={s.text}>
                        <button
                          type="button"
                          className={`mship-review__change${onlyChange === s.text ? ' is-on' : ''}`}
                          onClick={() => setOnlyChange(onlyChange === s.text ? null : s.text)}
                        >
                          <span>{s.text}</span>
                          <span className="mship-review__tally">
                            {s.count === members.length ? 'all' : `${s.count} of ${members.length}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="mship-review__section">
            <div className="mship-review__members-head">
              <p className="app-dialog__hint">Member by member ({rows.length})</p>
              <label className="mship-review__search">
                <Search size={14} aria-hidden />
                <input
                  type="search"
                  value={query}
                  placeholder="Find a pet, client, or item"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {onlyChange ? (
              <p className="mship-review__filter">
                Showing members who get: <strong>{onlyChange}</strong>
                <button type="button" onClick={() => setOnlyChange(null)} aria-label="Clear">
                  <X size={14} />
                </button>
              </p>
            ) : null}
            <ul className="mship-review__members">
              {rows.map((m) => {
                const isOpen = open.has(m.wellnessPlanId);
                return (
                  <li key={m.wellnessPlanId}>
                    <button
                      type="button"
                      className="mship-review__member"
                      onClick={() => toggle(m.wellnessPlanId)}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="mship-review__who">
                        {m.patientName || `Membership #${m.wellnessPlanId}`}
                        {m.clientName ? (
                          <span className="mship-review__client"> · {m.clientName}</span>
                        ) : null}
                      </span>
                      <span className="mship-review__count">
                        {m.changes.length} change{m.changes.length === 1 ? '' : 's'}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="mship-review__detail">
                        {byKind(m.changes, (c) => c).map(([kind, items]) => (
                          <div key={kind} className="mship-review__kind">
                            <p
                              className={`mship-review__kind-label mship-review__kind-label--${kind}`}
                            >
                              {KIND_LABEL[kind]}
                            </p>
                            <ul>
                              {items.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {unlisted > 0 ? (
              <p className="settings-muted">
                {unlisted} more member{unlisted === 1 ? '' : 's'} not listed.
              </p>
            ) : null}
          </section>
        </div>

        <div className="app-dialog__actions mship-review__actions">
          <button type="button" className="app-dialog__btn" onClick={() => onDone(false)}>
            Cancel — don&apos;t change members
          </button>
          <button
            type="button"
            className={`app-dialog__btn ${preview.benefitsRemoved > 0 ? 'app-dialog__btn--danger' : 'app-dialog__btn--primary'}`}
            onClick={() => onDone(true)}
          >
            Apply to {preview.membershipsUpdated} membership
            {preview.membershipsUpdated === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Member-by-member review of a whole-plan apply preview. Resolves true to apply. */
export function askMembershipApplyReview(info: MembershipApplyReviewInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    root.render(<MembershipApplyReviewDialog info={info} onDone={done} />);
  });
}
