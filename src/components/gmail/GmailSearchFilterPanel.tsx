import {
  EMPTY_GMAIL_SEARCH_FILTER,
  GMAIL_DATE_WITHIN_OPTIONS,
  type GmailSearchFilterFields,
} from './gmailSearch';

type Props = {
  open: boolean;
  draft: GmailSearchFilterFields;
  onChange: (draft: GmailSearchFilterFields) => void;
  onSearch: () => void;
};

export default function GmailSearchFilterPanel({
  open,
  draft,
  onChange,
  onSearch,
}: Props) {
  if (!open) return null;

  const set = (patch: Partial<GmailSearchFilterFields>) => onChange({ ...draft, ...patch });

  return (
    <div className="gmail-search-filter" role="dialog" aria-label="Search filter">
      <div className="gmail-search-filter__grid">
        <label className="gmail-search-filter__field">
          <span>From</span>
          <input
            type="text"
            value={draft.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label className="gmail-search-filter__field">
          <span>To</span>
          <input type="text" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label className="gmail-search-filter__field">
          <span>Subject</span>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => set({ subject: e.target.value })}
          />
        </label>
        <label className="gmail-search-filter__field">
          <span>Has the words</span>
          <input
            type="text"
            value={draft.hasWords}
            onChange={(e) => set({ hasWords: e.target.value })}
          />
        </label>
        <label className="gmail-search-filter__field">
          <span>Doesn&apos;t have</span>
          <input
            type="text"
            value={draft.notWords}
            onChange={(e) => set({ notWords: e.target.value })}
          />
        </label>
        <div className="gmail-search-filter__field gmail-search-filter__field--size">
          <span>Size</span>
          <div className="gmail-search-filter__size-row">
            <select
              value={draft.sizeOp}
              onChange={(e) =>
                set({ sizeOp: e.target.value as GmailSearchFilterFields['sizeOp'] })
              }
            >
              <option value="greater than">greater than</option>
              <option value="less than">less than</option>
            </select>
            <input
              type="number"
              min="0"
              value={draft.sizeValue}
              onChange={(e) => set({ sizeValue: e.target.value })}
            />
            <select
              value={draft.sizeUnit}
              onChange={(e) =>
                set({ sizeUnit: e.target.value as GmailSearchFilterFields['sizeUnit'] })
              }
            >
              <option value="KB">KB</option>
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </div>
        <div className="gmail-search-filter__field gmail-search-filter__field--date">
          <span>Date within</span>
          <div className="gmail-search-filter__date-row">
            <select
              value={draft.dateWithin}
              onChange={(e) => set({ dateWithin: e.target.value, date: '' })}
            >
              <option value="">Any time</option>
              {GMAIL_DATE_WITHIN_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
              aria-label="Specific date"
            />
          </div>
        </div>
        <label className="gmail-search-filter__field">
          <span>Search</span>
          <select
            value={draft.scope}
            onChange={(e) => set({ scope: e.target.value as GmailSearchFilterFields['scope'] })}
          >
            <option value="current">Current folder</option>
            <option value="all">All Mail</option>
            <option value="inbox">Inbox</option>
            <option value="sent">Sent</option>
            <option value="drafts">Drafts</option>
            <option value="trash">Trash</option>
            <option value="spam">Spam</option>
          </select>
        </label>
      </div>

      <label className="gmail-search-filter__check">
        <input
          type="checkbox"
          checked={draft.hasAttachment}
          onChange={(e) => set({ hasAttachment: e.target.checked })}
        />
        Has attachment
      </label>

      <div className="gmail-search-filter__actions">
        <button
          type="button"
          className="gmail-search-filter__clear"
          onClick={() => onChange({ ...EMPTY_GMAIL_SEARCH_FILTER })}
        >
          Clear
        </button>
        <button type="button" className="gmail-btn gmail-btn--primary" onClick={onSearch}>
          Search
        </button>
      </div>
    </div>
  );
}
