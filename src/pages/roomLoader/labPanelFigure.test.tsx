// Owner request Oct 31, 2026: a lab question shows its sample-results picture once, in the upper
// right beside the intro, not inside each panel option.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LabPanelsSection, { panelQuestionFigure } from './LabPanelsSection';
import type { RoomLoaderPanelOption, RoomLoaderPanelRule } from '../../utils/roomLoaderConfigTypes';

function option(id: string, name: string, imageUrl: string | null): RoomLoaderPanelOption {
  return {
    id,
    displayName: name,
    item: { itemType: 'lab', itemId: id === 'std' ? 1 : 2, code: id.toUpperCase(), name },
    descriptionHtml: `<p>${name} details</p>`,
    imageUrl,
    imageCaption: '',
    subAsks: [],
    replacesItems: [],
  } as unknown as RoomLoaderPanelOption;
}

function rule(options: RoomLoaderPanelOption[]): RoomLoaderPanelRule {
  return {
    id: 'r1',
    label: 'Senior',
    enabled: true,
    species: ['dog'],
    age: { minMonths: 0, maxMonths: null },
    introHtml: '<p>Nala is due for lab work.</p>',
    concernIntroHtml: '',
    closingHtml: '',
    concernClosingHtml: '',
    options,
    sortOrder: 0,
  } as unknown as RoomLoaderPanelRule;
}

const ctx = { species: 'dog', ageMonths: 100, history: [], reminders: [], estimateLines: [], outdoorAccess: null, medicalConcern: false } as never;

function renderPanels(r: RoomLoaderPanelRule, sample: { imageUrl: string; imageCaption: string } | null = null) {
  return render(
    <LabPanelsSection
      petKey="pet0"
      petName="Nala"
      rules={[r]}
      ctx={ctx}
      formData={{}}
      onChange={() => {}}
      priceFor={() => null}
      labsPageSample={sample}
    />,
  );
}

describe('lab question picture', () => {
  it('two panels: one picture, in the upper-right intro area, none inside the options', () => {
    const { container } = renderPanels(rule([option('std', 'Standard', '/trend.png'), option('ext', 'Extended', null)]));
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('/trend.png');
    expect(imgs[0].closest('.rl-panel__figure--side')).not.toBeNull();
    expect(imgs[0].closest('.rl-option')).toBeNull();
    const prose = container.querySelector('.rl-panel__prose');
    const options = container.querySelector('.rl-panel__options');
    expect(prose?.contains(imgs[0])).toBe(true);
    expect(prose!.compareDocumentPosition(options!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no option picture: uses the Labs page sample picture once', () => {
    const { container } = renderPanels(rule([option('std', 'Standard', null), option('ext', 'Extended', null)]), {
      imageUrl: '/sample.png',
      imageCaption: 'How values trend over time',
    });
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('/sample.png');
  });

  it('no picture anywhere: none shown', () => {
    expect(panelQuestionFigure([option('std', 'Standard', null)], null)).toBeNull();
    const { container } = renderPanels(rule([option('std', 'Standard', null), option('ext', 'Extended', null)]));
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('single panel keeps its one upper-right picture', () => {
    const { container } = renderPanels(rule([option('std', 'Standard', '/trend.png')]));
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].closest('.rl-panel__figure--side')).not.toBeNull();
  });
});
