/**
 * INV-01-9 and INV-01-10: the Receive screen says what finalizing will do with each cost
 * (owner decision D1: up to +15% updates prices, more goes to Cost Reviews), and the toast
 * after finalizing names anything held back.
 */
import { render, screen } from '@testing-library/react';

import ReceiveLineCostHint, {
  finalizeToastMessage,
  receiveLineCostHint,
} from './ReceiveLineCostHint';
import type { InventoryShipmentLine } from '../../api/inventoryOps';

const line = (over: Partial<InventoryShipmentLine>): InventoryShipmentLine =>
  ({
    id: 1,
    shipmentId: 1,
    inventoryItemId: 1,
    quantity: 180,
    costPerUnit: 0.33,
    catalogCost: 0.3,
    catalogPrice: 0.75,
    newPrice: null,
    costAction: 'none',
    increasePct: null,
    increaseLimitPct: 15,
    linkedProductCount: 0,
    ...over,
  }) as InventoryShipmentLine;

function Lines({ lines }: { lines: InventoryShipmentLine[] }) {
  return (
    <ul>
      {lines.map((l) => (
        <li key={l.id}>
          <ReceiveLineCostHint line={l} />
        </li>
      ))}
    </ul>
  );
}

describe('INV-01-9: line hints', () => {
  it('shows the new price and how many linked products move for a line under the limit', () => {
    render(
      <Lines
        lines={[
          line({
            id: 1,
            costAction: 'update',
            costPerUnit: 0.33,
            catalogCost: 0.3,
            catalogPrice: 0.75,
            newPrice: 0.83,
            increasePct: 10,
            linkedProductCount: 3,
          }),
        ]}
      />
    );
    expect(
      screen.getByText(/Will update price \$0\.75 → \$0\.83 \(and 3 linked products\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/cost \$0\.3000 → \$0\.3300/)).toBeInTheDocument();
  });

  it('says a line over the limit goes to Cost Reviews and leaves prices alone', () => {
    render(
      <Lines
        lines={[
          line({
            id: 2,
            costAction: 'review_large',
            costPerUnit: 54,
            increasePct: 17900,
            increaseLimitPct: 15,
          }),
        ]}
      />
    );
    const hint = screen.getByText(/Over 15%/);
    expect(hint).toHaveTextContent('+17,900%');
    expect(hint).toHaveTextContent('goes to Cost Reviews, prices unchanged');
    expect(screen.queryByText(/Will update price/)).not.toBeInTheDocument();
  });

  it('shows both kinds of line in one shipment', () => {
    render(
      <Lines
        lines={[
          line({ id: 1, costAction: 'update', newPrice: 0.83, linkedProductCount: 1 }),
          line({ id: 2, costAction: 'review_large', increasePct: 40 }),
        ]}
      />
    );
    expect(screen.getByText(/Will update price \$0\.75 → \$0\.83 \(and 1 linked product\)/)).toBeInTheDocument();
    expect(screen.getByText(/Over 15%/)).toBeInTheDocument();
  });

  it('says a first cost with nothing to compare goes to review', () => {
    render(<Lines lines={[line({ costAction: 'review_new', catalogCost: null })]} />);
    expect(
      screen.getByText('No catalog cost yet — goes to Cost Reviews, prices unchanged')
    ).toBeInTheDocument();
  });

  it('keeps the lower-cost and new-item messages', () => {
    expect(receiveLineCostHint(line({ costAction: 'review_lower' }))?.text).toBe(
      'Lower than catalog — manager will review on Cost Reviews'
    );
    expect(receiveLineCostHint(line({ isNewItem: true, costAction: 'update' }))?.text).toBe(
      'New item — practice manager will review on Cost Reviews'
    );
  });

  it('shows nothing when the cost is unchanged', () => {
    const { container } = render(<Lines lines={[line({ costAction: 'none' })]} />);
    expect(container.querySelector('.receive-line-cost-hint')).toBeNull();
  });
});

describe('INV-01-10: finalize toast', () => {
  it('names a held price increase', () => {
    const msg = finalizeToastMessage([line({ costAction: 'review_large' })]);
    expect(msg).toContain('1 price increase is waiting in Cost Reviews');
    expect(msg).toContain('prices stay the same until a manager applies them');
    expect(msg).toContain('Shipment finalized');
  });

  it('counts several, and items with no catalog cost', () => {
    const msg = finalizeToastMessage([
      line({ id: 1, costAction: 'review_large' }),
      line({ id: 2, costAction: 'review_large' }),
      line({ id: 3, costAction: 'review_new' }),
    ]);
    expect(msg).toContain('2 price increases are waiting in Cost Reviews');
    expect(msg).toContain('1 item with no catalog cost is waiting in Cost Reviews');
  });

  it('stays the plain message when nothing was held', () => {
    const msg = finalizeToastMessage([
      line({ id: 1, costAction: 'update' }),
      line({ id: 2, costAction: 'review_lower' }),
    ]);
    expect(msg).toBe(
      'Shipment finalized — stock updated. You can upload another invoice. Lower costs go to Cost Reviews.'
    );
  });

  it('does not double-count a brand-new item, which has its own review', () => {
    expect(finalizeToastMessage([line({ isNewItem: true, costAction: 'review_new' })])).not.toContain(
      'waiting'
    );
  });
});
