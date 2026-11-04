import fp from 'fastify-plugin';
import { isAgentAccessToken } from '../lib/agent-token.js';
import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import IORedis from 'ioredis';
import { getConfig } from '../config/env.js';
import { authorizeSocketRoom } from '../modules/socket/socket-room-authorization.js';
import { registerRoomHandlers } from '../modules/socket/socket-room-handlers.js';
import type { SocketChannelRoomSync } from '../events/socket-push.js';
import { isActiveAgent, resolveChannelRooms, syncChannelRooms, type SyncableServer } from '../modules/socket/socket-channel-rooms.js';

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

/**
 * socket:emit 訊息的目標房間：`room`（一個非空字串）或 `rooms`（非空陣列，每個元素是非空字串），只能給其中一個。
 * 格式不符（兩個都給、兩個都沒給、空字串）回 null，訊息被丟棄（主規格 core-inbox「socket:emit Message Shape」）。
 */
export function bridgeRooms(payload: { room?: unknown; rooms?: unknown }): string[] | null {
  const isRoomName = (r: unknown): r is string => typeof r === 'string' && r !== '';
  if (payload.room !== undefined && payload.rooms !== undefined) return null;
  if (isRoomName(payload.room)) return [payload.room];
  if (Array.isArray(payload.rooms) && payload.rooms.length > 0 && payload.rooms.every(isRoomName)) return payload.rooms;
  return null;
}

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
    syncSocketChannelRooms: SocketChannelRoomSync;
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
      // 停用或已刪除的成員：access token 還沒過期也不能連線（PR #438 審查）
      if (!await isActiveAgent(fastify.prismaAdmin, decoded)) throw new Error('AGENT_INACTIVE');

      socket.data.agentId = decoded.agentId;
      socket.data.tenantId = decoded.tenantId;
      socket.data.role = decoded.role;
      // roleId 供房間授權判斷 channel.view_all（總店可見全部）
      socket.data.roleId = decoded.roleId ?? null;
      // 渠道房間在連線完成前算好（issue #427）：客戶端收到 connect 時已在該在的房間，不會漏推播
      socket.data.channelRooms = await resolveChannelRooms(fastify.prismaAdmin, fastify.redis, {
        tenantId: decoded.tenantId,
        agentId: decoded.agentId,
      });

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
      fastify.redis,
      // 不用 token 裡的 roleId：連線後角色可能被改（降級），給 null 讓授權每次從資料庫讀目前的角色
      { agentId, tenantId, role: socket.data.role, roleId: null },
      input,
    );
    registerRoomHandlers(
      socket,
      { agentId, tenantId, channelRooms: socket.data.channelRooms ?? [] },
      authorize,
      fastify.log,
    );

    socket.on('disconnect', (reason) => {
      fastify.log.info({ agentId, reason }, 'Socket disconnected');
    });
  });

  fastify.decorate('io', io);
  // 重新計算已連線 socket 的渠道房間（issue #427）。失敗只記 log、不丟錯：
  // 授權已經寫入，該成員重新連線時仍會依新授權加入房間
  const syncSocketChannelRooms: SocketChannelRoomSync = async (tenantId, agentId) => {
    try {
      await syncChannelRooms(io as unknown as SyncableServer, fastify.prismaAdmin, fastify.redis, tenantId, agentId);
    } catch (err) {
      fastify.log.warn({ err, tenantId, agentId }, '[Socket] 重新計算渠道房間失敗，成員重新連線後生效');
    }
  };
  fastify.decorate('syncSocketChannelRooms', syncSocketChannelRooms);

  // ── Redis pub/sub bridge — forward events from standalone workers ────────────
  const socketBridgeSub = new IORedis(config.REDIS_URL);
  await socketBridgeSub.subscribe('socket:emit');
  socketBridgeSub.on('message', (_channel, message) => {
    try {
      const payload = JSON.parse(message) as { room?: unknown; rooms?: unknown; event?: unknown; data?: unknown; namespace?: string };
      const rooms = bridgeRooms(payload);
      if (!rooms || typeof payload.event !== 'string') {
        fastify.log.warn({ message }, '[SocketBridge] Malformed message, discarding');
        return;
      }
      const ns = typeof payload.namespace === 'string' ? io.of(payload.namespace) : io;
      // 多個房間用一次 to() 送出：同一個連線在多個房間也只收到一次（渠道推播，issue #427）
      ns.to(rooms).emit(payload.event as any, payload.data);
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
