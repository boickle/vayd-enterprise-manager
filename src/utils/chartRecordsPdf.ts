import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { IdexxResultDetail } from '../api/idexx';
import type { ChartRow } from './patientChartFromMedicalRecord';

/** Billing adjustments are not part of a medical record. */
const NOT_RECORD =
  /\bdiscount\b|\bpay link\b|\bgift card\b|\bstore credit\b|\bprofessional courtesy\b/i;

/**
 * eVet charted the stock item next to the product it was given as ("Rabies Inventory" beside
 * "Rabies Vaccine - 3 year"). The stock line repeats the product, so it stays off the record.
 */
const STOCK_LINE = /\binventory\b/i;
const STOCK_SOURCES = new Set<ChartRow['source']>(['treatment', 'visitCharge']);

/**
 * Timeline rows that belong in a records PDF, newest first, each once. Removed entries are left
 * out unless staff chose to include them (they print labelled as removed).
 */
export function chartRecordRows(
  rows: ChartRow[],
  opts: { includeRemoved?: boolean } = {}
): ChartRow[] {
  const seenFiles = new Set<number>();
  const seenRows = new Set<string>();
  const seenEntries = new Set<string>();
  const list = rows.filter((row) => {
    if ((row.removed && !opts.includeRemoved) || seenRows.has(row.id)) return false;
    if (NOT_RECORD.test(row.description)) return false;
    if (STOCK_SOURCES.has(row.source) && STOCK_LINE.test(row.description)) return false;
    if (row.source === 'mailOrder' || row.source === 'roomLoader') return false;
    if (isFileRow(row)) {
      const id = Number(row.fileDocumentId);
      if (seenFiles.has(id)) return false;
      seenFiles.add(id);
    } else {
      // The same exam form saved three times prints once.
      const day = (row.serviceDateIso ?? '').slice(0, 10);
      const key = [day, row.typeLabel, row.description, row.detailText, row.printText ?? ''].join(
        '|'
      );
      if (seenEntries.has(key)) return false;
      seenEntries.add(key);
    }
    seenRows.add(row.id);
    return true;
  });
  return [...list].sort((a, b) => b.sortTime - a.sortTime);
}

/** Lines that are bookkeeping, not medicine. */
const DETAIL_NOISE = [/^membership covered$/i, /^no directions on file$/i, /^pims:\s*\S+$/i];

/**
 * A chart entry's text as it should read on paper: imported HTML (eVet notes, TeleVet
 * transcripts) becomes plain text, and billing and system lines are dropped.
 */
