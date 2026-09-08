/**
 * 渠道↔團隊指派（ChannelTeamAccess）真實資料存取（CM-173）。
 *
 * 原為 in-memory mock（寫死 mock-line-channel-id/team_sales）；改為 Prisma 真 DB，
 * 對 `channel_team_accesses`（@@id([channelId, teamId])）做讀寫，並在租戶邊界內驗證
 * channel/team 同屬一租戶。可見性「解析」在 channel-visibility.ts（getAccessibleChannelIds）；
 * 本檔負責「管理」（grant/revoke/list）與 access-level 檢查。
 */
import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../lib/tenant-db.js';
import { AppError } from '../shared/utils/response.js';

export type ChannelTeamAccessLevel = 'read_only' | 'reply_only' | 'full';

export interface ChannelTeamAccessRow {
  channelId: string;
  teamId: string;
  accessLevel: ChannelTeamAccessLevel;
  grantedAt: Date;
  grantedById: string | null;
}

const LEVEL_ORDER: ChannelTeamAccessLevel[] = ['read_only', 'reply_only', 'full'];

/**
 * 指派渠道給團隊（upsert）。channel 與 team 必須同屬 tenantId，否則拒絕。
 */
export async function grantChannelTeamAccess(
  prisma: TenantDb,
  tenantId: string,
  params: {
    channelId: string;
    teamId: string;
    accessLevel: ChannelTeamAccessLevel;
    grantedById?: string;
  },
): Promise<ChannelTeamAccessRow> {
  // 租戶邊界檢查：channel 與 team 都要屬於本租戶（走 tenantPrisma，RLS 亦會擋跨租戶）
  const [channel, team] = await Promise.all([
    prisma.channel.findFirst({ where: { id: params.channelId, tenantId }, select: { id: true } }),
    prisma.team.findFirst({ where: { id: params.teamId, tenantId }, select: { id: true } }),
  ]);
  if (!channel) throw new AppError('Channel not found', 'NOT_FOUND', 404);
  if (!team) throw new AppError('Team not found', 'NOT_FOUND', 404);

  const row = await prisma.channelTeamAccess.upsert({
    where: { channelId_teamId: { channelId: params.channelId, teamId: params.teamId } },
    create: {
      channelId: params.channelId,
      teamId: params.teamId,
      accessLevel: params.accessLevel,
      grantedById: params.grantedById ?? null,
    },
    update: { accessLevel: params.accessLevel, grantedById: params.grantedById ?? null },
  });
  return row as ChannelTeamAccessRow;
}

/** 撤銷指派。回傳是否有刪到列。 */
export async function revokeChannelTeamAccess(
  prisma: TenantDb,
  tenantId: string,
  channelId: string,
  teamId: string,
): Promise<boolean> {
  // 先確認 channel 屬本租戶（避免撤銷他租戶資料；RLS 亦保護）
  const channel = await prisma.channel.findFirst({ where: { id: channelId, tenantId }, select: { id: true } });
  if (!channel) return false;
  const res = await prisma.channelTeamAccess.deleteMany({ where: { channelId, teamId } });
  return res.count > 0;
}

/** 某渠道被指派給哪些團隊。 */
export async function listTeamsForChannel(
  prisma: TenantDb,
  tenantId: string,
  channelId: string,
): Promise<ChannelTeamAccessRow[]> {
  const channel = await prisma.channel.findFirst({ where: { id: channelId, tenantId }, select: { id: true } });
  if (!channel) return [];
  const rows = await prisma.channelTeamAccess.findMany({ where: { channelId } });
  return rows as ChannelTeamAccessRow[];
}

/** 某團隊可見哪些渠道。 */
export async function listChannelsForTeam(
  prisma: TenantDb,
  tenantId: string,
  teamId: string,
): Promise<ChannelTeamAccessRow[]> {
  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId }, select: { id: true } });
  if (!team) return [];
  const rows = await prisma.channelTeamAccess.findMany({ where: { teamId } });
  return rows as ChannelTeamAccessRow[];
}

/**
 * 檢查某 team 對某 channel 是否有達到 requiredLevel 的存取。
 * 找不到指派 → 無存取；level 不足 → 無存取。
 */
export async function checkChannelTeamAccess(
  prisma: TenantDb,
  params: { channelId: string; teamId: string; requiredLevel?: ChannelTeamAccessLevel },
): Promise<{ hasAccess: boolean; level?: ChannelTeamAccessLevel }> {
  const row = await prisma.channelTeamAccess.findUnique({
    where: { channelId_teamId: { channelId: params.channelId, teamId: params.teamId } },
    select: { accessLevel: true },
  });
  if (!row) return { hasAccess: false };
  const level = row.accessLevel as ChannelTeamAccessLevel;
  if (params.requiredLevel) {
    if (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(params.requiredLevel)) {
      return { hasAccess: false, level };
    }
  }
  return { hasAccess: true, level };
}
