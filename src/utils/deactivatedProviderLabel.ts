import type { Provider } from '../api/employee';

export const DEACTIVATED_SUFFIX = ' (Deactivated)';

/** RP-07: report pages mark a departed doctor so their row and totals are explained. */
export function labelDeactivatedProviders<T extends Pick<Provider, 'name' | 'isActive'>>(
  list: T[]
): T[] {
  return list.map((p) =>
    p.isActive === false && !p.name.endsWith(DEACTIVATED_SUFFIX)
      ? { ...p, name: `${p.name}${DEACTIVATED_SUFFIX}` }
      : p
  );
}
