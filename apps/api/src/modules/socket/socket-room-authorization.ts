import type { PrismaClient } from '@open333crm/database';
import { getEffectiveTenantPermissions } from '../../services/permission.service.js';
import { getTenantPlanId } from '../../services/tenant-plan.cache.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_TYPES = new Set(['tenant', 'agent', 'team', 'channel', 'conversation']);

export interface SocketAuthorizationContext {
  agentId: string;
  tenantId: string;
  role: string;
  /** 當前 agent 的角色 ID，供 channel.view_all 權限判斷（總店）。JWT 帶入。 */
  roleId: string | null;
}

export interface SocketRoomTarget {
  type: 'tenant' | 'agent' | 'team' | 'channel' | 'conversation';
  id: string;
}

export type SocketRoomAuthorizationResult =
  | { ok: true; room: string }
  | { ok: false; code: 'INVALID_TARGET' | 'FORBIDDEN' };

function parseTarget(input: unknown): SocketRoomTarget | null {
  if (typeof input === 'string') {
    const separator = input.indexOf(':');
    if (separator <= 0 || separator === input.length - 1) return null;

    const type = input.slice(0, separator);
    const id = input.slice(separator + 1);
    if (!ROOM_TYPES.has(type) || !UUID_RE.test(id)) return null;
    return { type: type as SocketRoomTarget['type'], id };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const target = input as { type?: unknown; id?: unknown };
  if (typeof target.type !== 'string' || !ROOM_TYPES.has(target.type)) return null;
  if (typeof target.id !== 'string' || !UUID_RE.test(target.id)) return null;
  return { type: target.type as SocketRoomTarget['type'], id: target.id };
}

/**
 * 判斷當前 agent 是否持有 `channel.view_all`（總店）。
 * 判定方式比照 requirePermission guard：有效權限 = 角色權限 ∩ 方案功能天花板。
 * 取代舊的角色白名單（ADMIN/SUPERVISOR），改由 RBAC 權限點驅動總店可見全部。
 *
 * 注意：socket plugin 傳入的是 prismaAdmin，權限/方案查詢需以 admin client 執行
 * （與 rbac.guard、channel-visibility 一致），故此處直接沿用同一個 prisma 參數。
 */
async function resolveHasViewAll(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
): Promise<boolean> {
  const planId = await getTenantPlanId(prisma, context.tenantId);
  const eff = await getEffectiveTenantPermissions(prisma, context.roleId, planId);
  return eff.has('channel.view_all');
}

async function canAccessTeam(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  hasViewAll: boolean,
  teamId: string,
): Promise<boolean> {
  if (hasViewAll) {
    return Boolean(await prisma.team.findFirst({
      where: { id: teamId, tenantId: context.tenantId },
      select: { id: true },
    }));
  }

  return Boolean(await prisma.team.findFirst({
    where: {
      id: teamId,
      tenantId: context.tenantId,
      members: { some: { agentId: context.agentId } },
    },
    select: { id: true },
  }));
}

async function canAccessChannel(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  hasViewAll: boolean,
  channelId: string,
): Promise<boolean> {
  if (hasViewAll) {
    return Boolean(await prisma.channel.findFirst({
      where: { id: channelId, tenantId: context.tenantId, isActive: true },
      select: { id: true },
    }));
  }

  return Boolean(await prisma.channel.findFirst({
    where: {
      id: channelId,
      tenantId: context.tenantId,
      isActive: true,
      OR: [
        // Legacy channels without explicit team bindings remain open to
        // agents in the same tenant.
        { teamAccesses: { none: {} } },
        {
          teamAccesses: {
            some: {
              team: { tenantId: context.tenantId, members: { some: { agentId: context.agentId } } },
            },
          },
        },
      ],
    },
    select: { id: true },
  }));
}

async function canAccessConversation(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  hasViewAll: boolean,
  conversationId: string,
): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId: context.tenantId },
    select: { id: true, teamId: true, assignedToId: true, channelId: true },
  });
  if (!conversation) return false;
  if (hasViewAll) return true;
  if (conversation.assignedToId === context.agentId) return true;

  if (conversation.teamId) return canAccessTeam(prisma, context, hasViewAll, conversation.teamId);
  return canAccessChannel(prisma, context, hasViewAll, conversation.channelId);
}

async function isAuthorized(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  hasViewAll: boolean,
  target: SocketRoomTarget,
): Promise<boolean> {
  switch (target.type) {
    case 'tenant':
      return target.id === context.tenantId;
    case 'agent':
      if (target.id === context.agentId) return true;
      return hasViewAll && Boolean(await prisma.agent.findFirst({
        where: { id: target.id, tenantId: context.tenantId },
        select: { id: true },
      }));
    case 'team':
      return canAccessTeam(prisma, context, hasViewAll, target.id);
    case 'channel':
      return canAccessChannel(prisma, context, hasViewAll, target.id);
    case 'conversation':
      return canAccessConversation(prisma, context, hasViewAll, target.id);
  }
}

export async function authorizeSocketRoom(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  input: unknown,
): Promise<SocketRoomAuthorizationResult> {
  const target = parseTarget(input);
  if (!target) return { ok: false, code: 'INVALID_TARGET' };
  // 總店判定：一次解析 channel.view_all 權限，往下傳給各 helper（取代舊角色白名單）。
  // tenant/agent(自己) 房間其實不需要此判斷，但集中在此解析可讓各 case 一致取用。
  const hasViewAll = await resolveHasViewAll(prisma, context);
  if (!await isAuthorized(prisma, context, hasViewAll, target)) return { ok: false, code: 'FORBIDDEN' };

  return { ok: true, room: `${target.type}:${target.id}` };
}
