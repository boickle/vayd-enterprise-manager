// src/auth/AuthContext.ts
import { createContext } from 'react';

export type LoginResult = {
  token?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  user?: {
    id?: number;
    email?: string;
    requiresPasswordReset?: boolean;
    [k: string]: any;
  } | null;
  resetRequired: boolean;
  /** One-time code for the reset screen; the API sends it (top level) only after a temporary-password sign-in. */
  resetCode?: string | null;
  redirecting?: boolean;
};

export type AuthContextType = {
  token: string | null;
  userEmail: string | null;
  userId: string | null;
  role: string[];
  clientInfo: any | null; // Store client information for clients
  isInitializing: boolean; // True while checking/refreshing token on mount
  // ⬅️ now returns a LoginResult instead of void
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
