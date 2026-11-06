/**
 * Last chip in a household's pet list: "+3 inactive" shows the household's inactive
 * pets (greyed); "Hide inactive" puts them away again. Nothing renders when there are none.
 */
export default function InactivePetsToggle({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  if (count <= 0) return null;
  return (
    <li>
      <button
        type="button"
        className="pims-emr-household__inactive-toggle"
        aria-pressed={shown}
        onClick={onToggle}
        title={shown ? 'Hide inactive pets' : `Show ${count} inactive pet${count === 1 ? '' : 's'}`}
      >
        {shown ? 'Hide inactive' : `+${count} inactive`}
      </button>
    </li>
  );
}
