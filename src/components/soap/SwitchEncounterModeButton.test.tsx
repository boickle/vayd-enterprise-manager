/**
 * EMR-MODE (owner decision Nov 4, 2026): switch a visit's encounter between a medical note and a
 * SOAP before it is signed. The button asks first, saves pending text, then switches.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchEncounterMode = vi.fn();
vi.mock('../../api/visitWorkflow', () => ({
  switchEncounterMode: (...args: unknown[]) => switchEncounterMode(...args),
}));

import SwitchEncounterModeButton from './SwitchEncounterModeButton';

beforeEach(() => {
  switchEncounterMode.mockReset();
});

describe('EMR-MODE: Switch to SOAP / Switch to medical note', () => {
  it('renders nothing when hidden (signed) or before the encounter exists', () => {
    const { rerender } = render(
      <SwitchEncounterModeButton encounterId="enc-1" to="soap" hidden onSwitched={vi.fn()} />
    );
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<SwitchEncounterModeButton encounterId={null} to="soap" onSwitched={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks before switching a medical note, and Cancel changes nothing', () => {
    render(<SwitchEncounterModeButton encounterId="enc-1" to="soap" onSwitched={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to SOAP' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Switch this medical note to a SOAP? The note text moves into the SOAP.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(switchEncounterMode).not.toHaveBeenCalled();
  });

  it('saves pending note text first, then switches to a SOAP with that chart note', async () => {
    const order: string[] = [];
    const beforeSwitch = vi.fn(async () => {
      order.push('flush');
      return { chartNoteId: 'note-9' };
    });
    switchEncounterMode.mockImplementation(async () => {
      order.push('switch');
      return { id: 'enc-1', mode: 'comprehensive' };
    });
    const onSwitched = vi.fn();
    render(
      <SwitchEncounterModeButton
        encounterId="enc-1"
        to="soap"
        beforeSwitch={beforeSwitch}
        onSwitched={onSwitched}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch to SOAP' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch to SOAP' })[1]);
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith({ id: 'enc-1', mode: 'comprehensive' }));
    expect(order).toEqual(['flush', 'switch']);
    expect(switchEncounterMode).toHaveBeenCalledWith('enc-1', 'comprehensive', { chartNoteId: 'note-9' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches an untouched SOAP to a medical note after confirming', async () => {
    switchEncounterMode.mockResolvedValue({ id: 'enc-2', mode: 'medical_note' });
    const onSwitched = vi.fn();
    render(<SwitchEncounterModeButton encounterId="enc-2" to="medical_note" onSwitched={onSwitched} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to medical note' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch this SOAP to a medical note?');
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch to medical note' })[1]);
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
    expect(switchEncounterMode).toHaveBeenCalledWith('enc-2', 'medical_note', { chartNoteId: null });
  });

  it('shows the API’s reason when the switch is refused, and stays put', async () => {
    switchEncounterMode.mockRejectedValue({
      response: { data: { message: 'This SOAP already has Plan entered, so it can’t become a medical note.' } },
    });
    const onSwitched = vi.fn();
    render(<SwitchEncounterModeButton encounterId="enc-3" to="medical_note" onSwitched={onSwitched} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to medical note' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch to medical note' })[1]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already has Plan entered/);
    expect(onSwitched).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
