/**
 * Black out DEA numbers on a supplier invoice before Scout stores it (owner, Nov 13, 2026).
 *
 * - Electronic PDFs: every page is drawn with pdf.js; DEA numbers are found in the page's own text
 *   (two letters + seven digits with a valid DEA check digit, or a number the invoice reader
 *   listed) and covered exactly where they are printed.
 * - Photos (and scanned PDFs with no text): the invoice reader marks where each DEA number sits;
 *   those boxes are padded and covered.
 *
 * The stored file is rebuilt from the covered page images, so the hidden text is gone, not just
 * painted over. `unsure` tells the screen to ask before keeping the file.
 */
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import jsPDF from 'jspdf';

export type InvoiceDeaMark = {
  text: string;
  /** 1-based page (or photo) number. */
  page: number;
  /** [left, top, right, bottom] as fractions of the page, or null when the reader couldn't place it. */
  box: [number, number, number, number] | null;
};

/** Pixel box on a drawn page: left, top, right, bottom. */
export type PxBox = [number, number, number, number];

export type RedactedInvoice = {
  file: File;
  /** Small images of each covered page, for the "check this" preview. */
  previews: string[];
  /** How many DEA numbers were covered. */
  covered: number;
  /** True when Scout can't be sure every DEA number is covered. */
  unsure: boolean;
  /** Plain-words reasons for `unsure`, shown to staff. */
  reasons: string[];
};

/** DEA check digit: (d1 + d3 + d5) + 2 × (d2 + d4 + d6); its last digit must equal d7. */
export function deaCheckDigitOk(dea: string): boolean {
  const m = /^[A-Z][A-Z9](\d{7})$/.exec(dea.toUpperCase());
  if (!m) return false;
  const d = m[1].split('').map(Number);
  const sum = d[0] + d[2] + d[4] + 2 * (d[1] + d[3] + d[5]);
  return sum % 10 === d[6];
}

/** Two letters (the second may be 9), an optional single space, seven digits; not inside a longer code. */
const DEA_IN_TEXT = /(?<![A-Z0-9])([A-Z][A-Z9]) ?(\d{7})(?![0-9])/g;

/** Start/end character offsets of DEA numbers in a line of text. */
export function findDeaSpans(
  text: string,
  known: ReadonlySet<string> = new Set()
): Array<{ start: number; end: number; dea: string }> {
  const out: Array<{ start: number; end: number; dea: string }> = [];
  const upper = text.toUpperCase();
  for (const m of upper.matchAll(DEA_IN_TEXT)) {
    const dea = `${m[1]}${m[2]}`;
    if (!deaCheckDigitOk(dea) && !known.has(dea)) continue;
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length, dea });
  }
  return out;
}

/** One run of text on a drawn page, in canvas pixels; `y` is the baseline. */
export type PlacedText = { str: string; x: number; y: number; width: number; height: number };

/**
 * Groups text runs into lines, joins each line (runs that touch are joined without a space, so a
 * number split across runs still matches), and returns a box for every DEA number found.
 */
export function deaBoxesFromText(
  items: PlacedText[],
  known: ReadonlySet<string> = new Set()
): Array<{ dea: string; box: PxBox }> {
  const runs = items
    .filter((it) => it.str && it.width > 0 && it.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PlacedText[][] = [];
  for (const run of runs) {
    const line = lines.find(
      (l) => Math.abs(l[0].y - run.y) <= Math.max(l[0].height, run.height) * 0.4
    );
    if (line) line.push(run);
    else lines.push([run]);
  }
  const found: Array<{ dea: string; box: PxBox }> = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let text = '';
    // For each character: its left and right x, and its run (for top/bottom).
    const chars: Array<{ l: number; r: number; run: PlacedText }> = [];
    let prev: PlacedText | null = null;
    for (const run of line) {
      if (prev) {
        const gap = run.x - (prev.x + prev.width);
        if (gap > run.height * 0.15) {
          text += ' ';
          chars.push({ l: prev.x + prev.width, r: run.x, run });
        }
      }
      const step = run.width / run.str.length;
      for (let i = 0; i < run.str.length; i++) {
        text += run.str[i];
        chars.push({ l: run.x + step * i, r: run.x + step * (i + 1), run });
      }
      prev = run;
    }
    for (const span of findDeaSpans(text, known)) {
      const cs = chars.slice(span.start, span.end);
      // Capitals and digits sit about 0.75 of the font size above the baseline; leave the line above alone.
      const top = Math.min(...cs.map((c) => c.run.y - c.run.height * 0.85));
      const bottom = Math.max(...cs.map((c) => c.run.y + c.run.height * 0.25));
      found.push({
        dea: span.dea,
        box: [cs[0].l - 2, top - 2, cs[cs.length - 1].r + 2, bottom + 2],
      });
    }
  }
  return found;
}

/**
 * A reader box (fractions of the page) in pixels, padded: the reader's boxes are close but not
 * exact, so cover a little more than it says.
 */
export function padReaderBox(box: [number, number, number, number], w: number, h: number): PxBox {
  const [l, t, r, b] = box;
  const bw = r - l;
  const bh = b - t;
  const padX = Math.max(bw * 0.15, 0.012);
  const padY = Math.max(bh * 0.4, 0.005);
  return [
    Math.max(0, (l - padX) * w),
    Math.max(0, (t - padY) * h),
    Math.min(w, (r + padX) * w),
    Math.min(h, (b + padY) * h),
  ];
}

function cover(ctx: CanvasRenderingContext2D, box: PxBox) {
  ctx.fillStyle = '#000';
  ctx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
}

