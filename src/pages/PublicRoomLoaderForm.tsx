// src/pages/PublicRoomLoaderForm.tsx
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiBaseUrl, http } from '../api/http';
import { getEcwidProducts, type EcwidProduct, type EcwidChoice } from '../api/ecwid';
import { searchItemsPublic, type SearchableItem, checkItemPricingPublic, type CheckItemPricingResponse, type CheckItemPricingPublicRequest } from '../api/roomLoader';
import { getPatientTreatmentHistory, type TreatmentWithItems } from '../api/treatments';
import { DateTime } from 'luxon';
import jsPDF from 'jspdf';
import './PublicRoomLoaderForm.css';

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
  lepto: 'Leptospirosis Vaccine - Initial',
  bordetella: 'Bordetella Oral Vaccine - Annual',
  crLyme: 'crLyme Vaccine- Annual',
  lyme: 'crLyme Vaccine- Initial',
  felv: 'FELV (Leukemia) Vaccine - Initial',
} as const;

type VaccineOptKey = keyof typeof VACCINE_SEARCH_QUERIES;

function getItemId(item: SearchableItem): number | undefined {
  return item.inventoryItem?.id ?? (item as any).procedure?.id ?? item.lab?.id;
}

/** Build a SearchableItem from a row with id, name, price, itemType (for check-item-pricing lookup). */
function rowToSearchableItem(row: { id?: number | null; name?: string; price?: number | string | null; itemType?: string; type?: string; code?: string }): SearchableItem | null {
  const id = row.id;
  if (id == null) return null;
  const name = row.name ?? '';
  const price = row.price != null ? String(row.price) : '';
  const code = row.code;
  const itemType = (row.itemType ?? row.type ?? 'procedure').toString().toLowerCase();
  const entry = { id, name, price, code };
  const base: SearchableItem = {
    name,
    itemType: itemType === 'lab' ? 'lab' : itemType === 'inventory' ? 'inventory' : 'procedure',
  } as SearchableItem;
  if (itemType === 'lab') return { ...base, lab: entry } as SearchableItem;
  if (itemType === 'inventory') return { ...base, inventoryItem: entry } as SearchableItem;
  return { ...base, procedure: entry } as SearchableItem;
}

/** Build item payload for public check-item-pricing from a SearchableItem. */
function buildPricingItemPayload(item: SearchableItem | null | undefined): CheckItemPricingPublicRequest['item'] | null {
  if (!item) return null;
  const id = getItemId(item);
  const name = item.name ?? '';
  const price = (item as any).price ?? item.inventoryItem?.price ?? (item as any).lab?.price ?? (item as any).procedure?.price ?? '';
  const code = item.code ?? item.inventoryItem?.code ?? (item as any).lab?.code ?? (item as any).procedure?.code;
  if (id == null) return null;
  const entry = { id, name, price: String(price ?? ''), code };
  const t = (item.itemType ?? '').toLowerCase();
  if (t === 'lab') return { lab: entry };
  if (t === 'procedure') return { procedure: entry };
  if (t === 'inventory') return { inventoryItem: entry };
  if ((item as any).lab) return { lab: entry };
  if ((item as any).procedure) return { procedure: entry };
  if (item.inventoryItem) return { inventoryItem: entry };
  return { procedure: entry };
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

/** True if the label is descriptive enough to show in the modal (exclude e.g. "Size", "Option", "# doses"). */
function isDescriptiveModalLabel(label: string | null | undefined): boolean {
  const t = (label ?? '').trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  const generic = ['size', 'option', 'quantity', 'color', 'weight', '# doses', 'doses'];
  if (generic.includes(lower)) return false;
  if (/^#\s*doses$/i.test(lower)) return false;
  if (/^option\s*\d+$/i.test(lower)) return false;
  return true;
}

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
  // Exclude rows with no real description (e.g. "Size", "Option")
  rows = rows.filter((row) => isDescriptiveModalLabel(row.label));
  // Deduplicate by (label, price) so we show each option once even if API returns same variation multiple times
  const seenLabelPrice = new Set<string>();
  const deduped = rows.filter((row) => {
    const labelPriceKey = `${row.label}\t${row.price}`;
    if (seenLabelPrice.has(labelPriceKey)) return false;
    seenLabelPrice.add(labelPriceKey);
    return true;
  });
  return deduped.sort((a, b) => a.price - b.price);
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

/**
 * Fuzzy score for search: how well `text` matches `query` (0 = no match, 1 = exact).
 * Used to sort store (Ecwid) search results when the API may not do fuzzy matching.
 */
function fuzzyScoreQuery(query: string, text: string): number {
  const q = (query || '').trim().toLowerCase();
  const t = (text || '').trim().toLowerCase();
  if (!q) return 1;
  if (!t) return 0;
  if (t.includes(q)) return 1;
  const qWords = q.split(/\s+/).filter(Boolean);
  const wordsFound = qWords.filter((w) => t.includes(w)).length;
  if (wordsFound === qWords.length) return 0.9;
  if (wordsFound > 0) {
    const wordScore = (wordsFound / qWords.length) * 0.7;
    let rest = t;
    const subsequence = [...q].every((c) => {
      const i = rest.indexOf(c);
      if (i === -1) return false;
      rest = rest.slice(i + 1);
      return true;
    });
    return wordScore + (subsequence ? 0.15 : 0);
  }
  let idx = 0;
  for (const c of q) {
    const i = t.indexOf(c, idx);
    if (i === -1) return 0;
    idx = i + 1;
  }
  return 0.3;
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

/** True if name or code indicates any Lyme vaccine (including crLyme). */
function isLymeItem(name?: string | null, code?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  const c = (code ?? '').toLowerCase();
  return (n.includes('lyme') && !n.includes('lepto')) || c.includes('lyme');
}

/** True if patient ever declined a Lyme vaccine. */
function declinedLymeInPast(history: TreatmentWithItems[]): boolean {
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isLymeItem(name, code) && item.isDeclined) return true;
    }
  }
  return false;
}

/** True if patient received Lyme vaccine in the last 12 months. */
function hadLymeInLastYear(history: TreatmentWithItems[]): boolean {
  const oneYearAgo = DateTime.now().minus({ years: 1 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isLymeItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= oneYearAgo) return true;
    }
  }
  return false;
}

/** True if patient received Lyme vaccine in the last 15 months. Used for optional vaccine display (show if >15 months or never). */
function hadLymeInLast15Months(history: TreatmentWithItems[]): boolean {
  const cutoff = DateTime.now().minus({ months: 15 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isLymeItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= cutoff) return true;
    }
  }
  return false;
}

/** True if patient has ever received any Lyme vaccine (crLyme or other) in treatment history (not declined). */
function everHadAnyLymeVaccine(history: TreatmentWithItems[]): boolean {
  for (const tx of history ?? []) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isLymeItem(name, code) && !item.isDeclined) return true;
    }
  }
  return false;
}

