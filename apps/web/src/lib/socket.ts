import { io, Socket } from 'socket.io-client';
import { REALTIME_ORIGIN } from './constants';

let socket: Socket | null = null;

/** 被伺服器以驗證失敗拒絕時，換發 token 後重連的次數上限（連上後歸零） */
const MAX_AUTH_RETRIES = 3;

export interface SocketAuthOptions {
  /** 每次連線（含重連）時讀取當下的 access token */
  getToken: () => string | null;
  /** 驗證失敗時觸發 token 換發（例如呼叫一支需要登入的 API，讓攔截器自動 refresh） */
  onAuthError: () => Promise<unknown>;
}

export function getSocket({ getToken, onAuthError }: SocketAuthOptions): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  socket = io(REALTIME_ORIGIN || undefined, {
    // 用函式而不是固定值：access token 15 分鐘就過期，斷線重連（例如 API 重啟）要用換發後的新 token
    auth: (cb) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  let authRetries = 0;
  const s = socket;

  s.on('connect', () => {
    authRetries = 0;
    console.log('[Socket] Connected:', s.id);
  });

  s.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  s.on('connect_error', async (err) => {
    console.error('[Socket] Connection error:', err.message);
    // active 為 true 代表 socket.io 會自己重試（網路斷線等）；false 代表被伺服器拒絕（token 過期或無效），要換發後手動重連
    if (s.active || authRetries >= MAX_AUTH_RETRIES) return;
    authRetries++;
    await onAuthError().catch(() => {});
    s.connect();
  });

  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getCurrentSocket(): Socket | null {
  return socket;
}
