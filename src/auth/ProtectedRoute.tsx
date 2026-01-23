// src/auth/ProtectedRoute.tsx
import { ReactNode, useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

type ProtectedRouteProps = {
  children: ReactNode;
  allowRoles?: string[]; // if set, user must have at least one
  disallowRoles?: string[]; // if set, user must have none of these
  redirectTo?: string; // where to shove them if blocked
};

/**
 * Determines the appropriate redirect destination based on user role
 * - Clients go to /client-portal
 * - Employees go to /routing
 */
function getDefaultRedirect(roles: string[]): string {
  const normalizedRoles = roles.map((r) => String(r).toLowerCase().trim());
  if (normalizedRoles.includes('client')) {
    return '/client-portal';
  }
  return '/routing';
}

export function ProtectedRoute({
  children,
  allowRoles,
  disallowRoles,
  redirectTo,
}: ProtectedRouteProps) {
  const { token, role } = useAuth() as any;
  const location = useLocation();
  const roles: string[] = Array.isArray(role) ? role : role ? [String(role)] : [];

  // Not logged in - redirect to login
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const hasAny = (list?: string[]) => list?.some((r) => roles.includes(r)) ?? false;

  // If allowRoles is provided, require at least one
  if (allowRoles && !hasAny(allowRoles)) {
    const defaultRedirect = redirectTo || getDefaultRedirect(roles);
    return <Navigate to={defaultRedirect} replace />;
  }

  // If disallowRoles is provided, block if any match
  if (disallowRoles && hasAny(disallowRoles)) {
    const defaultRedirect = redirectTo || getDefaultRedirect(roles);
    return <Navigate to={defaultRedirect} replace />;
  }

  return <>{children}</>;
}
