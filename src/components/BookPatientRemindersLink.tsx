import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { fetchPatientMedicalRecordStaff } from '../api/patients';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

type ReminderRow = {
  id: string;
  title: string;
  dueLabel: string | null;
};

function formatReminderDue(iso: string | null): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  return dt.toLocaleString(DateTime.DATE_MED);
}

function remindersFromMedicalRecord(raw: unknown[] | undefined): ReminderRow[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const o = r as Record<string, unknown>;
      const due =
        pickStr(o.dueDate) ??
        pickStr(o.reminderDate) ??
        pickStr(o.serviceDate) ??
        pickStr(o.createdAt);
      return {
        id: String(o.id ?? `${pickStr(o.title) ?? pickStr(o.name) ?? 'reminder'}-${due ?? ''}`),
        title: pickStr(o.title) ?? pickStr(o.name) ?? pickStr(o.description) ?? 'Reminder',
        dueIso: due,
      };
    })
    .sort((a, b) => {
      const ta = a.dueIso ? DateTime.fromISO(a.dueIso).toMillis() : 0;
      const tb = b.dueIso ? DateTime.fromISO(b.dueIso).toMillis() : 0;
      return ta - tb;
    });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueLabel: formatReminderDue(r.dueIso),
  }));
}

type Props = {
  patientId: string;
  patientName: string;
};

export function BookPatientRemindersLink({ patientId, patientName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);

  const loadReminders = useCallback(async () => {
    const id = patientId.trim();
    if (!id) {
      setError('Patient id missing.');
      setReminders([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const mr = await fetchPatientMedicalRecordStaff(id);
      const list = remindersFromMedicalRecord(mr?.reminders);
      setReminders(list);
      if (list.length === 0) setError(null);
    } catch (e: unknown) {
      setReminders([]);
      setError(e instanceof Error && e.message.trim() ? e.message : 'Could not load reminders.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (!open) return;
    void loadReminders();
  }, [open, loadReminders]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  if (!patientId.trim()) return null;

  return (
    <>
      <button
        type="button"
        className="scheduler-book-view-reminders-link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        View reminders
      </button>
      {open
        ? createPortal(
            <div
              className="scheduler-modal-backdrop scheduler-book-reminders-backdrop"
              role="presentation"
              onMouseDown={close}
            >
              <div
                className="scheduler-book-reminders-modal"
                role="dialog"
                aria-modal
                aria-labelledby="scheduler-book-reminders-title"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="scheduler-book-reminders-head">
                  <h3 id="scheduler-book-reminders-title">
                    Reminders — {patientName.trim() || 'Patient'}
                  </h3>
                  <button
                    type="button"
                    className="scheduler-modal-close"
                    aria-label="Close reminders"
                    onClick={close}
                  >
                    ×
                  </button>
                </div>
                <div className="scheduler-book-reminders-body">
                  {loading ? (
                    <p className="scheduler-book-hint">Loading reminders…</p>
                  ) : error ? (
                    <p className="scheduler-book-hint scheduler-book-reminders-error">{error}</p>
                  ) : reminders.length === 0 ? (
                    <p className="scheduler-book-hint">No reminders on this patient&apos;s chart.</p>
                  ) : (
                    <ul className="scheduler-book-reminders-list">
                      {reminders.map((r) => (
                        <li key={r.id} className="scheduler-book-reminders-item">
                          <span className="scheduler-book-reminders-item-title">{r.title}</span>
                          {r.dueLabel ? (
                            <span className="scheduler-book-reminders-item-due">Due {r.dueLabel}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
