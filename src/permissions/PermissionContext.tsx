// src/permissions/PermissionContext.tsx
// Loads the signed-in user's effective permissions once per session and exposes
// them to the tree. The server re-checks everything; this only drives the UI.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  fetchMyPermissions,
  type EffectivePermissions,
  type PermissionScope,
  type RoleSlug,
} from '../api/permissions';
import { useAuth } from '../auth/useAuth';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const SCOPE_RANK: Record<PermissionScope, number> = {
  none: 0,
  own: 1,
  team: 2,
  all: 3,
};

type PermissionContextValue = {
  /** Null until the first load finishes; treat as "nothing yet", not "denied". */
  effective: EffectivePermissions | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  scopeOf: (permissionKey: string) => PermissionScope;
  can: (permissionKey: string, atLeast?: PermissionScope) => boolean;
  hasRole: (...roles: RoleSlug[]) => boolean;
  isLicensed: boolean;
  licenseType: 'veterinarian' | 'technician' | null;
};

const EMPTY_PERMISSIONS: Record<string, PermissionScope> = {};

const PermissionContext = createContext<PermissionContextValue | undefined>(
  undefined,
);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [effective, setEffective] = useState<EffectivePermissions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const liveRequest = useRef(0);

  useEffect(() => {
    if (!token) {
      setEffective(null);
      setError(null);
      setLoading(false);
      return;
    }
    const practiceId = currentPracticeId();
    if (!practiceId) return;
    const requestId = ++liveRequest.current;
    setLoading(true);
    fetchMyPermissions(practiceId)
      .then((data) => {
        if (liveRequest.current !== requestId) return;
        setEffective(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (liveRequest.current !== requestId) return;
        // Leave `effective` null so the UI stays in its loading-ish state rather
        // than hiding every control because one request failed.
        setError(
          err instanceof Error ? err.message : 'Could not load permissions',
        );
      })
      .finally(() => {
        if (liveRequest.current === requestId) setLoading(false);
      });
  }, [token, reloadKey]);

  const permissions = effective?.permissions ?? EMPTY_PERMISSIONS;

  const scopeOf = useCallback(
    (permissionKey: string): PermissionScope =>
      permissions[permissionKey] ?? 'none',
    [permissions],
  );

  const can = useCallback(
    (permissionKey: string, atLeast: PermissionScope = 'own'): boolean =>
      SCOPE_RANK[permissions[permissionKey] ?? 'none'] >= SCOPE_RANK[atLeast],
    [permissions],
  );

  const roles = effective?.roles ?? [];
  const hasRole = useCallback(
    (...wanted: RoleSlug[]) => wanted.some((r) => roles.includes(r)),
    [roles],
  );

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const value = useMemo<PermissionContextValue>(
    () => ({
      effective,
      loading,
      error,
      reload,
      scopeOf,
      can,
      hasRole,
      isLicensed: effective?.isLicensed ?? false,
      licenseType: effective?.licenseType ?? null,
    }),
    [effective, loading, error, reload, scopeOf, can, hasRole],
  );

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

/**
 * Permission state for the signed-in user. Safe outside the provider (client
 * portal, login) where it reports nothing held rather than throwing.
 */
export function usePermissions(): PermissionContextValue {
  const ctx = useContext(PermissionContext);
  return ctx ?? OUTSIDE_PROVIDER;
}

/** `true` when the user holds `permissionKey` at `atLeast` or stronger. */
export function useCan(
  permissionKey: string,
  atLeast: PermissionScope = 'own',
): boolean {
  return usePermissions().can(permissionKey, atLeast);
}

/**
 * The breadth of a permission, for code that behaves differently per scope —
 * e.g. a list that shows own cases at `own` and everyone's at `all`.
 */
export function useScope(permissionKey: string): PermissionScope {
  return usePermissions().scopeOf(permissionKey);
}

const OUTSIDE_PROVIDER: PermissionContextValue = {
  effective: null,
  loading: false,
  error: null,
  reload: () => undefined,
  scopeOf: () => 'none',
  can: () => false,
  hasRole: () => false,
  isLicensed: false,
  licenseType: null,
};
