/**
 * Wave 8A (bug 2): a line can come back only as many times as it was sold, counting earlier
 * returns. The server sends how many of each line already came back (`returnedQty` in the
 * return options); the return screen offers only the rest and prices the refund from it.
 */
export function returnableQty(
  line: { qty: number | string | null | undefined },
  options?: { returnedQty?: number | null } | null
): number {
  const sold = Math.abs(Number(line.qty) || 0);
  const back = Math.abs(Number(options?.returnedQty) || 0);
  return Math.max(0, Math.round((sold - back) * 1e4) / 1e4);
}

/** What the refund estimate should count for a line: what was typed, never more than is left. */
export function clampReturnQty(entered: string | number | null | undefined, returnable: number): number {
  const n = Number(entered || 0);
  if (!(n > 0)) return 0;
  return Math.min(n, returnable);
}

/** The message when someone types more than can come back, or null. */
export function returnQtyProblem(
  description: string | null | undefined,
  entered: string | number | null | undefined,
  line: { qty: number | string | null | undefined },
  options?: { returnedQty?: number | null } | null
): string | null {
  const n = Number(entered || 0);
  if (!(n > 0)) return null;
  const left = returnableQty(line, options);
  if (n <= left + 0.0001) return null;
  const back = Math.abs(Number(options?.returnedQty) || 0);
  const label = description || 'Item';
  return back > 0
    ? `${label}: ${back} already returned, so at most ${left} can come back.`
    : `${label}: at most ${left} can come back.`;
}
