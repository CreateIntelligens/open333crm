'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

interface Agent {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  status?: string;
}

interface AuthContextType {
  agent: Agent | null;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Module-level token ref — readable by api.ts interceptor outside React tree
let _accessToken: string | null = null;
export function getAccessToken(): string | null {
  return _accessToken;
}
export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // On mount: restore session
  // If access token already in memory (e.g. just logged in), skip refresh
  useEffect(() => {
    const existing = getAccessToken();

    const restoreSession = existing
      ? api.get('/auth/me')
      : api.post('/auth/refresh').then((res) => {
          setAccessToken(res.data.data.accessToken);
          return api.get('/auth/me');
        });

    restoreSession
      .then((res) => {
        setAgent(res.data.data);
      })
      .catch(() => {
        setAccessToken(null);
        setAgent(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      const res = await api.post('/auth/login', { email, password, rememberMe });
      const { accessToken, agent: agentData } = res.data.data;
      setAccessToken(accessToken);
      setAgent(agentData);
      router.push('/dashboard/inbox');
    },
    [router]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // best-effort
    }
    setAccessToken(null);
    setAgent(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ agent, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