/** True if this visit's line items (reminders + added items) include Lyme vaccine. */
function hasLymeInLineItems(patient: any): boolean {
  if (patient.reminders?.length) {
    for (const r of patient.reminders) {
      const item = r.item;
      if (item && isLymeItem(item.name, item.code)) return true;
    }
  }
  if (patient.addedItems?.length) {
    for (const item of patient.addedItems) {
      if (isLymeItem(item.name, item.code)) return true;
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

/** True if patient received Lepto vaccine in the last 15 months. Used for optional vaccine display (show if >15 months or never). */
function hadLeptoInLast15Months(history: TreatmentWithItems[]): boolean {
  const cutoff = DateTime.now().minus({ months: 15 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isLeptoItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= cutoff) return true;
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

/** True if patient received Bordetella vaccine in the last 15 months. Used for optional vaccine display (show if >15 months or never). */
function hadBordetellaInLast15Months(history: TreatmentWithItems[]): boolean {
  const cutoff = DateTime.now().minus({ months: 15 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isBordetellaItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= cutoff) return true;
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

/** True if patient has ever received FeLV vaccine (any time, not declined). */
function everHadFeLV(history: TreatmentWithItems[]): boolean {
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (isFeLVItem(name, code) && !item.isDeclined) return true;
    }
  }
  return false;
}

/** True if patient received FeLV vaccine in the last 15 months. Used for optional vaccine display (show if >15 months or never). */
function hadFeLVInLast15Months(history: TreatmentWithItems[]): boolean {
  const cutoff = DateTime.now().minus({ months: 15 });
  for (const tx of history) {
    for (const item of tx.treatmentItems || []) {
      const name = item.lab?.name ?? item.procedure?.name ?? item.inventoryItem?.name;
      const code = item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code;
      if (!isFeLVItem(name, code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate >= cutoff) return true;
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

type OptionalVaccineKey = 'felv' | 'lepto' | 'lyme' | 'bordetella';

function itemMatchesVaccine(vaccine: OptionalVaccineKey, name?: string | null, code?: string | null): boolean {
  if (vaccine === 'felv') return isFeLVItem(name, code);
  if (vaccine === 'lepto') return isLeptoItem(name, code);
  if (vaccine === 'lyme') return isLymeItem(name, code);
  if (vaccine === 'bordetella') return isBordetellaItem(name, code);
  return false;
}

/** True if patient has a reminder for this vaccine that is not yet due (due date in the future). If so, we do not show the optional vaccine question. */
function hasFutureReminderForVaccine(patient: any, vaccine: OptionalVaccineKey): boolean {
  const reminders = patient?.reminders;
  if (!Array.isArray(reminders)) return false;
  const now = DateTime.now();
  for (const r of reminders) {
    const item = r?.item;
    if (!item || !itemMatchesVaccine(vaccine, item.name, item.code)) continue;
    const dueStr = r.dueDate ?? r.due_date;
    if (dueStr == null) continue;
    const due = DateTime.fromISO(dueStr);
    if (due.isValid && due > now) return true;
  }
  return false;
}

const PDF_MARGIN = 0.5;
const PDF_PAGE_WIDTH = 8.5;
const PDF_PAGE_HEIGHT = 11;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const LINE_HEIGHT = 0.2;
const FONT_SIZE = 10;
const FONT_SIZE_SECTION = 11;
const FONT_SIZE_TITLE = 18;
const COLOR_DARK: [number, number, number] = [33, 37, 41];   // #212529
const COLOR_MUTED: [number, number, number] = [73, 80, 87];  // #495057
const COLOR_LINE: [number, number, number] = [222, 226, 230]; // #dee2e6
const COLOR_HEADER_BG: [number, number, number] = [248, 249, 250]; // #f8f9fa

type PdfOptions = { logoDataUrl?: string; practiceName?: string; logoWidth?: number; logoHeight?: number };

/** Build a jsPDF from responseFromClient (formAnswersForPdf + summaryForPdf) for completed room-loader view. */
function buildRoomLoaderPdf(responseFromClient: any, options?: PdfOptions): jsPDF {
  const doc = new jsPDF('portrait', 'in', 'letter');
  doc.setProperties({ title: 'Pre-Visit Check-In' });
  const practiceName = options?.practiceName ?? 'Vet At Your Door';
  let y = PDF_MARGIN;

  const pushY = (dy: number) => {
    y += dy;
    if (y > PDF_PAGE_HEIGHT - PDF_MARGIN - 0.4) {
      doc.addPage();
      y = PDF_MARGIN;
      drawHeader();
    }
  };

  const drawHeader = () => {
    const maxLogoW = 1.65;
    const maxLogoH = 0.65;
    const LOGO_DPI = 96; // pixels per inch for natural dimensions
    let logoW = maxLogoW;
    let logoH = maxLogoH;
    const natW = options?.logoWidth;
    const natH = options?.logoHeight;
    if (natW != null && natH != null && natW > 0 && natH > 0) {
      const natWIn = natW / LOGO_DPI;
      const natHIn = natH / LOGO_DPI;
      const scale = Math.min(maxLogoW / natWIn, maxLogoH / natHIn, 1);
      logoW = natWIn * scale;
      logoH = natHIn * scale;
    }
    const headerBottom = y + maxLogoH + 0.35;
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(0, 0, PDF_PAGE_WIDTH, headerBottom, 'F');
    const hasLogo = !!options?.logoDataUrl;
    if (hasLogo) {
      try {
        doc.addImage(options!.logoDataUrl!, 'JPEG', PDF_MARGIN, y, logoW, logoH);
      } catch {
        try {
          doc.addImage(options!.logoDataUrl!, 'PNG', PDF_MARGIN, y, logoW, logoH);
        } catch {
          /* ignore */
        }
      }
    }
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hasLogo ? 14 : 18);
    doc.text(practiceName, hasLogo ? PDF_MARGIN + logoW + 0.2 : PDF_MARGIN, y + maxLogoH / 2 + (hasLogo ? 0.06 : 0.1));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text('Pre-Visit Check-In', hasLogo ? PDF_MARGIN + logoW + 0.2 : PDF_MARGIN, y + maxLogoH / 2 + (hasLogo ? 0.2 : 0.22));
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFontSize(FONT_SIZE);
    y += maxLogoH + 0.28;
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.setLineWidth(0.012);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    pushY(0.28);
  };

  drawHeader();

  const addPageTitle = (title: string) => {
    pushY(0.12);
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_TITLE);
    const lines = doc.splitTextToSize(title, PDF_CONTENT_WIDTH);
    doc.text(lines, PDF_MARGIN, y);
    pushY(lines.length * 0.24 + 0.1);
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.setLineWidth(0.018);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    pushY(0.22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
  };

  const addSectionLabel = (label: string) => {
    pushY(0.06);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_SECTION);
    doc.text(label, PDF_MARGIN, y);
    pushY(0.22);
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
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
            const qLines = doc.splitTextToSize(qa.question, PDF_CONTENT_WIDTH);
            doc.text(qLines, PDF_MARGIN, y);
            pushY(qLines.length * LINE_HEIGHT + 0.04);
          }
          const ans = qa.answerLabel != null ? String(qa.answerLabel) : (qa.answer != null ? String(qa.answer) : '—');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(FONT_SIZE);
          doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
          const aLines = doc.splitTextToSize(ans || '—', PDF_CONTENT_WIDTH - 0.25);
          doc.text(aLines, PDF_MARGIN + 0.25, y);
          pushY(aLines.length * LINE_HEIGHT + 0.14);
        }
        pushY(0.1);
      }
      pushY(0.15);
    }
  }

  const summary = responseFromClient?.summaryForPdf;
  if (summary) {
    if (summary.title) addPageTitle(summary.title);
    const pets = summary.pets ?? [];
    for (const pet of pets) {
      pushY(0.1);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_SIZE_SECTION);
      doc.text(pet.patientName ?? 'Pet', PDF_MARGIN, y);
      pushY(LINE_HEIGHT + 0.08);
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
      const totalStr = `Estimated Total Due At Visit: $${Number(summary.grandTotal).toFixed(2)}`;
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
  /** Fetched item for Comprehensive Fecal (young new patients, lab work No). */
  const [comprehensiveFecalItem, setComprehensiveFecalItem] = useState<SearchableItem | null>(null);
  /** Fetched item for Sharps Disposal (when patient.vaccines.sharps is true; shown greyed out like trip fee on Summary). */
  const [sharpsDisposalItem, setSharpsDisposalItem] = useState<SearchableItem | null>(null);
  /** Fetched "commonly selected" items for Summary page (search by name, keyed by query). */
  const [commonItemsFetched, setCommonItemsFetched] = useState<Record<string, SearchableItem | null>>({});
  /** Client-adjusted pricing (discounts/membership) for labs and vaccines. Key: `${patientId}-${itemType}-${itemId}`. */
  const [clientPricingCache, setClientPricingCache] = useState<Record<string, CheckItemPricingResponse | null>>({});
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
  /** Inline validation errors keyed by form field (e.g. pet0_outdoorAccess). Shown below the field instead of alert. */
  const [fieldValidationErrors, setFieldValidationErrors] = useState<Record<string, string>>({});

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
            // Do not pre-fill "Do you want to share any additional details about the reason for this visit?"
            initialFormData[`${petKey}_appointmentReason`] = '';
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
            initialFormData[`${petKey}_lymeVaccine`] = '';
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
              else if (name.includes('crlyme') || (name.includes('lyme') && !name.includes('lepto'))) key = 'lyme';
              else if (name.includes('felv') || name.includes('leukemia')) key = 'felv';
              if (key) {
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

  // Fetch treatment history per patient when user reaches Care Plan (page 2) or later. Defers N requests until needed for vaccine/lab logic.
  useEffect(() => {
    if (!data?.patients?.length || currentPage < 2) return;
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
  }, [data?.patients, currentPage]);

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
    setFieldValidationErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
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
        const results = await searchItemsPublic({ q, practiceId, limit: 50 });
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
    const recommendedByPet = recommendedItemsByPet;
    const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
    const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);

    const remindersByPet: Array<{
      patientId: number | undefined;
      patientName: string;
      displayItems: any[];
      checked: boolean[];
      tripFeeItems: any[];
    }> = [];
    const petSubtotals: number[] = [];
    let grandTotal = 0;

    patientsData.forEach((patient: any, petIdx: number) => {
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const allItems = recommendedByPet[petIdx] ?? [];
      const displayItems = allItems.filter((item: any) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps'));
      const tripFeeItems = allItems.filter((item: any) => hasPhrase(item, 'trip fee') || hasPhrase(item, 'sharps'));
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
        const fourDxReplacedBy: string[] = seniorCaninePanel === 'extended' || seniorFelineTwoPanel === 'extended' ? ['Extended Comprehensive Panel'] : [];
        const isFecalReplaced = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
        const is4dxReplaced = (hasPhrase(item, '4dx') || hasPhrase(item, 'heartworm')) && fourDxReplacedBy.length > 0;
        const recKey = `pet${petIdx}_rec_${idx}`;
        return (isFecalReplaced || is4dxReplaced) ? false : isVisitOrConsult || formData[recKey] !== false;
      });
      remindersByPet.push({
        patientId,
        patientName: petName,
        displayItems,
        checked,
        tripFeeItems,
      });

      let petSubtotal = 0;
      displayItems.forEach((item: any, idx: number) => {
        const isChecked = checked[idx];
        const unitPrice = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) || 0);
        const qty = Number(item.quantity) || 1;
        if (isChecked) petSubtotal += unitPrice * qty;
      });
      tripFeeItems.forEach((item: any) => {
        const unitPrice = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) || 0);
        petSubtotal += unitPrice * (Number(item.quantity) || 1);
      });
      // Opted-in vaccine items for this pet
      const optedIn = optedInVaccinesByPatientId[patientId];
      if (optedIn) {
        (Object.values(optedIn).filter(Boolean) as SearchableItem[]).forEach((item) => {
          const p = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item);
          if (p != null) petSubtotal += p;
        });
      }
      // Lab panels selected for this pet
      if (formData[`lab_early_detection_feline_${patientId}`] === 'yes') {
        const p = getClientAdjustedPrice(patientId, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem);
        if (p != null) petSubtotal += p;
      }
      if (formData[`lab_early_detection_canine_${patientId}`] === 'yes') {
        const p = getClientAdjustedPrice(patientId, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem);
        if (p != null) petSubtotal += p;
      }
      if (formData[`lab_senior_feline_${patientId}`] === 'yes') {
        const p = getClientAdjustedPrice(patientId, seniorFelineItem) ?? getSearchItemPrice(seniorFelineItem);
        if (p != null) petSubtotal += p;
      }
      const seniorCaninePanelVal = formData[`lab_senior_canine_panel_${patientId}`];
      if (seniorCaninePanelVal === 'standard') {
        const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) petSubtotal += p;
      }
      if (seniorCaninePanelVal === 'extended') {
        const p = getClientAdjustedPrice(patientId, seniorCanineExtendedItem) ?? getSearchItemPrice(seniorCanineExtendedItem);
        if (p != null) petSubtotal += p;
      }
      const seniorFelineTwoPanelVal = formData[`lab_senior_feline_two_panel_${patientId}`];
      if (seniorFelineTwoPanelVal === 'standard') {
        const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) petSubtotal += p;
      }
      if (seniorFelineTwoPanelVal === 'extended') {
        const p = getClientAdjustedPrice(patientId, seniorFelineExtendedItem) ?? getSearchItemPrice(seniorFelineExtendedItem);
        if (p != null) petSubtotal += p;
      }
      if (formData[`lab_comprehensive_fecal_${patientId}`] === 'yes' && formData[`summary_exclude_lab_comprehensive_fecal_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, comprehensiveFecalItem) ?? getSearchItemPrice(comprehensiveFecalItem);
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
      entry.displayItems.forEach((item: any, idx: number) => {
        if (!entry.checked[idx]) return;
        const unitPrice = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) ?? 0);
        const qty = Number(item.quantity) || 1;
        summaryLineItems.push({
          name: item.name,
          quantity: qty,
          price: unitPrice,
          patientId,
          patientName,
          category: 'reminder',
        });
      });
      entry.tripFeeItems.forEach((item: any) => {
        const unitPrice = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) ?? 0);
        const qty = Number(item.quantity) || 1;
        summaryLineItems.push({
          name: item.name,
          quantity: qty,
          price: unitPrice,
          patientId,
          patientName,
          category: 'tripFee',
        });
      });
      const optedIn = optedInVaccinesByPatientId[patientId];
      if (optedIn) {
        (Object.values(optedIn).filter(Boolean) as SearchableItem[]).forEach((item) => {
          const p = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item);
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
      if (earlyDetectionYes && formData[`summary_exclude_lab_early_detection_feline_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem);
        if (p != null) summaryLineItems.push({ name: 'Early Detection Panel - Feline', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (earlyDetectionCanineYes && formData[`summary_exclude_lab_early_detection_canine_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem);
        if (p != null) summaryLineItems.push({ name: 'Early Detection Panel - Canine', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorFelineYes && formData[`summary_exclude_lab_senior_feline_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorFelineItem) ?? getSearchItemPrice(seniorFelineItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen Feline', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorCaninePanelVal === 'standard' && formData[`summary_exclude_lab_senior_canine_standard_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen - Standard Comprehensive Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorCaninePanelVal === 'extended' && formData[`summary_exclude_lab_senior_canine_extended_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorCanineExtendedItem) ?? getSearchItemPrice(seniorCanineExtendedItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen - Extended Comprehensive Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorFelineTwoPanelVal === 'standard' && formData[`summary_exclude_lab_senior_feline_two_standard_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen Feline - Standard Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      if (seniorFelineTwoPanelVal === 'extended' && formData[`summary_exclude_lab_senior_feline_two_extended_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorFelineExtendedItem) ?? getSearchItemPrice(seniorFelineExtendedItem);
        if (p != null) summaryLineItems.push({ name: 'Senior Screen Feline - Extended Panel', quantity: 1, price: p, patientId, patientName, category: 'lab' });
      }
      const comprehensiveFecalYes = formData[`lab_comprehensive_fecal_${patientId}`] === 'yes';
      const comprehensiveFecalExcluded = formData[`summary_exclude_lab_comprehensive_fecal_${patientId}`] === true;
      if (comprehensiveFecalYes && !comprehensiveFecalExcluded) {
        const p = getClientAdjustedPrice(patientId, comprehensiveFecalItem) ?? getSearchItemPrice(comprehensiveFecalItem);
        const name = comprehensiveFecalItem?.name ?? 'Comprehensive Fecal';
        if (p != null) summaryLineItems.push({ name, quantity: 1, price: p, patientId, patientName, category: 'lab' });
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
          const price = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item) ?? 0;
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
      const fourDxReplacedBy: string[] = seniorCaninePanelVal === 'extended' || seniorFelineTwoPanelVal === 'extended' ? ['Extended Comprehensive Panel'] : [];

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

      uncheckableDisplay.forEach(({ item }: { item: any }) => {
        const price = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) ?? 0);
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
        const price = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) ?? 0);
        const qty = Number(item.quantity) || 1;
        const lineTotal = price * qty;
        petSubtotal += lineTotal;
        rows.push({ type: 'tripFee', name: item.name, quantity: qty, price, lineTotal });
      });
      checkableDisplay.forEach(({ item, idx }: { item: any; idx: number }) => {
        const isFecalReplaced = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
        const is4dxReplaced = (hasPhrase(item, '4dx') || hasPhrase(item, 'heartworm')) && fourDxReplacedBy.length > 0;
        const recKey = `pet${petIdx}_rec_${idx}`;
        const isChecked = (isFecalReplaced || is4dxReplaced) ? false : formData[recKey] !== false;
        const price = item.searchableItem != null ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) ?? 0);
        const qty = Number(item.quantity) || 1;
        const isReplaced = isFecalReplaced || is4dxReplaced;
        const lineTotal = isChecked && !isReplaced ? price * qty : 0;
        if (isChecked && !isReplaced) petSubtotal += lineTotal;
        rows.push({
          type: 'reminder',
          name: item.name,
          quantity: qty,
          price,
          lineTotal,
          checked: isChecked,
          uncheckable: false,
          crossedOut: isReplaced,
          fecalReplacedBy: isReplaced ? (isFecalReplaced ? fecalReplacedBy.join(' or ') : fourDxReplacedBy.join(' or ')) : undefined,
        });
      });

      (Object.values(optedInVaccinesByPatientId[patientId] || {}).filter(Boolean) as SearchableItem[]).forEach((item) => {
        const p = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item);
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
      if (earlyDetectionYes && formData[`summary_exclude_lab_early_detection_feline_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem);
        if (p != null) labRows.push({ name: 'Early Detection Panel - Feline', price: p });
      }
      if (earlyDetectionCanineYes && formData[`summary_exclude_lab_early_detection_canine_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem);
        if (p != null) labRows.push({ name: 'Early Detection Panel - Canine', price: p });
      }
      if (seniorFelineYes && formData[`summary_exclude_lab_senior_feline_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorFelineItem) ?? getSearchItemPrice(seniorFelineItem);
        if (p != null) labRows.push({ name: 'Senior Screen Feline', price: p });
      }
      if (seniorCaninePanelVal === 'standard' && formData[`summary_exclude_lab_senior_canine_standard_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) labRows.push({ name: 'Senior Screen - Standard Comprehensive Panel', price: p });
      }
      if (seniorCaninePanelVal === 'extended' && formData[`summary_exclude_lab_senior_canine_extended_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorCanineExtendedItem) ?? getSearchItemPrice(seniorCanineExtendedItem);
        if (p != null) labRows.push({ name: 'Senior Screen - Extended Comprehensive Panel', price: p });
      }
      if (seniorFelineTwoPanelVal === 'standard' && formData[`summary_exclude_lab_senior_feline_two_standard_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
        if (p != null) labRows.push({ name: 'Senior Screen Feline - Standard Panel', price: p });
      }
      if (seniorFelineTwoPanelVal === 'extended' && formData[`summary_exclude_lab_senior_feline_two_extended_${patientId}`] !== true) {
        const p = getClientAdjustedPrice(patientId, seniorFelineExtendedItem) ?? getSearchItemPrice(seniorFelineExtendedItem);
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
        if (!isChecked) return; // Only include common items when selected
        const price = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item) ?? 0;
        petSubtotal += price;
        rows.push({
          type: 'common',
          name: displayName,
          quantity: 1,
          price,
          lineTotal: price,
          checked: true,
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
      title: 'Pre-Visit Check-In',
      instruction: "We've put together a personalized plan based on your pet's needs and our medical recommendations. You can review each item below, make adjustments, and see pricing clearly upfront so you feel informed and confident before your visit.",
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

    // Page 1: Time to Check-in for your Appointment (only include questions that were actually shown to the client)
    const page1Sections: Section[] = [];
    const appts = data?.appointments ?? [];
    patientsData.forEach((patient: any, petIdx: number) => {
      const petKey = `pet${petIdx}`;
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const apptPatient = appts[petIdx]?.patient;
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
      const markedNewByApi = patient.isNewPatient === true || appts[petIdx]?.isNewPatient === true;
      const explicitlyNotNew = patient.isNewPatient === false || appts[petIdx]?.isNewPatient === false;
      const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
      const treatAsNewWhenNoReminders = patient.isNewPatient !== false && appts[petIdx]?.isNewPatient !== false;
      const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));
      const questions: Qa[] = [];
      const addOptional = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        const val = raw === undefined ? null : raw;
        const label = valueLabels && val != null && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : null);
        questions.push({ question, answer: val ?? null, answerLabel: label ?? (val != null ? String(val) : null) });
      };
      addOptional('Do you want to share any additional details about the reason for this visit?', `${petKey}_appointmentReason`);
      addOptional(`How is ${petName} doing otherwise? Are there any other concerns you'd like us to address during this visit?`, `${petKey}_generalWellbeing`);
      if ((patient as any).questions?.mobility === true) {
        addOptional(`It sounds like you may have some concerns about ${petName}'s mobility. Can you tell us more about what you're noticing?`, `${petKey}_mobilityDetails`);
      }
      if (isCatPatient) {
        addOptional(`Does ${petName} go outdoors or live with a cat that goes outdoors?`, `${petKey}_outdoorAccess`, { yes: 'Yes', no: 'No' });
      }
      if (isNewPatient) {
        addOptional(`Describe ${petName}'s behavior at home, around strangers, and at a typical vet office.`, `${petKey}_newPatientBehavior`);
        addOptional(`What are you feeding ${petName}? (brand, amount, frequency)`, `${petKey}_feeding`);
        addOptional(`Do you or ${petName} have any food allergies? (we like to bribe!)`, `${petKey}_foodAllergies`, { yes: 'Yes', no: 'No' });
        if (formData[`${petKey}_foodAllergies`] === 'yes') {
          addOptional('If yes, what are they?', `${petKey}_foodAllergiesDetails`);
        }
      }
      if (questions.length > 0) {
        page1Sections.push({ sectionLabel: `Pet ${petIdx + 1}: ${petName}`, patientId, patientName: petName, questions });
      }
    });
    if (page1Sections.length > 0) {
      formAnswersPages.push({ pageNumber: 1, title: 'Time to Check-in for your Appointment', sections: page1Sections });
    }

    // Care Plan pages (one section per pet): only include vaccine/outdoor questions that were shown
    patientsData.forEach((patient: any, petIdx: number) => {
      const petKey = `pet${petIdx}`;
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
      const speciesParts = [
        patient.species,
        patient.speciesEntity?.name,
        patient.patient?.species,
        patient.patient?.speciesEntity?.name,
      ].filter(Boolean) as string[];
      const speciesLower = speciesParts.length ? speciesParts.join(' ').toLowerCase() : '';
      const isCatPatient = speciesLower.includes('cat') || speciesLower.includes('feline');
      const isDog = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !isCatPatient);
      const dob = patient?.dob ?? patient?.patient?.dob ?? appts[petIdx]?.patient?.dob;
      const isUnderOneYear = dob ? DateTime.now().diff(DateTime.fromISO(dob), 'years').years < 1 : false;
      const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';
      const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
      const showLepto = isDog && patientId != null && !hadLeptoInLast15Months(history) && !hasLeptoInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lepto');
      const showBordetella = isDog && patientId != null && !hadBordetellaInLast15Months(history) && !hasBordetellaInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'bordetella');
      const showLyme = isDog && patientId != null && !hadLymeInLast15Months(history) && !hasLymeInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lyme');
      const showRabiesCats = isCatPatient && patient.vaccines?.rabies;
      // FeLV: (a) <1yr and never had it; or (b) ≥1yr and outdoor yes and (never had or past due)
      const showFeLV = isCatPatient && patientId != null && !hasFeLVInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'felv') && ((isUnderOneYear && !everHadFeLV(history)) || (!isUnderOneYear && outdoorAccess && (!everHadFeLV(history) || !hadFeLVInLast15Months(history))));
      const questions: Qa[] = [];
      const add = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        const val = raw ?? null;
        const label = valueLabels && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : (val != null ? String(val) : null));
        questions.push({ question, answer: val, answerLabel: label ?? null });
      };
      if (isCatPatient) {
        add(`Does ${petName} go outdoors or live with a cat who does?`, `${petKey}_outdoorAccess`, { yes: 'Yes', no: 'No' });
      }
      if (showCrLymeBooster) add('Do you want us to schedule you a booster appointment after this visit? (crLyme)', `${petKey}_crLymeBooster`, { yes: 'Yes', no: 'No', unsure: "I'm not sure" });
      if (showLepto) add('Do you want us to give the Lepto vaccine?', `${petKey}_leptoVaccine`, { yes: 'Yes', no: 'No' });
      if (showBordetella) add('Do you want us to give the Bordetella vaccine?', `${petKey}_bordetellaVaccine`, { yes: 'Yes', no: 'No' });
      if (showLyme) add('Do you want us to give the Lyme vaccine?', `${petKey}_lymeVaccine`, { yes: 'Yes', no: 'No' });
      if (showRabiesCats) add('If not a member AND due for rabies AND a cat: we offer two rabies vaccines - a one year or three year - which would you prefer?', `${petKey}_rabiesPreference`, {
        '1year': 'Purevax Rabies 1 year',
        '3year': 'Purevax Rabies 3 year',
        no: 'No thank you, I do not want a rabies vx administered to my cat.',
      });
      if (showFeLV) add('Do you want us to give the FeLV vaccine? For initial immunity, two vaccines must be given, 3-4 weeks apart.', `${petKey}_felvVaccine`, { yes: 'Yes', no: 'No' });
      if (questions.length > 0) {
        formAnswersPages.push({
          pageNumber: 2 + petIdx,
          title: patientsData.length > 1 ? `Veterinary Care Plan — ${petName}` : 'Veterinary Care Plan',
          sections: [{ sectionLabel: `${petName} — Optional Vaccines & Questions`, patientId, patientName: petName, questions }],
        });
      }
    });

    // Labs We Recommend: only include lab questions that were shown (same logic as validation)
    const labsPageNum = 2 + patientsData.length;
    const labsSections: Section[] = [];
    const labRecs = labRecommendationsByPet ?? [];
    const labAppts = data?.appointments ?? [];
    labRecs.forEach((entry: { patientId?: number; patientName?: string; recommendations: { code?: string }[] }, idx: number) => {
      const patientId = entry.patientId ?? idx;
      const pidStr = String(patientId);
      const petName = entry.patientName || `Pet ${idx + 1}`;
      const patientForEntry = patientsData.find((p: any) => String(p.patientId ?? p.patient?.id ?? '') === String(entry.patientId ?? idx)) ?? patientsData[idx];
      const apptForEntry = labAppts[idx];
      const apptPatientEntry = apptForEntry?.patient;
      const speciesPartsEntry = [
        patientForEntry?.species,
        (patientForEntry as any)?.speciesEntity?.name,
        (patientForEntry as any)?.patient?.species,
        (patientForEntry as any)?.patient?.speciesEntity?.name,
        apptPatientEntry?.species,
        apptPatientEntry?.speciesEntity?.name,
      ].filter(Boolean) as string[];
      const speciesLowerEntry = speciesPartsEntry.length ? speciesPartsEntry.join(' ').toLowerCase() : '';
      const isDogEntry = speciesLowerEntry.includes('dog') || speciesLowerEntry.includes('canine') || (speciesLowerEntry === '' && !speciesLowerEntry.includes('cat'));
      const isCatEntry = speciesLowerEntry.includes('cat') || speciesLowerEntry.includes('feline');
      const questions: Qa[] = [];
      const add = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        const val = raw ?? null;
        const label = valueLabels && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : (val != null ? String(val) : null));
        questions.push({ question, answer: val, answerLabel: label ?? null });
      };
      entry.recommendations.forEach((rec: { code?: string }) => {
        if (rec.code === 'FIL48119999') {
          add('Would you like to do the Early Detection Panel? (Feline)', `lab_early_detection_feline_${pidStr}`, { yes: 'Yes', no: 'No' });
        }
        if (rec.code === 'FIL48719999') {
          add('Would you like us to include this recommended screening today? (Early Detection - Canine)', `lab_early_detection_canine_${pidStr}`, { yes: 'Yes — Include Early Detection Panel', no: 'Not at this time.' });
        }
        if ((rec.code === 'FIL25659999' || rec.code === 'FIL8659999') && isDogEntry) {
          add('Which panel would you like your pet to receive? (Senior Screen — Canine)', `lab_senior_canine_panel_${pidStr}`, {
            standard: 'Standard Comprehensive Panel',
            extended: 'Extended Comprehensive Panel',
            no: 'No thank you',
          });
        }
        if ((rec.code === '8659999' || rec.code === 'FIL45129999' || rec.code === 'FIL8659999') && isCatEntry) {
          add('Which panel would you like your pet to receive? (Senior Screen — Feline)', `lab_senior_feline_two_panel_${pidStr}`, {
            standard: 'Senior Screen Feline - Standard Panel',
            extended: 'Senior Screen Feline - Extended Panel',
            no: 'No thank you',
          });
        }
        if (rec.code === 'COMPREHENSIVE_FECAL') {
          add('Would you like to add a comprehensive fecal today?', `lab_comprehensive_fecal_${pidStr}`, { yes: 'Yes', no: 'No' });
        }
      });
      if (questions.length > 0) {
        labsSections.push({ sectionLabel: petName, patientId, patientName: petName, questions });
      }
    });
    if (labsSections.length > 0) {
      formAnswersPages.push({ pageNumber: labsPageNum, title: 'Labs We Recommend', sections: labsSections });
    }

    const formAnswersForPdf = { pages: formAnswersPages };

    // Lab keys that were actually shown (so we only send those in payload)
    const shownLabKeys = new Set<string>();
    const labRecsForFilter = labRecommendationsByPet ?? [];
    labRecsForFilter.forEach((entry: { patientId?: number; recommendations: { code?: string }[] }, idx: number) => {
      const patientId = entry.patientId ?? idx;
      const pidStr = String(patientId);
      const patientForEntry = patientsData.find((p: any) => String(p.patientId ?? p.patient?.id ?? '') === String(entry.patientId ?? idx)) ?? patientsData[idx];
      const apptForEntry = appts[idx];
      const apptPatientEntry = apptForEntry?.patient;
      const speciesPartsEntry = [
        patientForEntry?.species,
        (patientForEntry as any)?.speciesEntity?.name,
        (patientForEntry as any)?.patient?.species,
        (patientForEntry as any)?.patient?.speciesEntity?.name,
        apptPatientEntry?.species,
        apptPatientEntry?.speciesEntity?.name,
      ].filter(Boolean) as string[];
      const speciesLowerEntry = speciesPartsEntry.length ? speciesPartsEntry.join(' ').toLowerCase() : '';
      const isDogEntry = speciesLowerEntry.includes('dog') || speciesLowerEntry.includes('canine') || (speciesLowerEntry === '' && !speciesLowerEntry.includes('cat'));
      const isCatEntry = speciesLowerEntry.includes('cat') || speciesLowerEntry.includes('feline');
      entry.recommendations.forEach((rec: { code?: string }) => {
        if (rec.code === 'FIL48119999') shownLabKeys.add(`lab_early_detection_feline_${pidStr}`);
        if (rec.code === 'FIL48719999') shownLabKeys.add(`lab_early_detection_canine_${pidStr}`);
        if ((rec.code === 'FIL25659999' || rec.code === 'FIL8659999') && isDogEntry) shownLabKeys.add(`lab_senior_canine_panel_${pidStr}`);
        if ((rec.code === '8659999' || rec.code === 'FIL45129999' || rec.code === 'FIL8659999') && isCatEntry) shownLabKeys.add(`lab_senior_feline_two_panel_${pidStr}`);
        if (rec.code === 'COMPREHENSIVE_FECAL') shownLabKeys.add(`lab_comprehensive_fecal_${pidStr}`);
      });
    });

    // Only include form fields for questions that were actually shown to the client
    const allowedFormData: Record<string, any> = {};
    for (const [key, value] of Object.entries(formData)) {
      if (!key.startsWith('pet') && !key.startsWith('lab_')) {
        allowedFormData[key] = value;
        continue;
      }
      if (key.startsWith('summary_exclude_')) {
        allowedFormData[key] = value;
        continue;
      }
      const petMatch = key.match(/^pet(\d+)_(.+)$/);
      if (petMatch) {
        const petIdx = Number(petMatch[1]);
        const suffix = petMatch[2];
        const patient = patientsData[petIdx];
        if (!patient) continue;
        const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
        const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
        const apptPatient = appts[petIdx]?.patient;
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
        const isDog = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !isCatPatient);
        const markedNewByApi = patient.isNewPatient === true || appts[petIdx]?.isNewPatient === true;
        const explicitlyNotNew = patient.isNewPatient === false || appts[petIdx]?.isNewPatient === false;
        const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
        const treatAsNewWhenNoReminders = patient.isNewPatient !== false && appts[petIdx]?.isNewPatient !== false;
        const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));
        const dob = patient?.dob ?? patient?.patient?.dob ?? appts[petIdx]?.patient?.dob;
        const isUnderOneYear = dob ? DateTime.now().diff(DateTime.fromISO(dob), 'years').years < 1 : false;
        const outdoorAccess = formData[`pet${petIdx}_outdoorAccess`] === 'yes';
        const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
        const showLepto = isDog && patientId != null && !hadLeptoInLast15Months(history) && !hasLeptoInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lepto');
        const showBordetella = isDog && patientId != null && !hadBordetellaInLast15Months(history) && !hasBordetellaInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'bordetella');
        const showLyme = isDog && patientId != null && !hadLymeInLast15Months(history) && !hasLymeInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lyme');
        const showRabiesCats = isCatPatient && patient.vaccines?.rabies;
        // FeLV: (a) <1yr and never had it; or (b) ≥1yr and outdoor yes and (never had or past due)
        const showFeLV = isCatPatient && patientId != null && !hasFeLVInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'felv') && ((isUnderOneYear && !everHadFeLV(history)) || (!isUnderOneYear && outdoorAccess && (!everHadFeLV(history) || !hadFeLVInLast15Months(history))));

        if (suffix === 'appointmentReason' || suffix === 'generalWellbeing') allowedFormData[key] = value;
        else if (suffix === 'mobilityDetails' && (patientsData[petIdx] as any)?.questions?.mobility === true) allowedFormData[key] = value;
        else if (suffix === 'outdoorAccess' && isCatPatient) allowedFormData[key] = value;
        else if ((suffix === 'newPatientBehavior' || suffix === 'feeding' || suffix === 'foodAllergies' || suffix === 'foodAllergiesDetails') && isNewPatient) allowedFormData[key] = value;
        else if (suffix === 'crLymeBooster' && showCrLymeBooster) allowedFormData[key] = value;
        else if (suffix === 'leptoVaccine' && showLepto) allowedFormData[key] = value;
        else if (suffix === 'bordetellaVaccine' && showBordetella) allowedFormData[key] = value;
        else if (suffix === 'lymeVaccine' && showLyme) allowedFormData[key] = value;
        else if (suffix === 'rabiesPreference' && showRabiesCats) allowedFormData[key] = value;
        else if (suffix === 'felvVaccine' && showFeLV) allowedFormData[key] = value;
        else if (suffix.startsWith('rec_')) allowedFormData[key] = value;
        else if (suffix === 'labWork') allowedFormData[key] = value;
        continue;
      }
      if (key.startsWith('lab_') && shownLabKeys.has(key)) allowedFormData[key] = value;
    }

    const filteredLabSelections = patientsData.reduce((acc: Record<string, any>, patient: any, idx: number) => {
      const id = patient.patientId ?? patient.patient?.id ?? idx;
      const idStr = String(id);
      const sel: Record<string, any> = {};
      if (shownLabKeys.has(`lab_early_detection_feline_${idStr}`)) sel.lab_early_detection_feline = formData[`lab_early_detection_feline_${id}`];
      if (shownLabKeys.has(`lab_early_detection_canine_${idStr}`)) sel.lab_early_detection_canine = formData[`lab_early_detection_canine_${id}`];
      if (shownLabKeys.has(`lab_senior_canine_panel_${idStr}`)) sel.lab_senior_canine_panel = formData[`lab_senior_canine_panel_${id}`];
      if (shownLabKeys.has(`lab_senior_feline_two_panel_${idStr}`)) sel.lab_senior_feline_two_panel = formData[`lab_senior_feline_two_panel_${id}`];
      if (shownLabKeys.has(`lab_comprehensive_fecal_${idStr}`)) sel.lab_comprehensive_fecal = formData[`lab_comprehensive_fecal_${id}`];
      if (Object.keys(sel).length > 0) acc[idStr] = sel;
      return acc;
    }, {});

    return {
      ...allowedFormData,
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
      labSelections: filteredLabSelections,
    };
  }

  /** Validate required fields: outdoor (cats) and any vaccine question that is shown. */
  function validateRequiredBeforeSubmit(): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const errors: Record<string, string> = {};
    for (let petIdx = 0; petIdx < patientsData.length; petIdx++) {
      const patient = patientsData[petIdx];
      const petKey = `pet${petIdx}`;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
      const apptPatient = appts[petIdx]?.patient;
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
      const isDog = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !isCatPatient);
      const dob = patient?.dob ?? patient?.patient?.dob ?? apptPatient?.dob;
      const isUnderOneYear = dob ? DateTime.now().diff(DateTime.fromISO(dob), 'years').years < 1 : false;
      const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';

      if (isCatPatient) {
        const outdoor = formData[`${petKey}_outdoorAccess`];
        if (outdoor !== 'yes' && outdoor !== 'no') {
          errors[`${petKey}_outdoorAccess`] = `Please answer whether ${petName} goes outdoors or lives with a cat who does.`;
        }
      }
      const markedNewByApi = patient.isNewPatient === true || appts[petIdx]?.isNewPatient === true;
      const explicitlyNotNew = patient.isNewPatient === false || appts[petIdx]?.isNewPatient === false;
      const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
      const treatAsNewWhenNoReminders = patient.isNewPatient !== false && appts[petIdx]?.isNewPatient !== false;
      const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));
      if (isNewPatient) {
        const behavior = (formData[`${petKey}_newPatientBehavior`] ?? '').toString().trim();
        if (!behavior) {
          errors[`${petKey}_newPatientBehavior`] = `Please describe ${petName}'s behavior at home, around strangers, and at a typical vet office.`;
        }
        const foodAllergies = formData[`${petKey}_foodAllergies`];
        if (foodAllergies !== 'yes' && foodAllergies !== 'no') {
          errors[`${petKey}_foodAllergies`] = `Please answer the Food Allergies question for ${petName}.`;
        }
        if (foodAllergies === 'yes') {
          const details = (formData[`${petKey}_foodAllergiesDetails`] ?? '').toString().trim();
          if (!details) {
            errors[`${petKey}_foodAllergiesDetails`] = `Please describe ${petName}'s food allergies.`;
          }
        }
      }

      const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
      const showLepto = isDog && patientId != null && !hadLeptoInLast15Months(history) && !hasLeptoInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lepto');
      const showBordetella = isDog && patientId != null && !hadBordetellaInLast15Months(history) && !hasBordetellaInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'bordetella');
      const showLyme = isDog && patientId != null && !hadLymeInLast15Months(history) && !hasLymeInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lyme');
      const showRabiesCats = isCatPatient && patient.vaccines?.rabies;
      // FeLV: (a) <1yr and never had it; or (b) ≥1yr and outdoor yes and (never had or past due)
      const showFeLV = isCatPatient && patientId != null && !hasFeLVInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'felv') && ((isUnderOneYear && !everHadFeLV(history)) || (!isUnderOneYear && outdoorAccess && (!everHadFeLV(history) || !hadFeLVInLast15Months(history))));

      if (showCrLymeBooster && formData[`${petKey}_crLymeBooster`] !== 'yes' && formData[`${petKey}_crLymeBooster`] !== 'no' && formData[`${petKey}_crLymeBooster`] !== 'unsure') {
        errors[`${petKey}_crLymeBooster`] = `Please answer the crLyme booster question for ${petName}.`;
      }
      if (showLepto && formData[`${petKey}_leptoVaccine`] !== 'yes' && formData[`${petKey}_leptoVaccine`] !== 'no') {
        errors[`${petKey}_leptoVaccine`] = `Please answer the Leptospirosis vaccine question for ${petName}.`;
      }
      if (showBordetella && formData[`${petKey}_bordetellaVaccine`] !== 'yes' && formData[`${petKey}_bordetellaVaccine`] !== 'no') {
        errors[`${petKey}_bordetellaVaccine`] = `Please answer the Bordetella vaccine question for ${petName}.`;
      }
      if (showLyme && formData[`${petKey}_lymeVaccine`] !== 'yes' && formData[`${petKey}_lymeVaccine`] !== 'no') {
        errors[`${petKey}_lymeVaccine`] = `Please answer the Lyme vaccine question for ${petName}.`;
      }
      if (showRabiesCats && formData[`${petKey}_rabiesPreference`] !== '1year' && formData[`${petKey}_rabiesPreference`] !== '3year' && formData[`${petKey}_rabiesPreference`] !== 'no') {
        errors[`${petKey}_rabiesPreference`] = `Please answer the Rabies vaccine preference for ${petName}.`;
      }
      if (showFeLV && formData[`${petKey}_felvVaccine`] !== 'yes' && formData[`${petKey}_felvVaccine`] !== 'no') {
        errors[`${petKey}_felvVaccine`] = `Please answer the FeLV vaccine question for ${petName}.`;
      }
    }

    // Lab questions (required only when the corresponding block is shown on Labs page)
    const labRecs = labRecommendationsByPet ?? [];
    labRecs.forEach((entry, idx) => {
      const pidStr = String(entry.patientId ?? idx);
      const petName = entry.patientName || `Pet ${idx + 1}`;
      const patientForEntry = patientsData.find((p: any) => String(p.patientId ?? p.patient?.id ?? '') === String(entry.patientId ?? idx)) ?? patientsData[idx];
      const apptForEntry = appts[idx];
      const apptPatientEntry = apptForEntry?.patient;
      const speciesPartsEntry = [
        patientForEntry?.species,
        (patientForEntry as any)?.speciesEntity?.name,
        (patientForEntry as any)?.patient?.species,
        (patientForEntry as any)?.patient?.speciesEntity?.name,
        apptPatientEntry?.species,
        apptPatientEntry?.speciesEntity?.name,
      ].filter(Boolean) as string[];
      const speciesLowerEntry = speciesPartsEntry.length ? speciesPartsEntry.join(' ').toLowerCase() : '';
      const isDogEntry = speciesLowerEntry.includes('dog') || speciesLowerEntry.includes('canine') || (speciesLowerEntry === '' && !speciesLowerEntry.includes('cat'));
      const isCatEntry = speciesLowerEntry.includes('cat') || speciesLowerEntry.includes('feline');

      entry.recommendations.forEach((rec: { code?: string }) => {
        if (rec.code === 'FIL48119999') {
          const v = formData[`lab_early_detection_feline_${pidStr}`];
          if (v !== 'yes' && v !== 'no') {
            errors[`lab_early_detection_feline_${pidStr}`] = `Please answer the Early Detection Panel question for ${petName} before continuing.`;
          }
        }
        if (rec.code === 'FIL48719999') {
          const v = formData[`lab_early_detection_canine_${pidStr}`];
          if (v !== 'yes' && v !== 'no') {
            errors[`lab_early_detection_canine_${pidStr}`] = `Please answer the Early Detection Panel question for ${petName} before continuing.`;
          }
        }
        if ((rec.code === 'FIL25659999' || rec.code === 'FIL8659999') && isDogEntry) {
          const v = formData[`lab_senior_canine_panel_${pidStr}`];
          if (v !== 'standard' && v !== 'extended' && v !== 'no') {
            errors[`lab_senior_canine_panel_${pidStr}`] = `Please select a panel option for ${petName} before continuing.`;
          }
        }
        if (rec.code === '8659999' && isCatEntry) {
          const v = formData[`lab_senior_feline_two_panel_${pidStr}`];
          if (v !== 'standard' && v !== 'extended' && v !== 'no') {
            errors[`lab_senior_feline_two_panel_${pidStr}`] = `Please select a panel option for ${petName} before continuing.`;
          }
        }
        if ((rec.code === 'FIL45129999' || rec.code === 'FIL8659999') && isCatEntry) {
          const v = formData[`lab_senior_feline_two_panel_${pidStr}`];
          if (v !== 'standard' && v !== 'extended' && v !== 'no') {
            errors[`lab_senior_feline_two_panel_${pidStr}`] = `Please select a panel option for ${petName} before continuing.`;
          }
        }
        if (rec.code === 'COMPREHENSIVE_FECAL') {
          const v = formData[`lab_comprehensive_fecal_${pidStr}`];
          if (v !== 'yes' && v !== 'no') {
            errors[`lab_comprehensive_fecal_${pidStr}`] = `Please answer the Comprehensive Fecal question for ${petName} before continuing.`;
          }
        }
      });
    });

    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  /** Validate required fields when leaving Labs page (only for lab blocks that are actually shown). */
  function validateRequiredForLabsPage(): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const errors: Record<string, string> = {};
    const labRecs = labRecommendationsByPet ?? [];
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    labRecs.forEach((entry, idx) => {
      const petName = entry.patientName || `Pet ${idx + 1}`;
      const pid = entry.patientId ?? idx;
      const pidStr = String(pid);
      const patientForEntry = patientsData.find((p: any) => String(p.patientId ?? p.patient?.id ?? '') === String(entry.patientId ?? idx)) ?? patientsData[idx];
      const apptForEntry = appts[idx];
      const apptPatientEntry = apptForEntry?.patient;
      const speciesPartsEntry = [
        patientForEntry?.species,
        (patientForEntry as any)?.speciesEntity?.name,
        (patientForEntry as any)?.patient?.species,
        (patientForEntry as any)?.patient?.speciesEntity?.name,
        apptPatientEntry?.species,
        apptPatientEntry?.speciesEntity?.name,
      ].filter(Boolean) as string[];
      const speciesLowerEntry = speciesPartsEntry.length ? speciesPartsEntry.join(' ').toLowerCase() : '';
      const isDogEntry = speciesLowerEntry.includes('dog') || speciesLowerEntry.includes('canine') || (speciesLowerEntry === '' && !speciesLowerEntry.includes('cat'));
      const isCatEntry = speciesLowerEntry.includes('cat') || speciesLowerEntry.includes('feline');

      entry.recommendations.forEach((rec: { code?: string }) => {
        if (rec.code === 'FIL48119999') {
          const v = formData[`lab_early_detection_feline_${pidStr}`];
          if (v !== 'yes' && v !== 'no') {
            errors[`lab_early_detection_feline_${pidStr}`] = `Please answer the Early Detection Panel question for ${petName} before continuing.`;
          }
        }
        if (rec.code === 'FIL48719999') {
          const v = formData[`lab_early_detection_canine_${pidStr}`];
          if (v !== 'yes' && v !== 'no') {
            errors[`lab_early_detection_canine_${pidStr}`] = `Please answer the Early Detection Panel question for ${petName} before continuing.`;
          }
        }
        if ((rec.code === 'FIL25659999' || rec.code === 'FIL8659999') && isDogEntry) {
          const v = formData[`lab_senior_canine_panel_${pidStr}`];
          if (v !== 'standard' && v !== 'extended' && v !== 'no') {
            errors[`lab_senior_canine_panel_${pidStr}`] = `Please select a panel option for ${petName} before continuing.`;
          }
        }
        if (rec.code === '8659999' && isCatEntry) {
          const v = formData[`lab_senior_feline_two_panel_${pidStr}`];
          if (v !== 'standard' && v !== 'extended' && v !== 'no') {
            errors[`lab_senior_feline_two_panel_${pidStr}`] = `Please select a panel option for ${petName} before continuing.`;
          }
        }
        if ((rec.code === 'FIL45129999' || rec.code === 'FIL8659999') && isCatEntry) {
          const v = formData[`lab_senior_feline_two_panel_${pidStr}`];
          if (v !== 'standard' && v !== 'extended' && v !== 'no') {
            errors[`lab_senior_feline_two_panel_${pidStr}`] = `Please select a panel option for ${petName} before continuing.`;
          }
        }
        if (rec.code === 'COMPREHENSIVE_FECAL') {
          const v = formData[`lab_comprehensive_fecal_${pidStr}`];
          if (v !== 'yes' && v !== 'no') {
            errors[`lab_comprehensive_fecal_${pidStr}`] = `Please answer the Comprehensive Fecal question for ${petName} before continuing.`;
          }
        }
      });
    });
    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  /** Validate required fields when leaving page 1 (Check-in): outdoor for cats, food allergies only when that block is shown (new patients). */
  function validateRequiredForPage1(): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const errors: Record<string, string> = {};
    for (let petIdx = 0; petIdx < patientsData.length; petIdx++) {
      const patient = patientsData[petIdx];
      const petKey = `pet${petIdx}`;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const isCatPatient = (patient.species ?? '').toLowerCase().includes('cat') || (patient.speciesEntity?.name ?? '').toLowerCase().includes('cat') || (patient.species ?? '').toLowerCase().includes('feline');
      const markedNewByApi = patient.isNewPatient === true || appts[petIdx]?.isNewPatient === true;
      const explicitlyNotNew = patient.isNewPatient === false || appts[petIdx]?.isNewPatient === false;
      const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
      const treatAsNewWhenNoReminders = patient.isNewPatient !== false && appts[petIdx]?.isNewPatient !== false;
      const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));

      if (isCatPatient) {
        const outdoor = formData[`${petKey}_outdoorAccess`];
        if (outdoor !== 'yes' && outdoor !== 'no') {
          errors[`${petKey}_outdoorAccess`] = `Please answer whether ${petName} goes outdoors or lives with a cat who does.`;
        }
      }
      if (isNewPatient) {
        const behavior = (formData[`${petKey}_newPatientBehavior`] ?? '').toString().trim();
        if (!behavior) {
          errors[`${petKey}_newPatientBehavior`] = `Please describe ${petName}'s behavior at home, around strangers, and at a typical vet office before continuing.`;
        }
        const foodAllergies = formData[`${petKey}_foodAllergies`];
        if (foodAllergies !== 'yes' && foodAllergies !== 'no') {
          errors[`${petKey}_foodAllergies`] = `Please answer the Food Allergies question for ${petName} before continuing.`;
        }
        if (foodAllergies === 'yes') {
          const details = (formData[`${petKey}_foodAllergiesDetails`] ?? '').toString().trim();
          if (!details) {
            errors[`${petKey}_foodAllergiesDetails`] = `Please describe ${petName}'s food allergies before continuing.`;
          }
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  /** Validate required fields for one pet on Care Plan (outdoor if cat + any vaccine questions shown). Used before "Next pet" or "Next: Labs". */
  function validateRequiredForCarePlanPet(petIdx: number): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const patient = patientsData[petIdx];
    if (!patient) return { valid: true };
    const petKey = `pet${petIdx}`;
    const petName = patient.patientName || `Pet ${petIdx + 1}`;
    // Use same patientId as Care Plan vaccine section (no petIdx fallback) so we only require vaccine answers when that section is actually shown
    const patientId = patient.patientId ?? patient.patient?.id;
    const history = patientId != null ? (treatmentHistoryByPatientId[patientId] ?? []) : [];
    const apptPatient = appts[petIdx]?.patient;
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
    const isDog = speciesLower.includes('dog') || speciesLower.includes('canine') || (speciesLower === '' && !isCatPatient);
    const dob = patient?.dob ?? patient?.patient?.dob ?? apptPatient?.dob;
    const isUnderOneYear = dob ? DateTime.now().diff(DateTime.fromISO(dob), 'years').years < 1 : false;
    const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';

    const errors: Record<string, string> = {};

    if (isCatPatient) {
      const outdoor = formData[`${petKey}_outdoorAccess`];
      if (outdoor !== 'yes' && outdoor !== 'no') {
        const msg = `Please answer whether ${petName} goes outdoors or lives with a cat who does before continuing.`;
        errors[`${petKey}_outdoorAccess`] = msg;
      }
    }

    // Same rule as Care Plan UI: hide Optional Vaccines section for QOL Exam unless lab work was said Yes — so don't require vaccine answers in that case
    const apptForPet = appts[petIdx];
    const appointmentTypeName = (apptForPet?.appointmentType?.prettyName ?? apptForPet?.appointmentType?.name ?? '').toString().toLowerCase();
    const isQOLExam = appointmentTypeName.includes('qol');
    const labWorkYes = formData[`${petKey}_labWork`] === true || formData[`${petKey}_labWork`] === 'yes' || (patient as any)?.questions?.labWork === true;
    const hideVaccineSectionForQOL = isQOLExam && !labWorkYes;

    const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
    const showLepto = isDog && patientId != null && !hadLeptoInLast15Months(history) && !hasLeptoInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lepto');
    const showBordetella = isDog && patientId != null && !hadBordetellaInLast15Months(history) && !hasBordetellaInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'bordetella');
    const showLyme = isDog && patientId != null && !hadLymeInLast15Months(history) && !hasLymeInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lyme');
    const showRabiesCats = isCatPatient && patient.vaccines?.rabies;
    // FeLV: (a) <1yr and never had it; or (b) ≥1yr and outdoor yes and (never had or past due)
    const showFeLV = isCatPatient && patientId != null && !hasFeLVInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'felv') && ((isUnderOneYear && !everHadFeLV(history)) || (!isUnderOneYear && outdoorAccess && (!everHadFeLV(history) || !hadFeLVInLast15Months(history))));

    console.log('[RoomLoader] validateRequiredForCarePlanPet', {
      petIdx,
      petName,
      patientId,
      isDog,
      isCatPatient,
      historyLength: history?.length ?? 0,
      isQOLExam,
      labWorkYes,
      hideVaccineSectionForQOL,
      showCrLymeBooster,
      showLepto,
      showBordetella,
      showLyme,
      showRabiesCats,
      showFeLV,
      formValues: {
        crLymeBooster: formData[`${petKey}_crLymeBooster`],
        leptoVaccine: formData[`${petKey}_leptoVaccine`],
        bordetellaVaccine: formData[`${petKey}_bordetellaVaccine`],
        lymeVaccine: formData[`${petKey}_lymeVaccine`],
      },
    });

    if (!hideVaccineSectionForQOL && showCrLymeBooster && formData[`${petKey}_crLymeBooster`] !== 'yes' && formData[`${petKey}_crLymeBooster`] !== 'no' && formData[`${petKey}_crLymeBooster`] !== 'unsure') {
      errors[`${petKey}_crLymeBooster`] = `Please answer the crLyme booster question for ${petName} before continuing.`;
    }
    if (!hideVaccineSectionForQOL && showLepto && formData[`${petKey}_leptoVaccine`] !== 'yes' && formData[`${petKey}_leptoVaccine`] !== 'no') {
      errors[`${petKey}_leptoVaccine`] = `Please answer the Leptospirosis vaccine question for ${petName} before continuing.`;
    }
    if (!hideVaccineSectionForQOL && showBordetella && formData[`${petKey}_bordetellaVaccine`] !== 'yes' && formData[`${petKey}_bordetellaVaccine`] !== 'no') {
      errors[`${petKey}_bordetellaVaccine`] = `Please answer the Bordetella vaccine question for ${petName} before continuing.`;
    }
    if (!hideVaccineSectionForQOL && showLyme && formData[`${petKey}_lymeVaccine`] !== 'yes' && formData[`${petKey}_lymeVaccine`] !== 'no') {
      errors[`${petKey}_lymeVaccine`] = `Please answer the Lyme vaccine question for ${petName} before continuing.`;
    }
    if (!hideVaccineSectionForQOL && showRabiesCats && formData[`${petKey}_rabiesPreference`] !== '1year' && formData[`${petKey}_rabiesPreference`] !== '3year' && formData[`${petKey}_rabiesPreference`] !== 'no') {
      errors[`${petKey}_rabiesPreference`] = `Please answer the Rabies vaccine preference for ${petName} before continuing.`;
    }
    if (!hideVaccineSectionForQOL && showFeLV && formData[`${petKey}_felvVaccine`] !== 'yes' && formData[`${petKey}_felvVaccine`] !== 'no') {
      errors[`${petKey}_felvVaccine`] = `Please answer the FeLV vaccine question for ${petName} before continuing.`;
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  async function handleSubmit() {
    const tokenValue = token;
    if (!tokenValue) return;
    const safeToken = tokenValue as string;

    const validation = validateRequiredBeforeSubmit();
    if (!validation.valid) {
      setFieldValidationErrors(validation.errors || {});
      const firstErrorKey = Object.keys(validation.errors || {})[0] ?? '';
      const patientsCount = (data?.patients ?? []).length;
      if (firstErrorKey.startsWith('lab_')) {
        setCurrentPage(2 + patientsCount);
      } else if (firstErrorKey.startsWith('pet')) {
        const petNum = firstErrorKey.match(/pet(\d+)/)?.[1];
        const page = petNum != null ? 2 + Math.min(Number(petNum), patientsCount - 1) : 2;
        setCurrentPage(page);
      }
      return;
    }
    setFieldValidationErrors({});

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
      setFieldValidationErrors((prev) => ({ ...prev, _submit: 'Failed to submit form. Please try again.' }));
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
      const isQOLExam = (appt?.appointmentType?.prettyName ?? appt?.appointmentType?.name ?? '').toString().toLowerCase().includes('qol');
      if (isQOLExam) {
        result.push({ patientId, patientName: patient.patientName || `Pet ${idx + 1}`, recommendations: [] });
        return;
      }
      const recs: LabRec[] = [];

      // Build Care Plan display items for this pet (same as Veterinary Care Plan page) to detect unchecked items
      const carePlanItems: { name: string }[] = [];
      (patient?.reminders ?? []).forEach((r: any) => {
        const name = r?.item?.name ?? (r?.reminderText ?? r?.description ?? '');
        if (r?.item) {
          carePlanItems.push({ name: name || '' });
        } else if ((r?.reminderText ?? r?.description ?? '').toLowerCase().match(/visit|consult/)) {
          carePlanItems.push({ name: r?.reminderText ?? r?.description ?? 'Visit/Consult' });
        }
      });
      (patient?.addedItems ?? []).forEach((item: any) => {
        carePlanItems.push({ name: item?.name ?? '' });
      });
      const carePlanDisplayItems = carePlanItems.filter((item) => !itemNameMatch(item.name, 'trip fee'));
      const uncheckedOnCarePlan = (...phrases: string[]) =>
        carePlanDisplayItems.some(
          (item, i) => itemNameMatch(item.name, ...phrases) && formData[`pet${idx}_rec_${i}`] === false
        );

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
      const listHasFecal = listContains(patient, 'fecal');
      // Recommend lab if not on list OR if it was on Care Plan and client unchecked it
      const shouldRecommendSenior = !listHasSenior || uncheckedOnCarePlan('senior screen');
      const shouldRecommendYoungOrEarly = !listHasYoungOrEarly || uncheckedOnCarePlan('young wellness', 'early detection');
      const markedNewByApi = patient.isNewPatient === true || appt?.isNewPatient === true;
      const explicitlyNotNew = patient.isNewPatient === false || appt?.isNewPatient === false;
      const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
      const treatAsNewWhenNoReminders = patient.isNewPatient !== false && appt?.isNewPatient !== false;
      const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));

      if (labWorkYes) {
        recs.push({
          code: '8659999',
          title: 'Senior Screen',
          message: "You indicated that lab work would help with this visit. We recommend our Senior Screen to get a comprehensive picture of your pet's health.",
        });
      }

      if (age != null && isCat && standard && shouldRecommendSenior && !hadSenior8Mo && age > 8) {
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

      if (age != null && isDog && standard && shouldRecommendSenior && !hadSenior8Mo && age > 7) {
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

      if (age != null && isCat && standard && shouldRecommendYoungOrEarly && !hadYoungEarly8Mo && age > 1 && age <= 8) {
        const msg = listHasFIVOrFecal
          ? "We recommend our Early Detection Panel - Feline (Chem 10, lytes, CBC, Fecal Dx, FeLV/FIV/HWT). Since you already have FIV or fecal on the list, it isn't much more to add on a lot more info."
          : 'We recommend our Early Detection Panel - Feline (Chem 10, lytes, CBC, Fecal Dx, FeLV/FIV/HWT).';
        recs.push({ code: 'FIL48119999', title: 'Early Detection Panel - Feline', message: msg });
      }

      if (age != null && isDog && standard && shouldRecommendYoungOrEarly && !hadYoungEarly8Mo && age > 1 && age <= 7) {
        const msg = listHas4dxOrFecal
          ? "We recommend our Early Detection Panel - Canine (Chem 10, lytes, CBC, Fecal Dx, 4Dx). Since you already have 4Dx or fecal on the list, it isn't much more to add on a lot more info."
          : 'We recommend our Early Detection Panel - Canine (Chem 10, lytes, CBC, Fecal Dx, 4Dx).';
        recs.push({ code: 'FIL48719999', title: 'Early Detection Panel - Canine', message: msg });
      }

      // Pet < 1 year, fecal not on list, and they said No to lab work → recommend comprehensive fecal (all young pets, not only isNewPatient)
      if (age != null && age < 1 && !listHasFecal && !labWorkYes) {
        recs.push({
          code: 'COMPREHENSIVE_FECAL',
          title: 'Comprehensive Fecal',
          message: 'Because young pets are more likely to carry intestinal parasites, we recommend a comprehensive fecal test for all pets under one year old. Even healthy-appearing pets can have parasites, and early screening helps us keep them healthy, growing well, and reduces the risk of parasites being passed to other pets or people in the household.',
        });
      }

      result.push({
        patientId,
        patientName: patient.patientName || `Pet ${idx + 1}`,
        recommendations: recs,
      });
    });
    return result;
  }, [patients, appointments, treatmentHistoryByPatientId, formData]);

  /** Single batched effect: fetch all lab-panel items and common items in one Promise.all. Deferred until user reaches Care Plan (page 2) or later to reduce initial load. */
  useEffect(() => {
    if (!data || currentPage < 2) return;
    const pid = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    const hasEarlyFeline = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === 'FIL48119999'));
    const hasEarlyCanine = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === 'FIL48719999'));
    const hasSeniorCanine = labRecommendationsByPet.some((e) =>
      e.recommendations.some((r) => r.code === 'FIL25659999' || r.code === 'FIL8659999')
    );
    const has8659999 = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === '8659999'));
    const hasFIL45129999 = labRecommendationsByPet.some((e) => e.recommendations.some((r) => r.code === 'FIL45129999'));
    const hasSeniorFeline = labRecommendationsByPet.some((e) =>
      e.recommendations.some((r) => r.code === 'FIL45129999' || r.code === 'FIL8659999')
    );
    const needStandard = hasSeniorCanine || has8659999 || hasFIL45129999 || hasSeniorFeline;
    const needFelineExtended = has8659999 || hasFIL45129999 || hasSeniorFeline;
    const hasComprehensiveFecal = labRecommendationsByPet.some((e) =>
      e.recommendations.some((r) => r.code === 'COMPREHENSIVE_FECAL')
    );
    const hasSharps = data?.patients?.some((p: any) => p.vaccines?.sharps === true);

    const labQueries: { q: string; type: string }[] = [];
    if (hasEarlyFeline) labQueries.push({ q: 'Early Detection Panel - Feline', type: 'earlyFeline' });
    if (hasEarlyCanine) labQueries.push({ q: 'Early Detection Panel - Canine (chem 10, cbc, lytes, fecal Dx, 4dx)', type: 'earlyCanine' });
    if (needStandard) {
      labQueries.push({ q: 'Senior Screen (chem 25, CBC, T4, UA)', type: 'seniorStandard' });
      if (hasSeniorCanine) labQueries.push({ q: 'Senior Screen Canine (4Dx, Fecal O&P, chem 25, CBC, T4, UA)', type: 'seniorCanineExt' });
      if (needFelineExtended) labQueries.push({ q: 'Senior Screen Feline (Fecal Dx, felv/fiv/hw, fPL, chem 25, CBC, T4, UA)', type: 'seniorFelineExt' });
    }
    if (hasSeniorFeline) labQueries.push({ q: 'Senior Screen Feline', type: 'seniorFeline' });
    if (hasComprehensiveFecal) labQueries.push({ q: 'comprehensive fecal', type: 'comprehensiveFecal' });
    if (hasSharps) labQueries.push({ q: 'Sharps Disposal', type: 'sharps' });

    const commonQueries: string[] = [];
    COMMON_ITEMS_CONFIG.forEach((c) => {
      commonQueries.push(c.searchQuery);
      if ('searchQueryDog' in c && c.searchQueryDog) commonQueries.push(c.searchQueryDog);
    });

    const allQueries = [...labQueries.map((x) => x.q), ...commonQueries];
    if (allQueries.length === 0) {
      setCommonItemsFetched({});
      return;
    }

    let cancelled = false;
    Promise.all(
      allQueries.map((query) => searchItemsPublic({ q: query, practiceId: pid, limit: query.includes('Senior') || query.includes('Early') || query.includes('comprehensive') || query.includes('Sharps') ? 10 : 5 }))
    )
      .then((results) => {
        if (cancelled) return;
        const first = (arr: any) => (Array.isArray(arr) && arr[0] ? arr[0] : (arr as any)?.data?.[0] ?? (arr as any)?.results?.[0] ?? (arr as any)?.items?.[0] ?? null);
        let idx = 0;
        labQueries.forEach(({ type }) => {
          const res = results[idx++];
          const item = first(res) || null;
          switch (type) {
            case 'earlyFeline': setEarlyDetectionFelineItem(item); break;
            case 'earlyCanine': setEarlyDetectionCanineItem(item); break;
            case 'seniorStandard': setSeniorCanineStandardItem(item); break;
            case 'seniorCanineExt': setSeniorCanineExtendedItem(item); break;
            case 'seniorFelineExt': setSeniorFelineExtendedItem(item); break;
            case 'seniorFeline': setSeniorFelineItem(item); break;
            case 'comprehensiveFecal': setComprehensiveFecalItem(item); break;
            case 'sharps': setSharpsDisposalItem(item); break;
            default: break;
          }
        });
        if (!needStandard) {
          setSeniorCanineStandardItem(null);
          setSeniorCanineExtendedItem(null);
          setSeniorFelineExtendedItem(null);
        }
        if (!hasSeniorFeline) setSeniorFelineItem(null);
        if (!hasEarlyFeline) setEarlyDetectionFelineItem(null);
        if (!hasEarlyCanine) setEarlyDetectionCanineItem(null);
        if (!hasComprehensiveFecal) setComprehensiveFecalItem(null);
        if (!hasSharps) setSharpsDisposalItem(null);

        const nextCommon: Record<string, SearchableItem | null> = {};
        commonQueries.forEach((q, i) => {
          const r = results[idx + i];
          nextCommon[q] = Array.isArray(r) && r[0] ? r[0] : null;
        });
        setCommonItemsFetched(nextCommon);
      })
      .catch(() => {
        if (cancelled) return;
        setEarlyDetectionFelineItem(null);
        setEarlyDetectionCanineItem(null);
        setSeniorCanineStandardItem(null);
        setSeniorCanineExtendedItem(null);
        setSeniorFelineItem(null);
        setSeniorFelineExtendedItem(null);
        setComprehensiveFecalItem(null);
        setSharpsDisposalItem(null);
        setCommonItemsFetched({});
      });
    return () => { cancelled = true; };
  }, [data, labRecommendationsByPet, currentPage]);

  /** Fetch client-adjusted pricing (discounts/membership) for lab and vaccine items per patient. */
  useEffect(() => {
    const tokenValue = token;
    const patients = data?.patients ?? [];
    if (!tokenValue || !patients.length) return;
    const practiceId = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    const clientId = data?.clientId ?? data?.client?.id ?? data?.patients?.[0]?.clientId ?? (data?.patients?.[0] as any)?.client?.id ?? data?.appointments?.[0]?.client?.id ?? undefined;
    const labItems: (SearchableItem | null)[] = [
      earlyDetectionFelineItem,
      earlyDetectionCanineItem,
      seniorCanineStandardItem,
      seniorCanineExtendedItem,
      seniorFelineItem,
      seniorFelineExtendedItem,
      comprehensiveFecalItem,
    ];
    const pairs: { patientId: number; item: SearchableItem; key: string }[] = [];
    patients.forEach((p: any, idx: number) => {
      const patientId = p.patientId ?? p.patient?.id ?? idx;
      labItems.forEach((item) => {
        if (!item) return;
        const payload = buildPricingItemPayload(item);
        if (!payload) return;
        const id = getItemId(item);
        if (id == null) return;
        const itemType = (item.itemType ?? 'procedure').toString();
        pairs.push({ patientId, item, key: `p${patientId}-${itemType}-${id}` });
      });
      const optedIn = optedInVaccinesByPatientId[patientId];
      if (optedIn) {
        (Object.values(optedIn).filter(Boolean) as SearchableItem[]).forEach((item) => {
          const payload = buildPricingItemPayload(item);
          if (!payload) return;
          const id = getItemId(item);
          if (id == null) return;
          const itemType = (item.itemType ?? 'inventory').toString();
          pairs.push({ patientId, item, key: `p${patientId}-${itemType}-${id}` });
        });
      }
      // Display items (reminders + added items) so review page shows membership/discount pricing
      (p.reminders ?? []).forEach((reminder: any) => {
        if (reminder.item?.id != null || reminder.item?.procedure?.id != null || reminder.item?.lab?.id != null) {
          const id = reminder.item?.id ?? reminder.item?.procedure?.id ?? reminder.item?.lab?.id ?? reminder.item?.inventoryItem?.id;
          if (id == null) return;
          const row = { id, name: reminder.item.name, price: reminder.item.price, itemType: reminder.item?.type ?? reminder.itemType ?? 'procedure', code: reminder.item?.code };
          const si = rowToSearchableItem(row);
          if (si) {
            const itemType = (si.itemType ?? 'procedure').toString();
            pairs.push({ patientId, item: si, key: `p${patientId}-${itemType}-${id}` });
          }
        }
      });
      (p.addedItems ?? []).forEach((item: any) => {
        const id = item?.id ?? item?.procedure?.id ?? item?.lab?.id ?? item?.inventoryItem?.id;
        if (id == null) return;
        const row = { id, name: item.name, price: item.price, itemType: item.itemType ?? item.type ?? 'procedure', code: item.code };
        const si = rowToSearchableItem(row);
        if (si) {
          const itemType = (si.itemType ?? 'procedure').toString();
          pairs.push({ patientId, item: si, key: `p${patientId}-${itemType}-${id}` });
        }
      });
    });
    // Common items per patient (for "Commonly selected items" on review page)
    patients.forEach((p: any, idx: number) => {
      const patientId = p.patientId ?? p.patient?.id ?? idx;
      COMMON_ITEMS_CONFIG.forEach((c) => {
        const searchQueryDog = (c as any).searchQueryDog;
        const item = commonItemsFetched[c.searchQuery] ?? (searchQueryDog ? commonItemsFetched[searchQueryDog] : null);
        if (item && getItemId(item) != null) {
          const id = getItemId(item)!;
          const itemType = (item.itemType ?? 'procedure').toString();
          pairs.push({ patientId, item, key: `p${patientId}-${itemType}-${id}` });
        }
      });
    });
    const seen = new Set<string>();
    const toFetch = pairs.filter(({ key }) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (toFetch.length === 0) return;
    const requests = toFetch.map(({ patientId, item, key }) => {
      const payload = buildPricingItemPayload(item);
      if (!payload) return Promise.resolve({ key, res: null as CheckItemPricingResponse | null });
      const itemType = (item.itemType ?? 'procedure').toString();
      return checkItemPricingPublic({
        token: tokenValue,
        patientId,
        practiceId,
        clientId,
        itemType,
        item: payload,
      })
        .then((res) => ({ key, res }))
        .catch(() => ({ key, res: null as CheckItemPricingResponse | null }));
    });
    Promise.all(requests).then((results) => {
      const next: Record<string, CheckItemPricingResponse | null> = {};
      results.forEach(({ key, res }) => {
        next[key] = res;
      });
      setClientPricingCache((prev) => ({ ...prev, ...next }));
    });
  }, [
    token,
    data,
    data?.patients,
    earlyDetectionFelineItem,
    earlyDetectionCanineItem,
    seniorCanineStandardItem,
    seniorCanineExtendedItem,
    seniorFelineItem,
    seniorFelineExtendedItem,
    comprehensiveFecalItem,
    optedInVaccinesByPatientId,
    commonItemsFetched,
  ]);

  /** Type-ahead store search: debounced 300ms. Fetch with full query and, for multi-word queries, with first word too to improve fuzzy-like results from Ecwid (which may not fuzzy match). */
  useEffect(() => {
    const q = storeSearchQuery.trim();
    if (q.length < 2) {
      setStoreSearchResults([]);
      setStoreSearchLoading(false);
      return;
    }
    setStoreSearchLoading(true);
    const timeoutId = window.setTimeout(() => {
      const firstWord = q.split(/\s+/)[0];
      const queries = firstWord && firstWord !== q ? [q, firstWord] : [q];
      Promise.all(queries.map((query) => getEcwidProducts(query)))
        .then((responses) => {
          const seen = new Set<string | number>();
          const merged: EcwidProduct[] = [];
          for (const r of responses) {
            for (const p of r || []) {
              const id = p.id;
              if (seen.has(id)) continue;
              seen.add(id);
              merged.push(p);
            }
          }
          setStoreSearchResults(merged);
        })
        .catch(() => setStoreSearchResults([]))
        .finally(() => setStoreSearchLoading(false));
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
      setStoreSearchLoading(false);
    };
  }, [storeSearchQuery]);

  /** Group Ecwid results by product name; sort by fuzzy match to query so best matches appear first (Ecwid may not do fuzzy matching). */
  const storeSearchResultsByName = useMemo(() => {
    const query = storeSearchQuery.trim().toLowerCase();
    const sorted = query
      ? [...storeSearchResults].sort((a, b) => {
          const textA = `${a.name || ''} ${a.sku || ''}`.trim();
          const textB = `${b.name || ''} ${b.sku || ''}`.trim();
          return fuzzyScoreQuery(storeSearchQuery, textB) - fuzzyScoreQuery(storeSearchQuery, textA);
        })
      : storeSearchResults;
    const map = new Map<string, EcwidProduct[]>();
    for (const p of sorted) {
      const name = p.name || 'Unnamed';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(p);
    }
    return Array.from(map.entries());
  }, [storeSearchResults, storeSearchQuery]);

  /** Get client-adjusted pricing from cache (discounts/membership). */
  const getClientPricing = (patientId: number, item: SearchableItem | null): CheckItemPricingResponse | null => {
    if (!item) return null;
    const id = getItemId(item);
    if (id == null) return null;
    const itemType = (item.itemType ?? 'procedure').toString();
    return clientPricingCache[`p${patientId}-${itemType}-${id}`] ?? null;
  };
  /** Price to show for labs/vaccines: use client-adjusted price when available, else catalog price. */
  const getClientAdjustedPrice = (patientId: number, item: SearchableItem | null): number | null => {
    const pricing = getClientPricing(patientId, item);
    if (pricing?.adjustedPrice != null) return Number(pricing.adjustedPrice);
    return getSearchItemPrice(item);
  };

  /** Human-readable note for why a price was discounted (membership plan and/or client discount), or why full price applies. */
  const getDiscountNote = (pricing: CheckItemPricingResponse | { wellnessPlanPricing?: any; discountPricing?: any; } | null): string | null => {
    if (!pricing) return null;
    const parts: string[] = [];
    const wp = pricing.wellnessPlanPricing;
    const dp = pricing.discountPricing;
    // Membership quantity already used — full price applies
    if (wp?.hasCoverage && wp.isWithinLimit === false) {
      return 'Membership quantity used — full price applies';
    }
    const hasWellness = (wp?.hasCoverage && wp.originalPrice !== wp.adjustedPrice) || (wp as any)?.priceAdjustedByMembership;
    const hasDiscount = dp?.priceAdjustedByDiscount;
    if (hasWellness && wp) {
      if (wp.adjustedPrice === 0) {
        parts.push('Included in Membership');
      } else {
        parts.push(`Membership: $${Number(wp.originalPrice).toFixed(2)} → $${Number(wp.adjustedPrice).toFixed(2)}`);
      }
    }
    if (hasDiscount && dp?.clientDiscounts) {
      const reason =
        dp.clientDiscounts.clientStatusDiscount?.clientStatusName
          ? `${dp.clientDiscounts.clientStatusDiscount.clientStatusName} discount`
          : dp.clientDiscounts.personalDiscount
            ? 'Personal discount'
            : 'Client discount';
      const amount =
        dp.discountAmount != null
          ? `$${dp.discountAmount.toFixed(2)} off`
          : dp.discountPercentage != null
            ? `${dp.discountPercentage.toFixed(1)}% off`
            : '';
      parts.push(amount ? `${amount} — ${reason}` : reason);
    } else if (hasDiscount) {
      const amount =
        dp!.discountAmount != null
          ? `$${dp!.discountAmount!.toFixed(2)} off`
          : dp!.discountPercentage != null
            ? `${dp!.discountPercentage!.toFixed(1)}% off`
            : '';
      parts.push(amount || 'Discount applied');
    }
    return parts.length > 0 ? parts.join('. ') : null;
  };

  if (loading) {
    return (
      <div className="public-room-loader public-room-loader-loading" style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Loading room loader form...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-room-loader public-room-loader-error" style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ color: '#dc3545' }}>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="public-room-loader public-room-loader-error" style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>No data available</h2>
      </div>
    );
  }

  // When submitStatus === 'completed', show thank you page (no PDF preview)
  if (formAlreadySubmitted && data.responseFromClient) {
    const clientPortalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/client-portal`;
    return (
      <div className="public-room-loader public-room-loader-thank-you" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div className="public-room-loader-thank-you-inner" style={{ backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ marginBottom: '24px', fontSize: '48px' }}>✓</div>
          <h1 style={{ margin: '0 0 12px', fontSize: '28px', fontWeight: 700, color: '#1a1a1a' }}>
            Thank you
          </h1>
          <p style={{ margin: '0 0 8px', fontSize: '17px', color: '#444', lineHeight: 1.5 }}>
            Your Pre-Visit Check-In has been submitted.
          </p>
          <p style={{ margin: '0 0 28px', fontSize: '15px', color: '#666', lineHeight: 1.5 }}>
            Our team has received your form. A copy was emailed to you with a PDF attachment for your records.
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '15px', color: '#444', lineHeight: 1.6, textAlign: 'left', fontWeight: 700 }}>
            Want to spread out the cost of care while getting even more support and benefits?
          </p>
          <p style={{ margin: '0 0 24px', fontSize: '15px', color: '#555', lineHeight: 1.6, textAlign: 'left' }}>
            Memberships allow you to turn wellness care into easy monthly payments while giving you priority access to your dedicated One Team and after-hours triage support. You can explore membership options in your Client Portal. To apply membership benefits to this visit, enrollment should be completed before your appointment.
          </p>
          <div className="public-room-loader-thank-you-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', alignItems: 'center' }}>
            {token && (
              <a
                href={`${apiBaseUrl}/public/room-loader/pdf?token=${encodeURIComponent(token)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="public-room-loader-thank-you-btn public-room-loader-thank-you-btn-pdf"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '48px',
                  padding: '14px 24px',
                  fontSize: '16px',
                  fontWeight: 600,
                  backgroundColor: '#1a1a1a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  textDecoration: 'none',
                }}
              >
                View PDF
              </a>
            )}
            <a
              href={clientPortalUrl}
              className="public-room-loader-thank-you-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '48px',
                padding: '14px 28px',
                fontSize: '16px',
                fontWeight: 600,
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(13, 110, 253, 0.35)',
                textDecoration: 'none',
              }}
            >
              Visit your Client Portal
            </a>
          </div>
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
          const itemType = reminder.item?.type ?? reminder.itemType ?? 'procedure';
          const row: any = {
            name: reminder.item.name,
            price: reminder.item.price,
            quantity: reminder.quantity || 1,
            type: itemType,
            id: reminder.item?.id ?? reminder.item?.procedure?.id ?? reminder.item?.lab?.id ?? reminder.item?.inventoryItem?.id,
            itemType,
            code: reminder.item?.code ?? reminder.item?.procedure?.code ?? reminder.item?.lab?.code,
          };
          if (reminder.wellnessPlanPricing) row.wellnessPlanPricing = reminder.wellnessPlanPricing;
          if (reminder.discountPricing) row.discountPricing = reminder.discountPricing;
          row.searchableItem = rowToSearchableItem(row);
          recommendedItems.push(row);
          petItems.push(row);
        } else {
          // Visit/consult reminders may have no matched item; still show as existing if description contains visit or consult
          const text = (reminder.reminderText ?? reminder.description ?? '').toLowerCase();
          if (text.includes('visit') || text.includes('consult')) {
            const row: any = {
              name: reminder.reminderText ?? reminder.description ?? 'Visit/Consult',
              price: reminder.price ?? null,
              quantity: reminder.quantity ?? 1,
              type: reminder.itemType ?? 'procedure',
            };
            if (reminder.wellnessPlanPricing) row.wellnessPlanPricing = reminder.wellnessPlanPricing;
            if (reminder.discountPricing) row.discountPricing = reminder.discountPricing;
            recommendedItems.push(row);
            petItems.push(row);
          }
        }
      });
    }
    if (patient.addedItems && Array.isArray(patient.addedItems)) {
      patient.addedItems.forEach((item: any) => {
        const itemType = item.itemType ?? item.type ?? 'procedure';
        const row: any = {
          name: item.name,
          price: item.price,
          quantity: item.quantity || 1,
          type: itemType,
          id: item.id ?? item.procedure?.id ?? item.lab?.id ?? item.inventoryItem?.id,
          itemType,
          code: item.code ?? item.procedure?.code ?? item.lab?.code,
        };
        if (item.wellnessPlanPricing) row.wellnessPlanPricing = item.wellnessPlanPricing;
        if (item.discountPricing) row.discountPricing = item.discountPricing;
        row.searchableItem = rowToSearchableItem(row);
        recommendedItems.push(row);
        petItems.push(row);
      });
    }
    if (patient.vaccines?.sharps === true && sharpsDisposalItem) {
      const sharpsId = getItemId(sharpsDisposalItem);
      const sharpsRow: any = {
        name: sharpsDisposalItem.name ?? 'Sharps Disposal',
        price: getSearchItemPrice(sharpsDisposalItem),
        quantity: 1,
        type: 'procedure',
        id: sharpsId ?? undefined,
        itemType: 'procedure',
        code: (sharpsDisposalItem as any).procedure?.code ?? (sharpsDisposalItem as any).code,
      };
      sharpsRow.searchableItem = sharpsId != null ? sharpsDisposalItem : null;
      recommendedItems.push(sharpsRow);
      petItems.push(sharpsRow);
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
    <div className="public-room-loader">
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
        <div className="public-room-loader-form-page">
          <div className="public-room-loader-page-label" style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '14px', color: '#666' }}>
            PAGE 1
          </div>

          <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: '3px solid #e0e0e0' }}>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>
              Time to Check-in for your Appointment
            </h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginTop: '12px', marginBottom: '8px' }}>
              {doctorName} is looking forward to {petNames}'s appointment on {appointmentDate}.
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginBottom: '8px' }}>
              Window of arrival: {arrivalWindowStart} – {arrivalWindowEnd}
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginBottom: '0' }}>
              To best prepare for your appointment, please answer the questions below. We'll give you an estimate of costs after you answer some questions.
            </p>
          </div>

          {patients.map((patient: any, petIdx: number) => {
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
            const isCatPatient = patient.species?.toLowerCase().includes('cat') || patient.speciesEntity?.name?.toLowerCase().includes('cat') || (patient.species ?? '').toLowerCase().includes('feline');
            // Show new-patient questions when: not explicitly marked as not new, no reminders (not established in wellness), and either API marks as new or neither source says false (treat missing/undefined as possibly new).
            const markedNewByApi = patient.isNewPatient === true || appointments[petIdx]?.isNewPatient === true;
            const explicitlyNotNew = patient.isNewPatient === false || appointments[petIdx]?.isNewPatient === false;
            const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
            const treatAsNewWhenNoReminders = patient.isNewPatient !== false && appointments[petIdx]?.isNewPatient !== false;
            const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));
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
                  <label style={questionLabelStyle}>Do you want to share any additional details about the reason for this visit?</label>
                  <textarea
                    value={formData[`${petKey}_appointmentReason`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_appointmentReason`, e.target.value)}
                    readOnly={readOnly}
                    disabled={readOnly}
                    style={{ ...textareaStyle, minHeight: '100px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                    placeholder="Please provide more details..."
                  />
                </div>

                {(patient.questions?.mobility === true) && (
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={sectionLabelStyle}>Mobility</h4>
                    <label style={questionLabelStyle}>
                      It sounds like you may have some concerns about {petName}&apos;s mobility. Can you tell us more about what you&apos;re noticing?
                    </label>
                    <textarea
                      value={formData[`${petKey}_mobilityDetails`] || ''}
                      onChange={(e) => handleInputChange(`${petKey}_mobilityDetails`, e.target.value)}
                      readOnly={readOnly}
                      disabled={readOnly}
                      style={{ ...textareaStyle, minHeight: '100px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                      placeholder="Please describe what you're noticing..."
                    />
                  </div>
                )}

                <div style={{ marginBottom: '20px' }}>
                  <h4 style={sectionLabelStyle}>General Well-being & Concerns</h4>
                  <label style={questionLabelStyle}>
                    How is {petName} doing otherwise? Are there any other concerns you'd like us to address during this visit?
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
                    {fieldValidationErrors[`${petKey}_outdoorAccess`] && (
                      <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_outdoorAccess`]}</p>
                    )}
                  </div>
                )}

                {isNewPatient && (
                  <>
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={sectionLabelStyle}>New Patient – Behavior</h4>
                      <p style={{ fontSize: '15px', lineHeight: '1.6', color: '#555', marginBottom: '12px' }}>
                        Since we haven't met {petName} before, it helps to know a bit about their behavior (aligned with our Fear Free™ approach).
                      </p>
                      <label style={questionLabelStyle}>Describe {petName}'s behavior at home, around strangers, and at a typical vet office. <span style={{ color: '#dc3545' }}>*</span></label>
                      <textarea value={formData[`${petKey}_newPatientBehavior`] || ''} onChange={(e) => handleInputChange(`${petKey}_newPatientBehavior`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, minHeight: '120px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="Describe your pet's behavior..." />
                      {fieldValidationErrors[`${petKey}_newPatientBehavior`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_newPatientBehavior`]}</p>
                      )}
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={sectionLabelStyle}>Feeding</h4>
                      <label style={questionLabelStyle}>What are you feeding {petName}? (brand, amount, frequency)</label>
                      <textarea value={formData[`${petKey}_feeding`] || ''} onChange={(e) => handleInputChange(`${petKey}_feeding`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="What are you feeding your pet?" />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={sectionLabelStyle}>Food Allergies <span style={{ color: '#dc3545' }}>*</span></h4>
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
                      {fieldValidationErrors[`${petKey}_foodAllergies`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_foodAllergies`]}</p>
                      )}
                      {formData[`${petKey}_foodAllergies`] === 'yes' && (
                        <>
                          <label style={questionLabelStyle}>If yes, what are they? <span style={{ color: '#dc3545' }}>*</span></label>
                          <textarea value={formData[`${petKey}_foodAllergiesDetails`] || ''} onChange={(e) => handleInputChange(`${petKey}_foodAllergiesDetails`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="Please describe..." />
                          {fieldValidationErrors[`${petKey}_foodAllergiesDetails`] && (
                            <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_foodAllergiesDetails`]}</p>
                          )}
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
              type="button"
              onClick={() => {
                const v = validateRequiredForPage1();
                if (!v.valid) {
                  setFieldValidationErrors(v.errors || {});
                  return;
                }
                setFieldValidationErrors({});
                setCurrentPage(2);
              }}
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
        <div className="public-room-loader-form-page" style={{
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
                (item) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps')
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
              const fourDxReplacedBy: string[] = seniorCanineExtended || seniorFelineTwoPanelExtended ? ['Extended Comprehensive Panel'] : [];
              if (displayItems.length === 0) {
                return <p style={{ color: '#666', fontStyle: 'italic', margin: 0 }}>No recommended items at this time.</p>;
              }
              const itemCategory = (item: any) => {
                const t = (item.type ?? item.itemType ?? 'procedure').toString().toLowerCase();
                if (t === 'lab' || t === 'laboratory') return 'lab';
                if (t === 'inventory') return 'inventory';
                return 'procedure';
              };
              const is4dxItem = (it: any) => hasPhrase(it, '4dx') || hasPhrase(it, 'heartworm');
              // Sort so uncheckable items (visit/consult, fecal-replaced, 4dx-replaced) appear on top
              const sortedWithOriginalIdx = displayItems
                .map((item, originalIdx) => ({ item, originalIdx }))
                .sort((a, b) => {
                  const aReplaced = (hasPhrase(a.item, 'fecal') && fecalReplacedBy.length > 0) || (is4dxItem(a.item) && fourDxReplacedBy.length > 0);
                  const bReplaced = (hasPhrase(b.item, 'fecal') && fecalReplacedBy.length > 0) || (is4dxItem(b.item) && fourDxReplacedBy.length > 0);
                  const aUncheckable = hasPhrase(a.item, 'visit') || hasPhrase(a.item, 'consult') || aReplaced;
                  const bUncheckable = hasPhrase(b.item, 'visit') || hasPhrase(b.item, 'consult') || bReplaced;
                  if (aUncheckable && !bUncheckable) return -1;
                  if (!aUncheckable && bUncheckable) return 1;
                  return 0;
                });
              const procedureItems = sortedWithOriginalIdx.filter(({ item }) => itemCategory(item) === 'procedure');
              const labItems = sortedWithOriginalIdx.filter(({ item }) => itemCategory(item) === 'lab');
              const inventoryItems = sortedWithOriginalIdx.filter(({ item }) => itemCategory(item) === 'inventory');
              const CarePlanSeparator = () => <div style={{ height: '1px', backgroundColor: '#e0e0e0', margin: '12px 0' }} />;
              const renderRow = ({ item, originalIdx }: { item: any; originalIdx: number }, displayIdx: number, groupLength: number) => {
                const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
                const isFecalReplacedForItem = hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0;
                const is4dxReplacedForItem = is4dxItem(item) && fourDxReplacedBy.length > 0;
                const isReplacedForItem = isFecalReplacedForItem || is4dxReplacedForItem;
                const recKey = `pet${carePlanPetIndex}_rec_${originalIdx}`;
                const isChecked = isReplacedForItem ? false : (isVisitOrConsult || formData[recKey] !== false);
                const disabled = isVisitOrConsult || isReplacedForItem;
                const replacedByLabel = isFecalReplacedForItem ? fecalReplacedBy.join(' or ') : is4dxReplacedForItem ? fourDxReplacedBy.join(' or ') : '';
                return (
                  <div key={originalIdx} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: displayIdx < groupLength - 1 ? '1px solid #e0e0e0' : 'none' }}>
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
                    <span style={{ fontSize: '16px', color: '#333', ...(isReplacedForItem ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{item.name}</span>
                    {item.quantity > 1 && <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>(Qty: {item.quantity})</span>}
                    {isReplacedForItem && <span style={{ fontSize: '13px', color: '#666', marginLeft: '8px', fontStyle: 'italic' }}>(replaced by {replacedByLabel})</span>}
                  </div>
                );
              };
              return (
                <div style={{ padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {procedureItems.length > 0 && procedureItems.map((entry, i) => renderRow(entry, i, procedureItems.length))}
                  {procedureItems.length > 0 && (labItems.length > 0 || inventoryItems.length > 0) && <CarePlanSeparator />}
                  {labItems.length > 0 && labItems.map((entry, i) => renderRow(entry, i, labItems.length))}
                  {labItems.length > 0 && inventoryItems.length > 0 && <CarePlanSeparator />}
                  {inventoryItems.length > 0 && inventoryItems.map((entry, i) => renderRow(entry, i, inventoryItems.length))}
                </div>
              );
            })()}
          </div>

          {/* Cats only: Does pet go outdoors or live with a cat who does? (under list of checked services) */}
          {currentCarePlanPatient != null && (() => {
            const patient = currentCarePlanPatient;
            const petIdx = carePlanPetIndex;
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
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
            if (!isCatPatient) return null;
            return (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={sectionLabelStyle}>Outdoor access (cats) <span style={{ color: '#dc3545' }}>*</span></h4>
                <label style={questionLabelStyle}>Does {petName} go outdoors or live with a cat who does?</label>
                <div style={{ display: 'flex', gap: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                    <input
                      type="radio"
                      name={`${petKey}_outdoorAccess`}
                      value="yes"
                      checked={formData[`${petKey}_outdoorAccess`] === 'yes'}
                      onChange={(e) => handleInputChange(`${petKey}_outdoorAccess`, e.target.value)}
                      disabled={readOnly}
                      style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }}
                    />
                    Yes
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                    <input
                      type="radio"
                      name={`${petKey}_outdoorAccess`}
                      value="no"
                      checked={formData[`${petKey}_outdoorAccess`] === 'no'}
                      onChange={(e) => handleInputChange(`${petKey}_outdoorAccess`, e.target.value)}
                      disabled={readOnly}
                      style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }}
                    />
                    No
                  </label>
                </div>
                {fieldValidationErrors[`${petKey}_outdoorAccess`] && (
                  <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_outdoorAccess`]}</p>
                )}
              </div>
            );
          })()}

          {currentCarePlanPatient != null && (() => {
            const patientId = currentCarePlanPatient.patientId ?? currentCarePlanPatient.patient?.id;
            const optedIn = patientId != null ? optedInVaccinesByPatientId[patientId] : undefined;
            const items = optedIn ? (Object.values(optedIn).filter(Boolean) as SearchableItem[]) : [];
            if (items.length === 0) return null;
            return (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={sectionLabelStyle}>Added from your selections</h4>
                <div style={{ padding: '15px', backgroundColor: '#e8f5e9', borderRadius: '4px', border: '1px solid #81c784' }}>
                  {items.map((item, idx) => {
                    const displayPrice = patientId != null ? (getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item) ?? (item as any).price) : (getSearchItemPrice(item) ?? (item as any).price);
                    const vaccinePricing = patientId != null ? getClientPricing(patientId, item) : null;
                    const hasDiscount = vaccinePricing?.wellnessPlanPricing?.hasCoverage && (vaccinePricing.wellnessPlanPricing.originalPrice !== vaccinePricing.wellnessPlanPricing.adjustedPrice) || vaccinePricing?.discountPricing?.priceAdjustedByDiscount;
                    return (
                      <div key={idx} style={{ padding: '8px 0', borderBottom: idx < items.length - 1 ? '1px solid #c8e6c9' : 'none' }}>
                        <div>
                          <span style={{ fontSize: '16px', color: '#333' }}>{item.name}</span>
                          {displayPrice != null && <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>— <strong>${typeof displayPrice === 'number' ? displayPrice.toFixed(2) : Number(displayPrice).toFixed(2)}</strong></span>}
                        </div>
                        {hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px' }}>{getDiscountNote(vaccinePricing) ?? 'Discount applied'}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Optional Vaccines — single current pet (only show section if there is something to ask); hide for QOL Exam unless labs question was Yes */}
          {(() => {
            const patient = currentCarePlanPatient;
            const petIdx = carePlanPetIndex;
            const petKey = `pet${petIdx}`;
            const isQOLExam = (appointmentType || '').toString().toLowerCase().includes('qol');
            const labWorkYes = formData[`${petKey}_labWork`] === true || formData[`${petKey}_labWork`] === 'yes' || (patient as any)?.questions?.labWork === true;
            if (isQOLExam && !labWorkYes) return null;
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
            const dob = patient?.dob ?? patient?.patient?.dob ?? apptPatient?.dob;
            const isUnderOneYear = dob ? DateTime.now().diff(DateTime.fromISO(dob), 'years').years < 1 : false;
            const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';

            const patientId = patient.patientId ?? patient.patient?.id;
            const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
            const showCrLymeBooster = isDog && patientId != null && !everHadCrLyme(history) && gettingCrLymeThisTime(patient);
            const showLepto = isDog && patientId != null && !hadLeptoInLast15Months(history) && !hasLeptoInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lepto');
            const showBordetella = isDog && patientId != null && !hadBordetellaInLast15Months(history) && !hasBordetellaInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'bordetella');
            const showLyme = isDog && patientId != null && !hadLymeInLast15Months(history) && !hasLymeInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lyme');
            const showRabiesCats = isCatPatient && patient.vaccines?.rabies;
            // FeLV: (a) <1yr and never had it; or (b) ≥1yr and outdoor yes and (never had or past due)
            const showFeLV = isCatPatient && patientId != null && !hasFeLVInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'felv') && ((isUnderOneYear && !everHadFeLV(history)) || (!isUnderOneYear && outdoorAccess && (!everHadFeLV(history) || !hadFeLVInLast15Months(history))));
            const hasAnyOptionalContent = showCrLymeBooster || showLepto || showBordetella || showLyme || showRabiesCats || showFeLV;

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
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#212529', marginBottom: '12px', padding: '8px 12px', backgroundColor: '#e8f4fc', borderRadius: '6px' }}>crLyme vaccine</div>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '12px', color: '#555' }}>
                        We&apos;re excited to let you know that we&apos;ve switched to the crLyme vaccine, offering broader, more effective protection than what {petName} has received in the past, while remaining just as safe. {petName} will receive their first crLyme vaccine at the appointment.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        To ensure full effectiveness, we recommend a crLyme booster in 3-4 weeks. If the booster is skipped, however, the initial dose still is at least as protective as {petName}&apos;s previous Lyme vaccine. Do you want us to schedule you a booster appointment after this visit? <span style={{ color: '#dc3545' }}>*</span>
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
                      {fieldValidationErrors[`${petKey}_crLymeBooster`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_crLymeBooster`]}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Lyme recommendation (dogs only: not in last 15 months, not on staff-recommended list) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showLyme =
                    isDog &&
                    patientId != null &&
                    !hadLymeInLast15Months(history) &&
                    !hasLymeInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lyme');
                  if (!showLyme) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#212529', marginBottom: '12px', padding: '8px 12px', backgroundColor: '#e8f4fc', borderRadius: '6px' }}>Lyme vaccine</div>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '12px', color: '#555' }}>
                        It looks like {petName} has not received a Lyme vaccine within the past 15 months and may not be fully protected at this time.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '12px', color: '#555' }}>
                        Lyme disease is extremely common in our area due to the high number of ticks. While many dogs can be exposed without symptoms, about 10–15% develop serious issues like painful joints — and in rare cases, life-threatening kidney disease.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '12px', color: '#555' }}>
                        Because of the risk where we live, <strong>Vet At Your Door considers Lyme a core vaccine for all dogs.</strong>
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        To protect {petName}, we recommend starting the vaccine series now. It will involve two vaccines, 3–4 weeks apart, followed by an annual booster.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the Lyme vaccine? <span style={{ color: '#dc3545' }}>*</span>
                      </p>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_lymeVaccine`}
                            value="yes"
                            checked={formData[`${petKey}_lymeVaccine`] === 'yes'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'lyme', `${petKey}_lymeVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_lymeVaccine`}
                            value="no"
                            checked={formData[`${petKey}_lymeVaccine`] === 'no'}
                            onChange={(e) => handleVaccineOptChange(petKey, patientId ?? undefined, 'lyme', `${petKey}_lymeVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No
                        </label>
                      </div>
                      {fieldValidationErrors[`${petKey}_lymeVaccine`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_lymeVaccine`]}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Leptospirosis recommendation (dogs only: not in last 15 months, not on staff-recommended list) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showLepto =
                    isDog &&
                    patientId != null &&
                    !hadLeptoInLast15Months(history) &&
                    !hasLeptoInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'lepto');
                  if (!showLepto) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#212529', marginBottom: '12px', padding: '8px 12px', backgroundColor: '#e8f4fc', borderRadius: '6px' }}>Leptospirosis vaccine</div>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        It looks like {petName} has not received a Leptospirosis vaccine within the past 15 months and may not be fully protected at this time.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Leptospirosis is a serious bacterial infection that can be life-threatening for dogs — and can also spread to humans. It's carried in the urine of wild animals, and dogs can contract it simply by drinking from puddles or streams.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Based on updated veterinary guidelines (from AAHA, ACVIM, and WSAVA) and the risks in our area, <strong>Vet At Your Door now considers Leptospirosis a core vaccine for all dogs.</strong>
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        To protect {petName}, we recommend starting the vaccine series at your visit. It will involve two vaccines, 3–4 weeks apart, then an annual booster to stay protected.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the Lepto vaccine? <span style={{ color: '#dc3545' }}>*</span>
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
                      {fieldValidationErrors[`${petKey}_leptoVaccine`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_leptoVaccine`]}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Bordetella recommendation (dogs only: not in last 15 months, not on staff-recommended list) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const showBordetella =
                    isDog &&
                    patientId != null &&
                    !hadBordetellaInLast15Months(history) &&
                    !hasBordetellaInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'bordetella');
                  if (!showBordetella) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#212529', marginBottom: '12px', padding: '8px 12px', backgroundColor: '#e8f4fc', borderRadius: '6px' }}>Bordetella vaccine</div>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Bordetella: It doesn't look like {petName} has received the Bordetella ("Kennel Cough") vaccine in the last year.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        We recommend this vaccine for dogs under a year old and for adult dogs who are boarded, go to doggy day care, or take group training classes.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the Bordetella vaccine? <span style={{ color: '#dc3545' }}>*</span>
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
                      {fieldValidationErrors[`${petKey}_bordetellaVaccine`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_bordetellaVaccine`]}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Rabies Vaccine (Cats only) */}
                {isCatPatient && patient.vaccines?.rabies && (
                  <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#212529', marginBottom: '12px', padding: '8px 12px', backgroundColor: '#e8f4fc', borderRadius: '6px' }}>Rabies vaccine</div>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      If not a member AND due for rabies AND a cat: we offer two rabies vaccines - a one year or three year - which would you prefer? <span style={{ color: '#dc3545' }}>*</span>
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
                    {fieldValidationErrors[`${petKey}_rabiesPreference`] && (
                      <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_rabiesPreference`]}</p>
                    )}
                  </div>
                )}

                {/* FeLV recommendation (cats only: <1yr always; or outdoors + (never had or >15mo since)) */}
                {(() => {
                  const patientId = patient.patientId ?? patient.patient?.id;
                  const history = patientId != null ? treatmentHistoryByPatientId[patientId] ?? [] : [];
                  const dob = patient?.dob ?? patient?.patient?.dob ?? appointments[petIdx]?.patient?.dob;
                  const isUnderOneYear = dob ? DateTime.now().diff(DateTime.fromISO(dob), 'years').years < 1 : false;
                  const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';
                  // FeLV: (a) <1yr and never had it; or (b) ≥1yr and outdoor yes and (never had or past due)
                  const showFeLV =
                    isCatPatient &&
                    patientId != null &&
                    !hasFeLVInLineItems(patient) && !hasFutureReminderForVaccine(patient, 'felv') &&
                    ((isUnderOneYear && !everHadFeLV(history)) || (!isUnderOneYear && outdoorAccess && (!everHadFeLV(history) || !hadFeLVInLast15Months(history))));
                  if (!showFeLV) return null;
                  return (
                    <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#212529', marginBottom: '12px', padding: '8px 12px', backgroundColor: '#e8f4fc', borderRadius: '6px' }}>FeLV vaccine</div>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        It appears that {petName} has either not started the FeLV (Feline Leukemia) vaccine series or is not currently up to date.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        FeLV is a contagious and potentially fatal virus spread through close contact between cats, like grooming or sharing food and water bowls.
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Based on updated veterinary guidelines, <strong>FeLV is now considered a core vaccine for all kittens under one year old, regardless of whether they live indoors or outdoors. We also highly recommend it for any adult cats who go outside or live with cats who do.</strong>
                      </p>
                      <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                        Do you want us to give the FeLV vaccine? For initial immunity, two vaccines must be given, 3-4 weeks apart. <span style={{ color: '#dc3545' }}>*</span>
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
                      {fieldValidationErrors[`${petKey}_felvVaccine`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_felvVaccine`]}</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          <div className="public-room-loader-nav-buttons">
            <button
              type="button"
              className="public-room-loader-btn"
              onClick={() => setCurrentPage(isFirstCarePlanPet ? 1 : currentPage - 1)}
              style={{
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ced4da',
                cursor: 'pointer',
              }}
            >
              {isFirstCarePlanPet ? '← Back to Check-in' : '← Previous pet'}
            </button>
            {isLastCarePlanPet ? (
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={() => {
                  console.log('[RoomLoader] Next: Labs clicked', { carePlanPetIndex, labsPageIndex });
                  const v = validateRequiredForCarePlanPet(carePlanPetIndex);
                  console.log('[RoomLoader] Care plan validation result', { valid: v.valid, errors: v.errors, message: v.message });
                  if (!v.valid) {
                    setFieldValidationErrors(v.errors || {});
                    return;
                  }
                  setFieldValidationErrors({});
                  setCurrentPage(labsPageIndex);
                  console.log('[RoomLoader] Navigating to Labs page', labsPageIndex);
                }}
                style={{
                  backgroundColor: '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Next: Labs We Recommend →
              </button>
            ) : (
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={() => {
                  console.log('[RoomLoader] Next pet clicked', { carePlanPetIndex });
                  const v = validateRequiredForCarePlanPet(carePlanPetIndex);
                  console.log('[RoomLoader] Care plan validation result', { valid: v.valid, errors: v.errors });
                  if (!v.valid) {
                    setFieldValidationErrors(v.errors || {});
                    return;
                  }
                  setFieldValidationErrors({});
                  setCurrentPage(currentPage + 1);
                }}
                style={{
                  backgroundColor: '#0d6efd',
                  color: '#fff',
                  border: 'none',
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
        <div className="public-room-loader-form-page">
          <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '3px solid #e0e0e0' }}>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>Labs We Recommend</h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginTop: '10px', marginBottom: 0 }}>
              Based on your pet's age, species, and today's visit, here are lab panels we suggest.
            </p>
          </div>
          {Object.keys(fieldValidationErrors).some((k) => k.startsWith('lab_')) && (
            <p style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '6px', color: '#721c24', fontSize: '14px' }}>
              Please complete all required lab questions below before continuing.
            </p>
          )}

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
                <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>We have no further specific lab recommendations at this time for this visit.</p>
              ) : (
                entry.recommendations.map((rec, rIdx) => {
                  const isEarlyDetectionFeline = rec.code === 'FIL48119999';
                  const isEarlyDetectionCanine = rec.code === 'FIL48719999';
                  const petName = entry.patientName || 'your pet';
                  const labIdStr = String(entry.patientId ?? idx);
                  const patientIdForPricing = (entry.patientId != null ? Number(entry.patientId) : (patients[idx] as any)?.patientId) ?? idx;
                  const earlyDetKey = `lab_early_detection_feline_${labIdStr}`;
                  const earlyDetValue = formData[earlyDetKey];
                  const earlyDetCanineKey = `lab_early_detection_canine_${labIdStr}`;
                  const earlyDetCanineValue = formData[earlyDetCanineKey];
                  // For "replace fecal" copy and price diff: find this pet's fecal reminder
                  const patientForEntry = patients.find((p: any) => String(p.patientId ?? p.patient?.id ?? '') === String(entry.patientId ?? '')) ?? patients[idx];
                  const fecalReminder = patientForEntry?.reminders?.find((r: any) => ((r?.item?.name ?? '').toLowerCase().includes('fecal')));
                  const fecalPrice = fecalReminder?.item?.price != null ? Number(fecalReminder.item.price) : null;
                  const panelPrice = getClientAdjustedPrice(patientIdForPricing, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem);
                  const priceDiff = panelPrice != null && fecalPrice != null ? panelPrice - fecalPrice : null;
                  const earlyDetCaninePanelPrice = getClientAdjustedPrice(patientIdForPricing, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem);
                  const earlyDetCaninePriceDiff = earlyDetCaninePanelPrice != null && fecalPrice != null ? earlyDetCaninePanelPrice - fecalPrice : null;
                  const hasFecalReminder = !!fecalReminder;
                  // When user says Yes, uncheck the fecal item on Care Plan (recKey for this pet's fecal in displayItems)
                  const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
                  const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
                  const entryDisplayItems = (recommendedItemsByPet[idx] ?? []).filter((item: any) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps'));
                  const fecalDisplayIdx = entryDisplayItems.findIndex((item: any) => hasPhrase(item, 'fecal'));
                  const fecalRecKey = fecalDisplayIdx >= 0 ? `pet${idx}_rec_${fecalDisplayIdx}` : null;
                  const fourDxReminder = patientForEntry?.reminders?.find((r: any) => hasPhrase(r?.item, '4dx') || hasPhrase(r?.item, 'heartworm'));
                  const fourDxPrice = fourDxReminder?.item?.price != null ? Number(fourDxReminder.item.price) : null;
                  const fourDxDisplayIdx = entryDisplayItems.findIndex((item: any) => hasPhrase(item, '4dx') || hasPhrase(item, 'heartworm'));
                  const fourDxRecKey = fourDxDisplayIdx >= 0 ? `pet${idx}_rec_${fourDxDisplayIdx}` : null;
                  const has4dxReminder = !!fourDxReminder;

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
                  const isSeniorFelineFullPanel = (rec.code === 'FIL45129999' || rec.code === 'FIL8659999') && isCatEntry;
                  const isLabWorkYesFelineTwoPanel = rec.code === '8659999' && isCatEntry;

                  const formatPrice = (p: number | null | undefined) => (p != null && !Number.isNaN(Number(p)) ? `$${Number(p).toFixed(2)}` : null);
                  const standardPrice = getClientAdjustedPrice(patientIdForPricing, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
                  const extendedPrice = getClientAdjustedPrice(patientIdForPricing, seniorCanineExtendedItem) ?? getSearchItemPrice(seniorCanineExtendedItem);
                  const seniorCanineDiff = standardPrice != null && extendedPrice != null ? extendedPrice - standardPrice : null;
                  const seniorPanelKey = `lab_senior_canine_panel_${labIdStr}`;
                  const seniorPanelValue = formData[seniorPanelKey];
                  const seniorFelineKey = `lab_senior_feline_${labIdStr}`;
                  const seniorFelineValue = formData[seniorFelineKey];
                  const seniorFelinePrice = getClientAdjustedPrice(patientIdForPricing, seniorFelineItem) ?? getSearchItemPrice(seniorFelineItem);
                  const seniorFelinePriceDiff = seniorFelinePrice != null && fecalPrice != null ? seniorFelinePrice - fecalPrice : null;

                  const seniorFelineStandardPrice = getClientAdjustedPrice(patientIdForPricing, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem);
                  const seniorFelineExtendedPrice = getClientAdjustedPrice(patientIdForPricing, seniorFelineExtendedItem) ?? getSearchItemPrice(seniorFelineExtendedItem);
                  const seniorFelineTwoPanelDiff = seniorFelineStandardPrice != null && seniorFelineExtendedPrice != null ? seniorFelineExtendedPrice - seniorFelineStandardPrice : null;
                  const seniorFelineTwoPanelKey = `lab_senior_feline_two_panel_${labIdStr}`;
                  const seniorFelineTwoPanelValue = formData[seniorFelineTwoPanelKey];
                  const seniorFelineExtendedMinusFecal = seniorFelineExtendedPrice != null && fecalPrice != null ? seniorFelineExtendedPrice - fecalPrice : null;

                  if (isEarlyDetectionFeline) {
                    const earlyDetFelineCost = getClientAdjustedPrice(patientIdForPricing, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem);
                    const fivFelvReminder = patientForEntry?.reminders?.find((r: any) => {
                      const n = (r?.item?.name ?? '').toLowerCase();
                      return n.includes('fiv') || n.includes('felv') || (n.includes('heartworm') && isCatEntry);
                    });
                    const hasFivFelvReminder = !!fivFelvReminder;
                    const testsAlreadyRecommendedFeline: string[] = [];
                    if (hasFecalReminder) testsAlreadyRecommendedFeline.push('fecal parasite screening');
                    if (hasFivFelvReminder) testsAlreadyRecommendedFeline.push('FIV/FeLV/Heartworm screening');
                    const hasTestsAlreadyRecommendedFeline = testsAlreadyRecommendedFeline.length > 0;
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Early Detection Screening for {petName}</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            We recommend an Early Detection Panel as part of routine preventive care. This screening establishes baseline values, helps us monitor trends over time, and can identify subtle changes before pets show symptoms.
                          </p>
                        </div>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>The Early Detection Panel includes:</p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li>Chemistry Panel (liver and kidney function)</li>
                          <li>Complete Blood Count (CBC)</li>
                          <li>Fecal parasite screening</li>
                          <li>FIV/FeLV/Heartworm screening</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: hasTestsAlreadyRecommendedFeline ? '8px' : '12px' }}>
                          Cost: {formatPrice(earlyDetFelineCost) != null ? <strong>{formatPrice(earlyDetFelineCost)}</strong> : 'our standard lab pricing (ask at visit).'}
                          {(() => {
                            const labPricing = getClientPricing(patientIdForPricing, earlyDetectionFelineItem);
                            const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                            return hasDiscount ? <><br /><span style={{ fontSize: '12px', color: '#1976d2' }}>{getDiscountNote(labPricing) ?? 'Discount applied'}</span></> : null;
                          })()}
                        </p>
                        {hasTestsAlreadyRecommendedFeline && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
                            This bundled panel includes the {testsAlreadyRecommendedFeline.join(' and ')} already recommended for today&apos;s visit and provides a more complete picture of {petName}&apos;s health
                            {hasFecalReminder && priceDiff != null && !Number.isNaN(priceDiff)
                              ? priceDiff > 0
                                ? <> for <strong>${priceDiff.toFixed(2)}</strong> more.</>
                                : priceDiff < 0
                                  ? <> and saves you <strong>${(-priceDiff).toFixed(2)}</strong>.</>
                                  : ' at no extra cost.'
                              : '.'}
                          </p>
                        )}
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: '16px' }}>
                          Most families choose to include this screening so we have baseline information available if {petName} ever becomes sick.
                        </p>
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Would you like us to include this recommended screening today?</p>
                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
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
                            Yes — Include Early Detection Panel
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
                            Not at this time
                          </label>
                        </div>
                        {fieldValidationErrors[earlyDetKey] && (
                          <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[earlyDetKey]}</p>
                        )}
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
                    const fourDxReminder = patientForEntry?.reminders?.find((r: any) => hasPhrase(r?.item, '4dx') || hasPhrase(r?.item, 'heartworm'));
                    const has4dxReminder = !!fourDxReminder;
                    const testsAlreadyRecommended: string[] = [];
                    if (hasFecalReminder) testsAlreadyRecommended.push('fecal test');
                    if (has4dxReminder) testsAlreadyRecommended.push('4Dx');
                    const hasTestsAlreadyRecommended = testsAlreadyRecommended.length > 0;
                    const earlyDetCanineCost = getClientAdjustedPrice(patientIdForPricing, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem);
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Early Detection Screening for {petName}</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            We recommend an Early Detection Panel as part of routine preventive care. This screening establishes baseline values, helps us monitor trends over time, and can identify subtle changes before pets show symptoms.
                          </p>
                        </div>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>The Early Detection Panel includes:</p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li>Chemistry Panel (liver and kidney function)</li>
                          <li>Complete Blood Count (CBC)</li>
                          <li>Fecal parasite screening</li>
                          <li>4Dx (Heartworm and tick-borne disease screening — Lyme, Anaplasma, and Ehrlichia)</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: hasTestsAlreadyRecommended ? '8px' : '12px' }}>
                          Cost: {formatPrice(earlyDetCanineCost) != null ? <strong>{formatPrice(earlyDetCanineCost)}</strong> : 'our standard lab pricing (ask at visit).'}
                          {(() => {
                            const labPricing = getClientPricing(patientIdForPricing, earlyDetectionCanineItem);
                            const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                            return hasDiscount ? <><br /><span style={{ fontSize: '12px', color: '#1976d2' }}>{getDiscountNote(labPricing) ?? 'Discount applied'}</span></> : null;
                          })()}
                        </p>
                        {hasTestsAlreadyRecommended && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
                            This bundled panel includes the {testsAlreadyRecommended.join(' and ')} already recommended for today&apos;s visit and provides a more complete picture of {petName}&apos;s health
                            {hasFecalReminder && earlyDetCaninePriceDiff != null && !Number.isNaN(earlyDetCaninePriceDiff)
                              ? earlyDetCaninePriceDiff > 0
                                ? <> for <strong>${earlyDetCaninePriceDiff.toFixed(2)}</strong> more.</>
                                : earlyDetCaninePriceDiff < 0
                                  ? <> and saves you <strong>${(-earlyDetCaninePriceDiff).toFixed(2)}</strong>.</>
                                  : ' at no extra cost.'
                              : '.'}
                          </p>
                        )}
                        <p style={{ fontSize: '14px', color: '#555', marginBottom: '16px' }}>
                          Most families choose to include this screening so we have baseline information available if {petName} ever becomes sick.
                        </p>
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Would you like us to include this recommended screening today?</p>
                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
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
                            Yes — Include Early Detection Panel
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
                            Not at this time.
                          </label>
                        </div>
                        {fieldValidationErrors[earlyDetCanineKey] && (
                          <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[earlyDetCanineKey]}</p>
                        )}
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
                    const extendedMinus4dx = extendedPrice != null && fourDxPrice != null ? extendedPrice - fourDxPrice : null;
                    const extendedMinusBoth = extendedPrice != null && fecalPrice != null && fourDxPrice != null ? extendedPrice - fecalPrice - fourDxPrice : null;
                    const labWorkYesForEntry = formData[`pet${idx}_labWork`] === true || formData[`pet${idx}_labWork`] === 'yes' || (patients[idx] as any)?.questions?.labWork === true;
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Senior Screen — Canine</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            {!labWorkYesForEntry
                              ? <>It looks like {petName} is due for Annual Comprehensive Lab Work, which helps us gain helpful insight into {petName}&apos;s overall health and trends over time.</>
                              : <>We have two panels to choose from. Our <strong>Standard Comprehensive Panel</strong> ({formatPrice(standardPrice) != null ? <strong>{formatPrice(standardPrice)}</strong> : 'see pricing at visit'}) includes a:</>}
                          </p>
                        </div>
                        {!labWorkYesForEntry && (
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, marginBottom: '12px' }}>
                            We have two panels to choose from. Our <strong>Standard Comprehensive Panel</strong> ({formatPrice(standardPrice) != null ? <strong>{formatPrice(standardPrice)}</strong> : 'see pricing at visit'}) includes a:
                          </p>
                        )}
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Chemistry</strong> to look at organ function such as liver or kidneys</li>
                          <li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts</li>
                          <li><strong>Thyroid level</strong>, as this level can go below normal in middle and older aged dogs</li>
                          <li><strong>Urinalysis</strong>, to look at kidney and urinary health</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder || has4dxReminder ? '8px' : '12px' }}>
                          We also offer an <strong>Extended Comprehensive Panel</strong>, which is {seniorCanineDiff != null ? <><strong>${seniorCanineDiff.toFixed(2)}</strong> more</> : 'a bit more'}. This panel includes everything in the Standard Comprehensive Panel above and also includes a:
                        </p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder || has4dxReminder ? '8px' : '12px', paddingLeft: '20px' }}>
                          <li>Heartworm/tick disease screening test (called &quot;4Dx&quot;)</li>
                          <li>Stool sample analysis for parasites (&quot;Fecal&quot;)</li>
                        </ul>
                        {(hasFecalReminder || has4dxReminder) && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
                            The Extended Comprehensive Panel includes 4Dx and fecal, so it would replace {has4dxReminder && hasFecalReminder ? 'the 4Dx and fecal' : has4dxReminder ? 'the 4Dx' : 'the fecal'} already on your care plan.
                            {(() => {
                              const diff = has4dxReminder && hasFecalReminder ? extendedMinusBoth : has4dxReminder ? extendedMinus4dx : extendedMinusFecal;
                              return diff != null && !Number.isNaN(diff)
                                ? diff > 0
                                  ? <> It costs <strong>${diff.toFixed(2)}</strong> more.</>
                                  : diff < 0
                                    ? <> It saves you <strong>${(-diff).toFixed(2)}</strong>.</>
                                    : ' It\'s the same price.'
                                : '';
                            })()}
                          </p>
                        )}
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '16px' }}>
                          Conducting annual lab work aligns with the proactive essence of our philosophy by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.
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
                            Standard Comprehensive Panel {formatPrice(standardPrice) && <>(<strong>{formatPrice(standardPrice)}</strong>)</>}
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
                                if (fourDxRecKey != null) handleInputChange(fourDxRecKey, false);
                              }}
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            Extended Comprehensive Panel {formatPrice(extendedPrice) && <>(<strong>{formatPrice(extendedPrice)}</strong>)</>}
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
                        {(() => {
                          const standardPricing = getClientPricing(patientIdForPricing, seniorCanineStandardItem);
                          const extendedPricing = getClientPricing(patientIdForPricing, seniorCanineExtendedItem);
                          const hasStandardDiscount = standardPricing?.wellnessPlanPricing?.hasCoverage && (standardPricing.wellnessPlanPricing.originalPrice !== standardPricing.wellnessPlanPricing.adjustedPrice) || standardPricing?.discountPricing?.priceAdjustedByDiscount;
                          const hasExtendedDiscount = extendedPricing?.wellnessPlanPricing?.hasCoverage && (extendedPricing.wellnessPlanPricing.originalPrice !== extendedPricing.wellnessPlanPricing.adjustedPrice) || extendedPricing?.discountPricing?.priceAdjustedByDiscount;
                          const hasAnyDiscount = hasStandardDiscount || hasExtendedDiscount;
                          return hasAnyDiscount ? (
                            <p style={{ fontSize: '12px', color: '#1976d2', marginTop: '8px', marginBottom: 0 }}>
                              {hasStandardDiscount && hasExtendedDiscount ? (getDiscountNote(standardPricing) ?? 'Discount applied to prices above') : hasStandardDiscount ? (getDiscountNote(standardPricing) ?? 'Discount applied') : (getDiscountNote(extendedPricing) ?? 'Discount applied')}
                            </p>
                          ) : null;
                        })()}
                        {fieldValidationErrors[seniorPanelKey] && (
                          <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[seniorPanelKey]}</p>
                        )}
                        {seniorPanelValue === 'extended' && hasFecalReminder && fecalReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Extended Comprehensive Panel)
                          </p>
                        )}
                        {seniorPanelValue === 'extended' && has4dxReminder && fourDxReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fourDxReminder.item.name}</span> (included in Extended Comprehensive Panel)
                          </p>
                        )}
                        {seniorPanelValue === 'extended' && (
                          <p style={{ fontSize: '14px', color: '#333', marginTop: '12px', padding: '12px', backgroundColor: '#e8f5e9', border: '1px solid #81c784', borderRadius: '6px', lineHeight: 1.5 }}>
                            Great!<br /><br />
                            <strong>NOTE:</strong> Please try to have a stool sample (non-frozen, fresher is better!) ready for us when we arrive!<br /><br />
                            Please try to have a urine sample (morning of appointment is best — you can use a clean tupperware or jar to &quot;sneak&quot; it under while they go!)
                          </p>
                        )}
                      </div>
                    );
                  }

                  if (isLabWorkYesFelineTwoPanel) {
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Senior Screen — Feline</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            With the symptoms you mentioned for {petName}, {doctorName} is likely to recommend lab work in order to gain valuable insight into why {petName} might be displaying these symptoms.
                          </p>
                        </div>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px' }}>
                          We have two panels to choose from. First, our <strong>Standard Comprehensive Panel</strong> ({formatPrice(seniorFelineStandardPrice) != null ? <strong>{formatPrice(seniorFelineStandardPrice)}</strong> : 'see pricing at visit'}) includes a:
                        </p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Chemistry</strong> to look at organ function like the liver and kidneys.</li>
                          <li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts.</li>
                          <li><strong>Thyroid level</strong>, which may increase in older cats.</li>
                          <li><strong>Urinalysis</strong>, to look at kidney and urinary health.</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder ? '8px' : '12px' }}>
                          We also offer a more <strong>Extended Comprehensive Panel</strong>, which is {seniorFelineTwoPanelDiff != null ? <>around <strong>${seniorFelineTwoPanelDiff.toFixed(2)}</strong> more</> : 'a bit more'}. This panel includes everything in the Standard Comprehensive Panel above and also includes:
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
                                ? <> It costs <strong>${seniorFelineExtendedMinusFecal.toFixed(2)}</strong> more.</>
                                : seniorFelineExtendedMinusFecal < 0
                                  ? <> It saves you <strong>${(-seniorFelineExtendedMinusFecal).toFixed(2)}</strong>.</>
                                  : ' It\'s the same price.'
                              : ''}
                          </p>
                        )}
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '16px' }}>
                          Conducting annual lab work aligns with the proactive essence of our philosophy by enabling early detection and tailored care strategies, ensuring optimal health outcomes for {petName}.
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
                            Standard Comprehensive Panel {formatPrice(seniorFelineStandardPrice) && <>(<strong>{formatPrice(seniorFelineStandardPrice)}</strong>)</>}
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
                        {(() => {
                          const standardPricing = getClientPricing(patientIdForPricing, seniorCanineStandardItem);
                          const extendedPricing = getClientPricing(patientIdForPricing, seniorFelineExtendedItem);
                          const hasStandardDiscount = standardPricing?.wellnessPlanPricing?.hasCoverage && (standardPricing.wellnessPlanPricing.originalPrice !== standardPricing.wellnessPlanPricing.adjustedPrice) || standardPricing?.discountPricing?.priceAdjustedByDiscount;
                          const hasExtendedDiscount = extendedPricing?.wellnessPlanPricing?.hasCoverage && (extendedPricing.wellnessPlanPricing.originalPrice !== extendedPricing.wellnessPlanPricing.adjustedPrice) || extendedPricing?.discountPricing?.priceAdjustedByDiscount;
                          const hasAnyDiscount = hasStandardDiscount || hasExtendedDiscount;
                          return hasAnyDiscount ? (
                            <p style={{ fontSize: '12px', color: '#1976d2', marginTop: '8px', marginBottom: 0 }}>
                              {hasStandardDiscount && hasExtendedDiscount ? (getDiscountNote(standardPricing) ?? 'Discount applied to prices above') : hasStandardDiscount ? (getDiscountNote(standardPricing) ?? 'Discount applied') : (getDiscountNote(extendedPricing) ?? 'Discount applied')}
                            </p>
                          ) : null;
                        })()}
                        {fieldValidationErrors[seniorFelineTwoPanelKey] && (
                          <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[seniorFelineTwoPanelKey]}</p>
                        )}
                        {seniorFelineTwoPanelValue === 'extended' && hasFecalReminder && fecalReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Extended Comprehensive Panel)
                          </p>
                        )}
                        {seniorFelineTwoPanelValue === 'extended' && (
                          <p style={{ fontSize: '14px', color: '#333', marginTop: '12px', padding: '12px', backgroundColor: '#e8f5e9', border: '1px solid #81c784', borderRadius: '6px', lineHeight: 1.5 }}>
                            Great!<br /><br />
                            <strong>NOTE:</strong> Please try to have a stool sample (non-frozen, fresher is better!) ready for us when we arrive!<br /><br />
                            Ideally, please be sure to not let {petName} have access to the litterbox for 2–3 hours before our arrival. That way, we can get a good urine sample.
                          </p>
                        )}
                      </div>
                    );
                  }

                  if (isSeniorFelineFullPanel) {
                    // When labs was answered Yes and patient is due for senior screen, we already show the "With the symptoms you mentioned..." block (8659999). For FIL45129999 only, skip this block so that one doesn't duplicate.
                    const hasLabWorkYesSeniorFeline = entry.recommendations.some((r: any) => r.code === '8659999');
                    if (rec.code === 'FIL45129999' && hasLabWorkYesSeniorFeline) return null;
                    // Same two-panel choice (Standard / Extended / No) as 8659999, using lab_senior_feline_two_panel
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Senior Screen Feline</div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <img
                            src="/early-detection-feline.png"
                            alt="Early detection baseline and trend"
                            style={{ width: '180px', height: 'auto', borderRadius: '4px', border: '1px solid #e0e0e0', flexShrink: 0 }}
                          />
                          <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, margin: 0, flex: '1 1 280px' }}>
                            For senior cats, we recommend our Senior Screen Feline—a comprehensive panel that gives us a clear picture of {petName}&apos;s organ function, thyroid, and infectious disease status. We have two panels to choose from.
                          </p>
                        </div>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px' }}>
                          First, our <strong>Standard Comprehensive Panel</strong> ({formatPrice(seniorFelineStandardPrice) != null ? <strong>{formatPrice(seniorFelineStandardPrice)}</strong> : 'see pricing at visit'}) includes:
                        </p>
                        <ul style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '20px' }}>
                          <li><strong>Chemistry</strong> to look at organ function like the liver and kidneys.</li>
                          <li><strong>Complete Blood Count</strong> to look at red/white blood cell and platelet counts.</li>
                          <li><strong>Thyroid level</strong>, which may increase in older cats.</li>
                          <li><strong>Urinalysis</strong>, to look at kidney and urinary health.</li>
                        </ul>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: hasFecalReminder ? '8px' : '12px' }}>
                          We also offer a more <strong>Extended Comprehensive Panel</strong>, which is {seniorFelineTwoPanelDiff != null ? <>around <strong>${seniorFelineTwoPanelDiff.toFixed(2)}</strong> more</> : 'a bit more'}. This panel includes everything in the Standard Comprehensive Panel above and also includes:
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
                                ? <> It costs <strong>${seniorFelineExtendedMinusFecal.toFixed(2)}</strong> more.</>
                                : seniorFelineExtendedMinusFecal < 0
                                  ? <> It saves you <strong>${(-seniorFelineExtendedMinusFecal).toFixed(2)}</strong>.</>
                                  : ' It\'s the same price.'
                              : ''}
                          </p>
                        )}
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
                            Standard Comprehensive Panel {formatPrice(seniorFelineStandardPrice) && <>(<strong>{formatPrice(seniorFelineStandardPrice)}</strong>)</>}
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
                            Extended Comprehensive Panel {formatPrice(seniorFelineExtendedPrice) && <>(<strong>{formatPrice(seniorFelineExtendedPrice)}</strong>)</>}
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
                        {(() => {
                          const standardPricing = getClientPricing(patientIdForPricing, seniorCanineStandardItem);
                          const extendedPricing = getClientPricing(patientIdForPricing, seniorFelineExtendedItem);
                          const hasStandardDiscount = standardPricing?.wellnessPlanPricing?.hasCoverage && (standardPricing.wellnessPlanPricing.originalPrice !== standardPricing.wellnessPlanPricing.adjustedPrice) || standardPricing?.discountPricing?.priceAdjustedByDiscount;
                          const hasExtendedDiscount = extendedPricing?.wellnessPlanPricing?.hasCoverage && (extendedPricing.wellnessPlanPricing.originalPrice !== extendedPricing.wellnessPlanPricing.adjustedPrice) || extendedPricing?.discountPricing?.priceAdjustedByDiscount;
                          const hasAnyDiscount = hasStandardDiscount || hasExtendedDiscount;
                          return hasAnyDiscount ? (
                            <p style={{ fontSize: '12px', color: '#1976d2', marginTop: '8px', marginBottom: 0 }}>
                              {hasStandardDiscount && hasExtendedDiscount ? (getDiscountNote(standardPricing) ?? 'Discount applied to prices above') : hasStandardDiscount ? (getDiscountNote(standardPricing) ?? 'Discount applied') : (getDiscountNote(extendedPricing) ?? 'Discount applied')}
                            </p>
                          ) : null;
                        })()}
                        {fieldValidationErrors[seniorFelineTwoPanelKey] && (
                          <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[seniorFelineTwoPanelKey]}</p>
                        )}
                        {seniorFelineTwoPanelValue === 'extended' && hasFecalReminder && fecalReminder?.item?.name && (
                          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                            Replacing: <span style={{ textDecoration: 'line-through' }}>{fecalReminder.item.name}</span> (included in Extended Comprehensive Panel)
                          </p>
                        )}
                        {seniorFelineTwoPanelValue === 'extended' && (
                          <p style={{ fontSize: '14px', color: '#333', marginTop: '12px', padding: '12px', backgroundColor: '#e8f5e9', border: '1px solid #81c784', borderRadius: '6px', lineHeight: 1.5 }}>
                            Great!<br /><br />
                            <strong>NOTE:</strong> Please try to have a stool sample (non-frozen, fresher is better!) ready for us when we arrive!<br /><br />
                            Ideally, please be sure to not let {petName} have access to the litterbox for 2–3 hours before our arrival. That way, we can get a good urine sample.
                          </p>
                        )}
                      </div>
                    );
                  }

                  if (rec.code === 'COMPREHENSIVE_FECAL') {
                    const compFecalKey = `lab_comprehensive_fecal_${labIdStr}`;
                    const compFecalValue = formData[compFecalKey];
                    const compFecalPrice = getClientAdjustedPrice(patientIdForPricing, comprehensiveFecalItem) ?? getSearchItemPrice(comprehensiveFecalItem);
                    return (
                      <div key={rIdx} style={{ marginBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, paddingBottom: rIdx < entry.recommendations.length - 1 ? '16px' : 0, borderBottom: rIdx < entry.recommendations.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                        <div style={{ fontWeight: 600, color: '#333', fontSize: '18px', marginBottom: '12px', textDecoration: 'underline' }}>Comprehensive Fecal</div>
                        <p style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '12px' }}>{rec.message}</p>
                        {compFecalPrice != null && (
                          <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px' }}>
                            Cost: <strong>{formatPrice(compFecalPrice)}</strong>
                            {(() => {
                              const labPricing = getClientPricing(patientIdForPricing, comprehensiveFecalItem);
                              const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                              return hasDiscount ? <><br /><span style={{ fontSize: '12px', color: '#1976d2' }}>{getDiscountNote(labPricing) ?? 'Discount applied'}</span></> : null;
                            })()}
                          </p>
                        )}
                        <p style={{ fontSize: '15px', fontWeight: 600, color: '#333', marginBottom: '10px' }}>Would you like to add a comprehensive fecal today? <span style={{ color: '#dc3545' }}>*</span></p>
                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input type="radio" name={compFecalKey} value="yes" checked={compFecalValue === 'yes'} onChange={(e) => handleInputChange(compFecalKey, e.target.value)} style={{ marginRight: '8px', cursor: 'pointer' }} />
                            Yes
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                            <input type="radio" name={compFecalKey} value="no" checked={compFecalValue === 'no'} onChange={(e) => handleInputChange(compFecalKey, e.target.value)} style={{ marginRight: '8px', cursor: 'pointer' }} />
                            No
                          </label>
                        </div>
                        {fieldValidationErrors[compFecalKey] && (
                          <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[compFecalKey]}</p>
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

          <div className="public-room-loader-nav-buttons">
            <button
              type="button"
              className="public-room-loader-btn"
              onClick={() => setCurrentPage(labsPageIndex - 1)}
              style={{
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ced4da',
                cursor: 'pointer',
              }}
            >
              ← Back to Care Plan
            </button>
            <button
              type="button"
              className="public-room-loader-btn"
              onClick={() => {
                const v = validateRequiredForLabsPage();
                if (!v.valid) {
                  setFieldValidationErrors(v.errors || {});
                  return;
                }
                setFieldValidationErrors({});
                setCurrentPage(summaryPageIndex);
              }}
              style={{
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
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
          <div className="public-room-loader-summary-page">
            <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '3px solid #e0e0e0' }}>
              <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>Review Your Care Plan & Estimate</h1>
              <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginTop: '10px', marginBottom: 0 }}>
                We've put together a personalized plan based on your pet's needs and our medical recommendations. You can review each item below, make adjustments, and see pricing clearly upfront so you feel informed and confident before your visit.
              </p>
            </div>

            {patients.map((patient: any, petIdx: number) => {
              const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
              const petName = patient.patientName || `Pet ${petIdx + 1}`;
              const allItems = recommendedItemsByPet[petIdx] ?? [];
              const displayItems = allItems.filter((item: any) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps'));
              const tripFeeItems = allItems.filter((item: any) => hasPhrase(item, 'trip fee') || hasPhrase(item, 'sharps'));
              const displayWithIdx = displayItems.map((item: any, idx: number) => ({ item, idx }));
              const uncheckableDisplay = displayWithIdx.filter(({ item }) => hasPhrase(item, 'visit') || hasPhrase(item, 'consult'));
              const checkableDisplay = displayWithIdx.filter(({ item }) => !hasPhrase(item, 'visit') && !hasPhrase(item, 'consult'));
              const itemCategory = (item: any) => {
                const t = (item.type ?? item.itemType ?? 'procedure').toString().toLowerCase();
                if (t === 'lab' || t === 'laboratory') return 'lab';
                if (t === 'inventory') return 'inventory';
                return 'procedure';
              };
              const procedureDisplay = displayWithIdx.filter(({ item }) => itemCategory(item) === 'procedure');
              const labDisplay = displayWithIdx.filter(({ item }) => itemCategory(item) === 'lab');
              const inventoryDisplay = displayWithIdx.filter(({ item }) => itemCategory(item) === 'inventory');
              const SummarySeparator = ({ id }: { id: string }) => <div style={{ height: '1px', backgroundColor: '#e0e0e0', margin: '12px 0' }} />;
              const earlyDetectionYes = formData[`lab_early_detection_feline_${patientId}`] === 'yes';
              const earlyDetectionCanineYes = formData[`lab_early_detection_canine_${patientId}`] === 'yes';
              const seniorFelineYes = formData[`lab_senior_feline_${patientId}`] === 'yes';
              const seniorCaninePanel = formData[`lab_senior_canine_panel_${patientId}`];
              const seniorFelineTwoPanel = formData[`lab_senior_feline_two_panel_${patientId}`];
              const fecalReplacedBy: string[] = [];
              const earlyDetFelineExcluded = formData[`summary_exclude_lab_early_detection_feline_${patientId}`] === true;
              const earlyDetCanineExcluded = formData[`summary_exclude_lab_early_detection_canine_${patientId}`] === true;
              const seniorFelineExcluded = formData[`summary_exclude_lab_senior_feline_${patientId}`] === true;
              const seniorCanineExtendedExcluded = formData[`summary_exclude_lab_senior_canine_extended_${patientId}`] === true;
              const seniorFelineTwoExtendedExcluded = formData[`summary_exclude_lab_senior_feline_two_extended_${patientId}`] === true;
              if ((earlyDetectionYes && !earlyDetFelineExcluded) || (earlyDetectionCanineYes && !earlyDetCanineExcluded)) fecalReplacedBy.push('Early Detection Panel');
              if (seniorFelineYes && !seniorFelineExcluded) fecalReplacedBy.push('Senior Screen Feline');
              if ((seniorCaninePanel === 'extended' && !seniorCanineExtendedExcluded) || (seniorFelineTwoPanel === 'extended' && !seniorFelineTwoExtendedExcluded)) fecalReplacedBy.push('Extended Comprehensive Panel');
              const fourDxReplacedBy: string[] = (seniorCaninePanel === 'extended' && !seniorCanineExtendedExcluded) || (seniorFelineTwoPanel === 'extended' && !seniorFelineTwoExtendedExcluded) ? ['Extended Comprehensive Panel'] : [];
              const is4dxItem = (it: any) => hasPhrase(it, '4dx') || hasPhrase(it, 'heartworm');

              /** When a panel that replaces items (e.g. fecal, 4Dx) is unchecked on summary, re-check those items so they are no longer crossed out. */
              const replacedItemRecKeys = displayWithIdx
                .filter(({ item }) => (hasPhrase(item, 'fecal') && fecalReplacedBy.length > 0) || (is4dxItem(item) && fourDxReplacedBy.length > 0))
                .map(({ idx }) => `pet${petIdx}_rec_${idx}`);
              /** Exclude panel from summary (row stays visible, unchecked); restore replaced items when applicable. */
              const excludePanelOnSummary = (summaryExcludeKey: string, shouldRestoreReplaced: boolean) => {
                handleInputChange(summaryExcludeKey, true);
                if (shouldRestoreReplaced) replacedItemRecKeys.forEach((recKey) => handleInputChange(recKey, true));
              };
              const includePanelOnSummary = (summaryExcludeKey: string) => handleInputChange(summaryExcludeKey, false);

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
                const is4dxReplaced = is4dxItem(item) && fourDxReplacedBy.length > 0;
                const isReplaced = isFecalReplaced || is4dxReplaced;
                const recKey = `pet${petIdx}_rec_${idx}`;
                const canUncheck = !isVisitOrConsult && !isReplaced && !readOnly;
                const isChecked = isReplaced ? false : (isVisitOrConsult || formData[recKey] !== false);
                const searchableItem = item.searchableItem as SearchableItem | null | undefined;
                // Prefer pricing from API (reminder/addedItem wellnessPlanPricing) when present
                const hasApiPricing = item.wellnessPlanPricing != null || item.discountPricing != null;
                const displayPricing = hasApiPricing
                  ? { wellnessPlanPricing: item.wellnessPlanPricing ?? undefined, discountPricing: item.discountPricing ?? undefined }
                  : (searchableItem != null ? getClientPricing(patientId, searchableItem) : null);
                const unitPrice = hasApiPricing
                  ? (Number(item.price) ?? 0)
                  : (searchableItem != null ? (getClientAdjustedPrice(patientId, searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) || 0));
                const qty = Number(item.quantity) || 1;
                const lineTotal = isChecked && !isReplaced ? unitPrice * qty : 0;
                petSubtotal += lineTotal;
                const replacedByLabel = isFecalReplaced ? fecalReplacedBy.join(' or ') : is4dxReplaced ? fourDxReplacedBy.join(' or ') : '';
                const hasDiscount = displayPricing?.wellnessPlanPricing?.hasCoverage && (displayPricing.wellnessPlanPricing.originalPrice !== displayPricing.wellnessPlanPricing.adjustedPrice) || (displayPricing?.wellnessPlanPricing as any)?.priceAdjustedByMembership || displayPricing?.discountPricing?.priceAdjustedByDiscount;
                const quantityUsedNote = displayPricing?.wellnessPlanPricing?.hasCoverage && displayPricing.wellnessPlanPricing.isWithinLimit === false;
                const hasPricingNote = hasDiscount || quantityUsedNote;
                const isMembershipRelated = displayPricing?.wellnessPlanPricing?.hasCoverage && ((displayPricing.wellnessPlanPricing.originalPrice !== displayPricing.wellnessPlanPricing.adjustedPrice) || (displayPricing?.wellnessPlanPricing as any)?.priceAdjustedByMembership || quantityUsedNote);
                const discountNote = getDiscountNote(displayPricing) ?? 'Membership or discount applied';
                const displayNote = isMembershipRelated ? `From your care plan — ${discountNote}` : discountNote;
                return (
                  <div key={`d-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
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
                        <span style={{ ...(isReplaced ? { textDecoration: 'line-through', color: '#888' } : !isChecked ? { color: '#888' } : { color: '#333' }) }}>
                          {item.name}
                          {qty > 1 && <span style={{ color: '#666', marginLeft: '6px', fontSize: '14px' }}>(Qty: {qty})</span>}
                          {isReplaced && <span style={{ fontSize: '13px', color: '#666', marginLeft: '8px', fontStyle: 'italic' }}>(replaced by {replacedByLabel})</span>}
                        </span>
                      </label>
                      <span style={{ fontWeight: 700, flexShrink: 0, ...(isReplaced ? { textDecoration: 'line-through', color: '#888' } : !isChecked ? { color: '#888' } : {}) }}>
                        {formatPrice(isChecked && !isReplaced ? lineTotal : 0)}
                      </span>
                    </div>
                    {isChecked && !isReplaced && hasPricingNote && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{displayNote}</div>}
                  </div>
                );
              };

              return (
                <div key={petIdx} style={{ marginBottom: '28px', padding: '20px', backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '8px' }}>
                  <h3 style={{ margin: 0, marginBottom: '14px', color: '#212529', fontSize: '18px', fontWeight: 700 }}>{petName}</h3>
                  <div style={{ borderBottom: '1px solid #e0e0e0', paddingBottom: '12px', marginBottom: '12px' }}>
                    {/* Procedures: uncheckable (visit/consult), trip fee/sharps, then checkable procedure items */}
                    {procedureDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {tripFeeItems.map((item: any, idx: number) => {
                      const searchableItem = item.searchableItem as SearchableItem | null | undefined;
                      const hasApiPricing = item.wellnessPlanPricing != null || item.discountPricing != null;
                      const tripPricing = hasApiPricing
                        ? { wellnessPlanPricing: item.wellnessPlanPricing ?? undefined, discountPricing: item.discountPricing ?? undefined }
                        : (searchableItem != null ? getClientPricing(patientId, searchableItem) : null);
                      const unitPrice = hasApiPricing ? (Number(item.price) ?? 0) : (searchableItem != null ? (getClientAdjustedPrice(patientId, searchableItem) ?? Number(item.price) ?? 0) : (Number(item.price) || 0));
                      const qty = Number(item.quantity) || 1;
                      const lineTotal = unitPrice * qty;
                      petSubtotal += lineTotal;
                      const hasTripDiscount = tripPricing?.wellnessPlanPricing?.hasCoverage && (tripPricing.wellnessPlanPricing.originalPrice !== tripPricing.wellnessPlanPricing.adjustedPrice) || (tripPricing?.wellnessPlanPricing as any)?.priceAdjustedByMembership || tripPricing?.discountPricing?.priceAdjustedByDiscount;
                      const tripQuantityUsedNote = tripPricing?.wellnessPlanPricing?.hasCoverage && tripPricing.wellnessPlanPricing.isWithinLimit === false;
                      const hasTripPricingNote = hasTripDiscount || tripQuantityUsedNote;
                      const isTripMembershipRelated = tripPricing?.wellnessPlanPricing?.hasCoverage && ((tripPricing.wellnessPlanPricing.originalPrice !== tripPricing.wellnessPlanPricing.adjustedPrice) || (tripPricing?.wellnessPlanPricing as any)?.priceAdjustedByMembership || tripQuantityUsedNote);
                      const tripDiscountNote = getDiscountNote(tripPricing) ?? 'Membership or discount applied';
                      const tripDisplayNote = isTripMembershipRelated ? `From your care plan — ${tripDiscountNote}` : tripDiscountNote;
                      return (
                        <div key={`t-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', color: '#666' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, margin: 0, cursor: 'default' }}>
                              <input
                                type="checkbox"
                                checked
                                disabled
                                readOnly
                                style={{ marginRight: '12px', width: '18px', height: '18px', flexShrink: 0, opacity: 0.6, accentColor: '#999' }}
                              />
                              <span style={{ flex: 1, color: '#666' }}>
                                {item.name}
                                {qty > 1 && <span style={{ color: '#666', marginLeft: '6px', fontSize: '14px' }}>(Qty: {qty})</span>}
                              </span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0 }}>{formatPrice(lineTotal)}</span>
                          </div>
                          {hasTripPricingNote && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{tripDisplayNote}</div>}
                        </div>
                      );
                    })}
                    {(procedureDisplay.length > 0 || tripFeeItems.length > 0) ? <SummarySeparator id={`p${petIdx}-after-procedures`} /> : null}
                    {/* Labs: care plan lab items + lab panels */}
                    {labDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {/* Lab panels selected - with checkbox (uncheck excludes from total but row stays so they can re-check) */}
                    {earlyDetectionYes && (getClientAdjustedPrice(patientId, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_early_detection_feline_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, earlyDetectionFelineItem) ?? getSearchItemPrice(earlyDetectionFelineItem)!;
                      const labPricing = getClientPricing(patientId, earlyDetectionFelineItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, true))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>Early Detection Panel - Feline</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {earlyDetectionCanineYes && (getClientAdjustedPrice(patientId, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_early_detection_canine_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, earlyDetectionCanineItem) ?? getSearchItemPrice(earlyDetectionCanineItem)!;
                      const labPricing = getClientPricing(patientId, earlyDetectionCanineItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, true))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>Early Detection Panel - Canine</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {formData[`lab_comprehensive_fecal_${patientId}`] === 'yes' && (getClientAdjustedPrice(patientId, comprehensiveFecalItem) ?? getSearchItemPrice(comprehensiveFecalItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_comprehensive_fecal_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, comprehensiveFecalItem) ?? getSearchItemPrice(comprehensiveFecalItem)!;
                      const compFecalName = comprehensiveFecalItem?.name ?? 'Comprehensive Fecal';
                      const labPricing = getClientPricing(patientId, comprehensiveFecalItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, true))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>{compFecalName}</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {seniorFelineYes && (getClientAdjustedPrice(patientId, seniorFelineItem) ?? getSearchItemPrice(seniorFelineItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_senior_feline_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, seniorFelineItem) ?? getSearchItemPrice(seniorFelineItem)!;
                      const labPricing = getClientPricing(patientId, seniorFelineItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, true))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>Senior Screen Feline</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {seniorCaninePanel === 'standard' && (getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_senior_canine_standard_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem)!;
                      const labPricing = getClientPricing(patientId, seniorCanineStandardItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, false))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>Senior Screen - Standard Comprehensive Panel</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {seniorCaninePanel === 'extended' && (getClientAdjustedPrice(patientId, seniorCanineExtendedItem) ?? getSearchItemPrice(seniorCanineExtendedItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_senior_canine_extended_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, seniorCanineExtendedItem) ?? getSearchItemPrice(seniorCanineExtendedItem)!;
                      const labPricing = getClientPricing(patientId, seniorCanineExtendedItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, true))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>Senior Screen - Extended Comprehensive Panel</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {seniorFelineTwoPanel === 'standard' && (getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem)) != null && (() => {
                      const key = `lab_senior_feline_two_panel_${patientId}`;
                      const p = getClientAdjustedPrice(patientId, seniorCanineStandardItem) ?? getSearchItemPrice(seniorCanineStandardItem)!;
                      const labPricing = getClientPricing(patientId, seniorCanineStandardItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked
                                disabled={readOnly}
                                onChange={() => {
                                  if (readOnly) return;
                                  handleInputChange(key, 'no');
                                  replacedItemRecKeys.forEach((recKey) => handleInputChange(recKey, true));
                                }}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ color: '#333' }}>Senior Screen Feline - Standard Panel</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0 }}>{formatPrice(p)}</span>
                          </div>
                          {hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {seniorFelineTwoPanel === 'extended' && (getClientAdjustedPrice(patientId, seniorFelineExtendedItem) ?? getSearchItemPrice(seniorFelineExtendedItem)) != null && (() => {
                      const summaryExcludeKey = `summary_exclude_lab_senior_feline_two_extended_${patientId}`;
                      const isExcluded = formData[summaryExcludeKey] === true;
                      const p = getClientAdjustedPrice(patientId, seniorFelineExtendedItem) ?? getSearchItemPrice(seniorFelineExtendedItem)!;
                      const labPricing = getClientPricing(patientId, seniorFelineExtendedItem);
                      const hasDiscount = labPricing?.wellnessPlanPricing?.hasCoverage && (labPricing.wellnessPlanPricing.originalPrice !== labPricing.wellnessPlanPricing.adjustedPrice) || labPricing?.discountPricing?.priceAdjustedByDiscount;
                      if (!isExcluded) petSubtotal += p;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={readOnly}
                                onChange={() => !readOnly && (isExcluded ? includePanelOnSummary(summaryExcludeKey) : excludePanelOnSummary(summaryExcludeKey, true))}
                                style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>Senior Screen Feline - Extended Panel</span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>{formatPrice(isExcluded ? 0 : p)}</span>
                          </div>
                          {!isExcluded && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(labPricing) ?? 'Membership or discount applied'}</div>}
                        </div>
                      );
                    })()}
                    {(labDisplay.length > 0 || earlyDetectionYes || earlyDetectionCanineYes || formData[`lab_comprehensive_fecal_${patientId}`] === 'yes' || seniorFelineYes || seniorCaninePanel || seniorFelineTwoPanel) ? <SummarySeparator id={`p${petIdx}-after-labs`} /> : null}
                    {/* Inventory */}
                    {inventoryDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {(patientId != null && optedInVaccinesByPatientId[patientId] && Object.keys(optedInVaccinesByPatientId[patientId]).length > 0 && (procedureDisplay.length > 0 || tripFeeItems.length > 0 || labDisplay.length > 0 || inventoryDisplay.length > 0 || earlyDetectionYes || earlyDetectionCanineYes || formData[`lab_comprehensive_fecal_${patientId}`] === 'yes' || seniorFelineYes || seniorCaninePanel || seniorFelineTwoPanel)) ? <SummarySeparator id={`p${petIdx}-before-vaccines`} /> : null}
                    {/* Vaccines */}
                    {(patientId != null ? optedInVaccinesByPatientId[patientId] : undefined) && (() => {
                      const optedIn = optedInVaccinesByPatientId[patientId];
                      const entries = optedIn ? (Object.entries(optedIn).filter(([, it]) => it) as [VaccineOptKey, SearchableItem][]) : [];
                      return entries.map(([vaccineKey, item], i: number) => {
                        const vaccineSummaryKey = `summary_vaccine_${patientId}_${vaccineKey}`;
                        const isChecked = formData[vaccineSummaryKey] !== false;
                        const p = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item);
                        const price = p != null ? p : 0;
                        const vaccinePricing = getClientPricing(patientId, item);
                        const hasDiscount = vaccinePricing?.wellnessPlanPricing?.hasCoverage && (vaccinePricing.wellnessPlanPricing.originalPrice !== vaccinePricing.wellnessPlanPricing.adjustedPrice) || vaccinePricing?.discountPricing?.priceAdjustedByDiscount;
                        if (isChecked) petSubtotal += price;
                        return (
                          <div key={`v-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={readOnly}
                                  onChange={() => handleInputChange(vaccineSummaryKey, !isChecked)}
                                  style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                                />
                                <span style={{ ...(isChecked ? { color: '#333' } : { textDecoration: 'line-through', color: '#888' }) }}>{item.name ?? 'Vaccine'}</span>
                              </label>
                              <span style={{ fontWeight: 700, flexShrink: 0, ...(isChecked ? {} : { textDecoration: 'line-through', color: '#888' }) }}>{formatPrice(isChecked ? price : 0)}</span>
                            </div>
                            {isChecked && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(vaccinePricing) ?? 'Membership or discount applied'}</div>}
                          </div>
                        );
                      });
                    })()}
                    {(patientId != null && optedInVaccinesByPatientId[patientId] && Object.keys(optedInVaccinesByPatientId[patientId]).length > 0) ? <SummarySeparator id={`p${petIdx}-after-vaccines`} /> : null}
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
                            const price = getClientAdjustedPrice(patientId, item) ?? getSearchItemPrice(item) ?? 0;
                            const commonPricing = getClientPricing(patientId, item);
                            const hasDiscount = commonPricing?.wellnessPlanPricing?.hasCoverage && (commonPricing.wellnessPlanPricing.originalPrice !== commonPricing.wellnessPlanPricing.adjustedPrice) || commonPricing?.discountPricing?.priceAdjustedByDiscount;
                            if (isChecked) petSubtotal += price;
                            return (
                              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
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
                                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{formatPrice(price)}</span>
                                </div>
                                {isChecked && hasDiscount && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{getDiscountNote(commonPricing) ?? 'Membership or discount applied'}</div>}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                  {patients.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '15px', fontWeight: 600, color: '#333' }}>
                      Subtotal: <strong>{formatPrice(petSubtotal)}</strong>
                    </div>
                  )}
                  {(() => { grandTotal += petSubtotal; return null; })()}
                </div>
              );
            })}

            {/* Store search - type-ahead, add products to Additional items (below pets) */}
            <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#212529', marginBottom: '8px' }}>Add medications or preventatives</div>
              <p style={{ fontSize: '14px', lineHeight: 1.5, color: '#555', marginBottom: '12px', marginTop: 0 }}>
                If you'd like us to bring additional items, you can search and add them here. This is a great place to include flea/tick or heartworm prevention, chronic medications, or other products you know your pet needs.
              </p>
              {patients.length > 0 && (
                <p style={{ fontSize: '14px', color: '#555', marginBottom: '12px', marginTop: 0 }}>
                  Pet weight{patients.length > 1 ? 's' : ''}: {patients.map((p: any, i: number) => {
                    const name = p.patientName || `Pet ${i + 1}`;
                    const w = p.weight ?? p.patient?.weight ?? p.currentWeight;
                    const weightStr = w != null && w !== '' ? (typeof w === 'number' ? `${w} lbs` : String(w).replace(/\s*lb(s)?\s*$/i, '') + ' lbs') : '—';
                    return <span key={i}>{i > 0 ? '; ' : ''}{name}: {weightStr}</span>;
                  })}
                </p>
              )}
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
                    return (
                      <li
                        key={productName}
                        onClick={() => {
                        if (readOnly) return;
                        setStoreOptionModalGroup(items);
                        setStoreSearchQuery('');
                      }}
                        style={{ padding: '10px 12px', borderBottom: '1px solid #eee', cursor: readOnly ? 'default' : 'pointer', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(readOnly ? { opacity: 0.85 } : {}) }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e7f1ff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                      >
                        <span>{productName}</span>
                        <span style={{ fontWeight: 600 }}>{items.length > 1 ? <>from <strong>${minPrice.toFixed(2)}</strong></> : <strong>${minPrice.toFixed(2)}</strong>}</span>
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
                    {getStoreModalRows(storeOptionModalGroup).map(({ key, label, price, item }, idx) => (
                      <li
                        key={`${key}-${label}-${price}-${idx}`}
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
                          <strong>{formatPrice(price)}</strong>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                              if (readOnly) return;
                              setStoreAdditionalItems((prev) => [...prev, item]);
                              setStoreOptionModalGroup(null);
                              setStoreSearchQuery('');
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
                          <span style={{ fontWeight: 700 }}>{formatPrice(Number(item.price))}</span>
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

            <div className="public-room-loader-summary-total-row" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '3px solid #e0e0e0' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#212529' }}>Estimated Total Due At Visit: <strong>{formatPrice(grandTotal)}</strong></span>
            </div>

            {fieldValidationErrors._submit && (
              <p style={{ marginTop: '16px', marginBottom: 0, fontSize: '14px', color: '#dc3545' }}>{fieldValidationErrors._submit}</p>
            )}
            <div className="public-room-loader-summary-actions">
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={() => setCurrentPage(labsPageIndex)}
                style={{
                  backgroundColor: '#fff',
                  color: '#333',
                  border: '1px solid #ced4da',
                }}
              >
                ← Back to Labs
              </button>
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={(e) => {
                  e.preventDefault();
                  handleSubmit();
                }}
                disabled={submitting || readOnly}
                style={{
                  backgroundColor: submitting || readOnly ? '#adb5bd' : '#0d6efd',
                  color: '#fff',
                  border: 'none',
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
