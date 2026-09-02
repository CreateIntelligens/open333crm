import type { PrismaClient } from '@open333crm/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_TYPES = new Set(['tenant', 'agent', 'team', 'channel', 'conversation']);

export interface SocketAuthorizationContext {
  agentId: string;
  tenantId: string;
  role: string;
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

function isElevatedRole(role: string): boolean {
  return role === 'ADMIN' || role === 'SUPERVISOR';
}

async function canAccessTeam(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  teamId: string,
): Promise<boolean> {
  if (isElevatedRole(context.role)) {
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
  channelId: string,
): Promise<boolean> {
  if (isElevatedRole(context.role)) {
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
      teamAccesses: {
        some: {
          team: { tenantId: context.tenantId, members: { some: { agentId: context.agentId } } },
        },
      },
    },
    select: { id: true },
  }));
}

async function canAccessConversation(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  conversationId: string,
): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId: context.tenantId },
    select: { id: true, teamId: true, assignedToId: true, channelId: true },
  });
  if (!conversation) return false;
  if (isElevatedRole(context.role)) return true;
  if (conversation.assignedToId === context.agentId) return true;

  if (conversation.teamId && await canAccessTeam(prisma, context, conversation.teamId)) return true;
  return canAccessChannel(prisma, context, conversation.channelId);
}

async function isAuthorized(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  target: SocketRoomTarget,
): Promise<boolean> {
  switch (target.type) {
    case 'tenant':
      return target.id === context.tenantId;
    case 'agent':
      if (target.id === context.agentId) return true;
      return isElevatedRole(context.role) && Boolean(await prisma.agent.findFirst({
        where: { id: target.id, tenantId: context.tenantId },
        select: { id: true },
      }));
    case 'team':
      return canAccessTeam(prisma, context, target.id);
    case 'channel':
      return canAccessChannel(prisma, context, target.id);
    case 'conversation':
      return canAccessConversation(prisma, context, target.id);
  }
}

export async function authorizeSocketRoom(
  prisma: PrismaClient,
  context: SocketAuthorizationContext,
  input: unknown,
): Promise<SocketRoomAuthorizationResult> {
  const target = parseTarget(input);
  if (!target) return { ok: false, code: 'INVALID_TARGET' };
  if (!await isAuthorized(prisma, context, target)) return { ok: false, code: 'FORBIDDEN' };

  return { ok: true, room: `${target.type}:${target.id}` };
}
