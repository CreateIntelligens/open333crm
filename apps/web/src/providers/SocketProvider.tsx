'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { useAuth, getAccessToken } from './AuthProvider';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { agent } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!agent || !token) {
      disconnectSocket();
      setSocket(null);
      setIsConnected(false);
      return;
    }

    const s = getSocket(token);
    setSocket(s);

    const onConnect = () => {
      setIsConnected(true);
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
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextType {
  return useContext(SocketContext);
}
