import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listTaskAutomationRules,
  patchTaskAutomationRule,
  runTaskAutomationRules,
  type PatchTaskAutomationRuleBody,
  type TaskAutomationRule,
  type TaskAutomationTrigger,
} from '../../api/taskAutomation';
import {
  fetchAllEmployees,
  fetchEmployeeRoles,
  type Employee,
  type EmployeeRole,
} from '../../api/appointmentSettings';
import { listPracticeBranches, type PracticeBranch } from '../../api/branchInventory';
import './SettingsAutomaticTasks.css';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

/** What the rule is watching, in the words someone in the practice would use. */
const TRIGGER_DESCRIPTIONS: Record<TaskAutomationTrigger, string> = {
  soap_unfinished: 'A SOAP is still a draft.',
  invoice_open: 'An invoice is still open.',
  order_list_item: 'Items are sitting on an office order list.',
  call_unfiled: 'A transcribed call was never filed to a chart or waved off.',
  lab_result_missing:
    'An in-house lab was charged and its results were never entered. The doctor on the visit is added as a watcher.',
};

const ASSIGNEE_OWNER_LABELS: Record<TaskAutomationTrigger, string> = {
  soap_unfinished: 'The doctor on the visit',
  invoice_open: 'Whoever put the first charge on it',
  order_list_item: 'Whoever asked for the item',
  call_unfiled: 'Whoever made the call',
  lab_result_missing: 'Whoever put the lab on the bill',
};

