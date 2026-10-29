import type { InventoryShipmentLine } from '../../api/inventoryOps';

type HintLine = Pick<
  InventoryShipmentLine,
  | 'isNewItem'
  | 'costAction'
  | 'costPerUnit'
  | 'catalogCost'
  | 'catalogPrice'
  | 'newPrice'
  | 'increasePct'
  | 'increaseLimitPct'
  | 'linkedProductCount'
>;

const money = (n: number, places: number) => `$${n.toFixed(places)}`;

/** What finalizing will do with this line's cost, in words staff can act on before they finalize. */
export function receiveLineCostHint(line: HintLine): { tone: 'info' | 'ok' | 'warn'; text: string } | null {
  if (line.isNewItem) {
    return { tone: 'info', text: 'New item — practice manager will review on Cost Reviews' };
  }
  const invoice = line.costPerUnit != null ? Number(line.costPerUnit) : null;
  switch (line.costAction) {
    case 'update': {
      const cost =
        line.catalogCost != null && invoice != null
          ? `cost ${money(Number(line.catalogCost), 4)} → ${money(invoice, 4)}`
          : null;
      const linked = Number(line.linkedProductCount ?? 0);
      const linkedText =
        linked > 0 ? ` (and ${linked} linked product${linked === 1 ? '' : 's'})` : '';
      if (line.catalogPrice != null && line.newPrice != null) {
        const price = `${money(Number(line.catalogPrice), 2)} → ${money(Number(line.newPrice), 2)}`;
        return {
          tone: 'ok',
          text: `Will update price ${price}${linkedText}${cost ? ` · ${cost}` : ''}`,
        };
      }
      return { tone: 'ok', text: `Will update ${cost ?? 'cost'}${linkedText}` };
    }
    case 'review_large': {
      const limit = line.increaseLimitPct ?? 15;
      const pct = line.increasePct != null ? ` (+${Math.round(line.increasePct).toLocaleString('en-US')}%)` : '';
      return {
        tone: 'warn',
        text: `Over ${limit}%${pct} above the catalog cost — goes to Cost Reviews, prices unchanged`,
      };
    }
    case 'review_new':
      return {
        tone: 'warn',
        text: 'No catalog cost yet — goes to Cost Reviews, prices unchanged',
      };
    case 'review_lower':
      return { tone: 'warn', text: 'Lower than catalog — manager will review on Cost Reviews' };
    default:
      return null;
  }
}

const COLORS = { info: '#075985', ok: '#2e7d32', warn: '#9a3412' } as const;

export default function ReceiveLineCostHint({ line }: { line: HintLine }) {
  const hint = receiveLineCostHint(line);
  if (!hint) return null;
  return (
    <div
      className="receive-line-cost-hint"
      style={{
        marginTop: 2,
        fontSize: 13,
        fontWeight: hint.tone === 'ok' ? 600 : undefined,
        color: COLORS[hint.tone],
      }}
    >
      {hint.text}
    </div>
  );
}

/** The message after finalizing, naming costs that were held back so nobody wonders why a price didn't move. */
export function finalizeToastMessage(
  lines: Array<Pick<InventoryShipmentLine, 'costAction' | 'isNewItem'>>
): string {
  const base =
    'Shipment finalized — stock updated. You can upload another invoice. Lower costs go to Cost Reviews.';
  const held = lines.filter((l) => !l.isNewItem);
  const large = held.filter((l) => l.costAction === 'review_large').length;
  const noCost = held.filter((l) => l.costAction === 'review_new').length;
  const parts: string[] = [];
  if (large > 0) {
    parts.push(`${large} price increase${large === 1 ? ' is' : 's are'} waiting in Cost Reviews`);
  }
  if (noCost > 0) {
    parts.push(
      `${noCost} item${noCost === 1 ? '' : 's'} with no catalog cost ${noCost === 1 ? 'is' : 'are'} waiting in Cost Reviews`
    );
  }
  if (parts.length === 0) return base;
  return `${base} ${parts.join('; ')} — prices stay the same until a manager applies them.`;
}
