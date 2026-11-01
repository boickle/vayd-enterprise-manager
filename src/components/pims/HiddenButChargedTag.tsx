import { isHiddenFromClient } from '../../utils/invoiceEmail';

export const HIDDEN_BUT_CHARGED_TEXT = 'Normally hidden: shown to client because it has a charge';

/** True for a "Hide on invoice" line that has money on it (so the client sees it). */
export function isHiddenButCharged(line: {
  hideOnInvoice?: boolean | null;
  amount: number | string | null | undefined;
}): boolean {
  if (line.hideOnInvoice !== true) return false;
  return !isHiddenFromClient({ hideOnInvoice: true, amount: line.amount ?? null });
}

/** Staff-only tag; renders nothing unless the line is hidden-on-invoice but charged. */
export function HiddenButChargedTag({
  line,
  className,
}: {
  line: { hideOnInvoice?: boolean | null; amount: number | string | null | undefined };
  className?: string;
}) {
  if (!isHiddenButCharged(line)) return null;
  return (
    <span className={className} data-testid="hidden-but-charged-tag" title={HIDDEN_BUT_CHARGED_TEXT}>
      {HIDDEN_BUT_CHARGED_TEXT}
    </span>
  );
}
