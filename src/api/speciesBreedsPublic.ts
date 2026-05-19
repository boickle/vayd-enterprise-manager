import { http } from './http';

export type SpeciesBreedsSpecies = {
  id: number;
  name: string;
  prettyName?: string;
  showInUi?: boolean;
};

export type SpeciesBreedsBreed = {
  id: number;
  name: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object';
}

export async function fetchSpeciesListPublic(practiceId: number): Promise<SpeciesBreedsSpecies[]> {
  const { data } = await http.get<{ species?: unknown[] }>(`/public/species-breeds?practiceId=${practiceId}`);
  const species = Array.isArray(data?.species) ? data.species : [];
  return species
    .filter(isRecord)
    .filter((s) => s.showInUi !== false)
    .map((s) => ({
      id: Number(s.id),
      name: String(s.name ?? ''),
      prettyName: s.prettyName != null ? String(s.prettyName) : undefined,
      showInUi: typeof s.showInUi === 'boolean' ? s.showInUi : undefined,
    }))
    .filter((s) => Number.isFinite(s.id) && s.name.length > 0);
}

export async function fetchBreedsForSpeciesPublic(
  practiceId: number,
  speciesId: number
): Promise<SpeciesBreedsBreed[]> {
  const { data } = await http.get<{ breeds?: unknown[] }>(
    `/public/species-breeds?practiceId=${practiceId}&speciesId=${speciesId}`
  );
  const breeds = Array.isArray(data?.breeds) ? data.breeds : [];
  return breeds
    .filter(isRecord)
    .map((b) => ({
      id: Number(b.id),
      name: String(b.name ?? ''),
    }))
    .filter((b) => Number.isFinite(b.id) && b.name.length > 0);
}
