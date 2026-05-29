import type { AppointmentType } from '../api/appointmentSettings';
import { DateTime } from 'luxon';

/** Minimal household shape for points (My Week, My Day, scheduler). */
export type PointsHousehold = {
  isPersonalBlock?: boolean;
  patients?: unknown[] | null;
  primary?: unknown;
};

/** Lookup by id and normalized type name (legacy fallbacks when `points` is null). */
export type AppointmentTypeCatalog = {
  byId: Map<number, AppointmentType>;
  byName: Map<string, AppointmentType>;
};

export function normalizeAppointmentTypeName(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ');
}

function truthyFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

function falseyFlag(v: unknown): boolean {
  if (v === false || v === 0) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'false' || s === '0' || s === 'no';
  }
  return false;
}

function pickIso(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeIsDeleted(row: AppointmentType & Record<string, unknown>): boolean {
  const raw: unknown = row.isDeleted ?? row.is_deleted;
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return false;
}

/** True when the type is archived (hidden from new booking pickers). */
export function appointmentTypeIsArchived(type: AppointmentType | undefined | null): boolean {
  if (!type) return false;
  return normalizeAppointmentTypeFromApi(type).isDeleted === true;
}

function appointmentTypeNameDisallowsClientByName(
  name: string | null | undefined,
  prettyName?: string | null
): boolean {
  for (const raw of [name, prettyName]) {
    const s = normalizeAppointmentTypeName(raw);
    if (!s) continue;
    if (s === 'block' || s === 'personal block' || s.startsWith('block')) return true;
    if (s === 'note to staff' || s === 'vacation' || s === 'sick time') return true;
  }
  return false;
}

/** Coerce list rows from GET /appointment-types (camelCase or snake_case flags). */
export function normalizeAppointmentTypeFromApi(row: AppointmentType): AppointmentType {
  const r = row as AppointmentType & Record<string, unknown>;
  const archivedOn =
    pickIso(row.archivedOn) ??
    pickIso(r.archived_on) ??
    pickIso(r.deletedAt) ??
    pickIso(r.deleted_at);
  const allowClient = (() => {
    if (falseyFlag(row.allowClient) || falseyFlag(r.allow_client)) return false;
    if (row.allowClient === true || truthyFlag(r.allow_client)) return true;
    if (appointmentTypeNameDisallowsClientByName(row.name, row.prettyName)) return false;
    return row.allowClient !== false;
  })();
  const allowAlternateAddress =
    row.allowAlternateAddress === true ||
    truthyFlag(r.allow_alternate_address) ||
    truthyFlag(row.allowAlternateAddress);
  const addressRequired =
    row.addressRequired === true ||
    truthyFlag(r.address_required) ||
    truthyFlag(row.addressRequired);
  const excludeFromRouting =
    row.excludeFromRouting === true ||
    truthyFlag(r.exclude_from_routing) ||
    truthyFlag(row.excludeFromRouting);
  const usesLegacyRouting =
    row.usesLegacyRouting === true ||
    truthyFlag(r.uses_legacy_routing) ||
    truthyFlag(row.usesLegacyRouting);

  return {
    ...row,
    isDeleted: normalizeIsDeleted(r),
    archivedOn: archivedOn ?? row.archivedOn ?? null,
    allowAllDay: row.allowAllDay === true || truthyFlag(r.allow_all_day),
    allowClient,
    allowAlternateAddress,
    addressRequired,
    excludeFromRouting,
    usesLegacyRouting,
    allowSchedulingOverride:
      row.allowSchedulingOverride === true || truthyFlag(r.allow_scheduling_override),
  };
}

/** ISO instant when a type was archived, if known. */
export function appointmentTypeArchivedOnIso(type: AppointmentType): string | null {
  const t = normalizeAppointmentTypeFromApi(type);
  if (!t.isDeleted) return null;
  const r = t as AppointmentType & Record<string, unknown>;
  return (
    pickIso(t.archivedOn) ??
    pickIso(r.archived_on) ??
    pickIso(r.deletedAt) ??
    pickIso(r.deleted_at) ??
    pickIso(t.modified) ??
    pickIso(t.updated) ??
    pickIso(r.modifiedAt) ??
    pickIso(r.updatedAt)
  );
}

export function formatAppointmentTypeArchivedOn(type: AppointmentType): string {
  const iso = appointmentTypeArchivedOnIso(type);
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return '—';
  return dt.toLocaleString(DateTime.DATETIME_MED);
}

export function appointmentTypeAllowsAllDay(type: AppointmentType | undefined): boolean {
  if (!type) return false;
  return normalizeAppointmentTypeFromApi(type).allowAllDay === true;
}

export function buildAppointmentTypeCatalog(types: AppointmentType[]): AppointmentTypeCatalog {
  const byId = new Map<number, AppointmentType>();
  const byName = new Map<string, AppointmentType>();
  for (const t of types) {
    if (!t?.id) continue;
    byId.set(t.id, t);
    const names = [t.name, t.prettyName].filter(Boolean) as string[];
    for (const raw of names) {
      const key = normalizeAppointmentTypeName(raw);
      if (key && !byName.has(key)) byName.set(key, t);
    }
  }
  return { byId, byName };
}

/** Block / staff types that must not require a client (legacy name rules when API flag is missing). */
export function appointmentTypeNameDisallowsClient(type: AppointmentType | undefined): boolean {
  if (!type) return false;
  return appointmentTypeNameDisallowsClientByName(type.name, type.prettyName);
}

export function appointmentTypeAllowsClient(type: AppointmentType | undefined): boolean {
  if (!type) return false;
  return normalizeAppointmentTypeFromApi(type).allowClient === true;
}

export function appointmentTypeAddressRequired(type: AppointmentType | undefined): boolean {
  if (!type) return false;
  return normalizeAppointmentTypeFromApi(type).addressRequired === true;
}

/** Types that may appear on Get Best Route / routing book pickers. */
export function appointmentTypeIncludedInRouting(type: AppointmentType | undefined): boolean {
  if (!type) return false;
  const t = normalizeAppointmentTypeFromApi(type);
  if (t.excludeFromRouting === true) return false;
  return t.allowClient === true || t.allowAlternateAddress === true;
}

export function appointmentFormFlags(type: AppointmentType | undefined) {
  const t = type ? normalizeAppointmentTypeFromApi(type) : undefined;
  const allowsClient = appointmentTypeAllowsClient(t);
  return {
    showAllDay: appointmentTypeAllowsAllDay(t),
    /** Client/patient may be attached when the type allows it. */
    showClient: allowsClient,
    /** allowClient means optional — not “client required”. */
    requireClient: false,
    addressRequired: appointmentTypeAddressRequired(t),
    showAlternateAddress: t?.allowAlternateAddress === true,
    showNotRoutedHint: t?.excludeFromRouting === true,
    showSchedulingOverride: t?.allowSchedulingOverride === true,
  };
}

/** Server legacy rules when `points` is null on the type. */
export function legacyPointsPerPatientFromTypeName(typeName: string | null | undefined): number {
  const type = normalizeAppointmentTypeName(typeName);
  if (!type) return 1;
  if (type.includes('ash drop off')) return 0;
  if (type.includes('note to staff')) return 0;
  if (type === 'euthanasia') return 2;
  if (type.includes('tech appointment')) return 0.5;
  return 1;
}

export function resolveAppointmentType(
  catalog: AppointmentTypeCatalog | undefined,
  opts: { typeId?: number | string | null; typeName?: string | null }
): AppointmentType | undefined {
  if (!catalog) return undefined;
  const id = opts.typeId != null ? Number(opts.typeId) : NaN;
  if (Number.isFinite(id) && id > 0) {
    const byId = catalog.byId.get(id);
    if (byId) return byId;
  }
  const key = normalizeAppointmentTypeName(opts.typeName);
  if (key) return catalog.byName.get(key);
  return undefined;
}

/** Points per patient for one visit (not multiplied by patient count). */
export function pointsPerPatientForType(
  catalog: AppointmentTypeCatalog | undefined,
  opts: { typeId?: number | string | null; typeName?: string | null }
): number {
  const row = resolveAppointmentType(catalog, opts);
  if (row?.points != null && Number.isFinite(row.points)) {
    return Math.max(0, row.points);
  }
  return legacyPointsPerPatientFromTypeName(opts.typeName);
}

export function appointmentTypeNameFromPrimary(primary: unknown): string {
  if (!primary || typeof primary !== 'object') return '';
  const p = primary as Record<string, unknown>;
  const at = p.appointmentType;
  if (at && typeof at === 'object') {
    const o = at as { name?: string; prettyName?: string; id?: number };
    return String(o.name ?? o.prettyName ?? '').trim();
  }
  return String(p.appointmentType ?? p.appointmentTypeName ?? '').trim();
}

export function appointmentTypeIdFromPrimary(primary: unknown): number | undefined {
  if (!primary || typeof primary !== 'object') return undefined;
  const p = primary as Record<string, unknown>;
  const at = p.appointmentType;
  if (at && typeof at === 'object') {
    const id = (at as { id?: number }).id;
    if (id != null && Number.isFinite(Number(id))) return Number(id);
  }
  const raw = p.appointmentTypeId;
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/** Points for one household row (My Day / My Week). */
export function householdPoints(
  h: PointsHousehold,
  catalog?: AppointmentTypeCatalog
): number {
  if (h.isPersonalBlock) return 0;
  const typeName = appointmentTypeNameFromPrimary(h.primary);
  const typeId = appointmentTypeIdFromPrimary(h.primary);
  const perPatient = pointsPerPatientForType(catalog, { typeId, typeName });
  if (perPatient <= 0) return 0;
  const n = Math.max(1, h.patients?.length ?? 1);
  return perPatient * n;
}

/** Sum points for a list of households. */
export function sumHouseholdPoints(
  households: PointsHousehold[],
  catalog?: AppointmentTypeCatalog
): number {
  return households.reduce((total, h) => total + householdPoints(h, catalog), 0);
}

/** Points from flat appointment rows (e.g. doctor month API). */
export function pointsFromAppointmentRows(
  appts: {
    appointmentType?: string | null;
    appointmentTypeId?: number | string | null;
    isPersonalBlock?: boolean;
  }[],
  catalog?: AppointmentTypeCatalog
): number {
  return (appts ?? []).reduce((total, a) => {
    if (a.isPersonalBlock) return total;
    const perPatient = pointsPerPatientForType(catalog, {
      typeId: a.appointmentTypeId,
      typeName: a.appointmentType,
    });
    return total + perPatient;
  }, 0);
}

export function formatPointsSummary(type: AppointmentType | undefined): string {
  if (type?.points != null && Number.isFinite(type.points)) {
    return String(type.points);
  }
  return 'Legacy';
}
