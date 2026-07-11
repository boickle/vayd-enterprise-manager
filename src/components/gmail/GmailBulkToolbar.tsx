import { useEffect, useMemo, useRef, useState } from 'react';
import { EllipsisVertical, FolderInput, Mail, Search, Trash2 } from 'lucide-react';
import {
  archiveGmailMessage,
  buildUserLabelTreeFromPaths,
  collectUserLabelLeaves,
  flattenUserLabelsForMenu,
  isVirtualMailboxLabel,
  labelDisplayName,
  markGmailMessageUnread,
  modifyGmailMessage,
  trashGmailMessage,
  type GmailLabelMenuRow,
  type GmailLabelNode,
  type GmailMessageSummary,
} from '../../api/gmail';
import GmailLabelPicker, {
  type GmailLabelCheckState,
  type GmailLabelDraftState,
} from './GmailLabelPicker';

export type GmailLabelApplyUpdate = {
  messageId: string;
  threadId: string;
  labelIds: string[];
};

/** Gmail-style archive: a box with a downward arrow (matches lucide outline style). */
function ArchiveDownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M12 11v5" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

type Props = {
  mailbox: string;
  targetMessages: GmailMessageSummary[];
  currentLabelId: string;
  userLabels: GmailLabelNode[];
  /** Nested user-label tree for hierarchical Move to menu (sidebar order). */
  userLabelTree?: GmailLabelNode[];
  labelById: Map<string, GmailLabelNode>;
  disabled?: boolean;
  onComplete: () => void;
  onLabelsApplied: (updates: GmailLabelApplyUpdate[]) => void;
  onError: (message: string) => void;
  /**
   * Optional pre-archive check. Return an error string to block the archive
   * (e.g. an appointment-request thread missing a BOOKED / NOT BOOKED label);
   * return null to allow it.
   */
  guardArchive?: (targets: GmailMessageSummary[]) => string | null;
  /** Message reader: primary archive/trash/unread + overflow menu for move/label. */
  variant?: 'bulk' | 'message';
};

const MOVE_TARGET_IDS = ['INBOX', 'TRASH', 'SPAM'] as const;

