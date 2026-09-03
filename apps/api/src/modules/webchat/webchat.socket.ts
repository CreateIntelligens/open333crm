import type { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@open333crm/database';
import { logger } from '@open333crm/core';
import type { ChatboxFingerprintInput } from '@open333crm/shared';
import type { ChatboxSessionVerifier } from '../chatbox/chatbox.service.js';

const SOCKET_RATE_WINDOW_MS = 60_000;
const SOCKET_RATE_MAX = 60;
const socketRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkVisitorSocketRateLimit(ip: string | undefined): boolean {
  const key = ip || 'unknown';
  const now = Date.now();
  const bucket = socketRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    socketRateBuckets.set(key, { count: 1, resetAt: now + SOCKET_RATE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= SOCKET_RATE_MAX;
}

export function registerVisitorNamespace(
  io: SocketIOServer,
  _prisma: PrismaClient,
  chatboxSessionVerifier?: ChatboxSessionVerifier,
): void {
  const visitor = io.of('/visitor');

  // Visitor sockets require a server-issued Chatbox session and page claim.
  visitor.use(async (socket, next) => {
    try {
      if (!checkVisitorSocketRateLimit(socket.handshake.address)) {
        return next(new Error('Too many visitor socket connections'));
      }

      const { sessionId, claimToken, fingerprint } = socket.handshake.auth as Record<string, unknown>;
      if (!chatboxSessionVerifier || typeof sessionId !== 'string' || typeof claimToken !== 'string') {
        return next(new Error('Secure Chatbox session required'));
      }

      const session = await chatboxSessionVerifier.verify({
        sessionId,
        claimToken,
        fingerprint: fingerprint && typeof fingerprint === 'object'
          ? fingerprint as ChatboxFingerprintInput
          : undefined,
        userAgent: typeof socket.handshake.headers['user-agent'] === 'string'
          ? socket.handshake.headers['user-agent']
          : '',
      });

      socket.data.visitorToken = session.visitorToken;
      socket.data.channelId = session.channelId;
      socket.data.chatboxSessionId = session.id;
      next();
    } catch {
      next(new Error('Auth failed'));
    }
  });

  visitor.on('connection', (socket) => {
    const { visitorToken, channelId, chatboxSessionId } = socket.data as {
      visitorToken: string;
      channelId: string;
      chatboxSessionId?: string;
    };
    const room = `visitor:${channelId}:${visitorToken}`;

    socket.join(room);
    if (chatboxSessionId) {
      socket.join(`chatbox:${chatboxSessionId}`);
    }
    logger.info(`[WebChat] Visitor connected: channel=${channelId}`);

    socket.on('disconnect', (reason) => {
      logger.info(`[WebChat] Visitor disconnected: channel=${channelId} reason=${reason}`);
    });
  });
}
