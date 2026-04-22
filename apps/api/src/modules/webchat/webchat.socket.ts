import type { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerVisitorNamespace(io: SocketIOServer, prisma: PrismaClient): void {
  const visitor = io.of('/visitor');

  // Auth middleware — validate visitorToken (UUID) + channelId (exists in DB)
  visitor.use(async (socket, next) => {
    try {
      const { visitorToken, channelId } = socket.handshake.auth as Record<string, unknown>;

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
    const { visitorToken, channelId } = socket.data as { visitorToken: string; channelId: string };
    const room = `visitor:${channelId}:${visitorToken}`;

    socket.join(room);
    logger.info(`[WebChat] Visitor connected: channel=${channelId} visitor=${visitorToken.slice(-6)}`);

    socket.on('disconnect', (reason) => {
      logger.info(`[WebChat] Visitor disconnected: visitor=${visitorToken.slice(-6)} reason=${reason}`);
    });
  });
}