export function recordDetailText(text: string): string {
  const html = /<\/?[a-z][^>]*>/i.test(text) ? htmlToText(text) : text;
  return html
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => !DETAIL_NOISE.some((re) => re.test(line.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Who did it, unless the "provider" is a billing account or a placeholder. */
export function recordProvider(provider: string): string {
  const p = provider.trim();
  return !p || p === '—' || /hospital account/i.test(p) ? '' : p;
}

/** A section heading in a records summary: a short all-caps line such as "PROBLEMS". */
const SECTION_HEADING = /^\s*(?:#+\s*)?\**\s*[A-Z][A-Z0-9 &/,'()?-]{2,60}\s*\**\s*:?\s*$/;
const HANDLING_HEADING = /^\s*(?:#+\s*)?\**\s*HANDLING\s*\**\s*:?\s*$/;

/**
 * Records leaving the practice never carry handling notes (bite or aggression history,
 * what worked, the HANDLING ALERT line) from an outside-records summary; those are for
 * staff. Removes the HANDLING section up to the next heading.
 */
export function withoutHandlingSection(text: string): string {
  if (!/HANDLING/.test(text)) return text;
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (HANDLING_HEADING.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && SECTION_HEADING.test(line) && !/HANDLING/.test(line)) skipping = false;
    if (skipping) continue;
    if (/^\s*\**\s*HANDLING ALERT\b/i.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function isFileRow(row: ChartRow): boolean {
  const id = Number(row.fileDocumentId);
  const patient = Number(row.filePatientId);
  return (
    row.source === 'document' &&
    Number.isFinite(id) &&
    id > 0 &&
    Number.isFinite(patient) &&
    patient > 0
  );
}

/** One result line in a lab table. `flag` is H or L when outside the reference range. */
export type LabRow = {
  test: string;
  result: string;
  units: string;
  range: string;
  flag: '' | 'H' | 'L';
};
export type LabSection = { name: string; rows: LabRow[]; notes: string[] };
export type LabReport = { meta: string; sections: LabSection[]; notes: string[] };

export type RecordPdfEntry =
  | { kind: 'file'; name: string; filename: string; blob: Blob }
  | {
      kind: 'text';
      date: string;
      typeLabel: string;
      description: string;
      provider: string;
      detail: string;
      /** Lab results, printed as a table under the entry. */
      lab?: LabReport;
    };

/** The top of the first page. */
export type RecordsCover = {
  practice: string;
  patientName: string;
  /** Signalment, date of birth, microchip: whatever is on file. */
  facts: string[];
  owner: string;
  printedOn: string;
  /** "Includes removed entries", a date range, and so on. */
  note?: string;
};

export type RecordPdfResult = {
  blob: Blob;
  included: number;
  skipped: string[];
};

const MAX_EDGE_PX = 1600;
const MAX_PAGE_PT = 792;
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const FOOTER_ROOM = 22;
const INK = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.4, 0.45, 0.52);
const ACCENT = rgb(0.11, 0.4, 0.31);
const BAND = rgb(0.93, 0.96, 0.94);
const RULE = rgb(0.86, 0.88, 0.9);
const ZEBRA = rgb(0.965, 0.972, 0.978);

function isPdf(blob: Blob, filename: string): boolean {
  return blob.type.toLowerCase().includes('pdf') || filename.toLowerCase().endsWith('.pdf');
}

function isImage(blob: Blob, filename: string): boolean {
  return (
    blob.type.toLowerCase().startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|heic|heif|tif|tiff|bmp)$/i.test(filename)
  );
}

/** Standard PDF fonts only cover Latin-1. */
function plain(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, '  ')
    .normalize('NFKC')
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, '');
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('head, style, script').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4').forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Lab text ────────────────────────────────────────────────────────────────

/** "GLUCOSE 85 mg/dL (63 - 114)", "TCO2 (BICARBONATE) 21 mmol/L (13 - 27)", "% BASOPHIL 0.3 %". */
const LAB_LINE =
  /^([A-Za-z%][A-Za-z0-9 %/().,:'+-]*?)\s+([<>]?\d[\d.,]*)\s*([A-Za-z%/][\w/%.^]*)?\s*(?:\(([^()]*)\))?$/;
/** A short heading inside a lab printout: "IDEXX CBC", "CHEM 25 w/ TRIG SDMA". */
const LAB_HEADING = /^[A-Z][A-Za-z0-9 /&().,'-]{1,48}$/;

/** Mostly capitals, like a panel name ("CHEM 25 w/ TRIG SDMA"), not a sentence. */
function isLabHeading(line: string): boolean {
  if (!LAB_HEADING.test(line)) return false;
  const letters = line.replace(/[^A-Za-z]/g, '');
  const upper = line.replace(/[^A-Z]/g, '');
  return letters.length >= 2 && upper.length / letters.length >= 0.75;
}

export function labFlag(result: string, range: string): '' | 'H' | 'L' {
  const value = Number(result.replace(/,/g, ''));
  const m = /^\s*(-?\d[\d.,]*)\s*-\s*(-?\d[\d.,]*)\s*$/.exec(range);
  if (!m || /^[<>]/.test(result) || !Number.isFinite(value)) return '';
  const lo = Number(m[1]!.replace(/,/g, ''));
  const hi = Number(m[2]!.replace(/,/g, ''));
  if (value < lo) return 'L';
  if (value > hi) return 'H';
  return '';
}

export function labRowFromLine(line: string): LabRow | null {
  const m = LAB_LINE.exec(line.trim());
  if (!m) return null;
  const range = (m[4] ?? '').trim();
  const result = m[2]!;
  return { test: m[1]!.trim(), result, units: m[3] ?? '', range, flag: labFlag(result, range) };
}

type DetailBlock = { kind: 'text'; text: string } | { kind: 'lab'; sections: LabSection[] };

/**
 * Splits an entry's text into prose and lab tables. A run of at least three result lines
 * ("GLUCOSE 85 mg/dL (63 - 114)") becomes a table; headings inside the run start a section.
 */
export function detailBlocks(detail: string): DetailBlock[] {
  const lines = detail.split('\n');
  const blocks: DetailBlock[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    const text = prose.join('\n').trim();
    if (text) blocks.push({ kind: 'text', text });
    prose = [];
  };
  let i = 0;
  while (i < lines.length) {
    // Find the run of result lines (and headings) starting here.
    let j = i;
    let results = 0;
    const sections: LabSection[] = [];
    let current: LabSection | null = null;
    let pendingHeading: string | null = null;
    /** Just past the last result in the run; a heading after it belongs to the prose that follows. */
    let end = i;
    while (j < lines.length) {
      const line = lines[j]!.trim();
      const row = line ? labRowFromLine(line) : null;
      if (row) {
        if (!current || pendingHeading != null) {
          current = { name: pendingHeading ?? '', rows: [], notes: [] };
          sections.push(current);
          pendingHeading = null;
        }
        current.rows.push(row);
        results += 1;
        end = j + 1;
      } else if (line && isLabHeading(line)) {
        pendingHeading = line;
      } else if (
        line &&
        current &&
        results > 0 &&
        j + 1 < lines.length &&
        labRowFromLine(lines[j + 1]!.trim())
      ) {
        // A one-line comment between results ("SDMA is within ...") stays with the table.
        current.notes.push(line);
      } else if (line) {
        break;
      }
      j += 1;
    }
    if (results >= 3) {
      flushProse();
      blocks.push({ kind: 'lab', sections });
      i = end;
      continue;
    }
    prose.push(lines[i]!);
    i += 1;
  }
  flushProse();
  return blocks;
}

/**
 * An IDEXX result as printed tables, one per panel. Out-of-range values carry H or L; nothing
 * else is called out (no critical banners or internal review notes).
 */
export function labReportFromIdexx(detail: IdexxResultDetail): LabReport {
  const sections: LabSection[] = (detail.categories ?? []).map((cat) => ({
    name: cat.name?.trim() || '',
    rows: (cat.tests ?? []).map((t) => {
      const raw = t.result?.trim() || (t.resultNumeric != null ? String(t.resultNumeric) : '');
      const qualifier = t.qualifier?.trim() ?? '';
      const result = qualifier && !raw.startsWith(qualifier) ? `${qualifier}${raw}` : raw;
      const range =
        t.referenceRange?.trim() || (t.low != null && t.high != null ? `${t.low} - ${t.high}` : '');
      const code = (t.outOfRangeCode ?? '').toUpperCase();
      const flag: LabRow['flag'] = code.startsWith('H')
        ? 'H'
        : code.startsWith('L')
          ? 'L'
          : t.outOfRange
            ? labFlag(result, range)
            : '';
      return {
        test: t.name?.trim() || t.analyte?.trim() || t.code || '',
        result,
        units: t.units ?? '',
        range,
        flag,
      };
    }),
    notes: [
      ...(cat.notes ?? []).map((n) => n.content?.trim()).filter((n): n is string => Boolean(n)),
      ...(cat.tests ?? []).flatMap((t) =>
        (t.notes ?? []).filter(Boolean).map((n) => `${t.name ?? t.analyte ?? ''}: ${n}`.trim())
      ),
    ],
  }));
  const meta = [
    detail.accessionId && `Accession ${detail.accessionId}`,
    detail.veterinarian && `Ordered by ${detail.veterinarian}`,
    detail.specimenCollectionDate &&
      `Collected ${new Date(detail.specimenCollectionDate).toLocaleDateString('en-US')}`,
  ]
    .filter(Boolean)
    .join('  |  ');
  const overall = detail.notes?.content?.trim();
  return { meta, sections, notes: overall ? [overall] : [] };
}

// ── Layout ──────────────────────────────────────────────────────────────────

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of plain(text).split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** Text cut to fit a table cell. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = plain(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

function longDate(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

type Style = { size: number; bold?: boolean; color?: ReturnType<typeof rgb> };

/** Writes the record pages: a cover header, then entries grouped under date bands. */
class RecordWriter {
  private page: PDFPage | null = null;
  private y = 0;
  private lastDate: string | null = null;
  /** Pages this writer drew, for page numbers (attached PDFs keep their own look). */
  readonly pages: PDFPage[] = [];
  private readonly width = PAGE_W - MARGIN * 2;

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private cover: RecordsCover
  ) {}

  private fontFor(style: Style) {
    return style.bold ? this.bold : this.font;
  }

  private draw(text: string, x: number, y: number, style: Style) {
    this.page!.drawText(plain(text), {
      x,
      y,
      size: style.size,
      font: this.fontFor(style),
      color: style.color ?? INK,
    });
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    const top = PAGE_H - MARGIN + 14;
    this.draw(`${this.cover.patientName} - Medical record`, MARGIN, top, {
      size: 8.5,
      color: MUTED,
    });
    const right = plain(this.cover.practice);
    this.draw(right, PAGE_W - MARGIN - this.font.widthOfTextAtSize(right, 8.5), top, {
      size: 8.5,
      color: MUTED,
    });
    this.page.drawLine({
      start: { x: MARGIN, y: top - 6 },
      end: { x: PAGE_W - MARGIN, y: top - 6 },
      thickness: 0.5,
      color: RULE,
    });
    this.y = top - 22;
  }

  private ensure(height: number) {
    if (!this.page || this.y - height < MARGIN + FOOTER_ROOM) this.newPage();
  }

  /** Wrapped text at an indent; breaks across pages line by line. */
  private paragraph(text: string, indent: number, style: Style, width = this.width - indent) {
    const lineH = style.size * 1.38;
    for (const line of wrap(text, this.fontFor(style), style.size, width)) {
      this.ensure(lineH);
      if (line) this.draw(line, MARGIN + indent, this.y - style.size, style);
      this.y -= lineH;
    }
  }

  /** The next file starts on its own page, so text after it starts fresh too. */
  close() {
    this.page = null;
    this.lastDate = null;
  }

  writeCover() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    let y = PAGE_H - MARGIN;
    this.draw(this.cover.practice.toUpperCase(), MARGIN, y - 10, {
      size: 10,
      bold: true,
      color: ACCENT,
    });
    const label = 'MEDICAL RECORD';
    this.draw(label, PAGE_W - MARGIN - this.bold.widthOfTextAtSize(label, 9), y - 10, {
      size: 9,
      bold: true,
      color: MUTED,
    });
    y -= 22;
    this.page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 1.5,
      color: ACCENT,
    });
    y -= 34;
    this.draw(this.cover.patientName, MARGIN, y, { size: 24, bold: true });
    y -= 20;
    this.y = y + 10;
    const facts = this.cover.facts.filter(Boolean).join('   |   ');
    if (facts) this.paragraph(facts, 0, { size: 10.5, color: INK });
    const owner = [
      this.cover.owner && `Owner: ${this.cover.owner}`,
      `Printed ${this.cover.printedOn}`,
    ]
      .filter(Boolean)
      .join('   |   ');
    this.paragraph(owner, 0, { size: 9.5, color: MUTED });
    if (this.cover.note) this.paragraph(this.cover.note, 0, { size: 9.5, color: MUTED });
    this.y -= 14;
  }

  private dateBand(date: string) {
    // Room for the band and the start of its first entry, so a date never sits alone at the foot.
    this.ensure(110);
    this.y -= 6;
    const h = 20;
    this.page!.drawRectangle({
      x: MARGIN,
      y: this.y - h,
      width: this.width,
      height: h,
      color: BAND,
    });
    this.page!.drawRectangle({ x: MARGIN, y: this.y - h, width: 3, height: h, color: ACCENT });
    this.draw(date ? longDate(date) : 'Date not recorded', MARGIN + 10, this.y - 14, {
      size: 10.5,
      bold: true,
      color: ACCENT,
    });
    this.y -= h + 8;
  }

  write(entry: Extract<RecordPdfEntry, { kind: 'text' }>) {
    if (entry.date !== this.lastDate) {
      this.dateBand(entry.date);
      this.lastDate = entry.date;
    }
    this.ensure(44);
    // Type, then the description with the provider on the right.
    this.draw(entry.typeLabel.toUpperCase(), MARGIN + 10, this.y - 7.5, {
      size: 7.5,
      bold: true,
      color: ACCENT,
    });
    this.y -= 12;
    const provider = plain(entry.provider.trim());
    const providerW = provider ? this.font.widthOfTextAtSize(provider, 9) + 16 : 0;
    const descLines = wrap(entry.description, this.bold, 10.5, this.width - 10 - providerW);
    descLines.forEach((line, i) => {
      this.ensure(14.5);
      this.draw(line, MARGIN + 10, this.y - 10.5, { size: 10.5, bold: true });
      if (i === 0 && provider) {
        this.draw(provider, PAGE_W - MARGIN - providerW + 16, this.y - 10, {
          size: 9,
          color: MUTED,
        });
      }
      this.y -= 14.5;
    });

    const detail = entry.detail.trim();
    if (detail && detail !== entry.description.trim()) {
      this.y -= 2;
      for (const block of detailBlocks(detail)) {
        if (block.kind === 'text') this.paragraph(block.text, 10, { size: 9.5 });
        else this.labTable(block.sections);
      }
    }
    if (entry.lab) this.labReport(entry.lab);

    this.y -= 6;
    this.ensure(4);
    this.page!.drawLine({
      start: { x: MARGIN + 10, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 8;
  }

  private labReport(lab: LabReport) {
    if (lab.meta) this.paragraph(lab.meta, 10, { size: 8.5, color: MUTED });
    this.labTable(lab.sections);
    for (const note of lab.notes) this.paragraph(note, 10, { size: 8.5, color: MUTED });
  }

  private labTable(sections: LabSection[]) {
    const left = MARGIN + 10;
    const w = this.width - 10;
    const cols = { test: 0, result: w * 0.42, flag: w * 0.58, units: w * 0.64, range: w * 0.8 };
    const rowH = 13;
    const header = () => {
      this.ensure(rowH + 4);
      const style: Style = { size: 7.5, bold: true, color: MUTED };
      this.draw('TEST', left + 4 + cols.test, this.y - 9, style);
      this.draw('RESULT', left + cols.result, this.y - 9, style);
      this.draw('UNITS', left + cols.units, this.y - 9, style);
      this.draw('REFERENCE', left + cols.range, this.y - 9, style);
      this.y -= rowH;
    };
    for (const section of sections) {
      if (!section.rows.length && !section.notes.length) continue;
      this.y -= 4;
      if (section.name) {
        this.ensure(rowH * 3);
        this.draw(section.name.toUpperCase(), left, this.y - 9, {
          size: 8.5,
          bold: true,
          color: ACCENT,
        });
        this.y -= rowH;
      }
      header();
      section.rows.forEach((row, i) => {
        if (!this.page || this.y - rowH < MARGIN + FOOTER_ROOM) {
          this.newPage();
          header();
        }
        if (i % 2 === 0) {
          this.page!.drawRectangle({
            x: left,
            y: this.y - rowH + 2,
            width: w,
            height: rowH,
            color: ZEBRA,
          });
        }
        const flagged = row.flag !== '';
        const base: Style = { size: 8.5 };
        this.draw(fit(row.test, this.font, 8.5, cols.result - 10), left + 4, this.y - 8.5, base);
        this.draw(
          fit(row.result, this.bold, 8.5, cols.flag - cols.result - 4),
          left + cols.result,
          this.y - 8.5,
          {
            size: 8.5,
            bold: flagged,
          }
        );
        if (flagged) this.draw(row.flag, left + cols.flag, this.y - 8.5, { size: 8.5, bold: true });
        this.draw(
          fit(row.units, this.font, 8.5, cols.range - cols.units - 4),
          left + cols.units,
          this.y - 8.5,
          {
            size: 8.5,
            color: MUTED,
          }
        );
        this.draw(fit(row.range, this.font, 8.5, w - cols.range), left + cols.range, this.y - 8.5, {
          size: 8.5,
          color: MUTED,
        });
        this.y -= rowH;
      });
      for (const note of section.notes) this.paragraph(note, 14, { size: 8.5, color: MUTED });
    }
    this.y -= 4;
  }

  /** Page numbers count every page in the PDF, attachments included. */
  stampFooters() {
    const all = this.doc.getPages();
    const left = plain(`${this.cover.practice} - printed ${this.cover.printedOn}`);
    for (const page of this.pages) {
      const n = all.indexOf(page) + 1;
      const label = `Page ${n} of ${all.length}`;
      page.drawText(left, { x: MARGIN, y: MARGIN - 20, size: 8, font: this.font, color: MUTED });
      page.drawText(label, {
        x: PAGE_W - MARGIN - this.font.widthOfTextAtSize(label, 8),
        y: MARGIN - 20,
        size: 8,
        font: this.font,
        color: MUTED,
      });
    }
  }
}

/** Pictures that pdf-lib cannot embed directly become a JPEG. */
async function toJpeg(
  blob: Blob
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  if (!out) return null;
  return { bytes: new Uint8Array(await out.arrayBuffer()), width, height };
}

async function addImage(doc: PDFDocument, blob: Blob, filename: string): Promise<void> {
  const type = blob.type.toLowerCase();
  const png = type.includes('png') || filename.toLowerCase().endsWith('.png');
  const jpeg = type.includes('jpeg') || type.includes('jpg') || /\.jpe?g$/i.test(filename);
  let embedded;
  if (png || jpeg) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    embedded = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } else {
    const converted = await toJpeg(blob);
    if (!converted) throw new Error('unreadable picture');
    embedded = await doc.embedJpg(converted.bytes);
  }
  const scale = Math.min(MAX_PAGE_PT / embedded.width, MAX_PAGE_PT / embedded.height);
  const w = embedded.width * scale;
  const h = embedded.height * scale;
  const page = doc.addPage([w, h]);
  page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
}

/**
 * One PDF in the order given (newest first). Timeline rows are written as text under a cover
 * header; a PDF keeps its own page order and each picture gets a page.
 */
export async function buildChartRecordsPdf(
  entries: RecordPdfEntry[],
  cover: RecordsCover,
  onProgress?: (done: number, total: number, name: string) => void
): Promise<RecordPdfResult> {
  const doc = await PDFDocument.create();
  doc.setTitle(plain(`${cover.patientName} - medical record`));
  const writer = new RecordWriter(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    cover
  );
  writer.writeCover();
  const skipped: string[] = [];
  let included = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.kind === 'text') {
      writer.write(entry);
      included += 1;
      continue;
    }
    onProgress?.(i + 1, entries.length, entry.name);
    writer.close();
    try {
      if (isPdf(entry.blob, entry.filename)) {
        const src = await PDFDocument.load(await entry.blob.arrayBuffer(), {
          ignoreEncryption: true,
        });
        const pages = await doc.copyPages(src, src.getPageIndices());
        if (!pages.length) throw new Error('no pages');
        for (const page of pages) doc.addPage(page);
        included += 1;
      } else if (isImage(entry.blob, entry.filename)) {
        await addImage(doc, entry.blob, entry.filename);
        included += 1;
      } else {
        skipped.push(`${entry.name} (not a PDF or picture)`);
      }
    } catch {
      skipped.push(entry.name);
    }
  }
  if (!included) {
    throw new Error(
      skipped.length
        ? `None of these could be added: ${skipped.join('; ')}.`
        : 'Nothing to include.'
    );
  }
  writer.stampFooters();
  const bytes = await doc.save();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { blob: new Blob([copy as ArrayBuffer], { type: 'application/pdf' }), included, skipped };
}

export function recordsPdfFilename(patientName: string): string {
  const safe =
    patientName
      .trim()
      .replace(/[^\w .'-]+/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'patient';
  return `${safe} medical records.pdf`;
}
