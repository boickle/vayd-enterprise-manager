import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTasks, type TaskListItem } from '../../api/tasks';
import './ScheduleTasksPanel.css';

function isUrgent(t: TaskListItem, now: number): boolean {
  if (t.status === 'done') return false;
  if (t.status === 'open' && t.assignedToEmployeeId == null) return true;
  if (!t.dueAt) return false;
  const due = new Date(t.dueAt).getTime();
  if (Number.isNaN(due)) return false;
  const day = 24 * 60 * 60 * 1000;
  return due <= now + day;
}

type Props = {
  /** Bump to refetch after task changes elsewhere. */
  refreshKey?: number;
};

export default function ScheduleTasksPanel({ refreshKey = 0 }: Props) {
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listTasks({ includeDone: false, limit: 40, offset: 0 });
      setItems(res.items);
    } catch (e: unknown) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Could not load tasks');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const { urgent, normal } = useMemo(() => {
    const now = Date.now();
    const u: TaskListItem[] = [];
    const n: TaskListItem[] = [];
    for (const t of items) {
      if (isUrgent(t, now)) u.push(t);
      else n.push(t);
    }
    return { urgent: u.slice(0, 8), normal: n.slice(0, 8) };
  }, [items]);

  return (
    <div className="schedule-tasks-panel">
      <div className="schedule-tasks-panel__head">
        <h2 className="schedule-tasks-panel__title">Tasks</h2>
        <Link to="/schedule/tasks" className="schedule-tasks-panel__all">
          View all
        </Link>
      </div>
      {error && <p className="schedule-tasks-panel__err">{error}</p>}
      <section className="schedule-tasks-panel__section">
        <h3 className="schedule-tasks-panel__h3">Urgent</h3>
        {urgent.length === 0 ? (
          <p className="schedule-tasks-panel__empty">None right now</p>
        ) : (
          <ul className="schedule-tasks-panel__list">
            {urgent.map((t) => (
              <li key={t.id}>
                <Link to={`/schedule/tasks?taskId=${t.id}`} className="schedule-tasks-panel__link">
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="schedule-tasks-panel__section">
        <h3 className="schedule-tasks-panel__h3">Normal</h3>
        {normal.length === 0 ? (
          <p className="schedule-tasks-panel__empty">None</p>
        ) : (
          <ul className="schedule-tasks-panel__list">
            {normal.map((t) => (
              <li key={t.id}>
                <Link to={`/schedule/tasks?taskId=${t.id}`} className="schedule-tasks-panel__link">
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
