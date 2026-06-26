export const SCHEDULING_TOOLS_LIST_PAGE_SIZE = 25;

type Props = {
  listPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
};

export default function SchedulingToolsListPagination({
  listPage,
  totalItems,
  onPageChange,
  itemLabel = 'items',
}: Props) {
  const pageSize = SCHEDULING_TOOLS_LIST_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const start = (listPage - 1) * pageSize + 1;
  const end = Math.min(listPage * pageSize, totalItems);

  return (
    <div
      className="scheduling-tools-list-pagination"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 16,
        marginBottom: 8,
      }}
    >
      <span className="settings-muted" style={{ fontSize: 13 }}>
        Showing {start}–{end} of {totalItems} {itemLabel}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn secondary"
          disabled={listPage <= 1}
          onClick={() => onPageChange(listPage - 1)}
        >
          Previous
        </button>
        <span className="settings-muted" style={{ fontSize: 13, minWidth: 96, textAlign: 'center' }}>
          Page {listPage} of {totalPages}
        </span>
        <button
          type="button"
          className="btn secondary"
          disabled={listPage >= totalPages}
          onClick={() => onPageChange(listPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function paginateSchedulingToolsList<T>(
  items: readonly T[],
  listPage: number,
  pageSize = SCHEDULING_TOOLS_LIST_PAGE_SIZE,
): T[] {
  const start = (listPage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function schedulingToolsListTotalPages(
  totalItems: number,
  pageSize = SCHEDULING_TOOLS_LIST_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}
