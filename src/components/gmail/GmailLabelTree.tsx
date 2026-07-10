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
  isGmailVirtualLabelFolder,
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
  const isVirtualFolder = isGmailVirtualLabelFolder(label);
  const hasChildren = label.children.length > 0;
  const isFolder = hasChildren && (isGroup || isVirtualFolder || label.type === 'user');
  const isExpanded = expanded.has(label.id);
  const isSelected = !isGroup && !isVirtualFolder && selectedId === label.id;
  const count = labelSidebarCount(label);
  const display = isMoreGroup ? (isExpanded ? 'Less' : 'More') : labelDisplayName(label);

  const handleRowActivate = () => {
    if (isMoreGroup || isGroup) {
      onToggleExpand(label.id);
      return;
    }
    if (isVirtualFolder && hasChildren) {
      onToggleExpand(label.id);
      return;
    }
    onSelect(label.id);
  };

  return (
    <>
      <div
        className={[
          'gmail-label-row',
          isSelected ? 'gmail-label-row--selected' : '',
          isFolder ? 'gmail-label-row--folder' : '',
          depth > 0 ? 'gmail-label-row--nested' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
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
          onClick={handleRowActivate}
          title={label.name}
          aria-expanded={hasChildren ? isExpanded : undefined}
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
          <span className="gmail-label-row__text">
            <span
              className={[
                'gmail-label-row__name',
                label.id === 'DRAFT' || label.id === 'SPAM' || (label.id === 'INBOX' && count != null)
                  ? 'gmail-label-row__name--bold'
                  : '',
                isFolder ? 'gmail-label-row__name--folder' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {display}
            </span>
          </span>
          {count != null ? (
            <span className="gmail-label-row__unread">{count.toLocaleString()}</span>
          ) : null}
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <div className="gmail-label-tree__children" role="group" aria-label={display}>
          {label.children.map((child) => (
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
          ))}
        </div>
      ) : null}
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
