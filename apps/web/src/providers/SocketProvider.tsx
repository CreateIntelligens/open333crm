'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { useAuth, getAccessToken } from './AuthProvider';
import api from '@/lib/api';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  /** 重試用完仍連不上（例如登入狀態無法換發），需要重新整理頁面 */
  connectionLost: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  connectionLost: false,
});

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { agent } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!agent || !token) {
      disconnectSocket();
      setSocket(null);
      setIsConnected(false);
      return;
    }

    // 重連時讀最新 token；被拒時打一支需要登入的 API，讓 api 攔截器自動換發 token
    const s = getSocket({
      getToken: getAccessToken,
      onAuthError: () => api.get('/auth/me'),
      onGiveUp: () => setConnectionLost(true),
    });
    setSocket(s);

    const onConnect = () => {
      setIsConnected(true);
      setConnectionLost(false);
      // Join inbox room by default
      s.emit('join', 'inbox');
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    // If already connected
    if (s.connected) {
      setIsConnected(true);
      s.emit('join', 'inbox');
    }

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      disconnectSocket();
    };
  }, [agent]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, connectionLost }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextType {
  return useContext(SocketContext);
}
