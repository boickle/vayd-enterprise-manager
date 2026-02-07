// src/pages/PublicRoomLoaderForm.tsx
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { http } from '../api/http';
import { getEcwidProducts, type EcwidProduct, type EcwidChoice } from '../api/ecwid';
import { searchItems, type SearchableItem } from '../api/roomLoader';
import { getPatientTreatmentHistory, type TreatmentWithItems } from '../api/treatments';
import { DateTime } from 'luxon';
import jsPDF from 'jspdf';

// --- Labs We Recommend helpers ---
function getAgeYears(patient: { dob?: string | null }): number | null {
  if (!patient?.dob) return null;
  try {
    return DateTime.now().diff(DateTime.fromISO(patient.dob), 'years').years;
  } catch {
    return null;
  }
}

/** True if any reminder or addedItem for this patient contains "Wellness" (used for lab recommendations). */
function isWellnessVisit(patient: any): boolean {
  const text = getLineItemNames(patient);
  return text.includes('wellness');
}

function getLineItemNames(patient: any): string {
  const parts: string[] = [];
  (patient?.reminders ?? []).forEach((r: any) => {
    const n = r?.item?.name ?? r?.item?.code;
    if (n) parts.push(String(n).toLowerCase());
  });
  (patient?.addedItems ?? []).forEach((item: any) => {
    const n = item?.name ?? item?.code;
    if (n) parts.push(String(n).toLowerCase());
  });
  return parts.join(' ');
}

function listContains(patient: any, ...substrings: string[]): boolean {
  const text = getLineItemNames(patient);
  return substrings.some((s) => text.includes(s.toLowerCase()));
}

function itemNameMatch(name: string, ...substrings: string[]): boolean {
  const n = (name ?? '').toLowerCase();
  return substrings.some((s) => n.includes(s.toLowerCase()));
}

function hadInLast8Months(history: TreatmentWithItems[], ...nameSubstrings: string[]): boolean {
  const cutoff = DateTime.now().minus({ months: 8 });
  for (const tx of history ?? []) {
    for (const item of tx.treatmentItems ?? []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name ?? '';
      if (!itemNameMatch(name, ...nameSubstrings)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= cutoff) return true;
    }
  }
  return false;
}

const VACCINE_SEARCH_QUERIES = {
  lepto: 'Leptospirosis Vaccine - Annual',
  bordetella: 'Bordetella Oral Vaccine - Annual',
  crLyme: 'crLyme Vaccine- Annual',
  felv: 'FeLV (Leukemia) Vaccine - 1 year',
} as const;

type VaccineOptKey = keyof typeof VACCINE_SEARCH_QUERIES;

function getItemId(item: SearchableItem): number | undefined {
  return item.inventoryItem?.id ?? (item as any).procedure?.id ?? item.lab?.id;
}

/** True if text looks like a question to ignore (e.g. "What/Which pet is this for?", prescription disclaimer). */
function isQuestionLikeText(t: string): boolean {
  const s = (t ?? '').trim();
  if (!s) return true;
  if (s.includes('?')) return true;
  if (/^What\s/i.test(s)) return true;
  if (/^Which\s/i.test(s)) return true;
  if (/^This is a prescription item/i.test(s)) return true;
  if (/Has a .* veterinarian seen your pet/i.test(s)) return true;
  if (/Have a .* veterinarian examined .* pet/i.test(s)) return true;
  return false;
}

function isQuestionChoice(choice: EcwidChoice): boolean {
  const t = choice.textTranslated?.en ?? choice.text ?? '';
  return isQuestionLikeText(t);
}

/** Remove any leading "Label: " (text + colon + space) from description for cleaner display. */
function stripLeadingLabelPrefix(s: string): string {
  return (s ?? '').trim().replace(/^[^:]+:\s*/, '').trim();
}

/** Strip leading "# doses: ", "size: ", "Size / Species: ", etc. from attribute value for cleaner display. */
function stripAttributeLabelPrefix(s: string): string {
  return stripLeadingLabelPrefix(s.trim());
}

/** Get display label from product attributes (e.g. "Master product options" = dose/weight). Prefer this for modal. */
function getLabelFromAttributes(product: EcwidProduct): string | null {
  const attrs = product.attributes;
  if (!attrs || attrs.length === 0) return null;
  const masterOptions = attrs.find(
    (a) =>
      (a.nameTranslated?.en ?? a.name ?? '').toLowerCase().includes('master product options') ||
      (a.name ?? '').toLowerCase() === 'master product options'
  );
  if (!masterOptions) return null;
  const v = (masterOptions.valueTranslated?.en ?? masterOptions.value ?? '').trim();
  if (!v) return null;
  const stripped = stripAttributeLabelPrefix(v);
  return stripped || v;
}

/** First non-question choice/option text for display, or fallback so we never show the question. */
function getProductOptionLabel(product: EcwidProduct, fallbackIdx: number): string | null {
  // Prefer attributes (e.g. "Master product options" = "# doses: 4.1 - 17 lb - 6 doses (6 months' worth)")
  const fromAttrs = getLabelFromAttributes(product);
  if (fromAttrs) return fromAttrs;

  const choices = product.choices;
  if (choices && choices.length > 0) {
    const firstReal = choices.find((c) => !isQuestionChoice(c));
    if (firstReal) {
      const t = firstReal.textTranslated?.en ?? firstReal.text;
      return stripLeadingLabelPrefix(t) || t;
    }
    // only question choices — don't use them; fall through to options/sku/fallback
  }
  // Use options but skip any that are question-like (so we show dose/weight, not "What pet is this for?")
  const options = product.options;
  if (options && options.length > 0) {
    const firstRealOption = options.find((o) => {
      const v = (o.value ?? o.name ?? '').trim();
      return v && !isQuestionLikeText(v);
    });
    if (firstRealOption) {
      const v = (firstRealOption.value ?? firstRealOption.name ?? '').trim();
      return stripLeadingLabelPrefix(v) || v;
    }
  }
  return product.sku || `Option ${fallbackIdx + 1}`;
}

/** One row in the store option modal: label, price, and the item to add. */
type StoreModalRow = { key: string; label: string; price: number; item: EcwidProduct };

/** Build modal rows: if single product with combinations, one row per combination; else one row per product. No duplicates. */
function getStoreModalRows(products: EcwidProduct[]): StoreModalRow[] {
  let rows: StoreModalRow[];
  if (products.length === 1) {
    const product = products[0];
    const combinations = (product as any).combinations as Array<{
      id?: number;
      options?: Array<{ value?: string; valueTranslated?: { en?: string } }>;
      price?: number;
      defaultDisplayedPrice?: number;
    }> | undefined;
    if (combinations && combinations.length > 0) {
      rows = combinations.map((comb, idx) => {
        const opt = comb.options?.[0];
        const rawLabel = (opt?.valueTranslated?.en ?? opt?.value ?? '').trim() || `Option ${idx + 1}`;
        const label = stripLeadingLabelPrefix(rawLabel) || rawLabel;
        const price = Number(comb.defaultDisplayedPrice ?? comb.price ?? product.price);
        const item: EcwidProduct = {
          id: comb.id ?? `${product.id}-comb-${idx}`,
          name: `${product.name} - ${label}`,
          price,
          sku: product.sku,
        };
        return { key: String(comb.id ?? idx), label, price, item };
      });
    } else {
      rows = products
        .map((product, idx) => ({
          key: String(product.id),
          label: getProductOptionLabel(product, idx),
          price: Number(product.price),
          item: product,
        }))
        .filter((row): row is StoreModalRow => row.label != null) as StoreModalRow[];
    }
  } else {
    rows = products
      .map((product, idx) => ({
        key: String(product.id),
        label: getProductOptionLabel(product, idx),
        price: Number(product.price),
        item: product,
      }))
      .filter((row): row is StoreModalRow => row.label != null) as StoreModalRow[];
  }
  // Deduplicate by key (first occurrence wins)
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

/** Get price from a search result; API may return it top-level or on nested inventoryItem/lab/procedure or wellness pricing. */
function getSearchItemPrice(item: SearchableItem | null | undefined): number | null {
  if (!item) return null;
  const raw =
    (item as any).price ??
    item.inventoryItem?.price ??
    (item as any).lab?.price ??
    (item as any).procedure?.price ??
    item.wellnessPlanPricing?.adjustedPrice ??
    item.wellnessPlanPricing?.originalPrice;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/** True if name or code indicates crLyme (recombinant Lyme vaccine). */
function isCrLymeItem(name?: string | null, code?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  const c = (code ?? '').toLowerCase();
  return n.includes('crlyme') || n.includes('cr lyme') || c === 'lymecr' || c.includes('lymecr');
}

/** True if patient has ever had crLyme in their treatment history. */
function everHadCrLyme(history: TreatmentWithItems[]): boolean {
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isCrLymeItem(name, code)) return true;
    }
  }
  return false;
}

/** True if this visit's line items (reminders + added items) include crLyme. */
function gettingCrLymeThisTime(patient: any): boolean {
  if (patient.reminders?.length) {
    for (const r of patient.reminders) {
      const item = r.item;
      if (item && isCrLymeItem(item.name, item.code)) return true;
    }
  }
  if (patient.addedItems?.length) {
    for (const item of patient.addedItems) {
      if (isCrLymeItem(item.name, item.code)) return true;
    }
  }
  return false;
}

/** True if name or code indicates Leptospirosis vaccine. */
function isLeptoItem(name?: string | null, code?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  const c = (code ?? '').toLowerCase();
  return n.includes('lepto') || n.includes('leptospirosis') || c.includes('lepto');
}

/** True if patient ever declined a Lepto vaccine (any treatment item that is lepto and isDeclined). */
function declinedLeptoInPast(history: TreatmentWithItems[]): boolean {
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isLeptoItem(name, code) && item.isDeclined) return true;
    }
  }
  return false;
}

/** True if patient received Lepto vaccine in the last 12 months. */
function hadLeptoInLastYear(history: TreatmentWithItems[]): boolean {
  const oneYearAgo = DateTime.now().minus({ years: 1 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isLeptoItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= oneYearAgo) return true;
    }
  }
  return false;
}

/** True if this visit's line items (reminders + added items) include Lepto. */
function hasLeptoInLineItems(patient: any): boolean {
  if (patient.reminders?.length) {
    for (const r of patient.reminders) {
      const item = r.item;
      if (item && isLeptoItem(item.name, item.code)) return true;
    }
  }
  if (patient.addedItems?.length) {
    for (const item of patient.addedItems) {
      if (isLeptoItem(item.name, item.code)) return true;
    }
  }
  return false;
}

/** True if name or code indicates Bordetella (kennel cough) vaccine. */
function isBordetellaItem(name?: string | null, code?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  const c = (code ?? '').toLowerCase();
  return n.includes('bordetella') || n.includes('kennel cough') || c.includes('bordetella') || c.includes('kennel');
}

/** True if patient ever declined a Bordetella vaccine. */
function declinedBordetellaInPast(history: TreatmentWithItems[]): boolean {
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isBordetellaItem(name, code) && item.isDeclined) return true;
    }
  }
  return false;
}

/** True if patient received Bordetella vaccine in the last 12 months. */
function hadBordetellaInLastYear(history: TreatmentWithItems[]): boolean {
  const oneYearAgo = DateTime.now().minus({ years: 1 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isBordetellaItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= oneYearAgo) return true;
    }
  }
  return false;
}

/** True if this visit's line items (reminders + added items) include Bordetella. */
function hasBordetellaInLineItems(patient: any): boolean {
  if (patient.reminders?.length) {
    for (const r of patient.reminders) {
      const item = r.item;
      if (item && isBordetellaItem(item.name, item.code)) return true;
    }
  }
  if (patient.addedItems?.length) {
    for (const item of patient.addedItems) {
      if (isBordetellaItem(item.name, item.code)) return true;
    }
  }
  return false;
}

/** True if name or code indicates FeLV (Feline Leukemia) vaccine. */
function isFeLVItem(name?: string | null, code?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  const c = (code ?? '').toLowerCase();
  return n.includes('felv') || n.includes('fe lv') || n.includes('feline leukemia') || c.includes('felv');
}

/** True if patient ever declined an FeLV vaccine. */
function declinedFeLVInPast(history: TreatmentWithItems[]): boolean {
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isFeLVItem(name, code) && item.isDeclined) return true;
    }
  }
  return false;
}

/** True if patient received FeLV vaccine in the last 12 months. */
function hadFeLVInLastYear(history: TreatmentWithItems[]): boolean {
  const oneYearAgo = DateTime.now().minus({ years: 1 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isFeLVItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= oneYearAgo) return true;
    }
  }
  return false;
}

/** True if this visit's line items (reminders + added items) include FeLV. */
function hasFeLVInLineItems(patient: any): boolean {
  if (patient.reminders?.length) {
    for (const r of patient.reminders) {
      const item = r.item;
      if (item && isFeLVItem(item.name, item.code)) return true;
    }
  }
  if (patient.addedItems?.length) {
    for (const item of patient.addedItems) {
      if (isFeLVItem(item.name, item.code)) return true;
    }
  }
  return false;
}

const PDF_MARGIN = 0.5;
const PDF_PAGE_WIDTH = 8.5;
const PDF_PAGE_HEIGHT = 11;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const LINE_HEIGHT = 0.2;
const FONT_SIZE = 10;
const FONT_SIZE_SECTION = 12;
const FONT_SIZE_TITLE = 16;
const COLOR_DARK: [number, number, number] = [33, 37, 41];   // #212529
const COLOR_MUTED: [number, number, number] = [85, 85, 85];   // #555
const COLOR_LINE: [number, number, number] = [224, 224, 224]; // #e0e0e0

type PdfOptions = { logoDataUrl?: string; practiceName?: string };

