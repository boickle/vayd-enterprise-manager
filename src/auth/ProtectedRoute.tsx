// src/auth/ProtectedRoute.tsx
import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

type ProtectedRouteProps = {
  children: ReactNode;
  allowRoles?: string[]; // if set, user must have at least one
  disallowRoles?: string[]; // if set, user must have none of these
  redirectTo?: string; // where to shove them if blocked
};

export function ProtectedRoute({
  children,
  allowRoles,
  disallowRoles,
  redirectTo,
}: ProtectedRouteProps) {
  const { token, role } = useAuth() as any;
  const location = useLocation();
  const roles: string[] = Array.isArray(role) ? role : role ? [String(role)] : [];

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const hasAny = (list?: string[]) => list?.some((r) => roles.includes(r)) ?? false;

  // If allowRoles is provided, require at least one
  if (allowRoles && !hasAny(allowRoles)) {
    return <Navigate to={redirectTo || '/home'} replace />;
  }

  // If disallowRoles is provided, block if any match
  if (disallowRoles && hasAny(disallowRoles)) {
    return <Navigate to={redirectTo || '/client-portal'} replace />;
  }

  return <>{children}</>;
}
