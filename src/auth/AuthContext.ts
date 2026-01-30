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
    resetPasswordCode?: string | null;
    [k: string]: any;
  } | null;
  resetRequired: boolean;
  resetCode?: string | null;
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
