import { useEffect, useRef } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import GmailSearchFilterPanel from './GmailSearchFilterPanel';
import { hasActiveSearchFilter, type GmailSearchFilterFields } from './gmailSearch';

type Props = {
  value: string;
  onChange: (value: string) => void;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  filterDraft: GmailSearchFilterFields;
  onFilterDraftChange: (draft: GmailSearchFilterFields) => void;
  appliedFilter: GmailSearchFilterFields;
  onApplyFilter: () => void;
  onSubmit: () => void;
};

export default function GmailSearchBar({
  value,
  onChange,
  filterOpen,
  onFilterOpenChange,
  filterDraft,
  onFilterDraftChange,
  appliedFilter,
  onApplyFilter,
  onSubmit,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const filterActive = hasActiveSearchFilter(appliedFilter);

  useEffect(() => {
    if (!filterOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onFilterOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [filterOpen, onFilterOpenChange]);

  return (
    <div className="gmail-inbox__search-wrap" ref={wrapRef}>
      <div className={`gmail-inbox__search${filterActive ? ' gmail-inbox__search--filtered' : ''}`}>
        <Search size={16} strokeWidth={1.75} aria-hidden />
        <input
          type="search"
          className="gmail-inbox__search-input"
          placeholder="Search mail"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          aria-label="Search mail"
        />
        <button
          type="button"
          className={`gmail-inbox__search-filter-btn${filterOpen ? ' gmail-inbox__search-filter-btn--active' : ''}${filterActive ? ' gmail-inbox__search-filter-btn--on' : ''}`}
          aria-label="Show search options"
          aria-expanded={filterOpen}
          onClick={() => onFilterOpenChange(!filterOpen)}
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <GmailSearchFilterPanel
        open={filterOpen}
        draft={filterDraft}
        onChange={onFilterDraftChange}
        onSearch={() => {
          onApplyFilter();
          onFilterOpenChange(false);
        }}
      />
    </div>
  );
}