function MoveMenuLabelRow({
  row,
  onMove,
}: {
  row: GmailLabelMenuRow;
  onMove: (labelId: string) => void;
}) {
  const paddingLeft = 14 + row.depth * 16;
  if (!row.movable) {
    return (
      <li>
        <div
          className="gmail-bulk-menu__item gmail-bulk-menu__item--folder"
          style={{ paddingLeft }}
          aria-hidden
        >
          {labelDisplayName(row.label)}
        </div>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className="gmail-bulk-menu__item"
        role="menuitem"
        style={{ paddingLeft }}
        onClick={() => onMove(row.label.id)}
      >
        {labelDisplayName(row.label)}
      </button>
    </li>
  );
}

export default function GmailBulkToolbar({
  mailbox,
  targetMessages,
  currentLabelId,
  userLabels,
  userLabelTree,
  labelById,
  disabled,
  onComplete,
  onLabelsApplied,
  onError,
  guardArchive,
  variant = 'bulk',
}: Props) {
  const [busy, setBusy] = useState(false);
  const [labelApplying, setLabelApplying] = useState(false);
  const [openMenu, setOpenMenu] = useState<'move' | 'more' | null>(null);
  const [moveFilter, setMoveFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const resolvedUserLabelTree = useMemo(
    () => userLabelTree ?? buildUserLabelTreeFromPaths(collectUserLabelLeaves(userLabels)),
    [userLabelTree, userLabels],
  );

  const systemMoveTargets = useMemo(
    () =>
      MOVE_TARGET_IDS.map((id) => labelById.get(id)).filter(
        (l): l is GmailLabelNode => !!l && l.id !== currentLabelId,
      ),
    [labelById, currentLabelId],
  );

  const userMoveRowsAll = useMemo(
    () =>
      flattenUserLabelsForMenu(resolvedUserLabelTree).filter(
        (row) => !row.movable || row.label.id !== currentLabelId,
      ),
    [resolvedUserLabelTree, currentLabelId],
  );

  const filteredMoveRows = useMemo(() => {
    const q = moveFilter.trim().toLowerCase();
    if (!q) return userMoveRowsAll;
    return userMoveRowsAll.filter(
      (row) =>
        row.movable &&
        (labelDisplayName(row.label).toLowerCase().includes(q) ||
          row.label.name.toLowerCase().includes(q)),
    );
  }, [userMoveRowsAll, moveFilter]);

  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setMoveFilter('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenu]);

  const runOnChecked = async (fn: (msg: GmailMessageSummary) => Promise<unknown>) => {
    if (targetMessages.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(targetMessages.map((m) => fn(m)));
      onComplete();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Bulk action failed.');
    } finally {
      setBusy(false);
      setOpenMenu(null);
      setMoveFilter('');
    }
  };

  const handleArchive = () => {
    if (guardArchive) {
      const blocked = guardArchive(targetMessages);
      if (blocked) {
        onError(blocked);
        return;
      }
    }
    void runOnChecked((m) => archiveGmailMessage(mailbox, m.id, m.threadId));
  };

  const handleTrash = () => runOnChecked((m) => trashGmailMessage(mailbox, m.id, m.threadId));

  const handleMarkUnread = () =>
    runOnChecked((m) => markGmailMessageUnread(mailbox, m.id, m.threadId));

  const handleMoveTo = (targetLabelId: string) => {
    const removeLabelIds =
      currentLabelId && currentLabelId !== targetLabelId && !isVirtualMailboxLabel(currentLabelId)
        ? [currentLabelId]
        : undefined;
    void runOnChecked((m) =>
      modifyGmailMessage(
        mailbox,
        m.id,
        {
          addLabelIds: [targetLabelId],
          ...(removeLabelIds ? { removeLabelIds } : {}),
        },
        m.threadId
      )
    );
  };

  const labelState = (labelId: string): GmailLabelCheckState => {
    const count = targetMessages.filter((m) => m.labelIds.includes(labelId)).length;
    if (count === 0) return 'none';
    if (count === targetMessages.length) return 'all';
    return 'some';
  };

  const handleApplyLabels = async (draft: Map<string, GmailLabelDraftState>) => {
    if (targetMessages.length === 0) return;
    setLabelApplying(true);
    try {
      const updates = await Promise.all(
        targetMessages.map(async (m) => {
          const addLabelIds: string[] = [];
          const removeLabelIds: string[] = [];
          for (const label of userLabels) {
            const draftState = draft.get(label.id);
            const has = m.labelIds.includes(label.id);
            if (draftState === true && !has) addLabelIds.push(label.id);
            if (draftState === false && has) removeLabelIds.push(label.id);
          }
          if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
            return {
              messageId: m.id,
              threadId: m.threadId,
              labelIds: m.labelIds,
            };
          }
          const result = await modifyGmailMessage(
            mailbox,
            m.id,
            { addLabelIds, removeLabelIds },
            m.threadId
          );
          return {
            messageId: result.id,
            threadId: m.threadId,
            labelIds: result.labelIds,
          };
        })
      );
      onLabelsApplied(updates);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update labels.');
      throw e;
    } finally {
      setLabelApplying(false);
    }
  };

  const isDisabled = disabled || busy || labelApplying || targetMessages.length === 0;
  const isMessageVariant = variant === 'message';

  const primaryActions = (
    <>
      <button
        type="button"
        className="gmail-inbox__list-toolbar-btn gmail-bulk-toolbar__primary-btn"
        aria-label="Archive"
        title="Archive"
        disabled={isDisabled}
        onClick={handleArchive}
      >
        <ArchiveDownIcon size={20} />
      </button>
      <button
        type="button"
        className="gmail-inbox__list-toolbar-btn gmail-bulk-toolbar__primary-btn"
        aria-label="Delete"
        title="Delete"
        disabled={isDisabled}
        onClick={handleTrash}
      >
        <Trash2 size={20} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="gmail-inbox__list-toolbar-btn gmail-bulk-toolbar__primary-btn"
        aria-label="Mark as unread"
        title="Mark as unread"
        disabled={isDisabled}
        onClick={handleMarkUnread}
      >
        <span className="gmail-bulk-toolbar__unread-icon">
          <Mail size={20} strokeWidth={1.75} aria-hidden />
          <span className="gmail-bulk-toolbar__unread-dot" aria-hidden />
        </span>
      </button>
    </>
  );

  const moveMenu = openMenu === 'move' ? (
    <div className="gmail-bulk-menu gmail-bulk-menu--wide" role="menu" aria-label="Move to">
      <div className="gmail-bulk-menu__title">Move to:</div>
      <div className="gmail-bulk-menu__search">
        <input
          type="search"
          value={moveFilter}
          onChange={(e) => setMoveFilter(e.target.value)}
          placeholder="Search folders"
          aria-label="Search folders"
          autoFocus
        />
        <Search size={16} strokeWidth={1.75} aria-hidden />
      </div>
      <ul className="gmail-bulk-menu__list gmail-bulk-menu__list--scroll">
        {systemMoveTargets.length === 0 && filteredMoveRows.length === 0 ? (
          <li className="gmail-bulk-menu__empty">No folders found</li>
        ) : (
          <>
            {systemMoveTargets.map((label) => (
              <li key={label.id}>
                <button
                  type="button"
                  className="gmail-bulk-menu__item"
                  role="menuitem"
                  onClick={() => handleMoveTo(label.id)}
                >
                  {labelDisplayName(label)}
                </button>
              </li>
            ))}
            {filteredMoveRows.map((row) => (
              <MoveMenuLabelRow key={row.label.id} row={row} onMove={handleMoveTo} />
            ))}
          </>
        )}
      </ul>
    </div>
  ) : null;

  if (isMessageVariant) {
    return (
      <div
        className="gmail-bulk-toolbar gmail-bulk-toolbar--message"
        ref={rootRef}
      >
        {primaryActions}
        <div className="gmail-bulk-toolbar__menu-wrap">
          <button
            type="button"
            className={`gmail-inbox__list-toolbar-btn gmail-bulk-toolbar__primary-btn${openMenu ? ' gmail-inbox__list-toolbar-btn--active' : ''}`}
            aria-label="More actions"
            aria-expanded={Boolean(openMenu)}
            title="More"
            disabled={isDisabled}
            onClick={() => {
              setOpenMenu((m) => {
                if (m) {
                  setMoveFilter('');
                  return null;
                }
                return 'more';
              });
            }}
          >
            <EllipsisVertical size={20} strokeWidth={1.75} aria-hidden />
          </button>
          {openMenu === 'more' ? (
            <div className="gmail-bulk-menu" role="menu" aria-label="More actions">
              <button
                type="button"
                className="gmail-bulk-menu__item"
                role="menuitem"
                onClick={() => setOpenMenu('move')}
              >
                <FolderInput size={16} strokeWidth={1.75} aria-hidden />
                Move to
              </button>
              <div className="gmail-bulk-toolbar__more-label">
                <GmailLabelPicker
                  userLabels={userLabels}
                  labelState={labelState}
                  onApply={async (draft) => {
                    await handleApplyLabels(draft);
                    setOpenMenu(null);
                  }}
                  disabled={isDisabled}
                  applying={labelApplying}
                  trigger="detail-button"
                />
              </div>
            </div>
          ) : null}
          {moveMenu}
        </div>
      </div>
    );
  }

  return (
    <div className="gmail-bulk-toolbar" ref={rootRef}>
      <button
        type="button"
        className="gmail-inbox__list-toolbar-btn"
        aria-label="Archive selected messages"
        title="Archive"
        disabled={isDisabled}
        onClick={handleArchive}
      >
        <ArchiveDownIcon size={18} />
      </button>
      <button
        type="button"
        className="gmail-inbox__list-toolbar-btn"
        aria-label="Delete selected messages"
        title="Delete"
        disabled={isDisabled}
        onClick={handleTrash}
      >
        <Trash2 size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="gmail-inbox__list-toolbar-btn"
        aria-label="Mark selected messages as unread"
        title="Mark as unread"
        disabled={isDisabled}
        onClick={handleMarkUnread}
      >
        <span className="gmail-bulk-toolbar__unread-icon">
          <Mail size={18} strokeWidth={1.75} aria-hidden />
          <span className="gmail-bulk-toolbar__unread-dot" aria-hidden />
        </span>
      </button>

      <div className="gmail-bulk-toolbar__menu-wrap">
        <button
          type="button"
          className={`gmail-inbox__list-toolbar-btn${openMenu === 'move' ? ' gmail-inbox__list-toolbar-btn--active' : ''}`}
          aria-label="Move to label"
          aria-expanded={openMenu === 'move'}
          title="Move to"
          disabled={isDisabled}
          onClick={() => {
            setOpenMenu((m) => {
              if (m === 'move') {
                setMoveFilter('');
                return null;
              }
              setMoveFilter('');
              return 'move';
            });
          }}
        >
          <FolderInput size={18} strokeWidth={1.75} aria-hidden />
        </button>
        {moveMenu}
      </div>

      <GmailLabelPicker
        userLabels={userLabels}
        labelState={labelState}
        onApply={handleApplyLabels}
        disabled={isDisabled}
        applying={labelApplying}
        trigger="toolbar-icon"
      />
    </div>
  );
}