/** Build a jsPDF from responseFromClient (formAnswersForPdf + summaryForPdf) for completed room-loader view. */
function buildRoomLoaderPdf(responseFromClient: any, options?: PdfOptions): jsPDF {
  const doc = new jsPDF('portrait', 'in', 'letter');
  const practiceName = options?.practiceName ?? 'Vet At Your Door';
  let y = PDF_MARGIN;

  const pushY = (dy: number) => {
    y += dy;
    if (y > PDF_PAGE_HEIGHT - PDF_MARGIN) {
      doc.addPage();
      y = PDF_MARGIN;
      drawHeader();
    }
  };

  const drawHeader = () => {
    const logoH = 0.45;
    const logoW = 1.6;
    if (options?.logoDataUrl) {
      try {
        doc.addImage(options.logoDataUrl, 'JPEG', PDF_MARGIN, y, logoW, logoH);
      } catch {
        // if JPEG fails (e.g. PNG), try PNG
        try {
          doc.addImage(options.logoDataUrl, 'PNG', PDF_MARGIN, y, logoW, logoH);
        } catch {
          /* ignore */
        }
      }
    }
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(practiceName, PDF_MARGIN + logoW + 0.15, y + logoH / 2 + 0.05);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
    y += logoH + 0.2;
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.setLineWidth(0.01);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    pushY(0.25);
  };

  drawHeader();

  const addText = (text: string, opts?: { bold?: boolean; fontSize?: number; color?: [number, number, number] }) => {
    if (opts?.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    else doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    if (opts?.bold) doc.setFont('helvetica', 'bold');
    if (opts?.fontSize) doc.setFontSize(opts.fontSize);
    const lines = doc.splitTextToSize(text, PDF_CONTENT_WIDTH);
    doc.text(lines, PDF_MARGIN, y);
    pushY(lines.length * LINE_HEIGHT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
  };

  const addPageTitle = (title: string) => {
    pushY(0.15);
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_TITLE);
    const lines = doc.splitTextToSize(title, PDF_CONTENT_WIDTH);
    doc.text(lines, PDF_MARGIN, y);
    pushY(lines.length * LINE_HEIGHT + 0.12);
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.setLineWidth(0.015);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    pushY(0.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
  };

  const addSectionLabel = (label: string) => {
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_SECTION);
    doc.text(label, PDF_MARGIN, y);
    pushY(LINE_HEIGHT + 0.08);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
  };

  const formAnswers = responseFromClient?.formAnswersForPdf?.pages;
  if (Array.isArray(formAnswers)) {
    for (const page of formAnswers) {
      if (page.title) addPageTitle(page.title);
      const sections = page.sections ?? [];
      for (const sec of sections) {
        if (sec.sectionLabel) addSectionLabel(sec.sectionLabel);
        const questions = sec.questions ?? [];
        for (const qa of questions) {
          if (qa.question) {
            doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
            doc.setFont('helvetica', 'normal');
            const qLines = doc.splitTextToSize(`Question: ${qa.question}`, PDF_CONTENT_WIDTH);
            doc.text(qLines, PDF_MARGIN, y);
            pushY(qLines.length * LINE_HEIGHT + 0.02);
          }
          const ans = qa.answerLabel != null ? String(qa.answerLabel) : (qa.answer != null ? String(qa.answer) : '—');
          doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
          const aLines = doc.splitTextToSize(`Answer: ${ans || '—'}`, PDF_CONTENT_WIDTH - 0.2);
          doc.text(aLines, PDF_MARGIN + 0.2, y);
          pushY(aLines.length * LINE_HEIGHT + 0.12);
        }
        pushY(0.08);
      }
      pushY(0.15);
    }
  }

  const summary = responseFromClient?.summaryForPdf;
  if (summary) {
    if (summary.title) addPageTitle(summary.title);
    if (summary.instruction) {
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      const instLines = doc.splitTextToSize(summary.instruction, PDF_CONTENT_WIDTH);
      doc.text(instLines, PDF_MARGIN, y);
      pushY(instLines.length * LINE_HEIGHT + 0.2);
      doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    }
    const pets = summary.pets ?? [];
    for (const pet of pets) {
      doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
      doc.setLineWidth(0.005);
      doc.rect(PDF_MARGIN, y, PDF_CONTENT_WIDTH, 0.14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_SIZE_SECTION);
      doc.text(pet.patientName ?? 'Pet', PDF_MARGIN + 0.1, y + 0.09);
      pushY(0.2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE);
      const rows = pet.rows ?? [];
      for (const row of rows) {
        const label = row.crossedOut ? `(declined) ${row.name}` : row.name;
        const amt = row.lineTotal != null ? `$${Number(row.lineTotal).toFixed(2)}` : '';
        const leftLines = doc.splitTextToSize(label, PDF_CONTENT_WIDTH - 1.2);
        doc.text(leftLines, PDF_MARGIN, y);
        if (amt) doc.text(amt, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(amt), y);
        pushY(Math.max(leftLines.length * LINE_HEIGHT, LINE_HEIGHT) + 0.02);
      }
      if (pet.subtotal != null) {
        const subStr = `Subtotal: $${Number(pet.subtotal).toFixed(2)}`;
        doc.setFont('helvetica', 'bold');
        doc.text(subStr, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(subStr), y);
        pushY(LINE_HEIGHT + 0.1);
        doc.setFont('helvetica', 'normal');
      }
    }
    const addItems = summary.additionalItems;
    if (addItems?.label) {
      addSectionLabel(addItems.label);
      if (Array.isArray(addItems?.items)) {
        for (const it of addItems.items) {
          const line = `${it.name} (qty ${it.quantity ?? 1})`;
          const amt = `$${Number(it.price || 0).toFixed(2)}`;
          doc.text(line, PDF_MARGIN, y);
          doc.text(amt, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(amt), y);
          pushY(LINE_HEIGHT + 0.02);
        }
      }
      if (addItems?.subtotal != null) {
        const s = `Subtotal: $${Number(addItems.subtotal).toFixed(2)}`;
        doc.text(s, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(s), y);
        pushY(LINE_HEIGHT);
      }
      if (addItems?.taxLabel && addItems?.tax != null) {
        const t = `${addItems.taxLabel}: $${Number(addItems.tax).toFixed(2)}`;
        doc.text(t, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(t), y);
        pushY(LINE_HEIGHT);
      }
    }
    pushY(0.1);
    if (summary.grandTotal != null) {
      doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
      doc.setLineWidth(0.012);
      doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
      pushY(0.15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      const totalStr = `Total: $${Number(summary.grandTotal).toFixed(2)}`;
      doc.text(totalStr, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(totalStr), y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE);
    }
  }

  return doc;
}

export default function PublicRoomLoaderForm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [treatmentHistoryByPatientId, setTreatmentHistoryByPatientId] = useState<Record<number, TreatmentWithItems[]>>({});
  /** Per-patient opted-in vaccine items (from "Yes" on Lepto/Bordetella/crLyme/FeLV). Sent on submit. */
  const [optedInVaccinesByPatientId, setOptedInVaccinesByPatientId] = useState<Record<number, Partial<Record<VaccineOptKey, SearchableItem>>>>({});
  const [vaccineSearchLoading, setVaccineSearchLoading] = useState<Record<string, boolean>>({});
  /** Fetched item for Early Detection Panel - Feline (for price display). */
  const [earlyDetectionFelineItem, setEarlyDetectionFelineItem] = useState<SearchableItem | null>(null);
  /** Fetched item for Early Detection Panel - Canine (for price display). */
  const [earlyDetectionCanineItem, setEarlyDetectionCanineItem] = useState<SearchableItem | null>(null);
  /** Fetched items for Senior Screen Canine (two-panel choice). */
  const [seniorCanineStandardItem, setSeniorCanineStandardItem] = useState<SearchableItem | null>(null);
  const [seniorCanineExtendedItem, setSeniorCanineExtendedItem] = useState<SearchableItem | null>(null);
  /** Fetched item for Senior Screen Feline (for price / replace-fecal). */
  const [seniorFelineItem, setSeniorFelineItem] = useState<SearchableItem | null>(null);
  /** Fetched item for Senior Screen Feline Extended (two-panel "lab work yes" flow). */
  const [seniorFelineExtendedItem, setSeniorFelineExtendedItem] = useState<SearchableItem | null>(null);
  /** Fetched "commonly selected" items for Summary page (search by name, keyed by query). */
  const [commonItemsFetched, setCommonItemsFetched] = useState<Record<string, SearchableItem | null>>({});
  /** Store (Ecwid) search on Summary page. */
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState<EcwidProduct[]>([]);
  const [storeSearchLoading, setStoreSearchLoading] = useState(false);
  /** Store items added by client on Summary page (for subtotal + 5.5% tax). */
  const [storeAdditionalItems, setStoreAdditionalItems] = useState<EcwidProduct[]>([]);
  /** When set, show modal to pick a variation of this product (same name, different options/SKU). */
  const [storeOptionModalGroup, setStoreOptionModalGroup] = useState<EcwidProduct[] | null>(null);
  /** True when form was already submitted (client or admin viewing); show read-only or PDF view. */
  const [formAlreadySubmitted, setFormAlreadySubmitted] = useState(false);
  /** When submitStatus === 'completed', we show PDF view; this is the blob URL for the generated PDF. */
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  const COMMON_ITEMS_CONFIG = [
    { searchQuery: 'Pedicure - Cat', searchQueryDog: 'Pedicure - Dog', displayName: 'Pedicure', dogOnly: false },
    { searchQuery: 'Anal Gland Expression', dogOnly: true },
    { searchQuery: 'Ear Cleaning 1', displayName: 'Ear Cleaning', dogOnly: true },
    { searchQuery: 'HomeAgain Microchip', dogOnly: false },
  ] as const;

  useEffect(() => {
    const tokenValue = token;
    if (!tokenValue) {
      setError('Missing token parameter');
      setLoading(false);
      return;
    }
    const safeToken = tokenValue as string;

    async function fetchRoomLoaderData() {
      try {
        setLoading(true);
        setError(null);
        const { data: responseData } = await http.get(
          `/public/room-loader/form?token=${encodeURIComponent(safeToken)}`
        );
        setData(responseData);

        // Backend stores submit body in response_from_client; mapper may expose as responseFromClient or savedForm
        const rawSaved = responseData?.responseFromClient ?? responseData?.savedForm ?? responseData?.sentToClient ?? null;
        const savedForm = rawSaved && typeof rawSaved === 'object' && rawSaved.formData != null
          ? rawSaved.formData
          : rawSaved;

        // Initialize form data: defaults first, then overlay saved form (excluding nested keys we restore to separate state)
        if (responseData?.patients) {
          const initialFormData: Record<string, any> = {};
          const appts = responseData.appointments || [];
          responseData.patients.forEach((patient: any, idx: number) => {
            const petKey = `pet${idx}`;
            const appointmentReason =
              patient.appointmentReason ??
              (appts[idx] && (appts[idx].description || appts[idx].instructions)) ??
              '';
            initialFormData[`${petKey}_appointmentReason`] = appointmentReason;
            initialFormData[`${petKey}_generalWellbeing`] = '';
            initialFormData[`${petKey}_outdoorAccess`] = '';
            initialFormData[`${petKey}_specificConcerns`] = '';
            initialFormData[`${petKey}_newPatientBehavior`] = '';
            initialFormData[`${petKey}_feeding`] = '';
            initialFormData[`${petKey}_foodAllergies`] = '';
            initialFormData[`${petKey}_foodAllergiesDetails`] = '';
            initialFormData[`${petKey}_carePlanLooksRight`] = '';
            initialFormData[`${petKey}_crLymeBooster`] = '';
            initialFormData[`${petKey}_leptoVaccine`] = '';
            initialFormData[`${petKey}_bordetellaVaccine`] = '';
            initialFormData[`${petKey}_rabiesPreference`] = '';
            initialFormData[`${petKey}_felvVaccine`] = '';
            initialFormData[`${petKey}_labWork`] = '';
          });
          if (savedForm && typeof savedForm === 'object') {
            const {
              optedInVaccineItems: _ovi,
              storeAdditionalItems: _sai,
              currentPage: _cp,
              remindersByPet: _rbp,
              totals: _tot,
              labSelections: _lab,
              commonlySelectedItems: savedCommon,
              ...savedInputs
            } = savedForm;
            const mergedFormData = { ...initialFormData, ...savedInputs };
            if (savedCommon && typeof savedCommon === 'object') {
              Object.entries(savedCommon).forEach(([k, v]) => {
                mergedFormData[k] = v;
              });
            }
            setFormData(mergedFormData);
          } else {
            setFormData(initialFormData);
          }
        }

        // Restore store additional items (Ecwid products) from saved formData
        if (savedForm?.storeAdditionalItems && Array.isArray(savedForm.storeAdditionalItems)) {
          setStoreAdditionalItems(
            savedForm.storeAdditionalItems.map((item: any) => ({
              id: item.id,
              name: item.name ?? '',
              price: Number(item.price ?? 0),
              sku: item.sku,
            }))
          );
        }

        // Restore current page (e.g. summary) so user returns to where they left off
        if (typeof savedForm?.currentPage === 'number' && savedForm.currentPage >= 1) {
          setCurrentPage(savedForm.currentPage);
        }

        // When API returns submitStatus === 'completed', form was submitted — show PDF view (and read-only)
        if (responseData?.submitStatus === 'completed') {
          setFormAlreadySubmitted(true);
        } else if (savedForm && typeof savedForm === 'object') {
          const hasSubmitPayload =
            savedForm.summaryForPdf != null ||
            (Array.isArray(savedForm.summaryLineItems) && savedForm.summaryLineItems.length > 0);
          if (hasSubmitPayload) setFormAlreadySubmitted(true);
        }

        // Restore opted-in vaccine items from saved formData
        if (savedForm?.optedInVaccineItems && typeof savedForm.optedInVaccineItems === 'object') {
          const restored: Record<number, Partial<Record<VaccineOptKey, SearchableItem>>> = {};
          Object.entries(savedForm.optedInVaccineItems).forEach(([pidStr, items]: [string, any]) => {
            const patientId = Number(pidStr);
            if (!Number.isFinite(patientId) || !Array.isArray(items)) return;
            const map: Partial<Record<VaccineOptKey, SearchableItem>> = {};
            items.forEach((item: { itemType?: string; id?: number; name?: string; code?: string; price?: number }) => {
              const name = (item.name ?? '').toLowerCase();
              let key: VaccineOptKey | null = null;
              if (name.includes('leptospirosis')) key = 'lepto';
              else if (name.includes('bordetella')) key = 'bordetella';
              else if (name.includes('crlyme') || (name.includes('lyme') && !name.includes('lepto'))) key = 'crLyme';
              else if (name.includes('felv') || name.includes('leukemia')) key = 'felv';
              if (key && key !== 'crLyme') {
                map[key] = {
                  itemType: (item.itemType as any) ?? 'inventory',
                  inventoryItem: item.id != null ? { id: item.id, name: item.name, price: item.price, code: item.code } : undefined,
                  name: item.name ?? '',
                  code: item.code,
                  price: typeof item.price === 'number' ? item.price : Number(item.price) || 0,
                } as SearchableItem;
              }
            });
            if (Object.keys(map).length) restored[patientId] = map;
          });
          if (Object.keys(restored).length) setOptedInVaccinesByPatientId((prev) => ({ ...prev, ...restored }));
        }
      } catch (err: any) {
        console.error('Error fetching room loader form data:', err);
        setError(err?.response?.data?.message || err?.message || 'Failed to load room loader form');
      } finally {
        setLoading(false);
      }
    }

    fetchRoomLoaderData();
  }, [token]);

  // Fetch treatment history per patient for crLyme booster logic (Veterinary Care Plan page)
  useEffect(() => {
    if (!data?.patients?.length) return;
    const patientIds = data.patients
      .map((p: any) => p.patientId ?? p.patient?.id)
      .filter((id: any) => id != null);
    if (patientIds.length === 0) return;

    let cancelled = false;
    const historyByPatient: Record<number, TreatmentWithItems[]> = {};
    Promise.all(
      patientIds.map(async (patientId: number) => {
        if (cancelled) return;
        try {
          const history = await getPatientTreatmentHistory(patientId);
          if (!cancelled) historyByPatient[patientId] = history ?? [];
        } catch (e) {
          if (!cancelled) historyByPatient[patientId] = [];
        }
      })
    ).then(() => {
      if (!cancelled) setTreatmentHistoryByPatientId((prev) => ({ ...prev, ...historyByPatient }));
    });
    return () => {
      cancelled = true;
    };
  }, [data?.patients]);

  // When form is completed (submitStatus === 'completed'), load logo and generate PDF from responseFromClient
  useEffect(() => {
    if (!formAlreadySubmitted || !data?.responseFromClient) return;
    let cancelled = false;
    const practiceName = data.practiceName ?? data.practice?.name ?? 'Vet At Your Door';
    const loadLogo = (): Promise<string | undefined> =>
      fetch('/final_thick_lines_cropped.jpeg')
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(r.result as string);
              r.onerror = rej;
              r.readAsDataURL(blob);
            })
        )
        .catch(() => undefined);
    loadLogo().then((logoDataUrl) => {
      if (cancelled) return;
      try {
        const doc = buildRoomLoaderPdf(data.responseFromClient, { logoDataUrl, practiceName });
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e) {
        console.error('Error building room loader PDF:', e);
      }
    });
    return () => {
      cancelled = true;
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [formAlreadySubmitted, data?.responseFromClient, data?.practiceName, data?.practice?.name]);

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy');
    } catch {
      return dateStr;
    }
  }

  function formatTime(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('h:mm a');
    } catch {
      return dateStr;
    }
  }

  function handleInputChange(key: string, value: any) {
    if (formAlreadySubmitted) return;
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  const practiceId = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;

  async function handleVaccineOptChange(
    petKey: string,
    patientId: number | undefined,
    vaccineKey: VaccineOptKey,
    formFieldKey: string,
    value: string
  ) {
    handleInputChange(formFieldKey, value);
    if (patientId == null) return;

    // crLyme booster is scheduling-only: record the answer but do not add to reminders or bill
    if (vaccineKey === 'crLyme') {
      if (value !== 'yes') {
        setOptedInVaccinesByPatientId((prev) => {
          const next = { ...prev };
          const patient = { ...(next[patientId] || {}) };
          delete patient.crLyme;
          next[patientId] = patient;
          return next;
        });
      }
      return;
    }

    if (value === 'yes') {
      const loadKey = `${patientId}-${vaccineKey}`;
      setVaccineSearchLoading((prev) => ({ ...prev, [loadKey]: true }));
      try {
        const q = VACCINE_SEARCH_QUERIES[vaccineKey];
        const results = await searchItems({ q, practiceId, limit: 50 });
        const first = results[0];
        setOptedInVaccinesByPatientId((prev) => {
          const next = { ...prev };
          const patient = { ...(next[patientId] || {}) };
          if (first && getItemId(first) != null) {
            patient[vaccineKey] = first;
          }
          next[patientId] = patient;
          return next;
        });
      } catch (err) {
        console.error('Error searching for vaccine item:', err);
      } finally {
        setVaccineSearchLoading((prev) => ({ ...prev, [loadKey]: false }));
      }
    } else {
      setOptedInVaccinesByPatientId((prev) => {
        const next = { ...prev };
        const patient = { ...(next[patientId] || {}) };
        delete patient[vaccineKey];
        next[patientId] = patient;
        return next;
      });
    }
  }

  function buildOptedInVaccineItemsPayload(): Record<number, Array<{ itemType: string; id: number; name: string; code?: string; price: number; quantity: number }>> {
    const out: Record<number, Array<{ itemType: string; id: number; name: string; code?: string; price: number; quantity: number }>> = {};
    Object.entries(optedInVaccinesByPatientId).forEach(([pidStr, map]) => {
      const patientId = Number(pidStr);
      const items: Array<{ itemType: string; id: number; name: string; code?: string; price: number; quantity: number }> = [];
      if (map) {
        (Object.entries(map) as [VaccineOptKey, SearchableItem | undefined][]).forEach(([key, item]) => {
          if (key === 'crLyme') return; // crLyme booster is scheduling-only, not added to bill
          if (item && getItemId(item) != null) {
            items.push({
              itemType: item.itemType || 'inventory',
              id: getItemId(item)!,
              name: item.name ?? '',
              code: item.code,
              price: typeof item.price === 'number' ? item.price : Number(item.price) || 0,
              quantity: 1,
            });
          }
        });
      }
      if (items.length) out[patientId] = items;
    });
    return out;
  }

  /** Build recommended items per pet from API data (mirrors render logic) for snapshot. */
  function buildRecommendedItemsByPetSnapshot(patientsData: any[]): any[][] {
    const byPet: any[][] = [];
    (patientsData ?? []).forEach((patient: any) => {
      const petItems: any[] = [];
      if (patient.reminders && Array.isArray(patient.reminders)) {
        patient.reminders.forEach((reminder: any) => {
          if (reminder.item) {
            petItems.push({
              name: reminder.item.name,
              price: reminder.item.price,
              quantity: reminder.quantity || 1,
              type: reminder.itemType,
            });
          } else {
            const text = (reminder.reminderText ?? reminder.description ?? '').toLowerCase();
            if (text.includes('visit') || text.includes('consult')) {
              petItems.push({
                name: reminder.reminderText ?? reminder.description ?? 'Visit/Consult',
                price: reminder.price ?? null,
                quantity: reminder.quantity || 1,
                type: reminder.itemType ?? 'procedure',
              });
            }
          }
        });
      }
      if (patient.addedItems && Array.isArray(patient.addedItems)) {
        patient.addedItems.forEach((item: any) => {
          petItems.push({
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1,
            type: item.itemType,
          });
        });
      }
      byPet.push(petItems);
    });
    return byPet;
  }

  /** Build full form snapshot for submit: reminders with checked state, totals, lab choices, vaccines, store items, current page. */
  function buildFullFormSnapshot() {
    const optedInVaccineItems = buildOptedInVaccineItemsPayload();
    const patientsData = data?.patients ?? [];
    const recommendedByPet = buildRecommendedItemsByPetSnapshot(patientsData);
    const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
    const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);

    const remindersByPet: Array<{
      patientId: number | undefined;
      patientName: string;
      displayItems: Array<{ name: string; price: number | null; quantity: number; type?: string }>;
      checked: boolean[];
      tripFeeItems: Array<{ name: string; price: number | null; quantity: number }>;
    }> = [];
    const petSubtotals: number[] = [];
    let grandTotal = 0;

    patientsData.forEach((patient: any, petIdx: number) => {
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const allItems = recommendedByPet[petIdx] ?? [];
      const displayItems = allItems.filter((item: any) => !hasPhrase(item, 'trip fee'));
      const tripFeeItems = allItems.filter((item: any) => hasPhrase(item, 'trip fee'));
      const checked = displayItems.map((item: any, idx: number) => {
        const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
        const earlyDetectionYes = formData[`lab_early_detection_feline_${patientId}`] === 'yes';
        const earlyDetectionCanineYes = formData[`lab_early_detection_canine_${patientId}`] === 'yes';
        const seniorFelineYes = formData[`lab_senior_feline_${patientId}`] === 'yes';
        const seniorCaninePanel = formData[`lab_senior_canine_panel_${patientId}`];
        const seniorFelineTwoPanel = formData[`lab_senior_feline_two_panel_${patientId}`];
        const fecalReplacedBy: string[] = [];
        if (earlyDetectionYes || earlyDetectionCanineYes) fecalReplacedBy.push('Early Detection Panel');
        if (seniorFelineYes) fecalReplacedBy.push('Senior Screen Feline');
        if (seniorCaninePanel === 'extended' || seniorFelineTwoPanel === 'extended') fecalReplacedBy.push('Extended Comprehensive Panel');
        const isFecalReplaced = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
        const recKey = `pet${petIdx}_rec_${idx}`;
        return isFecalReplaced ? false : isVisitOrConsult || formData[recKey] !== false;
      });
      remindersByPet.push({
        patientId,
        patientName: petName,
        displayItems: displayItems.map((item: any) => ({
          name: String(item.name ?? ''),
          price: item.price != null ? Number(item.price) : null,
          quantity: Number(item.quantity) || 1,
          type: item.type,
        })),
        checked,
        tripFeeItems: tripFeeItems.map((item: any) => ({
          name: String(item.name ?? ''),
          price: item.price != null ? Number(item.price) : null,
          quantity: Number(item.quantity) || 1,
        })),
      });

      let petSubtotal = 0;
      displayItems.forEach((item: any, idx: number) => {
        const isChecked = checked[idx];
        const price = Number(item.price) || 0;
        const qty = Number(item.quantity) || 1;
        if (isChecked) petSubtotal += price * qty;
      });
      tripFeeItems.forEach((item: any) => {
        petSubtotal += (Number(item.price) || 0) * (Number(item.quantity) || 1);
      });
      // Opted-in vaccine items for this pet
      const optedIn = optedInVaccinesByPatientId[patientId];
      if (optedIn) {
        (Object.values(optedIn).filter(Boolean) as SearchableItem[]).forEach((item) => {
          const p = getSearchItemPrice(item);
          if (p != null) petSubtotal += p;
        });
      }
      // Lab panels selected for this pet
      if (formData[`lab_early_detection_feline_${patientId}`] === 'yes') {
        const p = getSearchItemPrice(earlyDetectionFelineItem);
        if (p != null) petSubtotal += p;
      }
      if (formData[`lab_early_detection_canine_${patientId}`] === 'yes') {
        const p = getSearchItemPrice(earlyDetectionCanineItem);
        if (p != null) petSubtotal += p;
      }
      if (formData[`lab_senior_feline_${patientId}`] === 'yes') {
        const p = getSearchItemPrice(seniorFelineItem);
        if (p != null) petSubtotal += p;
      }
      const seniorCaninePanelVal = formData[`lab_senior_canine_panel_${patientId}`];
      if (seniorCaninePanelVal === 'standard') {
        const p = getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) petSubtotal += p;
      }
      if (seniorCaninePanelVal === 'extended') {
        const p = getSearchItemPrice(seniorCanineExtendedItem);
        if (p != null) petSubtotal += p;
      }
      const seniorFelineTwoPanelVal = formData[`lab_senior_feline_two_panel_${patientId}`];
      if (seniorFelineTwoPanelVal === 'standard') {
        const p = getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) petSubtotal += p;
      }
      if (seniorFelineTwoPanelVal === 'extended') {
        const p = getSearchItemPrice(seniorFelineExtendedItem);
        if (p != null) petSubtotal += p;
      }
      petSubtotals.push(petSubtotal);
      grandTotal += petSubtotal;
    });

    const storeSubtotal = storeAdditionalItems.reduce((sum, i) => sum + Number(i.price), 0);
    const storeTaxRate = 0.055;
    const storeTax = storeSubtotal * storeTaxRate;
    grandTotal += storeSubtotal + storeTax;

    // Store additional items: always include name, quantity, price for backend summary
    const storeAdditionalItemsPayload = storeAdditionalItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: 1,
      price: Number(item.price),
      sku: item.sku,
    }));

    // Explicitly include commonly selected items (summary_common_* keys) so they always appear in the JSON
    const commonlySelectedItems: Record<string, boolean> = {};
    Object.entries(formData).forEach(([k, v]) => {
      if (k.startsWith('summary_common_') && (v === true || v === false)) {
        commonlySelectedItems[k] = v === true;
      }
    });

    // Build line items with { name, quantity, price } for backend to generate full summary
    type LineItem = { name: string; quantity: number; price: number; patientId?: number; patientName?: string; category?: string };
    const summaryLineItems: LineItem[] = [];

    remindersByPet.forEach((entry, petIdx) => {
      const patient = patientsData[petIdx];
      const patientId = entry.patientId ?? patient?.patientId ?? patient?.patient?.id ?? petIdx;
      const patientName = entry.patientName || `Pet ${petIdx + 1}`;
      entry.displayItems.forEach((item, idx) => {
        if (!entry.checked[idx]) return;
        const price = item.price != null ? Number(item.price) : 0;
        const qty = Number(item.quantity) || 1;
        summaryLineItems.push({
          name: item.name,
          quantity: qty,
          price,
          patientId,
          patientName,
          category: 'reminder',
        });
      });
      entry.tripFeeItems.forEach((item) => {
        const price = item.price != null ? Number(item.price) : 0;
        const qty = Number(item.quantity) || 1;
        summaryLineItems.push({
          name: item.name,
          quantity: qty,
          price,
          patientId,
          patientName,
          category: 'tripFee',
        });
      });
      const optedIn = optedInVaccinesByPatientId[patientId];
      if (optedIn) {
        (Object.values(optedIn).filter(Boolean) as SearchableItem[]).forEach((item) => {
          const p = getSearchItemPrice(item);
          if (p != null) {
            summaryLineItems.push({
              name: item.name ?? 'Vaccine',
              quantity: 1,
              price: p,
              patientId,
              patientName,
              category: 'vaccine',
            });
          }
        });
      }
      const earlyDetectionYes = formData[`lab_early_detection_feline_${patientId}`] === 'yes';
      const earlyDetectionCanineYes = formData[`lab_early_detection_canine_${patientId}`] === 'yes';
      const seniorFelineYes = formData[`lab_senior_feline_${patientId}`] === 'yes';
      const seniorCaninePanelVal = formData[`lab_senior_canine_panel_${patientId}`];
      const seniorFelineTwoPanelVal = formData[`lab_senior_feline_two_panel_${patientId}`];
      if (earlyDetectionYes) {
        const p = getSearchItemPrice(earlyDetectionFelineItem);
        if (p != null) summaryLineItems.push({ name: 'Early Detection Panel - Feline', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (earlyDetectionCanineYes) {
        const p = getSearchItemPrice(earlyDetectionCanineItem);
        if (p != null) summaryLineItems.push({ name: 'Early Detection Panel - Canine', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorFelineYes) {
        const p = getSearchItemPrice(seniorFelineItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen Feline', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorCaninePanelVal === 'standard') {
        const p = getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen - Standard Comprehensive Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorCaninePanelVal === 'extended') {
        const p = getSearchItemPrice(seniorCanineExtendedItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen - Extended Comprehensive Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorFelineTwoPanelVal === 'standard') {
        const p = getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen Feline - Standard Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorFelineTwoPanelVal === 'extended') {
        const p = getSearchItemPrice(seniorFelineExtendedItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen Feline - Extended Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      // Commonly selected items for this pet (checked) – resolve name/price from commonItemsFetched
      const appts = data?.appointments ?? [];
      const speciesParts = [
        patient?.species,
        (patient as any)?.patient?.species,
        appts[petIdx]?.patient?.species,
      ].filter(Boolean) as string[];
      const speciesLower = speciesParts.join(' ').toLowerCase();
      const isDogPet = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !speciesLower.includes('cat'));
      const existingNames = new Set<string>();
      (Object.values(optedInVaccinesByPatientId[patientId] || {}).filter(Boolean) as SearchableItem[]).forEach((item) => {
        if (item?.name) existingNames.add(String(item.name).toLowerCase());
      });
      const nameMatches = (a: string, b: string) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x.includes(y) || y.includes(x); };
      COMMON_ITEMS_CONFIG.forEach((c) => {
        if ((c as any).dogOnly && !isDogPet) return;
        const hasDisplayName = 'displayName' in c && c.displayName;
        let item: SearchableItem | null = null;
        let displayName: string;
        if (hasDisplayName && (c as any).displayName === 'Pedicure') {
          const searchQueryDog = 'searchQueryDog' in c ? (c as any).searchQueryDog : null;
          item = isDogPet && searchQueryDog ? commonItemsFetched[searchQueryDog] : commonItemsFetched[c.searchQuery];
          displayName = 'Pedicure';
        } else {
          item = commonItemsFetched[c.searchQuery];
          displayName = ('displayName' in c && (c as any).displayName) ? (c as any).displayName : (item?.name ?? c.searchQuery);
        }
        if (!item?.name) return;
        const n = String(item.name).toLowerCase();
        if ([...existingNames].some((ex) => nameMatches(ex, n))) return;
        const itemId = getItemId(item) ?? c.searchQuery;
        const commonKey = `summary_common_${patientId}_${itemId}`;
        if (formData[commonKey] === true) {
          const price = getSearchItemPrice(item) ?? 0;
          summaryLineItems.push({ name: displayName, quantity: 1, price, patientId, patientName, category: 'common' });
        }
      });
    });

    storeAdditionalItems.forEach((item) => {
      summaryLineItems.push({
        name: item.name,
        quantity: 1,
        price: Number(item.price),
        category: 'store',
      });
    });

    // --- summaryForPdf: structure mirrors Summary & Total page for identical PDF rendering ---
    type PdfRow = {
      type: 'visitConsult' | 'tripFee' | 'reminder' | 'vaccine' | 'lab' | 'common';
      name: string;
      quantity: number;
      price: number;
      lineTotal: number;
      checked?: boolean;
      uncheckable?: boolean;
      crossedOut?: boolean;
      fecalReplacedBy?: string;
    };
    const pdfPets: Array<{ patientId: number | undefined; patientName: string; rows: PdfRow[]; subtotal: number; commonSectionLabel?: string }> = [];
    remindersByPet.forEach((entry, petIdx) => {
      const patient = patientsData[petIdx];
      const patientId = entry.patientId ?? patient?.patientId ?? patient?.patient?.id ?? petIdx;
      const patientName = entry.patientName || `Pet ${petIdx + 1}`;
      const appts = data?.appointments ?? [];
      const speciesParts = [
        patient?.species,
        (patient as any)?.patient?.species,
        appts[petIdx]?.patient?.species,
      ].filter(Boolean) as string[];
      const speciesLower = speciesParts.join(' ').toLowerCase();
      const isDogPet = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !speciesLower.includes('cat'));

      const earlyDetectionYes = formData[`lab_early_detection_feline_${patientId}`] === 'yes';
      const earlyDetectionCanineYes = formData[`lab_early_detection_canine_${patientId}`] === 'yes';
      const seniorFelineYes = formData[`lab_senior_feline_${patientId}`] === 'yes';
      const seniorCaninePanelVal = formData[`lab_senior_canine_panel_${patientId}`];
      const seniorFelineTwoPanelVal = formData[`lab_senior_feline_two_panel_${patientId}`];
      const fecalReplacedBy: string[] = [];
      if (earlyDetectionYes || earlyDetectionCanineYes) fecalReplacedBy.push('Early Detection Panel');
      if (seniorFelineYes) fecalReplacedBy.push('Senior Screen Feline');
      if (seniorCaninePanelVal === 'extended' || seniorFelineTwoPanelVal === 'extended') fecalReplacedBy.push('Extended Comprehensive Panel');

      const displayItems = entry.displayItems;
      const tripFeeItems = entry.tripFeeItems;
      const uncheckableDisplay = displayItems
        .map((item: any, idx: number) => ({ item, idx }))
        .filter(({ item }) => hasPhrase(item, 'visit') || hasPhrase(item, 'consult'));
      const checkableDisplay = displayItems
        .map((item: any, idx: number) => ({ item, idx }))
        .filter(({ item }) => !hasPhrase(item, 'visit') && !hasPhrase(item, 'consult'));

      const rows: PdfRow[] = [];
      let petSubtotal = 0;

      uncheckableDisplay.forEach(({ item }) => {
        const price = item.price != null ? Number(item.price) : 0;
        const qty = Number(item.quantity) || 1;
        const lineTotal = price * qty;
        petSubtotal += lineTotal;
        rows.push({
          type: 'visitConsult',
          name: item.name,
          quantity: qty,
          price,
          lineTotal,
          checked: true,
          uncheckable: true,
          crossedOut: false,
        });
      });
      tripFeeItems.forEach((item: any) => {
        const price = item.price != null ? Number(item.price) : 0;
        const qty = Number(item.quantity) || 1;
        const lineTotal = price * qty;
        petSubtotal += lineTotal;
        rows.push({ type: 'tripFee', name: item.name, quantity: qty, price, lineTotal });
      });
      checkableDisplay.forEach(({ item, idx }) => {
        const isFecalReplaced = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
        const recKey = `pet${petIdx}_rec_${idx}`;
        const isChecked = isFecalReplaced ? false : formData[recKey] !== false;
        const price = item.price != null ? Number(item.price) : 0;
        const qty = Number(item.quantity) || 1;
        const lineTotal = isChecked && !isFecalReplaced ? price * qty : 0;
        if (isChecked && !isFecalReplaced) petSubtotal += lineTotal;
        rows.push({
          type: 'reminder',
          name: item.name,
          quantity: qty,
          price,
          lineTotal,
          checked: isChecked,
          uncheckable: false,
          crossedOut: !isChecked || isFecalReplaced,
          fecalReplacedBy: isFecalReplaced ? fecalReplacedBy.join(' or ') : undefined,
        });
      });

      (Object.values(optedInVaccinesByPatientId[patientId] || {}).filter(Boolean) as SearchableItem[]).forEach((item) => {
        const p = getSearchItemPrice(item);
        if (p != null) {
          petSubtotal += p;
          rows.push({
            type: 'vaccine',
            name: item.name ?? 'Vaccine',
            quantity: 1,
            price: p,
            lineTotal: p,
          });
        }
      });

      const labRows: { name: string; price: number }[] = [];
      if (earlyDetectionYes) {
        const p = getSearchItemPrice(earlyDetectionFelineItem);
        if (p != null) labRows.push({ name: 'Early Detection Panel - Feline', price: p });
      }
      if (earlyDetectionCanineYes) {
        const p = getSearchItemPrice(earlyDetectionCanineItem);
        if (p != null) labRows.push({ name: 'Early Detection Panel - Canine', price: p });
      }
      if (seniorFelineYes) {
        const p = getSearchItemPrice(seniorFelineItem);
        if (p != null) labRows.push({ name: 'Senior Screen Feline', price: p });
      }
      if (seniorCaninePanelVal === 'standard') {
        const p = getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) labRows.push({ name: 'Senior Screen - Standard Comprehensive Panel', price: p });
      }
      if (seniorCaninePanelVal === 'extended') {
        const p = getSearchItemPrice(seniorCanineExtendedItem);
        if (p != null) labRows.push({ name: 'Senior Screen - Extended Comprehensive Panel', price: p });
      }
      if (seniorFelineTwoPanelVal === 'standard') {
        const p = getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) labRows.push({ name: 'Senior Screen Feline - Standard Panel', price: p });
      }
      if (seniorFelineTwoPanelVal === 'extended') {
        const p = getSearchItemPrice(seniorFelineExtendedItem);
        if (p != null) labRows.push({ name: 'Senior Screen Feline - Extended Panel', price: p });
      }
      labRows.forEach(({ name, price }) => {
        petSubtotal += price;
        rows.push({ type: 'lab', name, quantity: 1, price, lineTotal: price });
      });

      const existingNames = new Set<string>();
      entry.displayItems.forEach((i: any) => { if (i?.name) existingNames.add(String(i.name).toLowerCase()); });
      (Object.values(optedInVaccinesByPatientId[patientId] || {}).filter(Boolean) as SearchableItem[]).forEach((item) => {
        if (item?.name) existingNames.add(String(item.name).toLowerCase());
      });
      const nameMatches = (a: string, b: string) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x.includes(y) || y.includes(x); };
      COMMON_ITEMS_CONFIG.forEach((c) => {
        if ((c as any).dogOnly && !isDogPet) return;
        const hasDisplayName = 'displayName' in c && c.displayName;
        let item: SearchableItem | null = null;
        let displayName: string;
        if (hasDisplayName && (c as any).displayName === 'Pedicure') {
          const searchQueryDog = 'searchQueryDog' in c ? (c as any).searchQueryDog : null;
          item = isDogPet && searchQueryDog ? commonItemsFetched[searchQueryDog] : commonItemsFetched[c.searchQuery];
          displayName = 'Pedicure';
        } else {
          item = commonItemsFetched[c.searchQuery];
          displayName = ('displayName' in c && (c as any).displayName) ? (c as any).displayName : (item?.name ?? c.searchQuery);
        }
        if (!item?.name) return;
        const n = String(item.name).toLowerCase();
        if ([...existingNames].some((ex) => nameMatches(ex, n))) return;
        const itemId = getItemId(item) ?? c.searchQuery;
        const commonKey = `summary_common_${patientId}_${itemId}`;
        const isChecked = formData[commonKey] === true;
        const price = getSearchItemPrice(item) ?? 0;
        if (isChecked) petSubtotal += price;
        rows.push({
          type: 'common',
          name: displayName,
          quantity: 1,
          price,
          lineTotal: isChecked ? price : 0,
          checked: isChecked,
          crossedOut: !isChecked,
        });
      });

      pdfPets.push({
        patientId,
        patientName,
        rows,
        subtotal: petSubtotals[petIdx] ?? petSubtotal,
        commonSectionLabel: 'Commonly selected items',
      });
    });

    const summaryForPdf = {
      title: 'Summary & Total',
      instruction: 'Uncheck any item you do not want. Visits/consults and trip fee cannot be removed. Removed or declined items are shown crossed out and do not affect the total.',
      pets: pdfPets,
      additionalItems: {
        label: 'Additional items',
        items: storeAdditionalItemsPayload.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
        subtotal: storeSubtotal,
        taxLabel: 'Sales tax (5.5%)',
        taxRate: storeTaxRate,
        tax: storeTax,
      },
      grandTotal,
    };

    // --- formAnswersForPdf: every question text + client answer for PDF (all pages before Summary) ---
    type Qa = { question: string; answer: string | boolean | null; answerLabel?: string | null };
    type Section = { sectionLabel?: string; patientId?: number; patientName?: string; questions: Qa[] };
    type PageSection = { pageNumber: number; title: string; sections: Section[] };
    const formAnswersPages: PageSection[] = [];

    // Page 1: Time to Check-in for your Appointment
    const page1Sections: Section[] = [];
    patientsData.forEach((patient: any, petIdx: number) => {
      const petKey = `pet${petIdx}`;
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const questions: Qa[] = [];
      const addRequired = (question: string, key: string) => {
        const raw = formData[key];
        const val = raw === undefined ? null : raw;
        questions.push({ question, answer: val ?? null, answerLabel: val != null && typeof val === 'string' ? val : null });
      };
      const addOptional = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        if (raw === undefined && valueLabels === undefined) return;
        const val = raw === undefined ? null : raw;
        const label = valueLabels && val != null && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : null);
        questions.push({ question, answer: val ?? null, answerLabel: label ?? (val != null ? String(val) : null) });
      };
      addRequired('Could you expand on that?', `${petKey}_appointmentReason`);
      addRequired(`How is ${petName} doing otherwise? Any other specific concerns for this visit?`, `${petKey}_generalWellbeing`);
      addOptional(`Does ${petName} go outdoors or live with a cat that goes outdoors?`, `${petKey}_outdoorAccess`, { yes: 'Yes', no: 'No' });
      addOptional(`Describe ${petName}'s behavior at home, around strangers, and at a typical vet office.`, `${petKey}_newPatientBehavior`);
      addOptional(`What are you feeding ${petName}? (brand, amount, frequency)`, `${petKey}_feeding`);
      addOptional(`Do you or ${petName} have any food allergies? (we like to bribe!)`, `${petKey}_foodAllergies`, { yes: 'Yes', no: 'No' });
      addOptional('If yes, what are they?', `${petKey}_foodAllergiesDetails`);
      if (questions.length > 0) {
        page1Sections.push({ sectionLabel: `Pet ${petIdx + 1}: ${petName}`, patientId, patientName: petName, questions });
      }
    });
    if (page1Sections.length > 0) {
      formAnswersPages.push({ pageNumber: 1, title: 'Time to Check-in for your Appointment', sections: page1Sections });
    }

    // Care Plan pages (one section per pet): Optional Vaccines & Questions
    patientsData.forEach((patient: any, petIdx: number) => {
      const petKey = `pet${petIdx}`;
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const questions: Qa[] = [];
      const add = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        if (raw === undefined) return;
        const val = raw;
        const label = valueLabels && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : String(val));
        questions.push({ question, answer: val, answerLabel: label });
      };
      add('Should we schedule your crLyme booster in the next 3-4 weeks?', `${petKey}_crLymeBooster`, { yes: 'Yes', no: 'No', unsure: "I'm not sure" });
      add('Do you want us to give the Lepto vaccine?', `${petKey}_leptoVaccine`, { yes: 'Yes', no: 'No' });
      add('Do you want us to give the Bordetella vaccine?', `${petKey}_bordetellaVaccine`, { yes: 'Yes', no: 'No' });
      add('If not a member AND due for rabies AND a cat: we offer two rabies vaccines - a one year or three year - which would you prefer?', `${petKey}_rabiesPreference`, {
        '1year': 'Purevax Rabies 1 year',
        '3year': 'Purevax Rabies 3 year',
        no: 'No thank you, I do not want a rabies vx administered to my cat.',
      });
      add('Do you want us to give the FeLV vaccine?', `${petKey}_felvVaccine`, { yes: 'Yes', no: 'No' });
      if (questions.length > 0) {
        formAnswersPages.push({
          pageNumber: 2 + petIdx,
          title: patientsData.length > 1 ? `Veterinary Care Plan — ${petName}` : 'Veterinary Care Plan',
          sections: [{ sectionLabel: `${petName} — Optional Vaccines & Questions`, patientId, patientName: petName, questions }],
        });
      }
    });

    // Labs We Recommend (one section per pet)
    const labsPageNum = 2 + patientsData.length;
    const labsSections: Section[] = [];
    patientsData.forEach((patient: any, idx: number) => {
      const patientId = patient.patientId ?? patient.patient?.id ?? idx;
      const petName = patient.patientName || `Pet ${idx + 1}`;
      const questions: Qa[] = [];
      const add = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        if (raw === undefined) return;
        const val = raw;
        const label = valueLabels && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : String(val));
        questions.push({ question, answer: val, answerLabel: label });
      };
      add('Would you like to do the Early Detection Panel? (Feline)', `lab_early_detection_feline_${patientId}`, { yes: 'Yes', no: 'No' });
      add('Would you like to do the Early Detection Panel? (Canine)', `lab_early_detection_canine_${patientId}`, { yes: 'Yes', no: 'No' });
      add('Would you like to do the Senior Screen Feline?', `lab_senior_feline_${patientId}`, { yes: 'Yes', no: 'No' });
      add('Which panel would you like your pet to receive? (Senior Screen — Canine)', `lab_senior_canine_panel_${patientId}`, {
        standard: 'Standard Comprehensive Panel',
        extended: 'Extended Comprehensive Panel',
        no: 'No thank you',
      });
      add('Which panel would you like your pet to receive? (Senior Screen — Feline)', `lab_senior_feline_two_panel_${patientId}`, {
        standard: 'Senior Screen Feline - Standard Panel',
        extended: 'Senior Screen Feline - Extended Panel',
        no: 'No thank you',
      });
      if (questions.length > 0) {
        labsSections.push({ sectionLabel: petName, patientId, patientName: petName, questions });
      }
    });
    if (labsSections.length > 0) {
      formAnswersPages.push({ pageNumber: labsPageNum, title: 'Labs We Recommend', sections: labsSections });
    }

    const formAnswersForPdf = { pages: formAnswersPages };

    return {
      ...formData,
      currentPage,
      optedInVaccineItems,
      storeAdditionalItems: storeAdditionalItemsPayload,
      commonlySelectedItems,
      remindersByPet,
      summaryLineItems,
      summaryForPdf,
      formAnswersForPdf,
      totals: {
        grandTotal,
        storeSubtotal,
        storeTax,
        storeTaxRate,
        petSubtotals,
      },
      labSelections: patientsData.reduce((acc: Record<string, any>, patient: any, idx: number) => {
        const id = patient.patientId ?? patient.patient?.id ?? idx;
        acc[String(id)] = {
          lab_early_detection_feline: formData[`lab_early_detection_feline_${id}`],
          lab_early_detection_canine: formData[`lab_early_detection_canine_${id}`],
          lab_senior_feline: formData[`lab_senior_feline_${id}`],
          lab_senior_canine_panel: formData[`lab_senior_canine_panel_${id}`],
          lab_senior_feline_two_panel: formData[`lab_senior_feline_two_panel_${id}`],
        };
        return acc;
      }, {}),
    };
  }

  async function handleSubmit() {
    const tokenValue = token;
    if (!tokenValue) return;
    const safeToken = tokenValue as string;

    const payloadFormData = buildFullFormSnapshot();

    setSubmitting(true);
    try {
      await http.post('/public/room-loader/submit', {
        token: safeToken,
        formData: payloadFormData,
      });
      // Refetch so we get submitStatus === 'completed' and responseFromClient, then show thank you page
      const { data: responseData } = await http.get(
        `/public/room-loader/form?token=${encodeURIComponent(safeToken)}`
      );
      setData(responseData);
      if (responseData?.submitStatus === 'completed') {
        setFormAlreadySubmitted(true);
      } else if (responseData?.responseFromClient ?? responseData?.savedForm) {
        const raw = responseData?.responseFromClient ?? responseData?.savedForm;
        const hasSubmitPayload =
          raw?.formData?.summaryForPdf != null ||
          (Array.isArray(raw?.formData?.summaryLineItems) && (raw?.formData?.summaryLineItems?.length ?? 0) > 0);
        if (hasSubmitPayload) setFormAlreadySubmitted(true);
      }
    } catch (err: any) {
      console.error('Error submitting form:', err);
      alert('Failed to submit form. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const patients = data?.patients ?? [];
  const appointments = data?.appointments ?? [];

  type LabRec = { code: string; title: string; message: string };
  const labRecommendationsByPet = useMemo(() => {
    const result: { patientId: number | undefined; patientName: string; recommendations: LabRec[] }[] = [];
    patients.forEach((patient: any, idx: number) => {
      const patientId = patient.patientId ?? patient.patient?.id;
      const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
      const appt = appointments[idx];
      const petKey = `pet${idx}`;
      const labWorkYes = formData[`${petKey}_labWork`] === true || formData[`${petKey}_labWork`] === 'yes' || (patient as any).questions?.labWork === true;
      const recs: LabRec[] = [];

      const speciesParts = [
        patient.species,
        patient.speciesEntity?.name,
        patient.patient?.species,
        patient.patient?.speciesEntity?.name,
        appt?.patient?.species,
        appt?.patient?.speciesEntity?.name,
      ].filter(Boolean) as string[];
      const speciesLower = speciesParts.length ? speciesParts.join(' ').toLowerCase() : '';
      const isCat = speciesLower.includes('cat') || speciesLower.includes('feline');
      const isDog = speciesLower.includes('dog') || speciesLower.includes('canine');
      const dob = patient?.dob ?? patient?.patient?.dob ?? appt?.patient?.dob;
      const age = dob != null ? getAgeYears({ dob }) : null;
      const standard = isWellnessVisit(patient);
      const listHasSenior = listContains(patient, 'senior screen');
      const listHasYoungOrEarly = listContains(patient, 'young wellness', 'early detection');
      const hadSenior8Mo = hadInLast8Months(history, 'senior screen');
      const hadYoungEarly8Mo = hadInLast8Months(history, 'young wellness', 'early detection');
      const listHasFIVOrFecal = listContains(patient, 'fiv', 'fecal');
      const listHas4dxOrFecal = listContains(patient, '4dx', 'fecal');

      if (labWorkYes) {
        recs.push({
          code: '8659999',
          title: 'Senior Screen',
          message: "You indicated that lab work would help with this visit. We recommend our Senior Screen to get a comprehensive picture of your pet's health.",
        });
      }

      if (age != null && isCat && standard && !listHasSenior && !hadSenior8Mo && age > 8) {
        if (listHasFIVOrFecal) {
          recs.push({
            code: 'FIL45129999',
            title: 'Senior Screen Feline',
            message: 'We recommend our Senior Screen Feline (fecal Dx, FeLV/FIV/HW, fPL, Chem 25, CBC, T4, UA). It would be cheaper to run this one panel and we would get more information.',
          });
        } else {
          recs.push({
            code: 'FIL8659999',
            title: 'Senior Screen Feline or Senior Screen',
            message: 'We recommend our Senior Screen Feline or Senior Screen for your senior cat.',
          });
        }
      }

      if (age != null && isDog && standard && !listHasSenior && !hadSenior8Mo && age > 7) {
        if (listHas4dxOrFecal) {
          recs.push({
            code: 'FIL25659999',
            title: 'Senior Screen Canine',
            message: 'We recommend our Senior Screen Canine (4Dx, Fecal O&P, Chem 25, CBC, T4, UA). It would be cheaper to run this one panel and we would get more information.',
          });
        } else {
          recs.push({
            code: 'FIL8659999',
            title: 'Senior Screen Canine or Senior Screen',
            message: 'We recommend our Senior Screen Canine or Senior Screen for your senior dog.',
          });
        }
      }

      if (age != null && isCat && standard && !listHasYoungOrEarly && !hadYoungEarly8Mo && age > 1 && age <= 8) {
        const msg = listHasFIVOrFecal
          ? "We recommend our Early Detection Panel - Feline (Chem 10, lytes, CBC, Fecal Dx, FeLV/FIV/HWT). Since you already have FIV or fecal on the list, it isn't much more to add on a lot more info."
          : 'We recommend our Early Detection Panel - Feline (Chem 10, lytes, CBC, Fecal Dx, FeLV/FIV/HWT).';
        recs.push({ code: 'FIL48119999', title: 'Early Detection Panel - Feline', message: msg });
      }

      if (age != null && isDog && standard && !listHasYoungOrEarly && !hadYoungEarly8Mo && age > 1 && age <= 7) {
        const msg = listHas4dxOrFecal
          ? "We recommend our Early Detection Panel - Canine (Chem 10, lytes, CBC, Fecal Dx, 4Dx). Since you already have 4Dx or fecal on the list, it isn't much more to add on a lot more info."
          : 'We recommend our Early Detection Panel - Canine (Chem 10, lytes, CBC, Fecal Dx, 4Dx).';
        recs.push({ code: 'FIL48719999', title: 'Early Detection Panel - Canine', message: msg });
      }

      result.push({
        patientId,
        patientName: patient.patientName || `Pet ${idx + 1}`,
        recommendations: recs,
      });
    });
    return result;
  }, [patients, appointments, treatmentHistoryByPatientId, formData]);

  useEffect(() => {
    const hasEarlyFeline = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === 'FIL48119999'));
    if (!hasEarlyFeline || !data) {
      setEarlyDetectionFelineItem(null);
      return;
    }
    const pid = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    searchItems({ q: 'Early Detection Panel - Feline', practiceId: pid, limit: 10 })
      .then((results) => {
        const first = results[0];
        setEarlyDetectionFelineItem(first || null);
      })
      .catch(() => setEarlyDetectionFelineItem(null));
  }, [data, labRecommendationsByPet]);

  useEffect(() => {
    const hasEarlyCanine = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === 'FIL48719999'));
    if (!hasEarlyCanine || !data) {
      setEarlyDetectionCanineItem(null);
      return;
    }
    const pid = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    searchItems({ q: 'Early Detection Panel - Canine (chem 10, cbc, lytes, fecal Dx, 4dx)', practiceId: pid, limit: 10 })
      .then((results) => {
        const first = results[0];
        setEarlyDetectionCanineItem(first || null);
      })
      .catch(() => setEarlyDetectionCanineItem(null));
  }, [data, labRecommendationsByPet]);

  // Senior panels: fetch Standard (same code for dog and cat) and Extended (canine vs feline by species). Same pattern for both.
  useEffect(() => {
    const hasSeniorCanine = labRecommendationsByPet.some((e) =>
      e.recommendations.some((r) => r.code === 'FIL25659999' || r.code === 'FIL8659999')
    );
    const has8659999 = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === '8659999'));
    const needStandard = hasSeniorCanine || has8659999;
    if (!needStandard || !data) {
      setSeniorCanineStandardItem(null);
      setSeniorFelineExtendedItem(null);
      if (!hasSeniorCanine) setSeniorCanineExtendedItem(null);
      return;
    }
    const pid = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    // Codes: Standard = "Senior Screen (chem 25, CBC, T4, UA)" (same as dog). Feline Extended = "Senior Screen Feline (Fecal Dx, felv/fiv/hw, fPL, chem 25, CBC, T4, UA)".
    const standardPromise = searchItems({ q: 'Senior Screen (chem 25, CBC, T4, UA)', practiceId: pid, limit: 10 });
    const canineExtendedPromise = hasSeniorCanine ? searchItems({ q: 'Senior Screen Canine (4Dx, Fecal O&P, chem 25, CBC, T4, UA)', practiceId: pid, limit: 10 }) : Promise.resolve([]);
    const felineExtendedPromise = has8659999 ? searchItems({ q: 'Senior Screen Feline (Fecal Dx, felv/fiv/hw, fPL, chem 25, CBC, T4, UA)', practiceId: pid, limit: 10 }) : Promise.resolve([]);
    Promise.all([standardPromise, canineExtendedPromise, felineExtendedPromise])
      .then(([standardRes, canineExtendedRes, felineExtendedRes]) => {
        const first = (arr: any) => (Array.isArray(arr) ? arr[0] : arr?.data?.[0] ?? arr?.results?.[0] ?? arr?.items?.[0]);
        setSeniorCanineStandardItem(first(standardRes) || null);
        setSeniorCanineExtendedItem(hasSeniorCanine ? (first(canineExtendedRes) || null) : null);
        setSeniorFelineExtendedItem(has8659999 ? (first(felineExtendedRes) || null) : null);
      })
      .catch(() => {
        setSeniorCanineStandardItem(null);
        setSeniorCanineExtendedItem(null);
        setSeniorFelineExtendedItem(null);
      });
  }, [data, labRecommendationsByPet]);

  useEffect(() => {
    const hasSeniorFeline = labRecommendationsByPet.some((e) =>
      e.recommendations.some((r) => r.code === 'FIL45129999' || r.code === 'FIL8659999')
    );
    if (!hasSeniorFeline || !data) {
      setSeniorFelineItem(null);
      return;
    }
    const pid = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    searchItems({ q: 'Senior Screen Feline', practiceId: pid, limit: 10 })
      .then((results) => {
        setSeniorFelineItem(results[0] || null);
      })
      .catch(() => setSeniorFelineItem(null));
  }, [data, labRecommendationsByPet]);

  useEffect(() => {
    if (!data) return;
    const pid = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    const queries: string[] = [];
    COMMON_ITEMS_CONFIG.forEach((c) => {
      queries.push(c.searchQuery);
      if ('searchQueryDog' in c && c.searchQueryDog) queries.push(c.searchQueryDog);
    });
    Promise.all(queries.map((q) => searchItems({ q, practiceId: pid, limit: 5 })))
      .then((results) => {
        const next: Record<string, SearchableItem | null> = {};
        queries.forEach((q, i) => {
          next[q] = Array.isArray(results[i]) && results[i][0] ? results[i][0] : null;
        });
        setCommonItemsFetched(next);
      })
      .catch(() => setCommonItemsFetched({}));
  }, [data]);

  /** Type-ahead store search: debounced 300ms after typing. */
  useEffect(() => {
    const q = storeSearchQuery.trim();
    if (q.length < 2) {
      setStoreSearchResults([]);
      setStoreSearchLoading(false);
      return;
    }
    setStoreSearchLoading(true);
    const timeoutId = window.setTimeout(() => {
      getEcwidProducts(q)
        .then((r) => { setStoreSearchResults(r); setStoreSearchLoading(false); })
        .catch(() => { setStoreSearchResults([]); setStoreSearchLoading(false); });
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
      setStoreSearchLoading(false);
    };
  }, [storeSearchQuery]);

  /** Group Ecwid results by product name so we show each name once; clicking opens modal to pick variation. */
  const storeSearchResultsByName = useMemo(() => {
    const map = new Map<string, EcwidProduct[]>();
    for (const p of storeSearchResults) {
      const name = p.name || 'Unnamed';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(p);
    }
    return Array.from(map.entries());
  }, [storeSearchResults]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Loading room loader form...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ color: '#dc3545' }}>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>No data available</h2>
      </div>
    );
  }

  // When submitStatus === 'completed', show thank you page with review/download
  if (formAlreadySubmitted && data.responseFromClient) {
    const handleReviewAndDownload = () => {
      if (pdfBlobUrl) {
        const a = document.createElement('a');
        a.href = pdfBlobUrl;
        a.download = `Room-Loader-Form-${DateTime.now().toISODate() ?? 'submitted'}.pdf`;
        a.click();
      } else {
        try {
          const practiceName = data.practiceName ?? data.practice?.name ?? 'Vet At Your Door';
          const doc = buildRoomLoaderPdf(data.responseFromClient, { practiceName });
          doc.save(`Room-Loader-Form-${DateTime.now().toISODate() ?? 'submitted'}.pdf`);
        } catch (e) {
          console.error('Error generating PDF for download:', e);
        }
      }
      const el = document.getElementById('submitted-form-pdf');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return (
      <div style={{ padding: '24px 20px', maxWidth: '900px', margin: '0 auto', fontFamily: 'system-ui, sans-serif', backgroundColor: '#f9f9f9', minHeight: '100vh' }}>
        <div style={{ marginBottom: '32px', padding: '28px 24px', backgroundColor: '#fff', border: '1px solid #e0e0e0', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 16px', fontSize: '26px', fontWeight: 700, color: '#212529' }}>
            Thank you
          </h1>
          <p style={{ margin: '0 0 12px', fontSize: '17px', color: '#495057', lineHeight: 1.5 }}>
            Your pre-appointment form has been submitted.
          </p>
          <p style={{ margin: '0 0 24px', fontSize: '16px', color: '#6c757d', lineHeight: 1.5 }}>
            Our team has received your form. A copy was emailed to you with a PDF attachment for your records.
          </p>
          <button
            type="button"
            onClick={handleReviewAndDownload}
            style={{
              padding: '14px 28px',
              fontSize: '16px',
              fontWeight: 600,
              backgroundColor: '#0d6efd',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            Review your form and download
          </button>
        </div>
        <div id="submitted-form-pdf" style={{ marginTop: '24px' }}>
          {pdfBlobUrl ? (
            <iframe
              title="Submitted form PDF"
              src={pdfBlobUrl}
              style={{ width: '100%', height: '80vh', minHeight: '600px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fff' }}
            />
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: '#666', fontSize: '16px' }}>
              Generating PDF…
            </div>
          )}
        </div>
      </div>
    );
  }

  const firstPatient = patients[0];
  const firstAppt = appointments[0];

  // Get doctor name from appointment
  const doctorName = firstAppt?.primaryProvider?.firstName && firstAppt?.primaryProvider?.lastName
    ? `${firstAppt.primaryProvider.title || 'Dr.'} ${firstAppt.primaryProvider.firstName} ${firstAppt.primaryProvider.lastName}`
    : 'Dr. ____';

  // Get appointment type
  const appointmentType = firstAppt?.appointmentType?.prettyName || firstAppt?.appointmentType?.name || 'appointment';

  const petNames = patients.map((p: any) => p.patientName || 'your pet').join(' and ');
  const appointmentDate = firstAppt?.appointmentStart ? formatDate(firstAppt.appointmentStart) : '____';
  const arrivalWindowStart = firstPatient?.arrivalWindow?.start ? formatTime(firstPatient.arrivalWindow.start) : '____';
  const arrivalWindowEnd = firstPatient?.arrivalWindow?.end ? formatTime(firstPatient.arrivalWindow.end) : '____';
  const appointmentReason = firstPatient?.appointmentReason || '';

  // Get recommended items (reminders + added items) — all pets combined (for any legacy use)
  const recommendedItems: any[] = [];
  const recommendedItemsByPet: any[][] = [];
  patients.forEach((patient: any) => {
    const petItems: any[] = [];
    if (patient.reminders && Array.isArray(patient.reminders)) {
      patient.reminders.forEach((reminder: any) => {
        if (reminder.item) {
          const row = {
            name: reminder.item.name,
            price: reminder.item.price,
            quantity: reminder.quantity || 1,
            type: reminder.itemType,
          };
          recommendedItems.push(row);
          petItems.push(row);
        } else {
          // Visit/consult reminders may have no matched item; still show as existing if description contains visit or consult
          const text = (reminder.reminderText ?? reminder.description ?? '').toLowerCase();
          if (text.includes('visit') || text.includes('consult')) {
            const row = {
              name: reminder.reminderText ?? reminder.description ?? 'Visit/Consult',
              price: reminder.price ?? null,
              quantity: reminder.quantity ?? 1,
              type: reminder.itemType ?? 'procedure',
            };
            recommendedItems.push(row);
            petItems.push(row);
          }
        }
      });
    }
    if (patient.addedItems && Array.isArray(patient.addedItems)) {
      patient.addedItems.forEach((item: any) => {
        const row = {
          name: item.name,
          price: item.price,
          quantity: item.quantity || 1,
          type: item.itemType,
        };
        recommendedItems.push(row);
        petItems.push(row);
      });
    }
    recommendedItemsByPet.push(petItems);
  });

  // Care plan: one page per pet. Page 1 = check-in; Page 2 = care plan pet 0; Page 2 + i = care plan pet i.
  const isCarePlanPage = patients.length > 0 && currentPage >= 2 && currentPage <= 1 + patients.length;
  const carePlanPetIndex = isCarePlanPage ? currentPage - 2 : 0;
  const currentCarePlanPatient = isCarePlanPage ? patients[carePlanPetIndex] : null;
  const currentPetRecommendedItems = currentCarePlanPatient != null ? recommendedItemsByPet[carePlanPetIndex] ?? [] : [];
  const isLastCarePlanPet = isCarePlanPage && currentPage === 1 + patients.length;
  const isFirstCarePlanPet = currentPage === 2;
  const labsPageIndex = 2 + patients.length;
  const isLabsPage = patients.length > 0 && currentPage === labsPageIndex;
  const summaryPageIndex = 3 + patients.length;
  const isSummaryPage = patients.length > 0 && currentPage === summaryPageIndex;

  // Check if cat and age conditions
  const isCat = firstPatient?.species?.toLowerCase().includes('cat') || firstPatient?.speciesEntity?.name?.toLowerCase().includes('cat');
  const isUnderOneYear = firstPatient?.dob ? 
    DateTime.now().diff(DateTime.fromISO(firstPatient.dob), 'years').years < 1 : false;

  const sectionLabelStyle = { marginBottom: '10px', color: '#555', fontSize: '18px', fontWeight: 600 } as const;
  const questionLabelStyle = { display: 'block', marginBottom: '10px', fontWeight: 500, color: '#333', fontSize: '16px' } as const;
  const inputBlockStyle = { padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ced4da', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' as const };
  const textareaStyle = { width: '100%', minHeight: '80px', padding: '12px', border: '1px solid #ced4da', borderRadius: '4px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' as const, backgroundColor: '#f9f9f9', boxSizing: 'border-box' as const };
  const readOnly = formAlreadySubmitted;

  return (
    <div style={{
      padding: '24px 20px',
      maxWidth: '1000px',
      margin: '0 auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#f9f9f9',
      minHeight: '100vh',
    }}>
      {readOnly && (
        <div
          style={{
            marginBottom: '20px',
            padding: '14px 18px',
            backgroundColor: '#e7f3ff',
            border: '1px solid #0d6efd',
            borderRadius: '8px',
            color: '#0a58ca',
            fontSize: '16px',
            fontWeight: 500,
          }}
          role="alert"
        >
          This form has already been submitted. Your answers are shown for your records only. No changes can be saved.
        </div>
      )}
      {/* Page 1 - Check-in Form */}
      {currentPage === 1 && (
        <div style={{
          padding: '24px',
          backgroundColor: '#fff',
          border: '2px solid #ddd',
          borderRadius: '12px',
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '14px', color: '#666' }}>
            PAGE 1
          </div>

          <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: '3px solid #e0e0e0' }}>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>
              Time to Check-in for your Appointment
            </h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginTop: '12px', marginBottom: '8px' }}>
              {doctorName} is looking forward to {petNames}'s {appointmentType} on {appointmentDate}.
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginBottom: '8px' }}>
              Window of arrival: {arrivalWindowStart} – {arrivalWindowEnd}
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginBottom: '0' }}>
              To best prepare for your appointment, please answer the questions below. We'll give you an estimate of costs before your visit.
            </p>
          </div>

          {patients.map((patient: any, petIdx: number) => {
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
            const isCatPatient = patient.species?.toLowerCase().includes('cat') || patient.speciesEntity?.name?.toLowerCase().includes('cat') || (patient.species ?? '').toLowerCase().includes('feline');
            // Only show new-patient questions when API marks as new, patient is not explicitly false, and patient is not already established (e.g. has reminders = already in wellness system).
            const markedNewByApi = patient.isNewPatient === true || appointments[petIdx]?.isNewPatient === true;
            const explicitlyNotNew = patient.isNewPatient === false;
            const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
            const isNewPatient = !explicitlyNotNew && markedNewByApi && !hasReminders;
            const appointmentReasonDisplay =
              patient.appointmentReason ??
              (appointments[petIdx] && (appointments[petIdx].description || appointments[petIdx].instructions)) ??
              '(RL-APPT-REASON)';

            return (
              <div
                key={petIdx}
                style={{
                  marginBottom: '30px',
                  padding: '20px',
                  backgroundColor: '#fff',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                }}
              >
                <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '3px solid #e0e0e0' }}>
                  <h3 style={{ margin: 0, color: '#212529', fontSize: '20px', fontWeight: 700 }}>
                    Pet {petIdx + 1}: {petName}
                  </h3>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <h4 style={sectionLabelStyle}>Reason for Appointment</h4>
                  <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd', marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px', fontWeight: 500 }}>You told us:</div>
                    <div style={{ fontSize: '14px', color: '#333' }}>{appointmentReasonDisplay}</div>
                  </div>
                  <label style={questionLabelStyle}>Could you expand on that?</label>
                  <textarea
                    value={formData[`${petKey}_appointmentReason`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_appointmentReason`, e.target.value)}
                    readOnly={readOnly}
                    disabled={readOnly}
                    style={{ ...textareaStyle, minHeight: '100px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                    placeholder="Please provide more details..."
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <h4 style={sectionLabelStyle}>General Well-being & Concerns</h4>
                  <label style={questionLabelStyle}>
                    How is {petName} doing otherwise? Any other specific concerns for this visit?
                  </label>
                  <textarea
                    value={formData[`${petKey}_generalWellbeing`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_generalWellbeing`, e.target.value)}
                    style={textareaStyle}
                    placeholder="How is your pet doing? Any other concerns?"
                  />
                </div>

                {isCatPatient && (
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={sectionLabelStyle}>Outdoor Access (cats)</h4>
                    <label style={questionLabelStyle}>Does {petName} go outdoors or live with a cat that goes outdoors?</label>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                        <input type="radio" name={`${petKey}_outdoorAccess`} value="yes" checked={formData[`${petKey}_outdoorAccess`] === 'yes'} onChange={(e) => handleInputChange(`${petKey}_outdoorAccess`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                        <input type="radio" name={`${petKey}_outdoorAccess`} value="no" checked={formData[`${petKey}_outdoorAccess`] === 'no'} onChange={(e) => handleInputChange(`${petKey}_outdoorAccess`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                        No
                      </label>
                    </div>
                  </div>
                )}

                {isNewPatient && (
                  <>
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={sectionLabelStyle}>New Patient – Behavior</h4>
                      <p style={{ fontSize: '15px', lineHeight: '1.6', color: '#555', marginBottom: '12px' }}>
                        Since we haven't met {petName} before, it helps to know a bit about their behavior (aligned with our Fear Free™ approach).
                      </p>
                      <label style={questionLabelStyle}>Describe {petName}'s behavior at home, around strangers, and at a typical vet office.</label>
                      <textarea value={formData[`${petKey}_newPatientBehavior`] || ''} onChange={(e) => handleInputChange(`${petKey}_newPatientBehavior`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, minHeight: '120px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="Describe your pet's behavior..." />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={sectionLabelStyle}>Feeding</h4>
                      <label style={questionLabelStyle}>What are you feeding {petName}? (brand, amount, frequency)</label>
                      <textarea value={formData[`${petKey}_feeding`] || ''} onChange={(e) => handleInputChange(`${petKey}_feeding`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="What are you feeding your pet?" />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={sectionLabelStyle}>Food Allergies</h4>
                      <label style={questionLabelStyle}>Do you or {petName} have any food allergies? (we like to bribe!)</label>
                      <div style={{ display: 'flex', gap: '20px', marginBottom: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                          <input type="radio" name={`${petKey}_foodAllergies`} value="yes" checked={formData[`${petKey}_foodAllergies`] === 'yes'} onChange={(e) => handleInputChange(`${petKey}_foodAllergies`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                          <input type="radio" name={`${petKey}_foodAllergies`} value="no" checked={formData[`${petKey}_foodAllergies`] === 'no'} onChange={(e) => handleInputChange(`${petKey}_foodAllergies`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                          No
                        </label>
                      </div>
                      {formData[`${petKey}_foodAllergies`] === 'yes' && (
                        <>
                          <label style={questionLabelStyle}>If yes, what are they?</label>
                          <textarea value={formData[`${petKey}_foodAllergiesDetails`] || ''} onChange={(e) => handleInputChange(`${petKey}_foodAllergiesDetails`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="Please describe..." />
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}>
            <button
              onClick={() => setCurrentPage(2)}
              style={{
                padding: '12px 28px',
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue to Care Plan →
            </button>
          </div>
        </div>
      )}

      {/* Veterinary Care Plan — one page per pet when multiple pets */}
      {isCarePlanPage && currentCarePlanPatient != null && (
        <div style={{
          padding: '24px',
          backgroundColor: '#fff',
          border: '2px solid #ddd',
          borderRadius: '12px',
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '14px', color: '#666' }}>
            {patients.length > 1 ? `Care Plan — ${currentCarePlanPatient.patientName || `Pet ${carePlanPetIndex + 1}`} (${carePlanPetIndex + 1} of ${patients.length})` : 'PAGE 2'}
          </div>

          <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '3px solid #e0e0e0' }}>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>
              Veterinary Care Plan{patients.length > 1 ? ` — ${currentCarePlanPatient.patientName || `Pet ${carePlanPetIndex + 1}`}` : ''}
            </h1>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <h4 style={sectionLabelStyle}>
              The following items are recommended for {currentCarePlanPatient?.patientName || `Pet ${carePlanPetIndex + 1}`}'s upcoming visit.
            </h4>
            <p style={{ fontSize: '14px', color: '#555', marginTop: '4px', marginBottom: '12px' }}>
              (Please uncheck any items you do not want)
            </p>
            {(() => {
              const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
              const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
              const displayItems = currentPetRecommendedItems.filter(
                (item) => !hasPhrase(item, 'trip fee')
              );
              const earlyDetectionYes = currentCarePlanPatient != null && formData[`lab_early_detection_feline_${currentCarePlanPatient.patientId ?? carePlanPetIndex}`] === 'yes';
              const earlyDetectionCanineYes = currentCarePlanPatient != null && formData[`lab_early_detection_canine_${currentCarePlanPatient.patientId ?? carePlanPetIndex}`] === 'yes';
              const seniorFelineYes = currentCarePlanPatient != null && formData[`lab_senior_feline_${currentCarePlanPatient.patientId ?? carePlanPetIndex}`] === 'yes';
              const seniorCanineExtended = currentCarePlanPatient != null && formData[`lab_senior_canine_panel_${currentCarePlanPatient.patientId ?? carePlanPetIndex}`] === 'extended';
              const seniorFelineTwoPanelExtended = currentCarePlanPatient != null && formData[`lab_senior_feline_two_panel_${currentCarePlanPatient.patientId ?? carePlanPetIndex}`] === 'extended';
              const fecalReplacedBy: string[] = [];
              if (earlyDetectionYes || earlyDetectionCanineYes) fecalReplacedBy.push('Early Detection Panel');
              if (seniorFelineYes) fecalReplacedBy.push('Senior Screen Feline');
              if (seniorCanineExtended || seniorFelineTwoPanelExtended) fecalReplacedBy.push('Extended Comprehensive Panel');
              if (displayItems.length === 0) {
                return <p style={{ color: '#666', fontStyle: 'italic', margin: 0 }}>No recommended items at this time.</p>;
              }
              return (
                <div style={{ padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {displayItems.map((item, idx) => {
                    const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
                    const isFecalReplacedForItem = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
                    const recKey = `pet${carePlanPetIndex}_rec_${idx}`;
                    const isChecked = isFecalReplacedForItem ? false : (isVisitOrConsult || formData[recKey] !== false);
                    const disabled = isVisitOrConsult || isFecalReplacedForItem;
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: idx < displayItems.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={disabled}
                          readOnly={disabled}
                          style={{ marginRight: '12px', width: '18px', height: '18px', cursor: disabled ? 'default' : 'pointer' }}
                          onChange={() => {
                            if (!disabled) handleInputChange(recKey, !isChecked);
                          }}
                        />
                        <span style={{ fontSize: '16px', color: '#333', ...(isFecalReplacedForItem ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{item.name}</span>
                        {item.quantity > 1 && <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>(Qty: {item.quantity})</span>}
                        {isFecalReplacedForItem && <span style={{ fontSize: '13px', color: '#666', marginLeft: '8px', fontStyle: 'italic' }}>(replaced by {fecalReplacedBy.join(' or ')})</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {currentCarePlanPatient != null && (() => {
            const patientId = currentCarePlanPatient.patientId ?? currentCarePlanPatient.patient?.id;
            const optedIn = patientId != null ? optedInVaccinesByPatientId[patientId] : undefined;
            const items = optedIn ? (Object.values(optedIn).filter(Boolean) as SearchableItem[]) : [];
            if (items.length === 0) return null;
            return (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={sectionLabelStyle}>Added from your selections</h4>
                <div style={{ padding: '15px', backgroundColor: '#e8f5e9', borderRadius: '4px', border: '1px solid #81c784' }}>
                  {items.map((item, idx) => (
                    <div key={idx} style={{ padding: '8px 0', borderBottom: idx < items.length - 1 ? '1px solid #c8e6c9' : 'none' }}>
                      <span style={{ fontSize: '16px', color: '#333' }}>{item.name}</span>
                      {item.price != null && <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>— ${typeof item.price === 'number' ? item.price.toFixed(2) : Number(item.price).toFixed(2)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Optional Vaccines — single current pet (only show section if there is something to ask) */}
          {(() => {
            const patient = currentCarePlanPatient;
            const petIdx = carePlanPetIndex;
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
            // Species can be on patient, patient.patient, or the matching appointment
            const apptPatient = appointments[petIdx]?.patient;
            const speciesParts = [
              patient.species,
              patient.speciesEntity?.name,
              patient.patient?.species,
              patient.patient?.speciesEntity?.name,
              apptPatient?.species,
              apptPatient?.speciesEntity?.name,
            ].filter(Boolean) as string[];
            const speciesLower = speciesParts.length ? speciesParts.join(' ').toLowerCase() : '';
            const isCatPatient = speciesLower.includes('cat') || speciesLower.includes('feline');
            // Explicit dog/canine check; when species is missing from API, assume dog so optional dog vaccines still show
            const isDog = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !isCatPatient);
            const isUnderOneYear = patient.dob ? 
              DateTime.now().diff(DateTime.fromISO(patient.dob), 'years').years < 1 : false;
            const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';

            const patientId = patient.patientId ?? patient.patient?.id;
            const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
            const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
            const showLepto = isDog && patientId != null && !declinedLeptoInPast(history) && !hadLeptoInLastYear(history) && !hasLeptoInLineItems(patient);
            const showBordetella = isDog && patientId != null && !declinedBordetellaInPast(history) && !hadBordetellaInLastYear(history) && !hasBordetellaInLineItems(patient);
            const showRabiesCats = isCatPatient && patient.vaccines?.rabies;
            const showFeLV = isCatPatient && patientId != null && !declinedFeLVInPast(history) && !hadFeLVInLastYear(history) && !hasFeLVInLineItems(patient);
            const showFeLVUnderOneOrOutdoor = isCatPatient && (isUnderOneYear || outdoorAccess);
            const hasAnyOptionalContent = showCrLymeBooster || showLepto || showBordetella || showRabiesCats || showFeLV || showFeLVUnderOneOrOutdoor;

            if (!hasAnyOptionalContent) return null;

            return (
              <div key={petIdx} style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '8px' }}>
                <div style={{ marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e0e0e0' }}>
                  <h3 style={{ margin: 0, color: '#212529', fontSize: '18px', fontWeight: 700 }}>{petName} — Optional Vaccines & Questions</h3>
                </div>

                {/* crLyme booster (dogs only; first-time crLyme this visit) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
                  if (!showCrLymeBooster) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Should we schedule your crLyme booster in the next 3-4 weeks?
                      </p>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_crLymeBooster`}
                            value="yes"
                            checked={formData[`${petKey}_crLymeBooster`] === 'yes'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'crLyme', `${petKey}_crLymeBooster`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_crLymeBooster`}
                            value="no"
                            checked={formData[`${petKey}_crLymeBooster`] === 'no'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'crLyme', `${petKey}_crLymeBooster`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_crLymeBooster`}
                            value="unsure"
                            checked={formData[`${petKey}_crLymeBooster`] === 'unsure'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'crLyme', `${petKey}_crLymeBooster`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          I'm not sure
                        </label>
                      </div>
                    </div>
                  );
                })()}

                {/* Leptospirosis recommendation (dogs only: not declined, not in last year, not on this visit) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showLepto =
                    isDog &&
                    patientId != null &&
                    !declinedLeptoInPast(history) &&
                    !hadLeptoInLastYear(history) &&
                    !hasLeptoInLineItems(patient);
                  if (!showLepto) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Leptospirosis: It looks like {petName} has not yet received the Leptospirosis vaccine.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Leptospirosis is a serious bacterial infection that can be life-threatening for dogs — and can also spread to humans. It's carried in the urine of wild animals, and dogs can contract it simply by drinking from puddles or streams.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Based on updated veterinary guidelines (from AAHA, ACVIM, and WSAVA) and the risks in our area, Vet At Your Door now considers Leptospirosis a core vaccine for all dogs.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        To protect {petName}, we recommend starting the vaccine series at your visit. It will involve two vaccines, 3–4 weeks apart, then an annual booster to stay protected.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the Lepto vaccine?
                      </p>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_leptoVaccine`}
                            value="yes"
                            checked={formData[`${petKey}_leptoVaccine`] === 'yes'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'lepto', `${petKey}_leptoVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_leptoVaccine`}
                            value="no"
                            checked={formData[`${petKey}_leptoVaccine`] === 'no'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'lepto', `${petKey}_leptoVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No
                        </label>
                      </div>
                    </div>
                  );
                })()}

                {/* Bordetella recommendation (dogs only: not declined, not in last year, not on this visit) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showBordetella =
                    isDog &&
                    patientId != null &&
                    !declinedBordetellaInPast(history) &&
                    !hadBordetellaInLastYear(history) &&
                    !hasBordetellaInLineItems(patient);
                  if (!showBordetella) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Bordetella: It doesn't look like {petName} has received the Bordetella ("Kennel Cough") vaccine in the last year.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        We recommend this vaccine for dogs under a year old and for dogs that are boarded, go to doggy day care, or take group training classes.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the Bordetella vaccine?
                      </p>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_bordetellaVaccine`}
                            value="yes"
                            checked={formData[`${petKey}_bordetellaVaccine`] === 'yes'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'bordetella', `${petKey}_bordetellaVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_bordetellaVaccine`}
                            value="no"
                            checked={formData[`${petKey}_bordetellaVaccine`] === 'no'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'bordetella', `${petKey}_bordetellaVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No
                        </label>
                      </div>
                    </div>
                  );
                })()}

                {/* Rabies Vaccine (Cats only) */}
                {isCatPatient && patient.vaccines?.rabies && (
                  <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      If not a member AND due for rabies AND a cat: we offer two rabies vaccines - a one year or three year - which would you prefer?
                    </p>
                    <div style={{ marginLeft: '20px' }}>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_rabiesPreference`}
                            value="1year"
                            checked={formData[`${petKey}_rabiesPreference`] === '1year'}
                            onChange={(e) => handleInputChange(`${petKey}_rabiesPreference`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Purevax Rabies 1 year
                        </label>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_rabiesPreference`}
                            value="3year"
                            checked={formData[`${petKey}_rabiesPreference`] === '3year'}
                            onChange={(e) => handleInputChange(`${petKey}_rabiesPreference`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Purevax Rabies 3 year
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_rabiesPreference`}
                            value="no"
                            checked={formData[`${petKey}_rabiesPreference`] === 'no'}
                            onChange={(e) => handleInputChange(`${petKey}_rabiesPreference`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No thank you, I do not want a rabies vx administered to my cat.
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* FeLV recommendation (cats only: not declined, not in last year, not on this visit) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showFeLV =
                    isCatPatient &&
                    patientId != null &&
                    !declinedFeLVInPast(history) &&
                    !hadFeLVInLastYear(history) &&
                    !hasFeLVInLineItems(patient);
                  if (!showFeLV) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        FeLV (Feline Leukemia Vaccine): It looks like {petName} has not yet received the FeLV vaccine.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        FeLV is a contagious and potentially fatal virus spread through close contact between cats, like grooming or sharing food and water bowls.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Based on updated veterinary guidelines, FeLV is now considered a core vaccine for all kittens under one year old, regardless of whether they live indoors or outdoors. We also highly recommend it for any adult cats who go outside or live with cats who do.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the FeLV vaccine?
                      </p>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_felvVaccine`}
                            value="yes"
                            checked={formData[`${petKey}_felvVaccine`] === 'yes'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'felv', `${petKey}_felvVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_felvVaccine`}
                            value="no"
                            checked={formData[`${petKey}_felvVaccine`] === 'no'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'felv', `${petKey}_felvVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No
                        </label>
                      </div>
                    </div>
                  );
                })()}

                {/* FELV Vaccine (cat, under 1 yr or outdoor) */}
                {isCatPatient && (isUnderOneYear || outdoorAccess) && (
                  <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      If a cat AND (&lt; 1 yr old OR answered yes to outdoor question)
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      FELV, or feline leukemia virus, is a contagious and potentially fatal virus spread through close contact between cats, like grooming or sharing food and water bowls.
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      Based on veterinary guidelines, FELV is now considered a core vaccine for all kittens under one year old, regardless of whether they live indoors or outdoors. We also highly recommend it for any adult cats who go outside or live with cats who do.
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      Do you want us to give the FELV vaccine to <strong>{petName}</strong>? This would be the first of two. The second would be given 3-4 weeks later.
                    </p>
                    <div style={{ marginLeft: '20px' }}>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_felvVaccine`}
                            value="yes"
                            checked={formData[`${petKey}_felvVaccine`] === 'yes'}
                            onChange={(e) => handleVaccineOptChange(petKey, patient.patientId ?? patient.patient?.id, 'felv', `${petKey}_felvVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_felvVaccine`}
                            value="no"
                            checked={formData[`${petKey}_felvVaccine`] === 'no'}
                            onChange={(e) => handleVaccineOptChange(petKey, patient.patientId ?? patient.patient?.id, 'felv', `${petKey}_felvVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No thank you.
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}>
            <button
              onClick={() => setCurrentPage(isFirstCarePlanPet ? 1 : currentPage - 1)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isFirstCarePlanPet ? '← Back to Check-in' : '← Previous pet'}
            </button>
            {isLastCarePlanPet ? (
              <button
                onClick={() => setCurrentPage(labsPageIndex)}
                style={{
                  padding: '12px 28px',
                  backgroundColor: '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Next: Labs We Recommend →
              </button>
            ) : (
              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                style={{
                  padding: '12px 28px',
                  backgroundColor: '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Next pet →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Labs We Recommend */}
      {isLabsPage && (
        <div style={{ padding: '24px', backgroundColor: '#fff', border: '2px solid #ddd', borderRadius: '12px', position: 'relative' }}>
          <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '3px solid #e0e0e0' }}>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>Labs We Recommend</h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginTop: '10px', marginBottom: 0 }}>
              Based on your pet's age, species, and today's visit, here are lab panels we suggest.
            </p>
          </div>

          {labRecommendationsByPet.map((entry, idx) => (
            <div
              key={idx}
              style={{
                marginBottom: '24px',
                padding: '20px',
                backgroundColor: '#f9f9f9',
                border: '1px solid #ddd',
                borderRadius: '8px',
              }}
            >
              <div style={{ marginBottom: '16px', paddingBottom: '10px', borderBottom: '2px solid #e0e0e0' }}>
                <h3 style={{ margin: 0, color: '#212529', fontSize: '18px', fontWeight: 700 }}>{entry.patientName}</h3>
              </div>
              {entry.recommendations.length === 0 ? (
                <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>No specific lab recommendations for this visit.</p>
              ) : (
                entry.recommendations.map((rec, rIdx) => {
                  const isEarlyDetectionFeline = rec.code === 'FIL48119999';
                  const isEarlyDetectionCanine = rec.code === 'FIL48719999';
                  const petName = entry.patientName || 'your pet';
                  const earlyDetKey = `lab_early_detection_feline_${entry.patientId ?? idx}`;
                  const earlyDetValue = formData[earlyDetKey];
                  const earlyDetCanineKey = `lab_early_detection_canine_${entry.patientId ?? idx}`;
                  const earlyDetCanineValue = formData[earlyDetCanineKey];
                  // For "replace fecal" copy and price diff: find this pet's fecal reminder
                  const patientForEntry = patients.find((p: any) => String(p.patientId ?? p.patient?.id ?? '') === String(entry.patientId ?? '')) ?? patients[idx];
                  const fecalReminder = patientForEntry?.reminders?.find((r: any) => ((r?.item?.name ?? '').toLowerCase().includes('fecal')));
                  const fecalPrice = fecalReminder?.item?.price != null ? Number(fecalReminder.item.price) : null;
                  const panelPrice = getSearchItemPrice(earlyDetectionFelineItem);
                  const priceDiff = panelPrice != null && fecalPrice != null ? panelPrice - fecalPrice : null;
                  const earlyDetCaninePanelPrice = getSearchItemPrice(earlyDetectionCanineItem);
                  const earlyDetCaninePriceDiff = earlyDetCaninePanelPrice != null && fecalPrice != null ? earlyDetCaninePanelPrice - fecalPrice : null;
                  const hasFecalReminder = !!fecalReminder;
                  // When user says Yes, uncheck the fecal item on Care Plan (recKey for this pet's fecal in displayItems)
                  const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
                  const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
                  const entryDisplayItems = (recommendedItemsByPet[idx] ?? []).filter((item: any) => !hasPhrase(item, 'trip fee'));
                  const fecalDisplayIdx = entryDisplayItems.findIndex((item: any) => hasPhrase(item, 'fecal'));
                  const fecalRecKey = fecalDisplayIdx >= 0 ? `pet${idx}_rec_${fecalDisplayIdx}` : null;

                  const apptForEntry = appointments[idx];
                  const apptPatientEntry = apptForEntry?.patient;
                  const speciesPartsEntry = [
                    patientForEntry?.species,
                    patientForEntry?.speciesEntity?.name,
                    (patientForEntry as any)?.patient?.species,
                    (patientForEntry as any)?.patient?.speciesEntity?.name,
                    apptPatientEntry?.species,
                    apptPatientEntry?.speciesEntity?.name,
                  ].filter(Boolean) as string[];
                  const speciesLowerEntry = speciesPartsEntry.length ? speciesPartsEntry.join(' ').toLowerCase() : '';
                  const isDogEntry = speciesLowerEntry.includes('dog') || speciesLowerEntry.includes('canine') || (speciesLowerEntry === '' && !speciesLowerEntry.includes('cat'));
                  const isCatEntry = speciesLowerEntry.includes('cat') || speciesLowerEntry.includes('feline');
                  const isSeniorCanine = (rec.code === 'FIL25659999' || rec.code === 'FIL8659999') && isDogEntry;
                  const isSeniorFelineWithFecal = rec.code === 'FIL45129999';
                  const isLabWorkYesFelineTwoPanel = rec.code === '8659999' && isCatEntry;

                  const formatPrice = (p: number | null | undefined) => (p != null && !Number.isNaN(Number(p)) ? `$${Number(p).toFixed(2)}` : null);
                  const standardPrice = getSearchItemPrice(seniorCanineStandardItem);
                  const extendedPrice = getSearchItemPrice(seniorCanineExtendedItem);
                  const seniorCanineDiff = standardPrice != null && extendedPrice != null ? extendedPrice - standardPrice : null;
                  const seniorPanelKey = `lab_senior_canine_panel_${entry.patientId ?? idx}`;
                  const seniorPanelValue = formData[seniorPanelKey];
                  const seniorFelineKey = `lab_senior_feline_${entry.patientId ?? idx}`;
                  const seniorFelineValue = formData[seniorFelineKey];
                  const seniorFelinePrice = getSearchItemPrice(seniorFelineItem);
                  const seniorFelinePriceDiff = seniorFelinePrice != null && fecalPrice != null ? seniorFelinePrice - fecalPrice : null;

                  const seniorFelineStandardPrice = getSearchItemPrice(seniorCanineStandardItem);
                  const seniorFelineExtendedPrice = getSearchItemPrice(seniorFelineExtendedItem);
                  const seniorFelineTwoPanelDiff = seniorFelineStandardPrice != null && seniorFelineExtendedPrice != null ? seniorFelineExtendedPrice - seniorFelineStandardPrice : null;
                  const seniorFelineTwoPanelKey = `lab_senior_feline_two_panel_${entry.patientId ?? idx}`;
                  const seniorFelineTwoPanelValue = formData[seniorFelineTwoPanelKey];
                  const seniorFelineExtendedMinusFecal = seniorFelineExtendedPrice != null && fecalPrice != null ? seniorFelineExtendedPrice - fecalPrice : null;

                  if (isEarlyDetectionFeline) {
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Early Detection Panel:</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            For cats less than eight years old, we can run a more extensive &quot;mini&quot; panel called an Early Detection Panel. Conducting annual lab work establishes a baseline for {petName} that we can compare to in times of illness. It also aligns with the proactive essence of our philosophy we call Vet Med 3.0 by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.
                          </p>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                        </div>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>The Early Detection Panel includes:</p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Abbreviated Chemistry:</strong> looks at organ function such as for the liver and kidneys.</li>
                          <li><strong>Complete Blood Count (CBC):</strong> looks at red blood cells, white blood cells and platelets.</li>
                          <li><strong>Fecal:</strong> A stool sample analysis to check for intestinal parasites.</li>
                          <li><strong>FIV/FeLV test:</strong> These two infectious diseases can cause harm to cats and can cause other cats that are exposed to get sick.</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: hasFecalReminder ? '8px' : '16px' }}>
                          This bundled panel costs {formatPrice(getSearchItemPrice(earlyDetectionFelineItem)) ?? 'our standard lab pricing (ask at visit).'}
                        </p>
                        {hasFecalReminder && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '16px' }}>
                            This will replace that fecal test
                            {priceDiff != null && !Number.isNaN(priceDiff)
                              ? priceDiff > 0
                                ? ` and it only costs $${priceDiff.toFixed(2)} more.`
                                : priceDiff < 0
                                  ? ` and saves you $${(-priceDiff).toFixed(2)}.`
                                  : ' at no extra cost.'
                              : '.'}
                          </p>
                        )}
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Would you like to do the Early Detection Panel?</p>
                        <div style={{ display: 'flex', gap: '20px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={earlyDetKey}
                              value="yes"
                              checked={earlyDetValue === 'yes'}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleInputChange(earlyDetKey, val);
                                if (val === 'yes' && fecalRecKey != null) handleInputChange(fecalRecKey, false);
                              }}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Yes
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={earlyDetKey}
                              value="no"
                              checked={earlyDetValue === 'no'}
                              onChange={(e) => handleInputChange(earlyDetKey, e.target.value)}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            No
                          </label>
                        </div>
                        {earlyDetValue === 'yes' && (
                          <>
                            <p style={{ fontSize: '14px', color: '#333', marginTop: '12px', padding: '12px', backgroundColor: '#e8f5e9', border: '1px solid #81c784', borderRadius: '6px', lineHeight: 1.5 }}>
                              Great!<br /><br />
                              <strong>NOTE:</strong> Please try to have a stool sample (non-frozen, fresher is better!) ready for us when we arrive!
                            </p>
                            {hasFecalReminder && fecalReminder?.item?.name && (
                              <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                                Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Early Detection Panel)
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }

                  if (isEarlyDetectionCanine) {
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Early Detection Panel:</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            For dogs less than eight years old, there is an extensive &quot;mini&quot; panel called an Early Detection Panel. Conducting annual lab work establishes a baseline for {petName} that we can compare to in times of illness. It also aligns with the proactive essence of our philosophy we call Vet Med 3.0 by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.
                          </p>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                        </div>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>The Early Detection Panel includes:</p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Abbreviated Chemistry:</strong> looks at organ function such as for the liver and kidneys.</li>
                          <li><strong>Complete Blood Count, or &quot;CBC&quot;:</strong> that looks at red blood cells, white blood cells and platelets.</li>
                          <li><strong>Fecal:</strong> A stool sample analysis to check for intestinal parasites.</li>
                          <li><strong>4dx (Heartworm/Tick test):</strong> Tests for heartworm (spread by mosquitoes) and three different tick-borne diseases (lyme, anaplasma, and ehrlichia).</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: hasFecalReminder ? '8px' : '16px' }}>
                          This bundled panel costs {formatPrice(getSearchItemPrice(earlyDetectionCanineItem)) ?? 'our standard lab pricing (ask at visit).'}
                        </p>
                        {hasFecalReminder && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '16px' }}>
                            This will replace that fecal test
                            {earlyDetCaninePriceDiff != null && !Number.isNaN(earlyDetCaninePriceDiff)
                              ? earlyDetCaninePriceDiff > 0
                                ? ` and it only costs $${earlyDetCaninePriceDiff.toFixed(2)} more.`
                                : earlyDetCaninePriceDiff < 0
                                  ? ` and saves you $${(-earlyDetCaninePriceDiff).toFixed(2)}.`
                                  : ' at no extra cost.'
                              : '.'}
                          </p>
                        )}
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Would you like to do the Early Detection Panel?</p>
                        <div style={{ display: 'flex', gap: '20px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={earlyDetCanineKey}
                              value="yes"
                              checked={earlyDetCanineValue === 'yes'}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleInputChange(earlyDetCanineKey, val);
                                if (val === 'yes' && fecalRecKey != null) handleInputChange(fecalRecKey, false);
                              }}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Yes
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={earlyDetCanineKey}
                              value="no"
                              checked={earlyDetCanineValue === 'no'}
                              onChange={(e) => handleInputChange(earlyDetCanineKey, e.target.value)}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            No
                          </label>
                        </div>
                        {earlyDetCanineValue === 'yes' && (
                          <>
                            <p style={{ fontSize: '14px', color: '#333', marginTop: '12px', padding: '12px', backgroundColor: '#e8f5e9', border: '1px solid #81c784', borderRadius: '6px', lineHeight: 1.5 }}>
                              Great!<br /><br />
                              <strong>NOTE:</strong> Please try to have a stool sample (non-frozen, fresher is better!) ready for us when we arrive!
                            </p>
                            {hasFecalReminder && fecalReminder?.item?.name && (
                              <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                                Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Early Detection Panel)
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }

                  if (isSeniorCanine) {
                    const extendedMinusFecal = extendedPrice != null && fecalPrice != null ? extendedPrice - fecalPrice : null;
                    const labWorkYesForEntry = formData[`pet${idx}_labWork`] === true || formData[`pet${idx}_labWork`] === 'yes' || (patients[idx] as any)?.questions?.labWork === true;
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Senior Screen — Canine</div>
                        {!labWorkYesForEntry && (
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, marginBottom: '12px' }}>
                            It looks like {petName} is due for Annual Comprehensive Lab Work, which helps us gain helpful insight into {petName}&apos;s overall health and trends over time.
                          </p>
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            We have two panels to choose from. Our <strong>Standard Comprehensive Panel</strong> ({formatPrice(standardPrice) ?? 'see pricing at visit'}) includes a:
                          </p>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                        </div>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Chemistry</strong> to look at organ function such as liver or kidneys</li>
                          <li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts</li>
                          <li><strong>Thyroid level</strong>, as this level can go below normal in middle and older aged dogs</li>
                          <li><strong>Urinalysis</strong>, to look at kidney and urinary health</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder ? '8px' : '12px' }}>
                          We also offer an <strong>Extended Comprehensive Panel</strong>, which is {seniorCanineDiff != null ? `$${seniorCanineDiff.toFixed(2)} more` : 'a bit more'}. This panel includes everything in the Standard Comprehensive Panel above and also includes a:
                        </p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder ? '8px' : '12px', paddingLeft: '20px' }}>
                          <li>Heartworm/tick disease screening test (called &quot;4Dx&quot;)</li>
                          <li>Stool sample analysis for parasites (&quot;Fecal&quot;)</li>
                        </ul>
                        {hasFecalReminder && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
                            The Extended Comprehensive Panel includes a fecal test, so it would replace the fecal already on your care plan.
                            {extendedMinusFecal != null && !Number.isNaN(extendedMinusFecal)
                              ? extendedMinusFecal > 0
                                ? ` It only costs $${extendedMinusFecal.toFixed(2)} more.`
                                : extendedMinusFecal < 0
                                  ? ` It saves you $${(-extendedMinusFecal).toFixed(2)}.`
                                  : ' It\'s the same price.'
                              : ''}
                          </p>
                        )}
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '16px' }}>
                          Conducting annual lab work aligns with the proactive essence of our philosophy we call Vet Med 3.0 by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.
                        </p>
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Which panel would you like {petName} to receive?</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorPanelKey}
                              value="standard"
                              checked={seniorPanelValue === 'standard'}
                              onChange={() => handleInputChange(seniorPanelKey, 'standard')}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Standard Comprehensive Panel {formatPrice(standardPrice) && `(${formatPrice(standardPrice)})`}
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorPanelKey}
                              value="extended"
                              checked={seniorPanelValue === 'extended'}
                              onChange={() => {
                                handleInputChange(seniorPanelKey, 'extended');
                                if (fecalRecKey != null) handleInputChange(fecalRecKey, false);
                              }}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Extended Comprehensive Panel {formatPrice(extendedPrice) && `(${formatPrice(extendedPrice)})`}
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorPanelKey}
                              value="no"
                              checked={seniorPanelValue === 'no'}
                              onChange={() => handleInputChange(seniorPanelKey, 'no')}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            No thank you
                          </label>
                        </div>
                        {seniorPanelValue === 'extended' && hasFecalReminder && fecalReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Extended Comprehensive Panel)
                          </p>
                        )}
                      </div>
                    );
                  }

                  if (isLabWorkYesFelineTwoPanel) {
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Senior Screen — Feline</div>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '16px' }}>
                          With the symptoms you mentioned for {petName}, {doctorName} is likely to recommend lab work in order to gain valuable insight into why {petName} might be displaying these symptoms.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            We have two panels to choose from. First, our <strong>Standard Comprehensive Panel</strong> ({formatPrice(seniorFelineStandardPrice) ?? 'see pricing at visit'}) includes a:
                          </p>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                        </div>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Chemistry</strong> to look at organ function like the liver and kidneys.</li>
                          <li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts.</li>
                          <li><strong>Thyroid level</strong>, which may increase in older cats.</li>
                          <li><strong>Urinalysis</strong>, to look at kidney and urinary health.</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder ? '8px' : '12px' }}>
                          We also offer a more <strong>Extended Comprehensive Panel</strong>, which is {seniorFelineTwoPanelDiff != null ? `around $${seniorFelineTwoPanelDiff.toFixed(2)} more` : 'a bit more'}. This panel includes everything in the Standard Comprehensive Panel above and also includes:
                        </p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder ? '8px' : '12px', paddingLeft: '20px' }}>
                          <li>A screening (called &quot;fPL&quot;) for chronic pancreatitis. This is a condition that is common in older cats, causes vague symptoms, and doesn&apos;t usually show itself on a standard comprehensive panel.</li>
                          <li>Stool sample analysis for parasites (&quot;Fecal&quot;).</li>
                          <li>Screening for three infectious diseases: FIV, FeLV, and Heartworm.</li>
                        </ul>
                        {hasFecalReminder && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
                            The Extended Comprehensive Panel includes a fecal test, so it would replace the fecal already on your care plan.
                            {seniorFelineExtendedMinusFecal != null && !Number.isNaN(seniorFelineExtendedMinusFecal)
                              ? seniorFelineExtendedMinusFecal > 0
                                ? ` It only costs $${seniorFelineExtendedMinusFecal.toFixed(2)} more.`
                                : seniorFelineExtendedMinusFecal < 0
                                  ? ` It saves you $${(-seniorFelineExtendedMinusFecal).toFixed(2)}.`
                                  : ' It\'s the same price.'
                              : ''}
                          </p>
                        )}
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '16px' }}>
                          Conducting annual lab work aligns with the proactive essence of our philosophy we call Vet Med 3.0 by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.
                        </p>
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Which panel would you like {petName} to receive?</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorFelineTwoPanelKey}
                              value="standard"
                              checked={seniorFelineTwoPanelValue === 'standard'}
                              onChange={() => handleInputChange(seniorFelineTwoPanelKey, 'standard')}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Standard Comprehensive Panel {formatPrice(seniorFelineStandardPrice) && `(${formatPrice(seniorFelineStandardPrice)})`}
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorFelineTwoPanelKey}
                              value="extended"
                              checked={seniorFelineTwoPanelValue === 'extended'}
                              onChange={() => {
                                handleInputChange(seniorFelineTwoPanelKey, 'extended');
                                if (fecalRecKey != null) handleInputChange(fecalRecKey, false);
                              }}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Extended Comprehensive Panel {formatPrice(seniorFelineExtendedPrice) && `(${formatPrice(seniorFelineExtendedPrice)})`}
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorFelineTwoPanelKey}
                              value="no"
                              checked={seniorFelineTwoPanelValue === 'no'}
                              onChange={() => handleInputChange(seniorFelineTwoPanelKey, 'no')}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            No thank you
                          </label>
                        </div>
                        {seniorFelineTwoPanelValue === 'extended' && hasFecalReminder && fecalReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Extended Comprehensive Panel)
                          </p>
                        )}
                      </div>
                    );
                  }

                  if (isSeniorFelineWithFecal) {
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Senior Screen Feline</div>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px' }}>
                          We recommend our Senior Screen Feline (fecal Dx, FeLV/FIV/HW, fPL, Chem 25, CBC, T4, UA). It would be cheaper to run this one panel and we would get more information.
                        </p>
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: hasFecalReminder ? '8px' : '16px' }}>
                          This panel costs {formatPrice(seniorFelinePrice) ?? 'our standard lab pricing (ask at visit).'}
                        </p>
                        {hasFecalReminder && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '16px' }}>
                            This will replace that fecal test
                            {seniorFelinePriceDiff != null && !Number.isNaN(seniorFelinePriceDiff)
                              ? seniorFelinePriceDiff > 0
                                ? ` and it only costs $${seniorFelinePriceDiff.toFixed(2)} more.`
                                : seniorFelinePriceDiff < 0
                                  ? ` and saves you $${(-seniorFelinePriceDiff).toFixed(2)}.`
                                  : ' at no extra cost.'
                              : '.'}
                          </p>
                        )}
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Would you like {petName} to receive the Senior Screen Feline?</p>
                        <div style={{ display: 'flex', gap: '20px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorFelineKey}
                              value="yes"
                              checked={seniorFelineValue === 'yes'}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleInputChange(seniorFelineKey, val);
                                if (val === 'yes' && fecalRecKey != null) handleInputChange(fecalRecKey, false);
                              }}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Yes
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input
                              type="radio"
                              name={seniorFelineKey}
                              value="no"
                              checked={seniorFelineValue === 'no'}
                              onChange={(e) => handleInputChange(seniorFelineKey, e.target.value)}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            No
                          </label>
                        </div>
                        {seniorFelineValue === 'yes' && hasFecalReminder && fecalReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Senior Screen Feline)
                          </p>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                      <div style={{ fontWeight: 600, color: '#333', fontSize: '16px', marginBottom: '6px' }}>{rec.title}</div>
                      <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.5 }}>{rec.message}</div>
                    </div>
                  );
                })
              )}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}>
            <button
              onClick={() => setCurrentPage(labsPageIndex - 1)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Back to Care Plan
            </button>
            <button
              onClick={() => setCurrentPage(summaryPageIndex)}
              style={{
                padding: '12px 28px',
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Next: Summary →
            </button>
          </div>
        </div>
      )}

      {/* Final Summary */}
      {isSummaryPage && (() => {
        const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
        const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
        const formatPrice = (p: number | null | undefined) => (p != null && !Number.isNaN(Number(p)) ? `$${Number(p).toFixed(2)}` : '$0.00');
        let grandTotal = 0;
        return (
          <div style={{ padding: '24px', backgroundColor: '#fff', border: '2px solid #ddd', borderRadius: '12px', position: 'relative' }}>
            <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '3px solid #e0e0e0' }}>
              <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>Summary & Total</h1>
              <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginTop: '10px', marginBottom: 0 }}>
                Uncheck any item you do not want. Visits/consults and trip fee cannot be removed. Removed or declined items are shown crossed out and do not affect the total.
              </p>
            </div>

            {patients.map((patient: any, petIdx: number) => {
              const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
              const petName = patient.patientName || `Pet ${petIdx + 1}`;
              const allItems = recommendedItemsByPet[petIdx] ?? [];
              const displayItems = allItems.filter((item: any) => !hasPhrase(item, 'trip fee'));
              const tripFeeItems = allItems.filter((item: any) => hasPhrase(item, 'trip fee'));
              const displayWithIdx = displayItems.map((item: any, idx: number) => ({ item, idx }));
              const uncheckableDisplay = displayWithIdx.filter(({ item }) => hasPhrase(item, 'visit') || hasPhrase(item, 'consult'));
              const checkableDisplay = displayWithIdx.filter(({ item }) => !hasPhrase(item, 'visit') && !hasPhrase(item, 'consult'));
              const earlyDetectionYes = formData[`lab_early_detection_feline_${patientId}`] === 'yes';
              const earlyDetectionCanineYes = formData[`lab_early_detection_canine_${patientId}`] === 'yes';
              const seniorFelineYes = formData[`lab_senior_feline_${patientId}`] === 'yes';
              const seniorCaninePanel = formData[`lab_senior_canine_panel_${patientId}`];
              const seniorFelineTwoPanel = formData[`lab_senior_feline_two_panel_${patientId}`];
              const fecalReplacedBy: string[] = [];
              if (earlyDetectionYes || earlyDetectionCanineYes) fecalReplacedBy.push('Early Detection Panel');
              if (seniorFelineYes) fecalReplacedBy.push('Senior Screen Feline');
              if (seniorCaninePanel === 'extended' || seniorFelineTwoPanel === 'extended') fecalReplacedBy.push('Extended Comprehensive Panel');

              let petSubtotal = 0;

              const speciesPartsPet = [
                patient.species,
                patient.speciesEntity?.name,
                (patient as any).patient?.species,
                appointments[petIdx]?.patient?.species,
              ].filter(Boolean) as string[];
              const speciesLowerPet = speciesPartsPet.join(' ').toLowerCase();
              const isDogPet = speciesLowerPet.includes('dog') || speciesLowerPet.includes('canine') || (speciesLowerPet === '' && !speciesLowerPet.includes('cat'));

              const renderDisplayRow = (item: any, idx: number) => {
                const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
                const isFecalReplaced = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
                const recKey = `pet${petIdx}_rec_${idx}`;
                const canUncheck = !isVisitOrConsult && !isFecalReplaced && !readOnly;
                const isChecked = isFecalReplaced ? false : (isVisitOrConsult || formData[recKey] !== false);
                const price = Number(item.price) || 0;
                const qty = Number(item.quantity) || 1;
                const lineTotal = isChecked && !isFecalReplaced ? price * qty : 0;
                petSubtotal += lineTotal;
                return (
                  <div key={`d-${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: canUncheck ? 'pointer' : 'default', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!canUncheck || readOnly}
                        onChange={canUncheck ? () => handleInputChange(recKey, !isChecked) : undefined}
                        style={{
                          marginRight: '12px',
                          width: '18px',
                          height: '18px',
                          cursor: canUncheck ? 'pointer' : 'default',
                          flexShrink: 0,
                          opacity: canUncheck ? 1 : 0.6,
                          accentColor: canUncheck ? undefined : '#999',
                        }}
                      />
                      <span style={{ ...((!isChecked || isFecalReplaced) ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>
                        {item.name}
                        {qty > 1 && <span style={{ color: '#666', marginLeft: '6px', fontSize: '14px' }}>(Qty: {qty})</span>}
                        {isFecalReplaced && <span style={{ fontSize: '13px', color: '#666', marginLeft: '8px', fontStyle: 'italic' }}>(replaced by {fecalReplacedBy.join(' or ')})</span>}
                      </span>
                    </label>
                    <span style={{ fontWeight: 500, flexShrink: 0, ...((!isChecked || isFecalReplaced) ? { textDecoration: 'line-through', color: '#888' } : {}) }}>
                      {formatPrice(isChecked && !isFecalReplaced ? price * qty : 0)}
                    </span>
                  </div>
                );
              };

              return (
                <div key={petIdx} style={{ marginBottom: '28px', padding: '20px', backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '8px' }}>
                  <h3 style={{ margin: 0, marginBottom: '14px', color: '#212529', fontSize: '18px', fontWeight: 700 }}>{petName}</h3>
                  <div style={{ borderBottom: '1px solid #e0e0e0', paddingBottom: '12px', marginBottom: '12px' }}>
                    {/* Uncheckable first: visit/consult */}
                    {uncheckableDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {/* Trip fee - always shown, greyed-out checkbox */}
                    {tripFeeItems.map((item: any, idx: number) => {
                      const price = Number(item.price) || 0;
                      const qty = Number(item.quantity) || 1;
                      const lineTotal = price * qty;
                      petSubtotal += lineTotal;
                      return (
                        <div key={`t-${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', flex: 1, margin: 0, cursor: 'default' }}>
                            <input
                              type="checkbox"
                              checked
                              disabled
                              readOnly
                              style={{ marginRight: '12px', width: '18px', height: '18px', flexShrink: 0, opacity: 0.6, accentColor: '#999' }}
                            />
                            <span style={{ flex: 1, color: '#333' }}>
                              {item.name}
                              {qty > 1 && <span style={{ color: '#666', marginLeft: '6px', fontSize: '14px' }}>(Qty: {qty})</span>}
                            </span>
                          </label>
                          <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(lineTotal)}</span>
                        </div>
                      );
                    })}
                    {/* Checkable items (can be unchecked) */}
                    {checkableDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {/* Opted-in vaccines - no checkbox */}
                    {(patientId != null ? optedInVaccinesByPatientId[patientId] : undefined) && (() => {
                      const optedIn = optedInVaccinesByPatientId[patientId];
                      const vaccineItems = optedIn ? (Object.values(optedIn).filter(Boolean) as SearchableItem[]) : [];
                      return vaccineItems.map((item: SearchableItem, i: number) => {
                        const p = getSearchItemPrice(item);
                        const price = p != null ? p : 0;
                        petSubtotal += price;
                        return (
                          <div key={`v-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                            <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                            <span style={{ flex: 1, color: '#333' }}>{item.name ?? 'Vaccine'}</span>
                            <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(price)}</span>
                          </div>
                        );
                      });
                    })()}
                    {/* Lab panels selected - no checkbox */}
                    {earlyDetectionYes && getSearchItemPrice(earlyDetectionFelineItem) != null && (() => { const p = getSearchItemPrice(earlyDetectionFelineItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Early Detection Panel - Feline</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {earlyDetectionCanineYes && getSearchItemPrice(earlyDetectionCanineItem) != null && (() => { const p = getSearchItemPrice(earlyDetectionCanineItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Early Detection Panel - Canine</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {seniorFelineYes && getSearchItemPrice(seniorFelineItem) != null && (() => { const p = getSearchItemPrice(seniorFelineItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Senior Screen Feline</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {seniorCaninePanel === 'standard' && getSearchItemPrice(seniorCanineStandardItem) != null && (() => { const p = getSearchItemPrice(seniorCanineStandardItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Senior Screen - Standard Comprehensive Panel</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {seniorCaninePanel === 'extended' && getSearchItemPrice(seniorCanineExtendedItem) != null && (() => { const p = getSearchItemPrice(seniorCanineExtendedItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Senior Screen - Extended Comprehensive Panel</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {seniorFelineTwoPanel === 'standard' && getSearchItemPrice(seniorCanineStandardItem) != null && (() => { const p = getSearchItemPrice(seniorCanineStandardItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Senior Screen Feline - Standard Panel</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {seniorFelineTwoPanel === 'extended' && getSearchItemPrice(seniorFelineExtendedItem) != null && (() => { const p = getSearchItemPrice(seniorFelineExtendedItem)!; petSubtotal += p; return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                        <span style={{ width: '30px', marginRight: '12px', flexShrink: 0 }} />
                        <span style={{ flex: 1, color: '#333' }}>Senior Screen Feline - Extended Panel</span>
                        <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(p)}</span>
                      </div>
                    ); })()}
                    {/* Commonly selected items - unchecked by default, can add to total */}
                    {(() => {
                      const existingNames = new Set<string>();
                      allItems.forEach((item: any) => { if (item?.name) existingNames.add(String(item.name).toLowerCase()); });
                      const optedIn = patientId != null ? optedInVaccinesByPatientId[patientId] : undefined;
                      const vaccineItems = optedIn ? (Object.values(optedIn).filter(Boolean) as SearchableItem[]) : [];
                      vaccineItems.forEach((item: SearchableItem) => { if (item?.name) existingNames.add(String(item.name).toLowerCase()); });
                      const nameMatches = (a: string, b: string) => { const x = a.toLowerCase(); const y = b.toLowerCase(); return x.includes(y) || y.includes(x); };
                      type CommonRow = { displayName: string; item: SearchableItem; key: string };
                      const rows: CommonRow[] = [];
                      COMMON_ITEMS_CONFIG.forEach((c) => {
                        if (c.dogOnly && !isDogPet) return;
                        const hasDisplayName = 'displayName' in c && c.displayName;
                        if (hasDisplayName && c.displayName === 'Pedicure') {
                          const searchQueryDog = 'searchQueryDog' in c ? c.searchQueryDog : null;
                          const item = isDogPet && searchQueryDog
                            ? commonItemsFetched[searchQueryDog]
                            : commonItemsFetched[c.searchQuery];
                          if (!item) return;
                          if ([...existingNames].some((ex) => ex.includes('pedicure'))) return;
                          rows.push({ displayName: 'Pedicure', item, key: `pedicure_${getItemId(item) ?? c.searchQuery}` });
                          return;
                        }
                        const item = commonItemsFetched[c.searchQuery];
                        if (!item?.name) return;
                        const n = String(item.name).toLowerCase();
                        if ([...existingNames].some((ex) => nameMatches(ex, n))) return;
                        const displayName = 'displayName' in c && c.displayName ? c.displayName : item.name;
                        rows.push({ displayName, item, key: c.searchQuery });
                      });
                      if (rows.length === 0) return null;
                      return (
                        <>
                          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e0e0e0', fontSize: '15px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>
                            Commonly selected items
                          </div>
                          {rows.map(({ displayName, item, key }) => {
                            const itemId = getItemId(item) ?? key;
                            const commonKey = `summary_common_${patientId}_${itemId}`;
                            const isChecked = formData[commonKey] === true;
                            const price = getSearchItemPrice(item) ?? 0;
                            if (isChecked) petSubtotal += price;
                            return (
                              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '15px', gap: '12px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={readOnly}
                                    onChange={(e) => handleInputChange(commonKey, e.target.checked)}
                                    style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                                  />
                                  <span style={{ color: '#333' }}>{displayName}</span>
                                </label>
                                <span style={{ fontWeight: 500, flexShrink: 0 }}>{formatPrice(price)}</span>
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                  {patients.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '15px', fontWeight: 600, color: '#333' }}>
                      Subtotal: {formatPrice(petSubtotal)}
                    </div>
                  )}
                  {(() => { grandTotal += petSubtotal; return null; })()}
                </div>
              );
            })}

            {/* Store search - type-ahead, add products to Additional items (below pets) */}
            <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>Search store items</label>
              <div style={{ position: 'relative', marginBottom: storeSearchResults.length > 0 ? '12px' : 0 }}>
                <input
                  type="text"
                  value={storeSearchQuery}
                  onChange={(e) => !readOnly && setStoreSearchQuery(e.target.value)}
                  readOnly={readOnly}
                  disabled={readOnly}
                  placeholder="Type to search products..."
                  style={{ width: '100%', padding: '10px 12px', paddingRight: storeSearchLoading ? '36px' : '12px', border: '1px solid #ced4da', borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                />
                {storeSearchLoading && (
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#666' }}>Searching...</span>
                )}
              </div>
              {storeSearchResultsByName.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: '200px', overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: '6px', backgroundColor: '#fff' }}>
                  {storeSearchResultsByName.map(([productName, items]) => {
                    const minPrice = Math.min(...items.map((p) => Number(p.price)));
                    const priceLabel = items.length > 1 ? `from $${minPrice.toFixed(2)}` : `$${minPrice.toFixed(2)}`;
                    return (
                      <li
                        key={productName}
                        onClick={() => !readOnly && setStoreOptionModalGroup(items)}
                        style={{ padding: '10px 12px', borderBottom: '1px solid #eee', cursor: readOnly ? 'default' : 'pointer', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(readOnly ? { opacity: 0.85 } : {}) }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e7f1ff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                      >
                        <span>{productName}</span>
                        <span style={{ fontWeight: 600 }}>{priceLabel}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Modal: pick a variation of a product (same name, different options/SKU) */}
            {storeOptionModalGroup && storeOptionModalGroup.length > 0 && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                }}
                onClick={() => setStoreOptionModalGroup(null)}
              >
                <div
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: '8px',
                    padding: '20px',
                    maxWidth: '420px',
                    width: '90%',
                    maxHeight: '80vh',
                    overflow: 'auto',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 style={{ margin: 0, marginBottom: '16px', fontSize: '16px', fontWeight: 600, color: '#333' }}>
                    {storeOptionModalGroup[0].name}
                  </h4>
                  <p style={{ margin: 0, marginBottom: '12px', fontSize: '13px', color: '#666' }}>
                    Select an option to add to your items:
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {getStoreModalRows(storeOptionModalGroup).map(({ key, label, price, item }) => (
                      <li
                        key={key}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 0',
                          borderBottom: '1px solid #eee',
                          gap: '12px',
                        }}
                      >
                        <span style={{ fontSize: '14px', color: '#333' }}>{label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 600 }}>{formatPrice(price)}</span>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                              if (readOnly) return;
                              setStoreAdditionalItems((prev) => [...prev, item]);
                              setStoreOptionModalGroup(null);
                            }}
                            style={{
                              padding: '6px 12px',
                              fontSize: '13px',
                              backgroundColor: readOnly ? '#adb5bd' : '#0d6efd',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setStoreOptionModalGroup(null)}
                      style={{
                        padding: '8px 16px',
                        fontSize: '14px',
                        backgroundColor: '#6c757d',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Additional items (store products) - subtotal + 5.5% sales tax */}
            {storeAdditionalItems.length > 0 && (() => {
              const storeSubtotal = storeAdditionalItems.reduce((sum, i) => sum + Number(i.price), 0);
              const storeTaxRate = 0.055;
              const storeTax = storeSubtotal * storeTaxRate;
              grandTotal += storeSubtotal + storeTax;
              return (
                <div style={{ marginTop: '24px', padding: '20px', backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '8px' }}>
                  <h4 style={{ margin: 0, marginBottom: '12px', fontSize: '16px', fontWeight: 600, color: '#333' }}>Additional items</h4>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {storeAdditionalItems.map((item, idx) => (
                      <li key={`${item.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee', fontSize: '15px' }}>
                        <span style={{ color: '#333' }}>{item.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontWeight: 500 }}>{formatPrice(Number(item.price))}</span>
                          <button
                            type="button"
                            onClick={() => !readOnly && setStoreAdditionalItems((prev) => prev.filter((_, i) => i !== idx))}
                            disabled={readOnly}
                            style={{ padding: '4px 10px', fontSize: '13px', color: readOnly ? '#999' : '#dc3545', background: 'none', border: `1px solid ${readOnly ? '#999' : '#dc3545'}`, borderRadius: '4px', cursor: readOnly ? 'not-allowed' : 'pointer' }}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #ddd', fontSize: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>Subtotal: {formatPrice(storeSubtotal)}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>Sales tax (5.5%): {formatPrice(storeTax)}</div>
                  </div>
                </div>
              );
            })()}

            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '3px solid #e0e0e0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#212529' }}>Total: {formatPrice(grandTotal)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}>
              <button
                onClick={() => setCurrentPage(labsPageIndex)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#fff',
                  color: '#333',
                  border: '1px solid #ced4da',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ← Back to Labs
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || readOnly}
                style={{
                  padding: '12px 28px',
                  backgroundColor: submitting || readOnly ? '#adb5bd' : '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: submitting || readOnly ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Submitting...' : readOnly ? 'Already submitted' : 'Submit Form'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
