'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { unmountWebTalk } from '@/lib/webtalk';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

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
  /** 當前使用者的有效權限碼集合（含 implies 閉包，來自 /auth/me/permissions） */
  permissions: Set<string>;
  /** 判斷是否擁有某權限 */
  hasPermission: (code: string) => boolean;
  passkeyEnabled: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  loginWithPasskey: (email?: string, rememberMe?: boolean) => Promise<void>;
  registerPasskey: (name: string) => Promise<void>;
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
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const router = useRouter();

  // 載入當前使用者有效權限（登入後 / restore session 後）
  const loadPermissions = useCallback(async () => {
    try {
      const res = await api.get('/auth/me/permissions');
      setPermissions(new Set<string>(res.data.data.permissions ?? []));
    } catch {
      setPermissions(new Set());
    }
  }, []);

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
        return loadPermissions();
      })
      .catch(() => {
        setAccessToken(null);
        setAgent(null);
        setPermissions(new Set());
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [loadPermissions]);

  useEffect(() => {
    api.get('/auth/passkeys/capability')
      .then((res) => {
        setPasskeyEnabled(res.data.data.enabled === true);
      })
      .catch(() => {
        setPasskeyEnabled(false);
      });
  }, []);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      const res = await api.post('/auth/login', { email, password, rememberMe });
      const { accessToken, agent: agentData } = res.data.data;
      setAccessToken(accessToken);
      setAgent(agentData);
      await loadPermissions();
      router.push('/dashboard/inbox');
    },
    [router, loadPermissions]
  );

  const loginWithPasskey = useCallback(
    async (email?: string, rememberMe = false) => {
      const optionsResponse = await api.post('/auth/passkeys/authentication/options', {
        ...(email ? { email } : {}),
        rememberMe,
      });
      const { challengeId, options } = optionsResponse.data.data;
      const response = await startAuthentication({ optionsJSON: options });
      const verifyResponse = await api.post('/auth/passkeys/authentication/verify', {
        challengeId,
        response,
      });
      const { accessToken, agent: agentData } = verifyResponse.data.data;
      setAccessToken(accessToken);
      setAgent(agentData);
      router.push('/dashboard/inbox');
    },
    [router],
  );

  const registerPasskey = useCallback(async (name: string) => {
    const optionsResponse = await api.post('/auth/passkeys/register/options');
    const { challengeId, options } = optionsResponse.data.data;
    const response = await startRegistration({ optionsJSON: options });
    await api.post('/auth/passkeys/register/verify', { challengeId, response, name });
  }, []);

  const logout = useCallback(async () => {
    unmountWebTalk();

    try {
      await api.post('/auth/logout');
    } catch {
      // best-effort
    }
    setAccessToken(null);
    setAgent(null);
    setPermissions(new Set());
    router.push('/login');
  }, [router]);

  const hasPermission = useCallback(
    (code: string) => permissions.has(code),
    [permissions]
  );

  return (
    <AuthContext.Provider value={{ agent, isLoading, permissions, hasPermission, passkeyEnabled, login, loginWithPasskey, registerPasskey, logout }}>

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

/** 判斷當前使用者是否擁有某權限碼（前端 gating 用；後端 guard 為權威）。 */
export function usePermission(code: string): boolean {
  return useAuth().hasPermission(code);
}
