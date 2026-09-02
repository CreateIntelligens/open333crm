import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import IORedis from 'ioredis';
import { getConfig } from '../config/env.js';
import { eventBus } from '../events/event-bus.js';
import { authorizeSocketRoom } from '../modules/socket/socket-room-authorization.js';

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

    let subscriptionAttempts = 0;
    const maxSubscriptionAttempts = 60;
    const authorize = async (input: unknown) => authorizeSocketRoom(
      fastify.prismaAdmin,
      { agentId, tenantId, role: socket.data.role },
      input,
    );

    // Subscribe to conversation/inbox rooms only after server-side authorization.
    socket.on('subscribe', async (input: unknown, ack?: (response: unknown) => void) => {
      subscriptionAttempts += 1;
      if (subscriptionAttempts > maxSubscriptionAttempts) {
        fastify.log.warn({ agentId }, 'Socket subscription rate limit exceeded');
        ack?.({ ok: false, code: 'RATE_LIMITED' });
        return;
      }

      try {
        const result = await authorize(input);
        if (!result.ok) {
          fastify.log.warn({ agentId, code: result.code }, 'Socket subscription rejected');
          ack?.(result);
          return;
        }

        fastify.log.info({ agentId, room: result.room }, 'Socket subscribing to room');
        await socket.join(result.room);
        ack?.(result);
      } catch (err) {
        fastify.log.warn({ agentId, err }, 'Socket subscription authorization failed');
        ack?.({ ok: false, code: 'FORBIDDEN' });
      }
    });

    socket.on('unsubscribe', async (input: unknown, ack?: (response: unknown) => void) => {
      subscriptionAttempts += 1;
      if (subscriptionAttempts > maxSubscriptionAttempts) {
        fastify.log.warn({ agentId }, 'Socket unsubscription rate limit exceeded');
        ack?.({ ok: false, code: 'RATE_LIMITED' });
        return;
      }

      try {
        const result = await authorize(input);
        if (!result.ok) {
          fastify.log.warn({ agentId, code: result.code }, 'Socket unsubscription rejected');
          ack?.(result);
          return;
        }

        fastify.log.info({ agentId, room: result.room }, 'Socket unsubscribing from room');
        await socket.leave(result.room);
        ack?.(result);
      } catch (err) {
        fastify.log.warn({ agentId, err }, 'Socket unsubscription authorization failed');
        ack?.({ ok: false, code: 'FORBIDDEN' });
      }
    });

    socket.on('disconnect', (reason) => {
      fastify.log.info({ agentId, reason }, 'Socket disconnected');
    });
  });

  fastify.decorate('io', io);

  // ── Redis pub/sub bridge — forward events from standalone workers ────────────
  const socketBridgeSub = new IORedis(config.REDIS_URL);
  await socketBridgeSub.subscribe('socket:emit');
  socketBridgeSub.on('message', (_channel, message) => {
    try {
      const payload = JSON.parse(message) as { room?: string; event?: string; data?: unknown; namespace?: string };
      if (typeof payload.room !== 'string' || typeof payload.event !== 'string') {
        fastify.log.warn({ message }, '[SocketBridge] Malformed message, discarding');
        return;
      }
      const ns = typeof payload.namespace === 'string' ? io.of(payload.namespace) : io;
      ns.to(payload.room).emit(payload.event as any, payload.data);
    } catch (err) {
      fastify.log.warn({ err }, '[SocketBridge] Failed to parse socket:emit message');
    }
  });

  // ── Domain event bridge — workers 發的 domain 事件轉成 in-process eventBus ──
  // worker（獨立 process）無法直接發 api 的 in-process eventBus（automation 規則訂閱的）。
  // 這裡收 redis 'domain:event' → 轉發成 eventBus 事件（如 worker add_tag 的 contact.tagged）。
  const domainEventSub = new IORedis(config.REDIS_URL);
  // 必須註冊 error listener：IORedis 無 error listener 時，連線中斷會拋 uncaught error 使整個 API crash。
  domainEventSub.on('error', (err) => {
    fastify.log.error({ err }, '[DomainEventBridge] Redis subscriber error');
  });
  await domainEventSub.subscribe('domain:event');
  domainEventSub.on('message', (_channel, message) => {
    try {
      const msg = JSON.parse(message) as { name?: string; tenantId?: string; payload?: Record<string, unknown> };
      if (typeof msg.name !== 'string' || typeof msg.tenantId !== 'string') {
        fastify.log.warn({ message }, '[DomainEventBridge] Malformed message, discarding');
        return;
      }
      eventBus.publish({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name: msg.name as any,
        tenantId: msg.tenantId,
        timestamp: new Date(),
        payload: msg.payload ?? {},
      });
    } catch (err) {
      fastify.log.warn({ err }, '[DomainEventBridge] Failed to parse domain:event message');
    }
  });

  fastify.addHook('onClose', async () => {
    io.close();
    socketBridgeSub.disconnect();
    domainEventSub.disconnect();
    fastify.log.info('Socket.IO server closed');
  });
}

export default fp(socketPlugin, {
  name: 'socket',
});
