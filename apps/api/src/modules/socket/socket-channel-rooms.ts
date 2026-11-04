/**
 * 成員連線的渠道房間（issue #427，主規格 socket-room-authorization「連線時加入的房間」
 * 與「授權變更時重新計算房間」）。
 *
 * 渠道相關推播（message.new、conversation.*）只送到渠道房間（events/socket-push.ts）。
 * 連線時依可見渠道（services/channel-visibility.ts，與 REST 同一個判斷）加入：
 *   - 有 channel.view_all（總店）→ 總店房間，之後新增的渠道不必重新加入
 *   - 否則 → 每個看得到的渠道各一個房間；沒有任何授權時不加入渠道房間（fail-closed）
 *
 * 授權變更（成員可用渠道、角色、角色權限、成員停用與刪除、渠道新增停用刪除、渠道團隊授權、
 * 方案異動）後，入口呼叫 syncChannelRooms 重新計算已連線 socket 的房間，並重新授權 subscribe 加入的房間。
 * 停用或已刪除的成員不重新計算，直接斷開他的連線；連線時也拒絕這些成員（isActiveAgent）。
 * 團隊成員目前沒有 API 可以修改，所以沒有對應的呼叫。
 *
 * `prisma` 是 BYPASSRLS 的連線（socket plugin 傳入 prismaAdmin）：每個查詢自帶 tenantId。
 */
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@open333crm/database';
import { isTenantChannelScopedRoom, tenantAllChannelsRoom, tenantChannelRoom } from '@open333crm/shared';
import { ALL_CHANNELS, resolveAgentChannelVisibility } from '../../services/channel-visibility.js';
import { agentPushRoom, tenantPushRoom } from '../../events/socket-push.js';
import { authorizeSocketRoom } from './socket-room-authorization.js';

/** 成員應該在的渠道房間 */
export async function resolveChannelRooms(
  prisma: PrismaClient,
  redis: Redis,
  identity: { tenantId: string; agentId: string },
): Promise<string[]> {
  const visible = await resolveAgentChannelVisibility(prisma, redis, identity.tenantId, identity.agentId);
  if (visible === ALL_CHANNELS) return [tenantAllChannelsRoom(identity.tenantId)];
  return [...visible].map((channelId) => tenantChannelRoom(identity.tenantId, channelId));
}

/** 成員存在且啟用中。停用或已刪除的成員不能連線，已連線的在重新計算時斷開（PR #438 審查） */
export async function isActiveAgent(
  prisma: PrismaClient,
  identity: { tenantId: string; agentId: string },
): Promise<boolean> {
  const agent = await prisma.agent.findFirst({
    where: { id: identity.agentId, tenantId: identity.tenantId },
    select: { isActive: true },
  });
  return agent?.isActive === true;
}

/** syncChannelRooms 用到的 socket 方法（Socket.IO 的 RemoteSocket） */
export interface SyncableSocket {
  rooms: Set<string>;
  data: { agentId?: string; tenantId?: string; role?: string };
  join(room: string | string[]): unknown;
  leave(room: string): unknown;
  disconnect(close?: boolean): unknown;
}

export interface SyncableServer {
  in(room: string): { fetchSockets(): Promise<SyncableSocket[]> };
}

/** subscribe 能加入的房間格式（socket-room-authorization）：`<類型>:<UUID>` */
const SUBSCRIBED_ROOM_RE = /^(tenant|agent|team|channel|conversation):[0-9a-f-]{36}$/i;

/**
 * 重新計算已連線 socket 的渠道房間。給 agentId 時只算該成員的連線，否則算本租戶所有連線。
 * subscribe 加入的房間（對話、渠道、團隊、其他成員）也重新授權，不再符合時離開。
 * 成員已停用或已刪除時斷開他的連線：他也在 tenant: 與成員房間，只離開渠道房間仍會收到其他推播。
 */
export async function syncChannelRooms(
  io: SyncableServer,
  prisma: PrismaClient,
  redis: Redis,
  tenantId: string,
  agentId?: string,
): Promise<void> {
  const sockets = await io.in(agentId ? agentPushRoom(tenantId, agentId) : tenantPushRoom(tenantId)).fetchSockets();
  const roomsByAgent = new Map<string, Promise<string[]>>();
  const activeByAgent = new Map<string, Promise<boolean>>();

  for (const socket of sockets) {
    const socketAgentId = socket.data.agentId;
    if (!socketAgentId || socket.data.tenantId !== tenantId) continue;
    if (!activeByAgent.has(socketAgentId)) {
      activeByAgent.set(socketAgentId, isActiveAgent(prisma, { tenantId, agentId: socketAgentId }));
    }
    if (!(await activeByAgent.get(socketAgentId)!)) {
      socket.disconnect(true);
      continue;
    }
    if (!roomsByAgent.has(socketAgentId)) {
      roomsByAgent.set(socketAgentId, resolveChannelRooms(prisma, redis, { tenantId, agentId: socketAgentId }));
    }
    const target = new Set(await roomsByAgent.get(socketAgentId)!);

    for (const room of [...socket.rooms]) {
      if (isTenantChannelScopedRoom(tenantId, room) && !target.has(room)) socket.leave(room);
    }
    const missing = [...target].filter((room) => !socket.rooms.has(room));
    if (missing.length > 0) socket.join(missing);

    for (const room of [...socket.rooms]) {
      if (!SUBSCRIBED_ROOM_RE.test(room) || room === tenantPushRoom(tenantId)) continue;
      const result = await authorizeSocketRoom(prisma, redis, {
        agentId: socketAgentId,
        tenantId,
        role: socket.data.role ?? '',
        // 不用 token 裡的 roleId：角色剛被改時它是舊的；給 null 讓授權從資料庫讀目前的角色
        roleId: null,
      }, room);
      if (!result.ok) socket.leave(room);
    }
  }
}
