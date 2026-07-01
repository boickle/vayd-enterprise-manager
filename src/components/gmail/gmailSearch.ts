export type GmailSearchScope =
  | 'current'
  | 'all'
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'spam';

export type GmailSearchFilterFields = {
  from: string;
  to: string;
  subject: string;
  hasWords: string;
  notWords: string;
  sizeOp: 'greater than' | 'less than';
  sizeValue: string;
  sizeUnit: 'KB' | 'MB' | 'GB';
  dateWithin: string;
  date: string;
  scope: GmailSearchScope;
  hasAttachment: boolean;
};

export const EMPTY_GMAIL_SEARCH_FILTER: GmailSearchFilterFields = {
  from: '',
  to: '',
  subject: '',
  hasWords: '',
  notWords: '',
  sizeOp: 'greater than',
  sizeValue: '',
  sizeUnit: 'MB',
  dateWithin: '',
  date: '',
  scope: 'current',
  hasAttachment: false,
};

export const GMAIL_DATE_WITHIN_OPTIONS = [
  '1 day',
  '3 days',
  '1 week',
  '2 weeks',
  '1 month',
  '2 months',
  '6 months',
  '1 year',
] as const;

const DATE_WITHIN_TO_GMAIL: Record<string, string> = {
  '1 day': '1d',
  '3 days': '3d',
  '1 week': '7d',
  '2 weeks': '14d',
  '1 month': '1m',
  '2 months': '2m',
  '6 months': '6m',
  '1 year': '1y',
};

const SCOPE_TO_GMAIL: Partial<Record<GmailSearchScope, string>> = {
  all: 'in:anywhere',
  inbox: 'in:inbox',
  sent: 'in:sent',
  drafts: 'in:drafts',
  trash: 'in:trash',
  spam: 'in:spam',
};

function quoteIfNeeded(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed)) return `"${trimmed.replace(/"/g, '')}"`;
  return trimmed;
}

function formatGmailDate(isoDate: string): string | null {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

export function buildGmailSearchQuery(
  filter: GmailSearchFilterFields,
  barText = '',
): string {
  const parts: string[] = [];

  const text = barText.trim();
  if (text) parts.push(text);

  if (filter.from.trim()) parts.push(`from:${quoteIfNeeded(filter.from)}`);
  if (filter.to.trim()) parts.push(`to:${quoteIfNeeded(filter.to)}`);
  if (filter.subject.trim()) parts.push(`subject:${quoteIfNeeded(filter.subject)}`);
  if (filter.hasWords.trim()) parts.push(quoteIfNeeded(filter.hasWords));

  for (const word of filter.notWords.split(/\s+/).filter(Boolean)) {
    parts.push(`-${quoteIfNeeded(word)}`);
  }

  if (filter.sizeValue.trim()) {
    const n = Number(filter.sizeValue);
    if (Number.isFinite(n) && n > 0) {
      const op = filter.sizeOp === 'greater than' ? 'larger' : 'smaller';
      parts.push(`${op}:${n}${filter.sizeUnit}`);
    }
  }

  const gmailDate = formatGmailDate(filter.date);
  if (gmailDate) {
    parts.push(`after:${gmailDate}`);
  } else if (filter.dateWithin.trim()) {
    const rel = DATE_WITHIN_TO_GMAIL[filter.dateWithin];
    if (rel) parts.push(`newer_than:${rel}`);
  }

  const scopeQ = SCOPE_TO_GMAIL[filter.scope];
  if (scopeQ) parts.push(scopeQ);

  if (filter.hasAttachment) parts.push('has:attachment');

  return parts.join(' ').trim();
}

export function searchLabelIdForScope(
  scope: GmailSearchScope,
  currentLabelId: string,
): string {
  switch (scope) {
    case 'inbox':
      return 'INBOX';
    case 'sent':
      return 'SENT';
    case 'drafts':
      return 'DRAFT';
    case 'trash':
      return 'TRASH';
    case 'spam':
      return 'SPAM';
    case 'all':
      return 'INBOX';
    case 'current':
    default:
      return currentLabelId;
  }
}

export function hasActiveSearchFilter(filter: GmailSearchFilterFields): boolean {
  return (
    !!filter.from.trim() ||
    !!filter.to.trim() ||
    !!filter.subject.trim() ||
    !!filter.hasWords.trim() ||
    !!filter.notWords.trim() ||
    !!filter.sizeValue.trim() ||
    !!filter.date.trim() ||
    !!filter.dateWithin.trim() ||
    filter.hasAttachment ||
    filter.scope !== 'current'
  );
}
