import { io, Socket } from 'socket.io-client';
import type { ChatboxFingerprint, Message } from './session.js';

export interface VisitorSocket {
  onAgentMessage(cb: (msg: Message) => void): void;
  disconnect(): void;
}

export function connectVisitorSocket(
  realtimeOrigin: string,
  sessionId: string,
  claimToken: string,
  fingerprint?: ChatboxFingerprint,
): VisitorSocket {
  const namespaceUrl = realtimeOrigin ? `${realtimeOrigin}/visitor` : '/visitor';
  const socket: Socket = io(namespaceUrl, {
    auth: { sessionId, claimToken, fingerprint },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect_error', (err) => {
    console.warn('[Open333CRM] Socket connection error:', err.message);
  });

  return {
    onAgentMessage(cb: (msg: Message) => void) {
      socket.on('agent:message', cb);
    },
    disconnect() {
      socket.disconnect();
    },
  };
}
