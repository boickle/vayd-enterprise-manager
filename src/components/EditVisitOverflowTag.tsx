type EditVisitOverflowTagProps = {
  overrunSeconds: number | null | undefined;
  /** Inline tag for the calendar preview banner. */
  compact?: boolean;
};

function overflowMinutes(overrunSeconds: number | null | undefined): number | null {
  if (typeof overrunSeconds !== 'number' || !Number.isFinite(overrunSeconds) || overrunSeconds <= 0) {
    return null;
  }
  return Math.max(1, Math.round(overrunSeconds / 60));
}

export function EditVisitOverflowTag({ overrunSeconds, compact = false }: EditVisitOverflowTagProps) {
  const min = overflowMinutes(overrunSeconds);
  const label = min != null ? `OVERFLOW +${min}m` : 'OVERFLOW';
  const detail =
    min != null
      ? `~${min} min past depot — score assumes overflow allowed.`
      : 'Score assumes depot overflow allowed (same as overflow checkbox on Get Best Route).';

  if (compact) {
    return (
      <span className="scheduler-edit-overflow-tag scheduler-edit-overflow-tag--compact" role="status">
        <span className="scheduler-edit-overflow-tag-label">{label}</span>
        <span className="scheduler-edit-overflow-tag-text">{detail}</span>
      </span>
    );
  }

  return (
    <div className="scheduler-edit-overflow-tag" role="status">
      <span className="scheduler-edit-overflow-tag-label">{label}</span>
      <span className="scheduler-edit-overflow-tag-text">{detail}</span>
    </div>
  );
}