const MAX_EDGE_PX = 1600;
const PREVIEW_EDGE_PX = 900;

type DrawnPage = { canvas: HTMLCanvasElement; widthPt: number; heightPt: number };

function previewOf(canvas: HTMLCanvasElement): string {
  const scale = Math.min(1, PREVIEW_EDGE_PX / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/jpeg', 0.8);
}

function pagesToPdf(pages: DrawnPage[], name: string): File {
  let doc: jsPDF | null = null;
  for (const p of pages) {
    const orientation = p.widthPt >= p.heightPt ? 'l' : 'p';
    if (!doc) {
      doc = new jsPDF({
        unit: 'pt',
        format: [p.widthPt, p.heightPt],
        orientation,
        compress: true,
      });
    } else {
      doc.addPage([p.widthPt, p.heightPt], orientation);
    }
    doc.addImage(p.canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, p.widthPt, p.heightPt);
  }
  if (!doc) throw new Error('Could not prepare the invoice');
  return new File([doc.output('blob')], name, { type: 'application/pdf' });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name || 'photo'}`));
    };
    img.src = url;
  });
}

function newCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the invoice');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

/** Marks the reader listed for a page that the page's own text didn't already cover. */
function leftoverMarks(marks: InvoiceDeaMark[], page: number, coveredText: Set<string>) {
  return marks.filter((m) => m.page === page && !coveredText.has(m.text));
}

async function redactPdf(file: File, marks: InvoiceDeaMark[], reasons: string[]) {
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const known = new Set(marks.map((m) => m.text));
  const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: DrawnPage[] = [];
  let covered = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, MAX_EDGE_PX / Math.max(base.width, base.height)) * 1.25;
      const viewport = page.getViewport({ scale });
      const { canvas, ctx } = newCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: ctx, viewport }).promise;

      const content = await page.getTextContent();
      const placed: PlacedText[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const tx = Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(tx[2], tx[3]);
        placed.push({ str: item.str, x: tx[4], y: tx[5], width: item.width * scale, height });
      }
      const hits = deaBoxesFromText(placed, known);
      const coveredText = new Set<string>();
      for (const hit of hits) {
        cover(ctx, hit.box);
        coveredText.add(hit.dea);
        covered += 1;
      }
      for (const m of leftoverMarks(marks, n, coveredText)) {
        if (m.box) {
          cover(ctx, padReaderBox(m.box, canvas.width, canvas.height));
          covered += 1;
          // Scanned page (no text): the reader's box is the only guide, as with photos.
          if (placed.length > 0) {
            reasons.push(
              `Page ${n}: a DEA number was covered from the reader's mark, not the page text.`
            );
          }
        } else {
          reasons.push(`Page ${n}: the reader saw a DEA number it couldn't place.`);
        }
      }
      pages.push({ canvas, widthPt: base.width, heightPt: base.height });
      page.cleanup();
    }
  } finally {
    void pdf.destroy();
  }
  const name = (file.name || 'invoice.pdf').replace(/\.pdf$/i, '') + '-redacted.pdf';
  return { file: pagesToPdf(pages, name), pages, covered };
}

async function redactPhotos(files: File[], marks: InvoiceDeaMark[], reasons: string[]) {
  const pages: DrawnPage[] = [];
  let covered = 0;
  for (let i = 0; i < files.length; i++) {
    const img = await loadImage(files[i]);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) throw new Error('Photo has no size');
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const { canvas, ctx } = newCanvas(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const m of marks.filter((mk) => mk.page === i + 1)) {
      if (m.box) {
        cover(ctx, padReaderBox(m.box, w, h));
        covered += 1;
      } else {
        reasons.push(`Photo ${i + 1}: the reader saw a DEA number it couldn't place.`);
      }
    }
    pages.push({ canvas, widthPt: w, heightPt: h });
  }
  let file: File;
  if (pages.length === 1) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      pages[0].canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not prepare the invoice'))),
        'image/jpeg',
        0.85
      )
    );
    const base = (files[0].name || 'invoice').replace(/\.[a-z0-9]+$/i, '');
    file = new File([blob], `${base}-redacted.jpg`, { type: 'image/jpeg' });
  } else {
    file = pagesToPdf(pages, 'invoice-pages-redacted.pdf');
  }
  return { file, pages, covered };
}

/**
 * Covers every DEA number on the invoice pages and returns the file to store.
 * `pageFiles` is what was read: one PDF, or one photo per page in order.
 */
export async function redactInvoiceDea(
  pageFiles: File[],
  marks: InvoiceDeaMark[],
  readerUnclear: boolean
): Promise<RedactedInvoice> {
  if (!pageFiles.length) throw new Error('No invoice pages');
  const reasons: string[] = [];
  const isPdf =
    pageFiles.length === 1 &&
    ((pageFiles[0].type || '').toLowerCase() === 'application/pdf' ||
      /\.pdf$/i.test(pageFiles[0].name || ''));
  const cleanMarks = marks.map((m) => ({
    ...m,
    text: m.text.toUpperCase().replace(/[^A-Z0-9]/g, ''),
  }));
  const result = isPdf
    ? await redactPdf(pageFiles[0], cleanMarks, reasons)
    : await redactPhotos(pageFiles, cleanMarks, reasons);
  if (readerUnclear) {
    reasons.unshift('Part of the invoice that may hold a DEA number was too hard to read.');
  }
  return {
    file: result.file,
    previews: result.pages.map((p) => previewOf(p.canvas)),
    covered: result.covered,
    unsure: reasons.length > 0,
    reasons,
  };
}
