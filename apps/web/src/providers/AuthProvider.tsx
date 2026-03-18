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
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // On mount, check localStorage for token and verify with /auth/me
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      api
        .get('/auth/me')
        .then((res) => {
          setAgent(res.data.data);
        })
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
          setAgent(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post('/auth/login', { email, password });
      const { token: newToken, agent: agentData } = res.data.data;
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setAgent(agentData);
      router.push('/dashboard/inbox');
    },
    [router]
  );

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setAgent(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ agent, token, isLoading, login, logout }}>
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
