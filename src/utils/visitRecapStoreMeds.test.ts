import { describe, expect, it } from 'vitest';
import { ensureRecapFarewell, insertBeforeFarewell } from './visitRecapSender';

const block = { html: '<div id="meds">BLOCK</div>', text: 'Order Biscuit\'s medications anytime' };

describe('insertBeforeFarewell (chronic-med store block in the recap)', () => {
  it('goes above the added "Take care," closing', () => {
    const closed = ensureRecapFarewell({ html: '<p>Hi Sarah,</p><p>Biscuit did great.</p>', text: 'Hi Sarah,\n\nBiscuit did great.' });
    const out = insertBeforeFarewell(closed, block);
    expect(out.html.indexOf('BLOCK')).toBeLessThan(out.html.indexOf('Take care,'));
    expect(out.html.indexOf('Biscuit did great')).toBeLessThan(out.html.indexOf('BLOCK'));
    expect(out.text).toBe("Hi Sarah,\n\nBiscuit did great.\n\nOrder Biscuit's medications anytime\n\nTake care,");
  });

  it("goes above the doctor's own closing paragraph", () => {
    const out = insertBeforeFarewell(
      { html: '<p>Biscuit did great.</p><p>Warmly,</p>', text: 'Biscuit did great.\n\nWarmly,' },
      block
    );
    expect(out.html).toBe('<p>Biscuit did great.</p><div id="meds">BLOCK</div><p>Warmly,</p>');
  });

  it('changes nothing without a block', () => {
    const closed = { html: '<p>x</p>', text: 'x' };
    expect(insertBeforeFarewell(closed, null)).toBe(closed);
  });
});
