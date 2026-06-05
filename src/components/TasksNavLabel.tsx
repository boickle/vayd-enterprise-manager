function formatTaskNavCount(n: number): string {
  if (n > 99) return '99+';
  return String(n);
}

type Props = {
  assignedCount: number;
  watchingCount: number;
};

/** Schedule / PIMS nav: red superscript = assigned open tasks, purple = watching. */
export default function TasksNavLabel({ assignedCount, watchingCount }: Props) {
  const showAssigned = assignedCount > 0;
  const showWatching = watchingCount > 0;
  if (!showAssigned && !showWatching) return <>Tasks</>;
  return (
    <>
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
    </>
  );
}
