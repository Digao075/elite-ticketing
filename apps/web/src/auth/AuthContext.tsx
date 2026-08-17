import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { apiRequest } from '../api/client';
import type { Role } from '../api/types';

type Session = { token: string; role: Role; email: string };
type AuthValue = Session & { signedIn: boolean } | null;

type AuthContextValue = {
  session: AuthValue;
  signIn(email: string, password: string): Promise<Role>;
  signOut(): void;
};

const STORAGE_KEY = 'elite-ticketing.session';
const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as Session);
  } catch {
    return null;
  }
}

/** Decodes the role from the token payload without verifying it. The server
 *  re-checks every request; this only decides which links to render. */
function roleFromToken(token: string): Role {
  const payload = JSON.parse(atob(token.split('.')[1])) as { role: Role };
  return payload.role;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStoredSession);

  const signIn = useCallback(async (email: string, password: string): Promise<Role> => {
    const result = await apiRequest<{ accessToken: string }>('/auth/login', { method: 'POST', body: { email, password } });
    const next: Session = { token: result.accessToken, role: roleFromToken(result.accessToken), email };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return next.role;
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session: session === null ? null : { ...session, signedIn: true }, signIn, signOut }),
    [session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
