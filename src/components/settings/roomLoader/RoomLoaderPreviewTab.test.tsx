// Settings → Room Loader → Preview & wording: the sample pet changes what is offered, and a
// wording edit shows in the preview straight away (and lands in the settings that get saved).
// The offered list names the catalog item behind each line and counts one panel of a
// choose-one set; each item question says when it is asked and can be turned off.
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { vaydRoomLoaderConfigSeed } from '../../../utils/roomLoaderConfigSeed';
import type { RoomLoaderConfig } from '../../../utils/roomLoaderConfigTypes';

vi.mock('../../../utils/roomLoaderCatalogPrice', () => ({
  fetchCatalogListPrice: vi.fn(async () => 10),
}));
vi.mock('../../messageTemplates/MessageTemplateHtmlEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="html-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('../../../pages/roomLoader/LabPanelsSection', () => ({ default: () => null }));

import RoomLoaderPreviewTab from './RoomLoaderPreviewTab';

let latest: RoomLoaderConfig | null = null;

function Harness() {
  const [config, setConfig] = useState<RoomLoaderConfig | null>(vaydRoomLoaderConfigSeed());
  latest = config;
  if (!config) return null;
  return (
    <RoomLoaderPreviewTab
      practiceId={1}
      config={config}
      setConfig={setConfig}
      onOpenAdvanced={() => {}}
    />
  );
}

describe('RoomLoaderPreviewTab', () => {
  it('offers FeLV Initial to an outdoor adult cat', async () => {
    render(<Harness />);
    expect(await screen.findByText(/What Maple is offered/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Cat' }));
    fireEvent.click(screen.getByRole('radio', { name: /Adult/ }));
    const outdoor = (await screen.findByText('Outdoor question')).closest('section') as HTMLElement;
    fireEvent.click(within(outdoor).getByLabelText('Yes'));
    const sidebar = (await screen.findByText(/What Juniper is offered/)).closest(
      'aside'
    ) as HTMLElement;
    expect(await within(sidebar).findByText(/adds: FeLV.*Initial \(FELVINIT\)/i)).toBeTruthy();
  });

  it('shows a wording edit in the preview and in the settings to save', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Cat' }));
    const outdoor = (await screen.findByText('Outdoor question')).closest('section') as HTMLElement;
    fireEvent.click(within(outdoor).getByRole('button', { name: /edit wording/i }));
    const box = outdoor.querySelector('textarea.rl-prev__textarea') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Does {petName} ever go outside?' } });
    expect(await within(outdoor).findByText(/Does Juniper ever go outside\?/)).toBeTruthy();
    expect(latest?.outdoor.questionText).toBe('Does {petName} ever go outside?');
  });

  it('names the catalog item each offer adds', async () => {
    render(<Harness />);
    const sidebar = (await screen.findByText(/What Maple is offered/)).closest(
      'aside'
    ) as HTMLElement;
    expect(
      within(sidebar).getByText(/adds: crLyme Vaccine - Initial \(LYMECRINITIAL\)/)
    ).toBeTruthy();
  });

  it('counts one panel where the client picks one', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Cat' }));
    fireEvent.click(screen.getByRole('radio', { name: /Senior/ }));
    const sidebar = (await screen.findByText(/What Juniper is offered/)).closest(
      'aside'
    ) as HTMLElement;
    expect(within(sidebar).getByText(/Client picks one/)).toBeTruthy();
    const inPick = sidebar.querySelectorAll('li.rl-prev__in-pick-one').length;
    const rows = sidebar.querySelectorAll('li:not(.rl-prev__pick-one)').length;
    expect(inPick).toBeGreaterThan(1);
    // Every catalog price is $10 here: the pick-one set counts once.
    const expected = (rows - inPick + 1) * 10;
    await waitFor(() =>
      expect(sidebar.querySelector('.rl-prev__offered-total strong')?.textContent).toBe(
        `$${expected.toFixed(2)}`
      )
    );
  });

  it('says when an item question is asked, and can turn it off', async () => {
    render(<Harness />);
    const block = (await screen.findByText('Questions about items on the visit')).closest(
      'section'
    ) as HTMLElement;
    expect(
      within(block).getByText(
        /Asked when staff put crLyme Vaccine - Initial on the visit, and only if Maple has never had crLyme Vaccine - Initial, crLyme Vaccine - Annual/
      )
    ).toBeTruthy();
    fireEvent.click(within(block).getByLabelText(/Ask “crLyme booster appointment”/));
    expect(within(block).getByText(/Off: clients are not asked this/)).toBeTruthy();
    expect(within(block).queryByText(/schedule Maple a booster appointment/)).toBeNull();
    expect(latest?.itemQuestions.find((q) => q.id === 'ask_crlyme_booster')?.enabled).toBe(false);
  });

  it('no longer has the cat rabies 1-year vs 3-year question by default', () => {
    expect(vaydRoomLoaderConfigSeed().itemQuestions.map((q) => q.id)).toEqual([
      'ask_crlyme_booster',
    ]);
  });
});
