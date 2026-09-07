import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { authApi, AuthUser } from './api';
import { disconnectSocket } from './socket';

export type User = AuthUser;

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

  const checkAuth = useCallback(async () => {
    try {
      setStatus('loading');
      const session = await authApi.getSession();
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

  useEffect(() => {
    checkAuth();
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
