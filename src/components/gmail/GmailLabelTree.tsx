import {
  AlertOctagon,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  FolderOpen,
  Inbox,
  Mails,
  Send,
  Star,
  Tag,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  GMAIL_MORE_GROUP_ID,
  GMAIL_ALL_MAIL_ID,
  GMAIL_SCHEDULED_ID,
  GMAIL_SNOOZED_ID,
  GmailLabelNode,
  isGmailLabelGroup,
  labelDisplayName,
  labelSidebarCount,
} from '../../api/gmail';

const SYSTEM_LABEL_ICONS: Record<string, LucideIcon> = {
  INBOX: Inbox,
  STARRED: Star,
  [GMAIL_SNOOZED_ID]: Clock,
  SENT: Send,
  DRAFT: FileText,
  IMPORTANT: Bookmark,
  [GMAIL_SCHEDULED_ID]: Clock,
  [GMAIL_ALL_MAIL_ID]: Mails,
  SPAM: AlertOctagon,
  TRASH: Trash2,
};

function LabelIcon({ label }: { label: GmailLabelNode }) {
  if (label.id === GMAIL_MORE_GROUP_ID) {
    return null;
  }
  if (isGmailLabelGroup(label)) {
    return <Tag size={16} strokeWidth={1.75} aria-hidden />;
  }
  const Icon = SYSTEM_LABEL_ICONS[label.id];
  if (Icon) {
    return <Icon size={16} strokeWidth={1.75} aria-hidden />;
  }
  if (label.type === 'user') {
    return <FolderOpen size={16} strokeWidth={1.75} aria-hidden />;
  }
  return null;
}

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
  const isMoreGroup = label.id === GMAIL_MORE_GROUP_ID;
  const isGroup = isGmailLabelGroup(label);
  const hasChildren = label.children.length > 0;
  const isExpanded = expanded.has(label.id);
  const isSelected = !isGroup && selectedId === label.id;
  const count = labelSidebarCount(label);
  const display = isMoreGroup ? (isExpanded ? 'Less' : 'More') : labelDisplayName(label);

  return (
    <>
      <div
        className={`gmail-label-row${isSelected ? ' gmail-label-row--selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren && !isMoreGroup ? (
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
          onClick={() => (isGroup ? onToggleExpand(label.id) : onSelect(label.id))}
          title={label.name}
        >
          <span className="gmail-label-row__icon">
            {isMoreGroup ? (
              isExpanded ? (
                <ChevronUp size={16} strokeWidth={1.75} aria-hidden />
              ) : (
                <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
              )
            ) : label.color ? (
              <span
                className="gmail-label-row__swatch"
                style={{ backgroundColor: label.color.backgroundColor }}
                aria-hidden
              />
            ) : (
              <LabelIcon label={label} />
            )}
          </span>
          <span className={`gmail-label-row__name${label.id === 'DRAFT' || label.id === 'SPAM' || (label.id === 'INBOX' && count != null) ? ' gmail-label-row__name--bold' : ''}`}>
            {display}
          </span>
          {count != null ? (
            <span className="gmail-label-row__unread">{count.toLocaleString()}</span>
          ) : null}
        </button>
      </div>
      {hasChildren && isExpanded
        ? label.children.map((child) => (
            <LabelRow
              key={child.id}
              label={child}
              depth={isMoreGroup ? 0 : depth + 1}
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
