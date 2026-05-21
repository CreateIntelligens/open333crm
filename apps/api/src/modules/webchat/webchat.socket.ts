import type { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import type { ChatboxSessionVerifier } from '../chatbox/chatbox.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  prisma: PrismaClient,
  chatboxSessionVerifier?: ChatboxSessionVerifier,
): void {
  const visitor = io.of('/visitor');

  // Auth middleware — validate either legacy visitorToken+channelId or chatbox sessionId.
  visitor.use(async (socket, next) => {
    try {
      if (!checkVisitorSocketRateLimit(socket.handshake.address)) {
        return next(new Error('Too many visitor socket connections'));
      }

      const { visitorToken, channelId, sessionId, fingerprint } = socket.handshake.auth as Record<string, unknown>;

      if (typeof sessionId === 'string') {
        if (!chatboxSessionVerifier) {
          return next(new Error('Chatbox session verifier unavailable'));
        }
        const session = await chatboxSessionVerifier.verify({
          sessionId,
          fingerprint: fingerprint && typeof fingerprint === 'object' ? fingerprint as any : undefined,
          userAgent: typeof socket.handshake.headers['user-agent'] === 'string'
            ? socket.handshake.headers['user-agent']
            : '',
        });

        socket.data.visitorToken = session.visitorToken;
        socket.data.channelId = session.channelId;
        socket.data.chatboxSessionId = session.id;
        return next();
      }

      if (typeof visitorToken !== 'string' || !UUID_RE.test(visitorToken)) {
        return next(new Error('Invalid visitorToken'));
      }

      if (typeof channelId !== 'string' || !UUID_RE.test(channelId)) {
        return next(new Error('Invalid channelId'));
      }

      const channel = await prisma.channel.findFirst({
        where: { id: channelId, channelType: CHANNEL_TYPE.WEBCHAT, isActive: true },
        select: { id: true },
      });

      if (!channel) {
        return next(new Error('Channel not found'));
      }

      socket.data.visitorToken = visitorToken;
      socket.data.channelId = channelId;
      next();
    } catch (err) {
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
    logger.info(`[WebChat] Visitor connected: channel=${channelId} visitor=${visitorToken.slice(-6)}`);

    socket.on('disconnect', (reason) => {
      logger.info(`[WebChat] Visitor disconnected: visitor=${visitorToken.slice(-6)} reason=${reason}`);
    });
  });
}
