import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { authApi, AuthUser } from './api';
import { disconnectSocket } from './socket';

export type User = AuthUser;

// Retry budget for a rate-limited session check. Bounded so the app can never
// sit on the splash forever, and the delay is clamped because the server's
// Retry-After can be the whole 15-minute window (far too long to stall on) or
// a single second (which would just hammer an already-limited bucket).
const MAX_RATE_LIMIT_RETRIES = 3;
const RETRY_DELAY_MIN_MS = 5000;
const RETRY_DELAY_MAX_MS = 30000;

interface AuthContextType {
  user: User | null;
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'unassigned';
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthContextType['status']>('loading');

  // Attempt counter lives in a ref, not state, so a retry never re-renders and
  // an explicit checkAuth() (e.g. from the login screen) can reset the budget.
  const rateLimitAttempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSessionCheck: () => Promise<void> = useCallback(async () => {
    try {
      setStatus('loading');
      const session = await authApi.getSession();

      // Rate limited: the session is probably fine, we just could not ask. The
      // old code dropped straight to 'unauthenticated' here, which _layout.tsx
      // turns into router.replace('/login') — a 429 logged the user out. Stay on
      // 'loading' instead (both app/index.tsx and app/_layout.tsx treat it as
      // "do nothing yet", so nothing routes anywhere) and ask again shortly.
      // The token is deliberately NOT cleared on this path.
      if (session.rateLimited && rateLimitAttempts.current < MAX_RATE_LIMIT_RETRIES) {
        rateLimitAttempts.current += 1;
        const delay = Math.min(
          RETRY_DELAY_MAX_MS,
          Math.max(RETRY_DELAY_MIN_MS, (session.retryAfterSeconds || 0) * 1000),
        );
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { runSessionCheck(); }, delay);
        return;
      }
      // Attempts exhausted → fall through to the old behaviour below, so the
      // screen resolves to the login flow rather than hanging indefinitely.

      if (session.authenticated && session.user) {
        setUserState(session.user);
        setStatus(session.user.role === 'unassigned' ? 'unassigned' : 'authenticated');
      } else {
        setUserState(null);
        setStatus('unauthenticated');
      }
    } catch {
      setUserState(null);
      setStatus('unauthenticated');
    }
  }, []);

  const checkAuth = useCallback(async () => {
    // An explicit call is a fresh intent (mount, or the login screen after a
    // successful sign-in), so the rate-limit retry budget starts over and any
    // pending retry is dropped.
    rateLimitAttempts.current = 0;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    await runSessionCheck();
  }, [runSessionCheck]);

  useEffect(() => {
    checkAuth();
    // Never leave a retry timer running after unmount.
    return () => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [checkAuth]);

  function setUser(u: User | null) {
    setUserState(u);
    if (!u) setStatus('unauthenticated');
    else if (u.role === 'unassigned') setStatus('unassigned');
    else setStatus('authenticated');
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      // Disconnect the socket so a new login starts a fresh session
      try { disconnectSocket(); } catch { /* ignore */ }
      setUserState(null);
      setStatus('unauthenticated');
    }
  }

  return (
    <AuthContext.Provider value={{ user, status, setUser, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
