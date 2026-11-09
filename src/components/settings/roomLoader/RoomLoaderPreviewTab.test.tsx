// Settings → Room Loader → Preview & wording: the sample pet changes what is offered, and a
// wording edit shows in the preview straight away (and lands in the settings that get saved).
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    expect(await within(sidebar).findByText(/FeLV.*Initial/i)).toBeTruthy();
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
});
