import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import RoomLoaderChartPanel, { autoOpenChartPetId, PetChartNameLink } from './RoomLoaderChartPanel';
import { sexNeuterLabel } from '../../utils/patientSexNeuter';

vi.mock('../../components/pims/PimsPatientDetailView', () => ({
  default: ({ patientId, embedded }: { patientId: string; embedded?: boolean }) => (
    <div data-testid="chart" data-embedded={String(!!embedded)}>chart for {patientId}</div>
  ),
}));

const pets = [
  { id: '1', name: 'Ziggy', species: 'Canine' },
  { id: '2', name: 'Mo', species: 'Feline' },
];

function Where() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function Host() {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <MemoryRouter initialEntries={['/schedule/room-loader']}>
      <Where />
      <input aria-label="note" value={note} onChange={(e) => setNote(e.target.value)} />
      {pets.map((p) => (
        <PetChartNameLink key={p.id} petId={p.id} name={p.name} onOpen={setOpen} />
      ))}
      {open && (
        <RoomLoaderChartPanel pets={pets} activePetId={open} onSelectPet={setOpen} onClose={() => setOpen(null)} />
      )}
    </MemoryRouter>
  );
}

it('clicking a pet name opens the panel without navigating', async () => {
  render(<Host />);
  fireEvent.click(screen.getByText('Ziggy', { selector: 'a' }));
  expect(await screen.findByText('chart for 1')).toBeTruthy();
  expect(screen.getByTestId('loc').textContent).toBe('/schedule/room-loader');
  expect(screen.getByTestId('chart').dataset.embedded).toBe('true');
});

it('two pets give two tabs; tab and second name both switch', async () => {
  render(<Host />);
  fireEvent.click(screen.getByText('Ziggy', { selector: 'a' }));
  await screen.findByText('chart for 1');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('tab', { name: /Ziggy/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: /Mo/ }));
  expect(await screen.findByText('chart for 2')).toBeTruthy();
  fireEvent.click(screen.getByText('Ziggy', { selector: 'a' }));
  expect(await screen.findByText('chart for 1')).toBeTruthy();
  fireEvent.click(screen.getByText('Mo', { selector: 'a' }));
  await screen.findByText('chart for 2');
  expect(screen.getByRole('tab', { name: /Mo/ }).getAttribute('aria-selected')).toBe('true');
});

it('closing the panel keeps an edited Room Loader field; full chart opens a new tab', async () => {
  render(<Host />);
  fireEvent.change(screen.getByLabelText('note'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByText('Ziggy', { selector: 'a' }));
  await screen.findByText('chart for 1');
  const full = screen.getByText('Open full chart') as HTMLAnchorElement;
  expect(full.getAttribute('target')).toBe('_blank');
  expect(full.getAttribute('href')).toBe('/schedule/patients?patientId=1');
  fireEvent.click(screen.getByLabelText('Close chart'));
  await waitFor(() => expect(screen.queryByTestId('rl-chart-panel')).toBeNull());
  expect((screen.getByLabelText('note') as HTMLInputElement).value).toBe('hello');
});

it('sex/neuter label', () => {
  expect(sexNeuterLabel('MaleNeutered', 'Neutered')).toBe('Neutered Male');
  expect(sexNeuterLabel('MaleNeutered')).toBe('Neutered Male');
  expect(sexNeuterLabel('FemaleSpayed', 'Spayed')).toBe('Spayed Female');
  expect(sexNeuterLabel('Female', 'Spayed')).toBe('Spayed Female');
  expect(sexNeuterLabel('Male', 'Intact')).toBe('Intact Male');
  expect(sexNeuterLabel('Male')).toBe('Male');
  expect(sexNeuterLabel('Unknown')).toBe('');
});

describe('autoOpenChartPetId (chart opens on its own)', () => {
  const base = {
    modalOpen: true,
    roomLoaderId: 7,
    petIds: [11, 12],
    chartPetId: null,
    dismissedForRoomLoaderId: null,
    wideScreen: true,
  };
  it('opens the first pet when the details open on a wide screen', () => {
    expect(autoOpenChartPetId(base)).toBe('11');
  });
  it('leaves an open chart alone (e.g. staff switched to the second pet)', () => {
    expect(autoOpenChartPetId({ ...base, chartPetId: '12' })).toBeNull();
  });
  it('stays closed after staff close it for this Room Loader', () => {
    expect(autoOpenChartPetId({ ...base, dismissedForRoomLoaderId: 7 })).toBeNull();
  });
  it('opens again for a different Room Loader', () => {
    expect(autoOpenChartPetId({ ...base, roomLoaderId: 8, dismissedForRoomLoaderId: 7 })).toBe('11');
  });
  it('does not open over the form on a narrow screen, or with the details closed', () => {
    expect(autoOpenChartPetId({ ...base, wideScreen: false })).toBeNull();
    expect(autoOpenChartPetId({ ...base, modalOpen: false })).toBeNull();
    expect(autoOpenChartPetId({ ...base, petIds: [] })).toBeNull();
  });
});