function employeeName(e: Employee): string {
  return [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || `#${e.id}`;
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}

function thresholdLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

const THRESHOLD_CHOICES = [60, 120, 240, 480, 720, 1440, 2880, 4320, 10080];

type Props = {
  practiceId: number;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsAutomaticTasks({ practiceId, onMessage }: Props) {
  const [rules, setRules] = useState<TaskAutomationRule[]>([]);
  const [placeholders, setPlaceholders] = useState<
    Record<string, string[]>
  >({});
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const notify = useCallback(
    (msg: string, kind: 'success' | 'error') => onMessage?.(msg, kind),
    [onMessage]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [res, roleList, employeeList, branchList] = await Promise.all([
        listTaskAutomationRules(practiceId),
        fetchEmployeeRoles({ owner: 'scout' }),
        fetchAllEmployees(),
        listPracticeBranches(practiceId),
      ]);
      setRules(res.rules);
      setPlaceholders(res.placeholders ?? {});
      setRoles(roleList);
      setEmployees(employeeList);
      setBranches(branchList);
    } catch (err) {
      setLoadError(extractErr(err));
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleName = useMemo(() => {
    const map = new Map(roles.map((r) => [r.id, r.name]));
    return (id: number | null) => (id == null ? null : (map.get(id) ?? `Role #${id}`));
  }, [roles]);

  const save = useCallback(
    async (rule: TaskAutomationRule, patch: PatchTaskAutomationRuleBody) => {
      setSavingId(rule.id);
      // Optimistic, so toggling a switch does not feel like it hung.
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, ...patch } : r))
      );
      try {
        const updated = await patchTaskAutomationRule(practiceId, rule.id, patch);
        setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
        notify(`Saved "${updated.name}".`, 'success');
      } catch (err) {
        setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
        notify(extractErr(err), 'error');
      } finally {
        setSavingId(null);
      }
    },
    [practiceId, notify]
  );

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const { created } = await runTaskAutomationRules(practiceId);
      notify(
        created === 0
          ? 'Nothing needed chasing right now.'
          : `Created ${created} task${created === 1 ? '' : 's'}.`,
        'success'
      );
      await load();
    } catch (err) {
      notify(extractErr(err), 'error');
    } finally {
      setRunning(false);
    }
  }, [practiceId, notify, load]);

  if (loading) return <div className="auto-tasks__empty">Loading…</div>;
  if (loadError) return <div className="auto-tasks__error">{loadError}</div>;
  if (!rules.length) {
    return (
      <div className="auto-tasks__empty">
        No automatic tasks are set up for this practice yet.
      </div>
    );
  }

  return (
    <div className="auto-tasks">
      <div className="auto-tasks__toolbar">
        <button
          type="button"
          className="auto-tasks__run"
          onClick={() => void runNow()}
          disabled={running}
        >
          {running ? 'Running…' : 'Run now'}
        </button>
        <span className="auto-tasks__toolbar-note">
          Rules otherwise run on their own every half hour.
        </span>
      </div>

      {rules.map((rule) => {
        const open = expandedId === rule.id;
        const saving = savingId === rule.id;
        const vars = placeholders[rule.trigger] ?? [];
        return (
          <section
            key={rule.id}
            className={`auto-tasks__rule${rule.isEnabled ? '' : ' auto-tasks__rule--off'}`}
          >
            <header className="auto-tasks__head">
              <label className="auto-tasks__toggle">
                <input
                  type="checkbox"
                  checked={rule.isEnabled}
                  disabled={saving}
                  onChange={(e) => void save(rule, { isEnabled: e.target.checked })}
                />
                <span className="auto-tasks__toggle-track" aria-hidden="true" />
              </label>

              <div className="auto-tasks__head-text">
                <h3 className="auto-tasks__name">{rule.name}</h3>
                <p className="auto-tasks__summary">
                  {TRIGGER_DESCRIPTIONS[rule.trigger]}{' '}
                  {rule.timingMode === 'end_of_day'
                    ? `Checked at ${hourLabel(rule.endOfDayHour)}.`
                    : `Waits ${thresholdLabel(rule.thresholdMinutes)}.`}{' '}
                  {rule.assigneeMode === 'owner'
                    ? `Goes to ${ASSIGNEE_OWNER_LABELS[rule.trigger].toLowerCase()}.`
                    : rule.assigneeMode === 'role'
                      ? `Goes to the ${roleName(rule.assigneeRoleId) ?? 'chosen role'}.`
                      : rule.assigneeMode === 'employee'
                        ? 'Goes to one named person.'
                        : 'Waits on the queue for someone to claim.'}{' '}
                  {rule.recreateIfIncomplete
                    ? 'Comes back if they mark it done but the work is not.'
                    : 'Stays closed if they mark it done or take it off the list.'}
                </p>
              </div>

              <button
                type="button"
                className="auto-tasks__expand"
                onClick={() => setExpandedId(open ? null : rule.id)}
              >
                {open ? 'Done' : 'Edit'}
              </button>
            </header>

            {open && (
              <div className="auto-tasks__body">
                <div className="auto-tasks__grid">
                  <label className="auto-tasks__field">
                    <span>Name</span>
                    <input
                      type="text"
                      defaultValue={rule.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== rule.name) void save(rule, { name });
                      }}
                    />
                  </label>

                  <label className="auto-tasks__field">
                    <span>When it fires</span>
                    <select
                      value={rule.timingMode}
                      onChange={(e) =>
                        void save(rule, {
                          timingMode: e.target.value as TaskAutomationRule['timingMode'],
                        })
                      }
                    >
                      <option value="age">After it has sat for a while</option>
                      <option value="end_of_day">At the end of the day</option>
                    </select>
                  </label>

                  {rule.timingMode === 'age' ? (
                    <label className="auto-tasks__field">
                      <span>How long it may sit</span>
                      <select
                        value={rule.thresholdMinutes}
                        onChange={(e) =>
                          void save(rule, { thresholdMinutes: Number(e.target.value) })
                        }
                      >
                        {THRESHOLD_CHOICES.map((m) => (
                          <option key={m} value={m}>
                            {thresholdLabel(m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="auto-tasks__field">
                      <span>End of day is</span>
                      <select
                        value={rule.endOfDayHour}
                        onChange={(e) =>
                          void save(rule, { endOfDayHour: Number(e.target.value) })
                        }
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {hourLabel(h)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="auto-tasks__field">
                    <span>Who gets the task</span>
                    <select
                      value={rule.assigneeMode}
                      onChange={(e) =>
                        void save(rule, {
                          assigneeMode: e.target
                            .value as TaskAutomationRule['assigneeMode'],
                        })
                      }
                    >
                      <option value="owner">{ASSIGNEE_OWNER_LABELS[rule.trigger]}</option>
                      <option value="role">Whoever holds a role</option>
                      <option value="employee">One specific person</option>
                      <option value="queue">Nobody — leave it on the queue</option>
                    </select>
                  </label>

                  {rule.assigneeMode === 'role' && (
                    <label className="auto-tasks__field">
                      <span>Which role</span>
                      <select
                        value={rule.assigneeRoleId ?? ''}
                        onChange={(e) =>
                          void save(rule, {
                            assigneeRoleId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      >
                        <option value="">Choose a role…</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {rule.assigneeMode === 'employee' && (
                    <label className="auto-tasks__field">
                      <span>Which person</span>
                      <select
                        value={rule.assigneeEmployeeId ?? ''}
                        onChange={(e) =>
                          void save(rule, {
                            assigneeEmployeeId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">Choose a person…</option>
                        {employees.map((em) => (
                          <option key={em.id} value={em.id}>
                            {employeeName(em)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="auto-tasks__field">
                    <span>Queue it sits on when nobody is found</span>
                    <select
                      value={rule.queueRoleId ?? ''}
                      onChange={(e) =>
                        void save(rule, {
                          queueRoleId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      <option value="">No queue</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="auto-tasks__field">
                    <span>Limit to one office</span>
                    <select
                      value={rule.branchId ?? ''}
                      onChange={(e) =>
                        void save(rule, {
                          branchId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      <option value="">Every office</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="auto-tasks__check">
                    <input
                      type="checkbox"
                      checked={rule.recreateIfIncomplete}
                      disabled={saving}
                      onChange={(e) =>
                        void save(rule, { recreateIfIncomplete: e.target.checked })
                      }
                    />
                    <span>
                      <strong>Re-do if the work is still not done</strong>
                      <em>
                        After someone marks the task complete, make a new one once
                        the wait has passed if the SOAP is still unsigned, the
                        invoice is still open, or the order list still has items.
                        Leave this off when choosing not to do the work is allowed
                        — for example, a call they decided not to file.
                      </em>
                    </span>
                  </label>

                  <label className="auto-tasks__field">
                    <span>Due</span>
                    <select
                      value={rule.dueInHours ?? ''}
                      onChange={(e) =>
                        void save(rule, {
                          dueInHours: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      <option value="">No due date</option>
                      <option value={4}>4 hours after it appears</option>
                      <option value={24}>1 day after it appears</option>
                      <option value={48}>2 days after it appears</option>
                      <option value={72}>3 days after it appears</option>
                    </select>
                  </label>
                </div>

                <WatcherRoles
                  rule={rule}
                  roles={roles}
                  onChange={(watcherRoleIds) => void save(rule, { watcherRoleIds })}
                />

                <label className="auto-tasks__field auto-tasks__field--wide">
                  <span>Task title</span>
                  <input
                    type="text"
                    defaultValue={rule.titleTemplate}
                    onBlur={(e) => {
                      const titleTemplate = e.target.value.trim();
                      if (titleTemplate && titleTemplate !== rule.titleTemplate) {
                        void save(rule, { titleTemplate });
                      }
                    }}
                  />
                </label>

                <label className="auto-tasks__field auto-tasks__field--wide">
                  <span>Task notes</span>
                  <textarea
                    rows={3}
                    defaultValue={rule.bodyTemplate ?? ''}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next !== (rule.bodyTemplate ?? '')) {
                        void save(rule, { bodyTemplate: next || null });
                      }
                    }}
                  />
                </label>

                {vars.length > 0 && (
                  <p className="auto-tasks__vars">
                    You can use{' '}
                    {vars.map((v, i) => (
                      <span key={v}>
                        {i > 0 && ', '}
                        <code>{`{{${v}}}`}</code>
                      </span>
                    ))}{' '}
                    in the title and notes.
                  </p>
                )}

                {rule.lastRunAt && (
                  <p className="auto-tasks__last-run">
                    Last checked {new Date(rule.lastRunAt).toLocaleString()}.
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function WatcherRoles({
  rule,
  roles,
  onChange,
}: {
  rule: TaskAutomationRule;
  roles: EmployeeRole[];
  onChange: (ids: number[]) => void;
}) {
  const selected = new Set(rule.watcherRoleIds ?? []);
  return (
    <fieldset className="auto-tasks__watchers">
      <legend>Who else should see it</legend>
      <p className="auto-tasks__watchers-note">
        Branch-specific roles resolve to the holder at the office the work happened at.
      </p>
      <div className="auto-tasks__watcher-list">
        {roles.map((r) => (
          <label key={r.id} className="auto-tasks__watcher">
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(r.id);
                else next.delete(r.id);
                onChange([...next]);
              }}
            />
            <span>{r.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
