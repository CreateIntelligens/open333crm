/**
 * 渠道級可見性（CM-173 / channel-scoped-visibility）核心解析。
 *
 * 「總店/分店」場景：單一租戶內多分店，各分店有自己的渠道（LINE/FB/IG OA）。
 * 分店店員只該看到/操作自己渠道來的訊息，總店主管看全部。此檔提供**單一事實來源**
 * —— 解析「某 agent 在當前租戶可見哪些 channelId」，供 REST 查詢與 socket 授權共用，
 * 確保兩層行為一致。
 *
 * 與 Postgres RLS 分層：RLS 管「跨租戶」隔離（租戶 A 讀不到 B）；本檔管「租戶內」
 * 渠道可見性（分店 A 讀不到 B）。查詢一律走 tenantPrisma（RLS session 之上疊加過濾）。
 *
 * 規則（與 socket-room-authorization.ts 既有邏輯對齊）：
 *   - 持有 `channel.view_all`（總店）→ 回哨兵 ALL_CHANNELS，查詢層略過渠道過濾。
 *   - 否則 → agent 所屬 team（AgentTeamMember）被授權的 channel（ChannelTeamAccess），
 *     外加「無任何 teamAccesses 綁定的 legacy channel」（向後相容：未指派團隊的渠道
 *     維持全租戶可見，避免上線當下有人突然看不到）。
 *   - fail-closed：非總店且無任何可見渠道 → 回空集合，查詢結果為空。
 */
import type { FastifyRequest } from 'fastify';
import type { TenantDb } from '../lib/tenant-db.js';
import { getEffectiveTenantPermissions } from './permission.service.js';
import { getTenantPlanId } from './tenant-plan.cache.js';
import { AppError } from '../shared/utils/response.js';

/** 總店（channel.view_all）不受渠道限制的哨兵值。 */
export const ALL_CHANNELS = Symbol('ALL_CHANNELS');

export type AccessibleChannels = typeof ALL_CHANNELS | Set<string>;

export interface VisibilityContext {
  tenantId: string;
  agentId: string;
  /** 是否持有 channel.view_all（總店）。由呼叫端從權限判斷後帶入。 */
  hasViewAll: boolean;
}

/**
 * 解析 agent 在當前租戶的可見 channelId 集合。
 * 回傳 ALL_CHANNELS（總店，不過濾）或 Set<channelId>（可能為空＝fail-closed）。
 */
export async function getAccessibleChannelIds(
  prisma: TenantDb,
  ctx: VisibilityContext,
): Promise<AccessibleChannels> {
  if (ctx.hasViewAll) return ALL_CHANNELS;

  const channels = await prisma.channel.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        // legacy：未指派任何團隊「且」未直綁任何 agent 的渠道 → 全租戶可見（向後相容）
        {
          AND: [
            { teamAccesses: { none: {} } },
            { agentAccesses: { none: {} } },
          ],
        },
        // team 授權：agent 所屬 team 有被授權此渠道
        {
          teamAccesses: {
            some: {
              team: {
                tenantId: ctx.tenantId,
                members: { some: { agentId: ctx.agentId } },
              },
            },
          },
        },
        // agent 直綁：人員設定直接勾選的可用渠道（CM-173 延伸，與 team 授權取聯集）
        { agentAccesses: { some: { agentId: ctx.agentId } } },
      ],
    },
    select: { id: true },
  });

  return new Set(channels.map((c) => c.id));
}

/** 便利判斷：某 channelId 是否在可見集合內（ALL 一律 true）。 */
export function isChannelAccessible(
  accessible: AccessibleChannels,
  channelId: string,
): boolean {
  return accessible === ALL_CHANNELS || accessible.has(channelId);
}

/**
 * 把可見渠道套進 Prisma where 的 channelId 條件。
 * ALL → 不加條件（回 undefined，呼叫端展開時無效果）；
 * Set → `{ in: [...] }`（空集合會產生 `in: []`＝查無資料，即 fail-closed）。
 */
export function channelIdWhereFilter(
  accessible: AccessibleChannels,
): { in: string[] } | undefined {
  if (accessible === ALL_CHANNELS) return undefined;
  return { in: Array.from(accessible) };
}

/**
 * request 層便利函式：判斷當前 agent 是否持有 `channel.view_all`（總店），
 * 再解析其可見渠道集合。查詢層一行呼叫即可。
 * 權限判斷比照 requirePermission guard：角色權限 ∩ 方案天花板。
 */
export async function resolveChannelVisibility(
  request: FastifyRequest,
): Promise<AccessibleChannels> {
  const tenantId = request.agent.tenantId;
  const agentId = request.agent.id;
  const roleId = request.agent.roleId;
  const planId = await getTenantPlanId(request.server.prismaAdmin, tenantId);
  const eff = await getEffectiveTenantPermissions(request.server.prismaAdmin, roleId, planId);
  return getAccessibleChannelIds(request.tenantPrisma, {
    tenantId,
    agentId,
    hasViewAll: eff.has('channel.view_all'),
  });
}

/**
 * 操作守門：assert 當前 agent 對某對話的渠道有可見性，否則丟 403。
 * 用於「回覆/指派/關閉/轉真人」等對話操作端點——不可見渠道的對話不得操作。
 * 找不到對話時不在此丟（交給後續 service 的 404），只擋「可見但無權操作」。
 */
export async function assertConversationChannelVisible(
  request: FastifyRequest,
  conversationId: string,
): Promise<void> {
  const accessible = await resolveChannelVisibility(request);
  if (accessible === ALL_CHANNELS) return;
  const conv = await request.tenantPrisma.conversation.findFirst({
    where: { id: conversationId, tenantId: request.agent.tenantId },
    select: { channelId: true },
  });
  // 對話不存在 → 放行，讓下游回 404（不在此洩漏存在與否以外資訊）
  if (!conv) return;
  if (!accessible.has(conv.channelId)) {
    throw new AppError('Forbidden: channel not accessible', 'FORBIDDEN', 403);
  }
}
