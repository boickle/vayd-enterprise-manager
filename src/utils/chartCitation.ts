export type CaseHistoryCiteKind = 'exam' | 'history' | 'chartNote' | 'soap';

export type CaseHistoryCitation = {
  ref: string;
  date: string;
  label: string;
  href: string;
  /** When set, Case history opens this record in place instead of leaving Epiphany. */
  kind?: CaseHistoryCiteKind;
  recordId?: string;
};

export function citationOpensInPlace(c: CaseHistoryCitation): boolean {
  return Boolean(c.kind && c.recordId);
}

export type CitedPart =
  | { type: 'text'; value: string }
  | { type: 'ref'; ref: string; citation: CaseHistoryCitation | null };

const REF_RE = /\[ref:([A-Za-z0-9_-]+)\]/g;

export function citationMap(citations: CaseHistoryCitation[]): Map<string, CaseHistoryCitation> {
  return new Map(citations.map((c) => [c.ref, c]));
}

export function splitCitedText(text: string, citations: CaseHistoryCitation[]): CitedPart[] {
  const map = citationMap(citations);
  const parts: CitedPart[] = [];
  let last = 0;
  const re = new RegExp(REF_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    const ref = m[1];
    parts.push({ type: 'ref', ref, citation: map.get(ref) ?? null });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

export function citationChipLabel(c: CaseHistoryCitation): string {
  if (c.date && c.date !== 'undated') return c.date;
  return c.label;
}

export function citationTitle(c: CaseHistoryCitation): string {
  return c.date && c.date !== 'undated' ? `${c.date} · ${c.label}` : c.label;
}
