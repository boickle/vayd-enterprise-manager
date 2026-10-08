import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ChartRow } from './patientChartFromMedicalRecord';

/** Billing adjustments are not part of a medical record. */
const NOT_RECORD = /\bdiscount\b|\bpay link\b|\bgift card\b|\bstore credit\b/i;

/** Timeline rows that belong in a records PDF, newest first, each once. */
export function chartRecordRows(rows: ChartRow[]): ChartRow[] {
  const seenFiles = new Set<number>();
  const seenRows = new Set<string>();
  const list = rows.filter((row) => {
    if (row.removed || seenRows.has(row.id)) return false;
    if (row.source === 'visitCharge' && NOT_RECORD.test(row.description)) return false;
    if (row.source === 'mailOrder' || row.source === 'roomLoader') return false;
    if (isFileRow(row)) {
      const id = Number(row.fileDocumentId);
      if (seenFiles.has(id)) return false;
      seenFiles.add(id);
    }
    seenRows.add(row.id);
    return true;
  });
  return [...list].sort((a, b) => b.sortTime - a.sortTime);
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

export type RecordPdfEntry =
  | { kind: 'file'; name: string; filename: string; blob: Blob }
  | {
      kind: 'text';
      date: string;
      typeLabel: string;
      description: string;
      provider: string;
      detail: string;
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
const INK = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.4, 0.45, 0.52);

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
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4').forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

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

/** Writes timeline rows as plain pages, starting a new page when one fills up. */
class TextWriter {
  private page: PDFPage | null = null;
  private y = 0;
  private doc: PDFDocument;
  private font: PDFFont;
  private bold: PDFFont;
  private header: string;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, header: string) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.header = header;
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
    this.page.drawText(plain(this.header), {
      x: MARGIN,
      y: this.y,
      size: 9,
      font: this.font,
      color: MUTED,
    });
    this.y -= 22;
  }

  /** The next file starts on its own page, so text after it starts fresh too. */
  close() {
    this.page = null;
  }

  private line(text: string, opts: { size: number; bold?: boolean; color?: typeof INK }) {
    const lineH = opts.size * 1.35;
    if (!this.page || this.y - lineH < MARGIN) this.newPage();
    this.page!.drawText(text, {
      x: MARGIN,
      y: this.y - opts.size,
      size: opts.size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
    this.y -= lineH;
  }

  write(entry: Extract<RecordPdfEntry, { kind: 'text' }>) {
    const width = PAGE_W - MARGIN * 2;
    if (!this.page || this.y - 60 < MARGIN) this.newPage();
    else this.y -= 8;
    const head = [entry.date, entry.typeLabel].filter(Boolean).join('  ·  ');
    for (const l of wrap(head, this.bold, 10.5, width)) this.line(l, { size: 10.5, bold: true });
    for (const l of wrap(entry.description, this.font, 10, width)) this.line(l, { size: 10 });
    if (entry.provider.trim()) {
      for (const l of wrap(entry.provider, this.font, 9, width)) {
        this.line(l, { size: 9, color: MUTED });
      }
    }
    const detail = entry.detail.trim();
    if (detail && detail !== entry.description.trim()) {
      this.y -= 3;
      for (const l of wrap(detail, this.font, 9.5, width)) this.line(l, { size: 9.5 });
    }
    this.y -= 4;
    this.page!.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.5,
      color: rgb(0.85, 0.87, 0.9),
    });
    this.y -= 4;
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
 * One PDF in the order given (newest first). Timeline rows are written as text;
 * a PDF keeps its own page order and each picture gets a page.
 */
export async function buildChartRecordsPdf(
  entries: RecordPdfEntry[],
  header: string,
  onProgress?: (done: number, total: number, name: string) => void
): Promise<RecordPdfResult> {
  const doc = await PDFDocument.create();
  const writer = new TextWriter(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    header
  );
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
