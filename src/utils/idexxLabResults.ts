/** IDEXX VetConnect PLUS result XML (stored on eVet lab order results as `externalData`). */

export type IdexxTest = {
  name: string;
  value: string;
  units: string;
  low: string;
  high: string;
  /** Worked out from the reference range — the XML carries no flag of its own. */
  flag: 'HIGH' | 'LOW' | null;
  notes: string[];
};

export type IdexxPanel = {
  name: string;
  /** 0 for a top-level profile, 1 for a panel inside it, and so on. */
  depth: number;
  tests: IdexxTest[];
};

export type IdexxReport = {
  accession: string;
  requisitionId: string;
  orderedBy: string;
  status: 'Final' | 'Partial' | string;
  /** Top-level profile names, e.g. "YNG WELLNESS FECAL Dx 4Dx". */
  title: string;
  panels: IdexxPanel[];
};

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}

function child(el: Element, name: string): Element | undefined {
  return children(el, name)[0];
}

function text(el: Element | undefined): string {
  return (el?.textContent ?? '').trim();
}

/** Attributes are namespaced (`d1p1:name`); match on the local name. */
function attr(el: Element, name: string): string {
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name) return a.value.trim();
  }
  return '';
}

function flagFor(value: string, low: string, high: string): IdexxTest['flag'] {
  const v = Number(value.replace(/^[<>]=?\s*/, ''));
  if (!Number.isFinite(v) || /^[<>]/.test(value)) return null;
  const lo = low === '' ? NaN : Number(low);
  const hi = high === '' ? NaN : Number(high);
  if (Number.isFinite(lo) && v < lo) return 'LOW';
  if (Number.isFinite(hi) && v > hi) return 'HIGH';
  return null;
}

function statusLabel(code: string): string {
  if (code === 'F') return 'Final';
  if (code === 'P' || code === 'I') return 'Partial';
  return code;
}

export function isIdexxXml(raw: string | null | undefined): raw is string {
  return Boolean(raw && /<LabResults[\s>]/.test(raw) && /idexx\.com\/vetconnect/i.test(raw));
}

export function parseIdexxReport(raw: string | null | undefined): IdexxReport | null {
  if (!isIdexxXml(raw)) return null;
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = doc.documentElement;
  const accessionEl = Array.from(root.children).find((c) => c.localName === 'Accession');
  const results = accessionEl ? child(accessionEl, 'results') : undefined;
  if (!accessionEl || !results) return null;

  const panels: IdexxPanel[] = [];
  const walk = (el: Element, depth: number) => {
    for (const p of children(el, 'panels')) {
      const tests = children(p, 'tests').map((t): IdexxTest => {
        const value = text(child(t, 'result'));
        const low = text(child(t, 'lowRange'));
        const high = text(child(t, 'highRange'));
        return {
          name: attr(t, 'name'),
          value,
          units: text(child(t, 'resultUOM')),
          low,
          high,
          flag: flagFor(value, low, high),
          notes: children(t, 'notes')
            .map((n) => text(n))
            .filter(Boolean),
        };
      });
      panels.push({ name: attr(p, 'name'), depth, tests });
      walk(p, depth + 1);
    }
  };
  walk(results, 0);

  return {
    accession: attr(accessionEl, 'code'),
    requisitionId: attr(root, 'requisitionID'),
    orderedBy: attr(root, 'requisitionStaffName'),
    status: statusLabel(attr(accessionEl, 'statusCode')),
    title: children(results, 'panels')
      .map((p) => attr(p, 'name'))
      .filter((name) => name && !/^note from idexx$/i.test(name))
      .join(', '),
    panels,
  };
}

function rangeText(t: IdexxTest): string {
  if (t.low && t.high) return `${t.low} - ${t.high}`;
  return t.low || t.high;
}

/** "GLUCOSE 71 mg/dL LOW (72 - 175)" for each out-of-range value. */
export function idexxAbnormalLines(report: IdexxReport): string[] {
  return report.panels.flatMap((p) =>
    p.tests
      .filter((t) => t.flag)
      .map((t) => {
        const range = rangeText(t);
        return `${t.name} ${t.value}${t.units ? ` ${t.units}` : ''} ${t.flag}${range ? ` (${range})` : ''}`;
      })
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Result table in the style of the VetConnect report eVet shows. */
export function idexxReportHtml(report: IdexxReport): string {
  const head = [
    report.accession && `<div><strong>Accession Id:</strong> ${esc(report.accession)}</div>`,
    report.requisitionId &&
      `<div><strong>Requisition Id:</strong> ${esc(report.requisitionId)}</div>`,
    report.orderedBy && `<div><strong>Order By:</strong> ${esc(report.orderedBy)}</div>`,
    report.status && `<div><strong>Status:</strong> ${esc(report.status)}</div>`,
  ]
    .filter(Boolean)
    .join('');
  const rows = report.panels
    .map((p) => {
      const panelRow = `<tr class="idexx-lab__panel"><td colspan="6">${'&nbsp;'.repeat(p.depth * 3)}- ${esc(p.name)}</td></tr>`;
      const testRows = p.tests
        .map((t) => {
          const cls = t.flag ? ' class="idexx-lab__abnormal"' : '';
          const notes = t.notes.map((n) => `<div>${esc(n)}</div>`).join('');
          return `<tr${cls}><td>${esc(t.name)}</td><td>${esc(t.value)}</td><td>${esc(rangeText(t))}</td><td>${esc(t.units)}</td><td>${t.flag ?? ''}</td><td>${notes}</td></tr>`;
        })
        .join('');
      return panelRow + testRows;
    })
    .join('');
  return `<div class="idexx-lab"><div class="idexx-lab__head">${head}</div><table class="idexx-lab__table"><thead><tr><th>Test</th><th>Value</th><th>Range</th><th>Units</th><th>Status</th><th>Comments</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** Plain-text report for the records PDF. */
export function idexxReportText(report: IdexxReport): string {
  const lines: string[] = [
    [
      report.accession && `Accession ${report.accession}`,
      report.requisitionId && `Requisition ${report.requisitionId}`,
      report.orderedBy && `Ordered by ${report.orderedBy}`,
      report.status,
    ]
      .filter(Boolean)
      .join(' · '),
  ];
  for (const p of report.panels) {
    lines.push('', `${'  '.repeat(p.depth)}${p.name}`);
    for (const t of p.tests) {
      const range = rangeText(t);
      const main = [
        t.name,
        [t.value, t.units].filter(Boolean).join(' '),
        t.flag,
        range && `(${range})`,
      ]
        .filter(Boolean)
        .join('  ');
      lines.push(`${'  '.repeat(p.depth + 1)}${main}`);
      for (const n of t.notes) lines.push(`${'  '.repeat(p.depth + 2)}${n}`);
    }
  }
  return lines.join('\n');
}
