import { GmailLabelNode, labelDisplayName } from '../../api/gmail';

type Props = {
  labels: GmailLabelNode[];
  selectedId: string;
  onSelect: (labelId: string) => void;
  expanded: Set<string>;
  onToggleExpand: (labelId: string) => void;
};

function LabelRow({
  label,
  depth,
  selectedId,
  onSelect,
  expanded,
  onToggleExpand,
}: {
  label: GmailLabelNode;
  depth: number;
} & Props) {
  const hasChildren = label.children.length > 0;
  const isExpanded = expanded.has(label.id);
  const isSelected = selectedId === label.id;
  const unread = label.messagesUnread ?? label.threadsUnread ?? 0;
  const display = labelDisplayName(label);

  return (
    <>
      <div
        className={`gmail-label-row${isSelected ? ' gmail-label-row--selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="gmail-label-row__expand"
            aria-label={isExpanded ? `Collapse ${display}` : `Expand ${display}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(label.id);
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="gmail-label-row__expand gmail-label-row__expand--spacer" aria-hidden />
        )}
        <button
          type="button"
          className="gmail-label-row__btn"
          onClick={() => onSelect(label.id)}
          title={label.name}
        >
          {label.color ? (
            <span
              className="gmail-label-row__swatch"
              style={{ backgroundColor: label.color.backgroundColor }}
              aria-hidden
            />
          ) : null}
          <span className="gmail-label-row__name">{display}</span>
          {unread > 0 ? <span className="gmail-label-row__unread">{unread}</span> : null}
        </button>
      </div>
      {hasChildren && isExpanded
        ? label.children.map((child) => (
            <LabelRow
              key={child.id}
              label={child}
              depth={depth + 1}
              labels={[]}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
            />
          ))
        : null}
    </>
  );
}

export default function GmailLabelTree(props: Props) {
  const { labels } = props;
  return (
    <div className="gmail-label-tree" role="tree" aria-label="Gmail labels">
      {labels.map((label) => (
        <LabelRow key={label.id} label={label} depth={0} {...props} />
      ))}
    </div>
  );
}
