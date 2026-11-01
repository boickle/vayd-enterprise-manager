import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BundleGroupEditor, {
  bundleGroupDraftsFrom,
  bundleGroupDraftsToInput,
  type BundleGroupDraft,
} from './BundleGroupEditor';
import type { Bundle } from '../../api/memberships';

function bundle(kind: 'bundle' | 'membership'): Bundle {
  const item = (id: number, name: string, bundlePrice: number | null) => ({
    id,
    itemType: 'inventory' as const,
    catalogItemId: 500 + id,
    name,
    code: null,
    catalogPrice: 24.38,
    quantity: 1,
    coverage: 'included' as const,
    copayPrice: bundlePrice,
    bundlePrice: kind === 'bundle' ? bundlePrice : null,
    percentOff: null,
    productionBasis: 'full_price' as const,
    productionOverride: null,
    sortOrder: id,
    note: null,
  });
  return {
    id: 1,
    kind,
    groups: [
      {
        id: 1,
        name: 'Always included',
        description: null,
        selectionMode: 'all',
        allowedQuantity: 1,
        isRequired: true,
        sortOrder: 0,
        items: [item(1, 'Telazol', 0), item(2, 'Butorphanol', null)],
      },
    ],
  } as unknown as Bundle;
}

let latest: BundleGroupDraft[] = [];

function Harness({ source, context }: { source: Bundle; context: 'bundle' | 'membership' }) {
  const [groups, setGroups] = useState(() => bundleGroupDraftsFrom(source));
  latest = groups;
  return <BundleGroupEditor practiceId={1} groups={groups} onChange={setGroups} context={context} />;
}

describe('bundle item price field', () => {
  it('shows on bundles, pre-filled with the stored 0, blank when unset', () => {
    render(<Harness source={bundle('bundle')} context="bundle" />);
    const inputs = screen.getAllByPlaceholderText('list price') as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['0', '']);
  });

  it('does not show on membership plans', () => {
    render(<Harness source={bundle('membership')} context="membership" />);
    expect(screen.queryByText('Bundle price')).toBeNull();
    expect(screen.queryByPlaceholderText('list price')).toBeNull();
  });

  it('clearing sends null, entering 0 sends 0, entering a number sends it', () => {
    render(<Harness source={bundle('bundle')} context="bundle" />);
    const [first, second] = screen.getAllByPlaceholderText('list price') as HTMLInputElement[];
    fireEvent.change(first, { target: { value: '' } });
    fireEvent.change(second, { target: { value: '0' } });
    let sent = bundleGroupDraftsToInput(latest)[0].items.map((i) => i.bundlePrice);
    expect(sent).toEqual([null, 0]);
    fireEvent.change(first, { target: { value: '12.50' } });
    sent = bundleGroupDraftsToInput(latest)[0].items.map((i) => i.bundlePrice);
    expect(sent).toEqual([12.5, 0]);
  });

  it('membership input does not carry a bundle price', () => {
    const drafts = bundleGroupDraftsFrom(bundle('membership'));
    expect(bundleGroupDraftsToInput(drafts, 'membership')[0].items[0]).not.toHaveProperty('bundlePrice');
  });
});
