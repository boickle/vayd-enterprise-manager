import {
  DIRECTIONS_MAX_LINES,
  directionsCharacterLimit,
  directionsFitsLabel,
  directionsWrappedLineCount,
} from '../../utils/dymoPrescriptionLabel';

export default function DirectionsLimitHint({
  value,
  className = '',
}: {
  value: string;
  className?: string;
}) {
  const limit = directionsCharacterLimit();
  const left = Math.max(0, limit - value.length);
  const over = !directionsFitsLabel(value);
  return (
    <span className={`rx-directions-limit${over ? ' is-over' : ''}${className ? ` ${className}` : ''}`}>
      {left} character{left === 1 ? '' : 's'} left · {directionsWrappedLineCount(value)} /{' '}
      {DIRECTIONS_MAX_LINES} lines
    </span>
  );
}

export function directionsMaxLength(): number {
  return directionsCharacterLimit();
}
