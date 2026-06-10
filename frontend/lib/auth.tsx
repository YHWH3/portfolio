'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  apiFetch,
  clearTokens,
  getAccessToken,
  loadStoredUser,
  setTokens,
  storeUser,
} from './api';
import type { LoginResponse, RegisterResponse, User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Hydrate from localStorage on mount.
    const token = getAccessToken();
    if (token) {
      const stored = loadStoredUser<User>();
      if (stored) setUser(stored);
    }
    setLoading(false);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
        noAuth: true,
      });
      setTokens(res.token, res.refresh_token);
      storeUser(res.user);
      setUser(res.user);
      router.push('/drafts');
    },
    [router]
  );

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      first_name: string;
      last_name: string;
    }) => {
      const res = await apiFetch<RegisterResponse>('/api/v1/auth/register', {
        method: 'POST',
        body: data,
        noAuth: true,
      });
      setTokens(res.token, res.refresh_token);
      storeUser(res.user);
      setUser(res.user);
      router.push('/drafts');
    },
    [router]
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
    router.push('/auth/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: !!user || !!getAccessToken(),
      login,
      register,
      logout,
    }),
    [user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
