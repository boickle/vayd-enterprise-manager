/** Lab codes that do not trigger a sharps disposal line. */
export const SHARPS_EXEMPT_LAB_CODES = new Set(['FIL24639', 'FIL5010']);

export function labCodeRequiresSharpsDisposal(code: string | null | undefined): boolean {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return true;
  return !SHARPS_EXEMPT_LAB_CODES.has(c);
}

/** Inventory categories that mean a needle was used — Room Loader + SOAP checkout both use this. */
export function inventoryCategoryRequiresSharpsDisposal(
  categoryName: string | null | undefined
): boolean {
  const n = (categoryName ?? '').trim().toLowerCase();
  return n === 'vaccines' || n === 'injections' || n === 'injectable' || n === 'injectables';
}

export function isVaccineInventoryCategory(categoryName: string | null | undefined): boolean {
  return (categoryName ?? '').trim().toLowerCase() === 'vaccines';
}
