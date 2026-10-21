import fp from 'fastify-plugin';
import { isAgentAccessToken } from '../lib/agent-token.js';
import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import IORedis from 'ioredis';
import { getConfig } from '../config/env.js';
import { authorizeSocketRoom } from '../modules/socket/socket-room-authorization.js';
import { registerRoomHandlers } from '../modules/socket/socket-room-handlers.js';

/**
 * socket 連線的 token 驗證：只收客服 access token（AUDIT AUTH-05）。
 * refresh token 或粉絲 token 連上會自動加入租戶房間，收到全租戶的訊息。驗證失敗丟錯，由呼叫端拒絕連線。
 */
export function decodeSocketAgentToken(
  verify: (token: string) => unknown,
  token: string,
): { agentId: string; tenantId: string; role: string; roleId?: string | null } {
  const decoded = verify(token) as Record<string, unknown>;
  if (!isAgentAccessToken(decoded)) throw new Error('INVALID_TOKEN_PURPOSE');
  return decoded as unknown as { agentId: string; tenantId: string; role: string; roleId?: string | null };
}

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

      const decoded = decodeSocketAgentToken((t) => fastify.jwt.verify(t), token);

      socket.data.agentId = decoded.agentId;
      socket.data.tenantId = decoded.tenantId;
      socket.data.role = decoded.role;
      // roleId 供房間授權判斷 channel.view_all（總店可見全部）
      socket.data.roleId = decoded.roleId ?? null;

      next();
    } catch {
      next(new Error('登入已過期，請重新登入'));
    }
  });

  io.on('connection', (socket) => {
    const { agentId, tenantId } = socket.data;
    fastify.log.info({ agentId }, 'Socket connected');

    const authorize = async (input: unknown) => authorizeSocketRoom(
      fastify.prismaAdmin,
      { agentId, tenantId, role: socket.data.role, roleId: socket.data.roleId ?? null },
      input,
    );
    registerRoomHandlers(socket, { agentId, tenantId }, authorize, fastify.log);

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

  fastify.addHook('onClose', async () => {
    io.close();
    socketBridgeSub.disconnect();
    fastify.log.info('Socket.IO server closed');
  });
}

export default fp(socketPlugin, {
  name: 'socket',
});
