// Room loader test plan RL-15: a panel whose own item staff already put on the check-in is not charged twice.
import { describe, expect, it } from 'vitest';
import { estimateLinesReplacedByPanel, type EngineEstimateLine } from './roomLoaderOfferEngine';
import { vaydRoomLoaderConfigSeed } from './roomLoaderConfigSeed';
import { panelReplacementLabels } from '../pages/roomLoader/roomLoaderConfigPlan';

const config = vaydRoomLoaderConfigSeed();
const option = (id: string) => {
  for (const rule of config.panelRules) {
    const found = rule.options.find((o) => o.id === id);
    if (found) return found;
  }
  throw new Error(`no option ${id}`);
};

// The staff line a "Senior Screen" reminder puts on the check-in: the same catalog item as the senior Standard panel.
const seniorScreenLine: EngineEstimateLine = {
  itemType: 'lab',
  itemId: 128,
  code: 'FIL8659999',
} as EngineEstimateLine;
const trip: EngineEstimateLine = { itemType: 'procedure', itemId: 9, code: 'CVTIER1TRIPFEE' } as EngineEstimateLine;

describe('RL-15 a panel replaces a staff line for its own item', () => {
  it.each(['opt_senior_basic', 'opt_senior_cat_std'])('%s absorbs the staff Senior Screen line', (id) => {
    expect(estimateLinesReplacedByPanel(option(id), [seniorScreenLine, trip])).toEqual([seniorScreenLine]);
  });

  it('matches by code when the staff line has no catalog id', () => {
    const byCode = { code: 'fil8659999' } as EngineEstimateLine;
    expect(estimateLinesReplacedByPanel(option('opt_senior_basic'), [byCode])).toEqual([byCode]);
  });

  it('labels the absorbed line with the panel, so the summary lists it once', () => {
    const labels = panelReplacementLabels([option('opt_senior_cat_std')], [seniorScreenLine, trip]);
    expect(labels.size).toBeGreaterThan(0);
    expect([...labels.values()].every((l) => l === (option('opt_senior_cat_std').displayName || 'Senior Screen (chem 25, CBC, T4, UA)'))).toBe(true);
  });

  it('leaves unrelated staff lines alone', () => {
    expect(estimateLinesReplacedByPanel(option('opt_senior_basic'), [trip])).toEqual([]);
  });
});
