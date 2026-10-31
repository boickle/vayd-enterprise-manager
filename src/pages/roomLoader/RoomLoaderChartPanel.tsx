import { lazy, Suspense } from 'react';
import { patientHref } from '../../utils/recentRecordsStore';
import './RoomLoaderChartPanel.css';

// Loaded only when a pet's name is first clicked, so opening the Room Loader stays fast.
const PimsPatientDetailView = lazy(() => import('../../components/pims/PimsPatientDetailView'));

export type ChartPanelPet = { id: string; name: string; species?: string | null };

/** Wide enough for the chart to sit beside the form (matches RoomLoaderChartPanel.css). */
export const CHART_SIDE_BY_SIDE_QUERY = '(min-width: 1101px)';

/**
 * The pet whose chart should open on its own, or null (owner request Oct 31, 2026): the first
 * pet's chart opens when the details open on a wide screen, unless staff closed it for this
 * Room Loader or a chart is already showing.
 */
export function autoOpenChartPetId(args: {
  modalOpen: boolean;
  roomLoaderId: number | null;
  petIds: Array<number | string | null | undefined>;
  chartPetId: string | null;
  dismissedForRoomLoaderId: number | null;
  wideScreen: boolean;
}): string | null {
  if (!args.modalOpen || args.roomLoaderId == null || !args.wideScreen) return null;
  if (args.chartPetId) return null;
  if (args.dismissedForRoomLoaderId === args.roomLoaderId) return null;
  const first = args.petIds.find((id) => id != null && String(id) !== '');
  return first != null ? String(first) : null;
}

type Props = {
  pets: ChartPanelPet[];
  activePetId: string;
  onSelectPet: (id: string) => void;
  onClose: () => void;
};

function speciesIcon(species?: string | null): string {
  const s = (species ?? '').toLowerCase();
  if (s.includes('canine') || s.includes('dog')) return '🐶';
  if (s.includes('feline') || s.includes('cat')) return '🐱';
  if (s.includes('rabbit')) return '🐰';
  if (s.includes('bird') || s.includes('avian')) return '🐦';
  if (s.includes('horse') || s.includes('equine')) return '🐴';
  return '🐾';
}

/** Chart docked beside the Room Loader details: one tab per pet, only the shown tab is fetched. */
export default function RoomLoaderChartPanel({ pets, activePetId, onSelectPet, onClose }: Props) {
  const active = pets.find((p) => p.id === activePetId) ?? pets[0];
  if (!active) return null;
  return (
    <aside
      className="rl-chart-panel"
      aria-label="Patient chart"
      data-testid="rl-chart-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="rl-chart-panel__bar">
        <div className="rl-chart-panel__tabs" role="tablist" aria-label="Pets on this check-in">
          {pets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`rl-chart-tab-${p.id}`}
              aria-selected={p.id === active.id}
              className={`rl-chart-panel__tab${p.id === active.id ? ' is-active' : ''}`}
              onClick={() => onSelectPet(p.id)}
            >
              <span aria-hidden>{speciesIcon(p.species)}</span> {p.name || 'Unknown Pet'}
            </button>
          ))}
        </div>
        <a
          className="rl-chart-panel__full"
          href={patientHref(active.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open full chart
        </a>
        <button type="button" className="rl-chart-panel__close" onClick={onClose} aria-label="Close chart">
          ×
        </button>
      </div>
      <div className="rl-chart-panel__body" role="tabpanel" aria-labelledby={`rl-chart-tab-${active.id}`}>
        <Suspense fallback={<div style={{ padding: 16 }}>Loading chart…</div>}>
          <PimsPatientDetailView key={active.id} patientId={active.id} onBack={onClose} embedded />
        </Suspense>
      </div>
    </aside>
  );
}

/** Pet name in the Room Loader header: opens the docked chart instead of navigating away. */
export function PetChartNameLink({
  petId,
  name,
  onOpen,
}: {
  petId: string;
  name: string;
  onOpen: (petId: string) => void;
}) {
  return (
    <a
      href={patientHref(petId)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new-tab clicks stay native
        e.preventDefault();
        onOpen(petId);
      }}
      title="Show chart beside this room loader"
      style={{ color: '#212529', textDecoration: 'underline', cursor: 'pointer' }}
    >
      {name}
    </a>
  );
}
