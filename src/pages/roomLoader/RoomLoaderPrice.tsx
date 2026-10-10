import type { ReactNode } from 'react';

export type RoomLoaderPriceFor = (item: { itemType: string; itemId: number }) => ReactNode;

export const MEMBERSHIP_ALLOTMENT_USED_LABEL = 'Membership allotment has been used this year already';

export function formatRoomLoaderMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Catalog list price, with the membership/discount amount beside it when they differ. */
export function roomLoaderPriceLabel(
  list: number | null | undefined,
  adjusted: number | null | undefined,
  opts?: { allotmentUsed?: boolean }
): ReactNode {
  const listN = list != null && Number.isFinite(list) ? Number(list) : null;
  const adjN = adjusted != null && Number.isFinite(adjusted) ? Number(adjusted) : null;
  const shown = adjN ?? listN;
  if (shown == null) return null;
  if (opts?.allotmentUsed) {
    return (
      <>
        {listN != null && listN - shown > 0.005 ? (
          <s className="rl-price__was">{formatRoomLoaderMoney(listN)}</s>
        ) : null}
        {formatRoomLoaderMoney(shown)}
        <span className="rl-price__allotment"> {MEMBERSHIP_ALLOTMENT_USED_LABEL}</span>
      </>
    );
  }
  if (listN != null && adjN != null && listN - adjN > 0.005) {
    return (
      <>
        <s className="rl-price__was">{formatRoomLoaderMoney(listN)}</s>
        {adjN <= 0.005 ? (
          <span className="rl-price__covered">Included in membership</span>
        ) : (
          formatRoomLoaderMoney(adjN)
        )}
      </>
    );
  }
  if (adjN != null && adjN <= 0.005 && (listN == null || listN <= 0.005)) {
    return <span className="rl-price__covered">Included in membership</span>;
  }
  return formatRoomLoaderMoney(shown);
}
