import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Plus, X } from 'lucide-react';
import {
  createPatientReminder,
  listPatientOpenReminders,
  patchReminder,
  type UnscheduledReminder,
} from '../../api/careOutreach';
import { declineReminder } from '../../api/declinedTreatments';
import type { VisitInvoice } from '../../api/visitWorkflow';
import { appConfirm, appPrompt } from '../../utils/appDialog';
import './CheckoutReminders.css';

type Pet = { patientId: number; patientName: string };

function isStaffTask(r: UnscheduledReminder): boolean {
  const type = (r.reminderType ?? '').trim().toLowerCase();
  return type === 'callback' || type === 'todo';
}

/** yyyy-MM-dd on the local calendar, so an evening entry doesn't show as the next day. */
function localDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Noon local time keeps the picked day the same in every US timezone. */
function dayToIso(day: string): string {
  return new Date(`${day}T12:00:00`).toISOString();
}

function formatDay(iso: string | null | undefined): string {
  const day = localDay(iso);
  if (!day) return '—';
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Reminders for each pet on this bill. New ones come from the invoice lines, crossed-out ones
 * clear when the invoice is paid, and every other open reminder can be declined or removed here.
 */
export default function CheckoutReminders({
  invoice,
  pets,
  disabled,
}: {
  invoice: VisitInvoice | null;
  pets: Pet[];
  disabled?: boolean;
}) {
  const [byPet, setByPet] = useState<Record<number, UnscheduledReminder[]>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [draft, setDraft] = useState({ description: '', dueDate: '' });

  const liveLines = useMemo(
    () => (invoice?.lines ?? []).filter((l) => !l.isDeleted),
    [invoice?.lines]
  );
  const lineIds = useMemo(() => new Set(liveLines.map((l) => l.id)), [liveLines]);
  const petIds = useMemo(() => pets.map((p) => p.patientId).join(','), [pets]);
  const refreshKey = [
    invoice?.id,
    invoice?.status,
    invoice?.amountPaid,
    liveLines.map((l) => `${l.id}:${l.patientId}`).join('|'),
    petIds,
  ].join('/');

  const load = useCallback(async () => {
    const ids = petIds ? petIds.split(',').map(Number) : [];
    const rows = await Promise.all(
      ids.map(async (id) => [id, await listPatientOpenReminders(id).catch(() => [])] as const)
    );
    setByPet(Object.fromEntries(rows));
  }, [petIds]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const run = async (id: number | null, action: () => Promise<unknown>, failure: string) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r: UnscheduledReminder) => {
    const ok = await appConfirm({
      title: 'Remove this reminder?',
      message: `"${r.description}" will leave the reminder list (not recorded as declined).`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    await run(
      r.id,
      () => patchReminder(r.id, { isHidden: true }),
      'Could not remove that reminder.'
    );
  };

  const decline = async (r: UnscheduledReminder) => {
    const ok = await appConfirm({
      title: 'Owner declined this?',
      message: `Record "${r.description}" under Declined on the chart.`,
      confirmLabel: 'Record decline',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    const note = await appPrompt({
      title: 'Decline note (optional)',
      message: 'Why was this declined?',
      placeholder: 'Optional',
      confirmLabel: 'Save',
      cancelLabel: 'Skip note',
    });
    await run(r.id, () => declineReminder(r.id, note), 'Could not decline that reminder.');
  };

  const saveAdd = async (patientId: number) => {
    const description = draft.description.trim();
    if (!description || !draft.dueDate) return;
    await run(
      null,
      () => createPatientReminder({ patientId, description, dueDate: dayToIso(draft.dueDate) }),
      'Could not add that reminder.'
    );
    setAdding(null);
    setDraft({ description: '', dueDate: '' });
  };

  if (!invoice || pets.length === 0) return null;
  const today = localDay(new Date().toISOString());

  const cleanupRow = (r: UnscheduledReminder) => (
    <div key={r.id} className="checkout-reminders__row">
      <span className="checkout-reminders__text">{r.description}</span>
      <span className="checkout-reminders__due">
        {r.dueDate ? `Due ${formatDay(r.dueDate)}` : 'No due date'}
      </span>
      <button
        type="button"
        className="soap-btn ghost small"
        disabled={disabled || busyId === r.id}
        title="Owner declined — stays on the chart as declined"
        onClick={() => void decline(r)}
      >
        🚫 Decline
      </button>
      <button
        type="button"
        className="soap-btn ghost small danger"
        disabled={disabled || busyId === r.id}
        title="Remove from the reminder list only"
        onClick={() => void remove(r)}
      >
        <X size={13} aria-hidden /> Remove
      </button>
    </div>
  );

  return (
    <section className="checkout-reminders" aria-label="Reminders">
      <h3 className="checkout-reminders__title">
        <BellRing size={14} aria-hidden /> Reminders
      </h3>
      {error ? <div className="soap-error">{error}</div> : null}
      {pets.map((pet) => {
        const rows = (byPet[pet.patientId] ?? []).filter((r) => !isStaffTask(r));
        const added = rows.filter(
          (r) => r.createdByInvoiceLineId && lineIds.has(r.createdByInvoiceLineId)
        );
        const crossed = rows.filter(
          (r) => r.pendingClearByInvoiceLineId && lineIds.has(r.pendingClearByInvoiceLineId)
        );
        const shown = new Set([...added, ...crossed].map((r) => r.id));
        const others = rows
          .filter((r) => !shown.has(r.id))
          .sort((a, b) => localDay(a.dueDate).localeCompare(localDay(b.dueDate)));
        const pastDue = others.filter((r) => r.dueDate && localDay(r.dueDate) < today);
        const upcoming = others.filter((r) => !r.dueDate || localDay(r.dueDate) >= today);
        return (
          <div key={pet.patientId} className="checkout-reminders__pet">
            {pets.length > 1 ? (
              <div className="checkout-reminders__pet-name">{pet.patientName}</div>
            ) : null}

            {added.length > 0 ? (
              <div className="checkout-reminders__group">
                <span className="checkout-reminders__label">New from this invoice</span>
                {added.map((r) => (
                  <div
                    key={`${r.id}:${r.dueDate ?? ''}:${r.description}`}
                    className="checkout-reminders__row"
                  >
                    <input
                      className="checkout-reminders__desc"
                      defaultValue={r.description}
                      disabled={disabled || busyId === r.id}
                      aria-label="Reminder description"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== r.description) {
                          void run(
                            r.id,
                            () => patchReminder(r.id, { description: next }),
                            'Could not save that reminder.'
                          );
                        }
                      }}
                    />
                    <input
                      type="date"
                      className="checkout-reminders__date"
                      defaultValue={localDay(r.dueDate)}
                      disabled={disabled || busyId === r.id}
                      aria-label="Due date"
                      onBlur={(e) => {
                        const next = e.target.value;
                        if (next && next !== localDay(r.dueDate)) {
                          void run(
                            r.id,
                            () => patchReminder(r.id, { dueDate: dayToIso(next) }),
                            'Could not save that date.'
                          );
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="soap-btn ghost small danger"
                      disabled={disabled || busyId === r.id}
                      title="Remove from the reminder list only"
                      onClick={() => void remove(r)}
                    >
                      <X size={13} aria-hidden /> Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {crossed.length > 0 ? (
              <div className="checkout-reminders__group">
                <span className="checkout-reminders__label">Replaced (clears when paid)</span>
                {crossed.map((r) => (
                  <div
                    key={r.id}
                    className="checkout-reminders__row checkout-reminders__row--crossed"
                  >
                    <span className="checkout-reminders__text">{r.description}</span>
                    <span className="checkout-reminders__due">Due {formatDay(r.dueDate)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {pastDue.length > 0 ? (
              <div className="checkout-reminders__group">
                <span className="checkout-reminders__label checkout-reminders__label--warn">
                  Past due — not on this invoice
                </span>
                {pastDue.map(cleanupRow)}
              </div>
            ) : null}

            {upcoming.length > 0 ? (
              <div className="checkout-reminders__group">
                <span className="checkout-reminders__label">Upcoming — not on this invoice</span>
                {upcoming.map(cleanupRow)}
              </div>
            ) : null}

            {byPet[pet.patientId] && rows.length === 0 ? <p className="soap-hint">No reminders for this pet.</p> : null}

            {adding === pet.patientId ? (
              <div className="checkout-reminders__row checkout-reminders__add">
                <input
                  className="checkout-reminders__desc"
                  placeholder="Reminder"
                  value={draft.description}
                  aria-label="New reminder"
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
                <input
                  type="date"
                  className="checkout-reminders__date"
                  value={draft.dueDate}
                  aria-label="Due date"
                  onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                />
                <button
                  type="button"
                  className="soap-btn small"
                  disabled={!draft.description.trim() || !draft.dueDate || busyId != null}
                  onClick={() => void saveAdd(pet.patientId)}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="soap-btn ghost small"
                  onClick={() => {
                    setAdding(null);
                    setDraft({ description: '', dueDate: '' });
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="soap-btn ghost small checkout-reminders__add-btn"
                disabled={disabled}
                onClick={() => {
                  setAdding(pet.patientId);
                  setDraft({ description: '', dueDate: '' });
                }}
              >
                <Plus size={13} aria-hidden /> Add reminder
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
