function formatTaskNavCount(n: number): string {
  if (n > 99) return '99+';
  return String(n);
}

type Props = {
  assignedCount: number;
  watchingCount: number;
};

/** Schedule / PIMS nav: red superscript = assigned open tasks, purple = watching.
 * The whole label is one no-wrap unit so the badges stay glued to the "s" in
 * "Tasks" instead of dropping to a second line when the tab is narrow. */
export default function TasksNavLabel({ assignedCount, watchingCount }: Props) {
  const showAssigned = assignedCount > 0;
  const showWatching = watchingCount > 0;
  if (!showAssigned && !showWatching) return <>Tasks</>;
  return (
    <span className="navbar-schedule-tab-label">
      Tasks
      {showAssigned ? (
        <sup
          className="navbar-schedule-tab-badge"
          aria-label={`${assignedCount} assigned open tasks`}
        >
          {formatTaskNavCount(assignedCount)}
        </sup>
      ) : null}
      {showWatching ? (
        <sup
          className="navbar-schedule-tab-badge navbar-schedule-tab-badge--watching"
          aria-label={`${watchingCount} tasks you are watching`}
        >
          {formatTaskNavCount(watchingCount)}
        </sup>
      ) : null}
    </span>
  );
}
