import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { getConfig } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

async function socketPlugin(fastify: FastifyInstance) {
  const config = getConfig();

  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // JWT auth middleware
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string) ??
        (socket.handshake.query?.token as string);

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = fastify.jwt.verify<{
        agentId: string;
        tenantId: string;
        role: string;
      }>(token);

      socket.data.agentId = decoded.agentId;
      socket.data.tenantId = decoded.tenantId;
      socket.data.role = decoded.role;

      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { agentId, tenantId } = socket.data;
    fastify.log.info({ agentId }, 'Socket connected');

    // Auto-join tenant room and agent-specific room
    socket.join(`tenant:${tenantId}`);
    socket.join(`agent:${agentId}`);

    // Subscribe to conversation/inbox rooms
    socket.on('subscribe', (room: string) => {
      fastify.log.info({ agentId, room }, 'Socket subscribing to room');
      socket.join(room);
    });

    socket.on('unsubscribe', (room: string) => {
      fastify.log.info({ agentId, room }, 'Socket unsubscribing from room');
      socket.leave(room);
    });

    socket.on('disconnect', (reason) => {
      fastify.log.info({ agentId, reason }, 'Socket disconnected');
    });
  });

  fastify.decorate('io', io);

  fastify.addHook('onClose', async () => {
    io.close();
    fastify.log.info('Socket.IO server closed');
  });
}

export default fp(socketPlugin, {
  name: 'socket',
});
