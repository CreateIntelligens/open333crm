import { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { ALL_CHANNELS, channelIdWhere, channelIdWhereFilter, type AccessibleChannels } from '../../services/channel-visibility.js';
import { channelDisplayName, csvRow } from '@open333crm/shared';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function groupByClause(groupBy: string) {
  switch (groupBy) {
    case 'week':
      return Prisma.sql`date_trunc('week', m."createdAt")`;
    case 'month':
      return Prisma.sql`date_trunc('month', m."createdAt")`;
    default:
      return Prisma.sql`date_trunc('day', m."createdAt")`;
  }
}

/*
 * 渠道可見範圍（channel-scoped-visibility「報表只統計可見渠道」）：每個報表收成員的可見渠道，
 * 總店（ALL_CHANNELS）不加條件；空集合等於什麼都看不到。
 */

/** `AND <column> = ANY(可見渠道)`；總店回空片段 */
function channelSql(accessible: AccessibleChannels, column: string) {
  const ids = channelIdWhereFilter(accessible);
  return ids ? Prisma.sql`AND ${Prisma.raw(column)} = ANY(${ids.in}::uuid[])` : Prisma.empty;
}

/**
 * 聯絡人可見，規則同 contact.service 的 isContactVisible()：有可見渠道的身份，或沒有身份且沒有被合併；
 * 已被合併、身份都移走的聯絡人依直接保留方判斷（只看一層）。
 */
function contactSql(accessible: AccessibleChannels, contactIdColumn: string) {
  const ids = channelIdWhereFilter(accessible);
  if (!ids) return Prisma.empty;
  const col = Prisma.raw(contactIdColumn);
  const directlyVisible = (contactId: Prisma.Sql) => Prisma.sql`(
    EXISTS (SELECT 1 FROM channel_identities vci WHERE vci."contactId" = ${contactId} AND vci."channelId" = ANY(${ids.in}::uuid[]))
    OR (
      NOT EXISTS (SELECT 1 FROM channel_identities vci WHERE vci."contactId" = ${contactId})
      AND EXISTS (SELECT 1 FROM contacts vc WHERE vc.id = ${contactId} AND vc."mergedIntoId" IS NULL)
    )
  )`;
  return Prisma.sql`AND (
    ${directlyVisible(col)}
    OR EXISTS (
      SELECT 1 FROM contacts merged
      WHERE merged.id = ${col}
        AND merged."mergedIntoId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM channel_identities mci WHERE mci."contactId" = merged.id)
        AND ${directlyVisible(Prisma.raw('merged."mergedIntoId"'))}
    )
  )`;
}

/** Prisma where 的工單渠道條件；總店回空物件 */
function caseChannelWhere(accessible: AccessibleChannels): Prisma.CaseWhereInput {
  return channelIdWhere(accessible);
}

/* -------------------------------------------------------------------------- */
/*  2a. Overview Stats                                                         */
/* -------------------------------------------------------------------------- */

export async function getOverviewStats(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  from: Date,
  to: Date,
) {
  // Total messages in range (via conversations belonging to tenant)
  const messageStats = await ctx.tx.$queryRaw<
    { total: bigint; inbound: bigint; outbound: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE m.direction = 'INBOUND')::bigint AS inbound,
      COUNT(*) FILTER (WHERE m.direction = 'OUTBOUND')::bigint AS outbound
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${ctx.tenantId}::uuid
      AND m."createdAt" >= ${from}
      AND m."createdAt" <= ${to}
      ${channelSql(accessible, 'c."channelId"')}
  `;

  const msg = messageStats[0] || { total: 0n, inbound: 0n, outbound: 0n };

  // Open cases (current snapshot)
  const openCases = await ctx.tx.case.count({
    where: {
      tenantId: ctx.tenantId,
      status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] },
      ...caseChannelWhere(accessible),
    },
  });

  // New cases in range
  const newCases = await ctx.tx.case.count({
    where: {
      tenantId: ctx.tenantId,
      createdAt: { gte: from, lte: to },
      ...caseChannelWhere(accessible),
    },
  });

  // Resolved cases in range
  const resolvedCases = await ctx.tx.case.count({
    where: {
      tenantId: ctx.tenantId,
      resolvedAt: { gte: from, lte: to, not: null },
      ...caseChannelWhere(accessible),
    },
  });

  // SLA achievement rate
  const slaRows = await ctx.tx.$queryRaw<
    { total: bigint; achieved: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "resolvedAt" <= "slaDueAt")::bigint AS achieved
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "resolvedAt" IS NOT NULL
      AND "slaDueAt" IS NOT NULL
      AND "resolvedAt" >= ${from}
      AND "resolvedAt" <= ${to}
  `;
  const sla = slaRows[0] || { total: 0n, achieved: 0n };
  const slaAchievementRate =
    Number(sla.total) > 0
      ? Math.round((Number(sla.achieved) / Number(sla.total)) * 100)
      : null;

  // Avg first response & resolution times
  const timeRows = await ctx.tx.$queryRaw<
    { avg_first_response: number | null; avg_resolution: number | null }[]
  >`
    SELECT
      AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)
        FILTER (WHERE "firstResponseAt" IS NOT NULL) AS avg_first_response,
      AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 60)
        FILTER (WHERE "resolvedAt" IS NOT NULL) AS avg_resolution
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  const times = timeRows[0] || { avg_first_response: null, avg_resolution: null };

  // CSAT：平均與好評率只算客人自評，客服代評另計筆數（issue #339 決定 8）。
  // 沒有來源的舊評分（csatRatedBy 是 NULL）視為客人自評，所以用 IS DISTINCT FROM，不用 <>（<> 會排除 NULL）
  const csatRows = await ctx.tx.$queryRaw<
    { avg_score: number | null; total: bigint; positive: bigint; agent_rated: bigint }[]
  >`
    SELECT
      (AVG("csatScore") FILTER (WHERE "csatRatedBy" IS DISTINCT FROM 'agent'))::float AS avg_score,
      COUNT(*) FILTER (WHERE "csatRatedBy" IS DISTINCT FROM 'agent')::bigint AS total,
      COUNT(*) FILTER (WHERE "csatRatedBy" IS DISTINCT FROM 'agent' AND "csatScore" >= 4)::bigint AS positive,
      COUNT(*) FILTER (WHERE "csatRatedBy" = 'agent')::bigint AS agent_rated
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "csatScore" IS NOT NULL
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  const csat = csatRows[0] || { avg_score: null, total: 0n, positive: 0n, agent_rated: 0n };

  return {
    totalMessages: Number(msg.total),
    inboundMessages: Number(msg.inbound),
    outboundMessages: Number(msg.outbound),
    openCases,
    newCases,
    resolvedCases,
    slaAchievementRate,
    avgFirstResponseMinutes: times.avg_first_response
      ? Math.round(times.avg_first_response * 10) / 10
      : null,
    avgResolutionMinutes: times.avg_resolution
      ? Math.round(times.avg_resolution * 10) / 10
      : null,
    csatAvg: csat.avg_score ? Math.round(csat.avg_score * 10) / 10 : null,
    csatPositiveRate:
      Number(csat.total) > 0
        ? Math.round((Number(csat.positive) / Number(csat.total)) * 100)
        : null,
    /** 期間內客服代評的工單數，不計入 csatAvg 與 csatPositiveRate */
    csatAgentRatedCount: Number(csat.agent_rated),
  };
}

/* -------------------------------------------------------------------------- */
/*  2b. Message Trend                                                          */
/* -------------------------------------------------------------------------- */

export async function getMessageTrend(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  from: Date,
  to: Date,
  groupBy: string = 'day',
) {
  const trunc = groupByClause(groupBy);

  const rows = await ctx.tx.$queryRaw<
    { date: Date; channel_type: string; count: bigint }[]
  >`
    SELECT
      ${trunc} AS date,
      c."channelType" AS channel_type,
      COUNT(*)::bigint AS count
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${ctx.tenantId}::uuid
      AND m."createdAt" >= ${from}
      AND m."createdAt" <= ${to}
      ${channelSql(accessible, 'c."channelId"')}
    GROUP BY 1, 2
    ORDER BY 1
  `;

  // Pivot: { date, LINE, FB, WEBCHAT, total }
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = toIso(row.date);
    if (!map.has(key)) {
      map.set(key, { LINE: 0, FB: 0, WEBCHAT: 0, WHATSAPP: 0, total: 0 });
    }
    const entry = map.get(key)!;
    const cnt = Number(row.count);
    entry[row.channel_type] = (entry[row.channel_type] || 0) + cnt;
    entry.total += cnt;
  }

  return Array.from(map.entries()).map(([date, vals]) => ({
    date,
    ...vals,
  }));
}

/* -------------------------------------------------------------------------- */
/*  2c. Case Stats                                                             */
/* -------------------------------------------------------------------------- */

export async function getCaseStats(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  from: Date,
  to: Date,
) {
  // Trend: daily opened / closed
  const trendRows = await ctx.tx.$queryRaw<
    { date: Date; opened: bigint; closed: bigint }[]
  >`
    SELECT
      date_trunc('day', "createdAt") AS date,
      COUNT(*)::bigint AS opened,
      COUNT(*) FILTER (WHERE "resolvedAt" IS NOT NULL)::bigint AS closed
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;

  const trend = trendRows.map((r) => ({
    date: toIso(r.date),
    opened: Number(r.opened),
    closed: Number(r.closed),
  }));

  // Category distribution
  const categoryRows = await ctx.tx.$queryRaw<
    { category: string | null; count: bigint }[]
  >`
    SELECT COALESCE(category, '未分類') AS category, COUNT(*)::bigint AS count
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
    ORDER BY count DESC
  `;

  const categoryDistribution = categoryRows.map((r) => ({
    name: r.category || '未分類',
    value: Number(r.count),
  }));

  // Priority distribution
  const priorityRows = await ctx.tx.$queryRaw<
    { priority: string; count: bigint }[]
  >`
    SELECT priority, COUNT(*)::bigint AS count
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
    -- 固定順序：每日彙總存下的分布與即時報表要一致
    ORDER BY 1
  `;

  const priorityDistribution = priorityRows.map((r) => ({
    name: r.priority,
    value: Number(r.count),
  }));

  // Status distribution
  const statusRows = await ctx.tx.$queryRaw<
    { status: string; count: bigint }[]
  >`
    SELECT status, COUNT(*)::bigint AS count
    FROM cases
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
    -- 固定順序：每日彙總存下的分布與即時報表要一致
    ORDER BY 1
  `;

  const statusDistribution = statusRows.map((r) => ({
    name: r.status,
    value: Number(r.count),
  }));

  // SLA violations
  const slaViolations = await ctx.tx.case.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { notIn: ['CLOSED', 'RESOLVED'] },
      slaDueAt: { lt: new Date() },
      ...caseChannelWhere(accessible),
    },
    include: {
      assignee: { select: { id: true, name: true } },
      contact: { select: { id: true, displayName: true } },
    },
    orderBy: { slaDueAt: 'asc' },
    take: 50,
  });

  // Escalation rate
  const totalInRange = await ctx.tx.case.count({
    where: { tenantId: ctx.tenantId, createdAt: { gte: from, lte: to }, ...caseChannelWhere(accessible) },
  });
  const escalatedInRange = await ctx.tx.case.count({
    where: { tenantId: ctx.tenantId, createdAt: { gte: from, lte: to }, status: 'ESCALATED', ...caseChannelWhere(accessible) },
  });
  const escalationRate =
    totalInRange > 0
      ? Math.round((escalatedInRange / totalInRange) * 100)
      : 0;

  return {
    trend,
    categoryDistribution,
    priorityDistribution,
    statusDistribution,
    slaViolations,
    escalationRate,
  };
}

/* -------------------------------------------------------------------------- */
/*  2d. Agent Performance                                                      */
/* -------------------------------------------------------------------------- */

export async function getAgentPerformance(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  from: Date,
  to: Date,
  agentId?: string,
) {
  // 過濾客服本身（a.id）：以 c."assigneeId" 過濾時，期間內沒有工單的客服會因 LEFT JOIN 沒有對到而消失
  const agentFilter = agentId ? Prisma.sql`AND a.id = ${agentId}::uuid` : Prisma.sql``;
  // 非總店只列出被授權任一可見渠道（直綁或所屬團隊）、或在可見渠道有工單的客服（channel-scoped-visibility）：
  // 同分店期間內沒有工單的客服照常以 0 列出，其他分店的客服不列出
  const visibleIds = channelIdWhereFilter(accessible);
  const visibleAgentsOnly = visibleIds
    ? Prisma.sql`HAVING COUNT(c.id) > 0
      OR EXISTS (SELECT 1 FROM agent_channel_accesses aca WHERE aca."agentId" = a.id AND aca."channelId" = ANY(${visibleIds.in}::uuid[]))
      OR EXISTS (
        SELECT 1 FROM agent_team_members atm
        JOIN channel_team_accesses cta ON cta."teamId" = atm."teamId"
        WHERE atm."agentId" = a.id AND cta."channelId" = ANY(${visibleIds.in}::uuid[])
      )`
    : Prisma.empty;

  const rows = await ctx.tx.$queryRaw<
    {
      agent_id: string;
      agent_name: string;
      agent_role: string;
      cases_handled: bigint;
      cases_resolved: bigint;
      avg_first_response: number | null;
      avg_resolution: number | null;
      csat_avg: number | null;
      sla_total: bigint;
      sla_achieved: bigint;
    }[]
  >`
    SELECT
      a.id AS agent_id,
      a.name AS agent_name,
      a.role AS agent_role,
      COUNT(c.id)::bigint AS cases_handled,
      COUNT(c.id) FILTER (WHERE c."resolvedAt" IS NOT NULL)::bigint AS cases_resolved,
      AVG(EXTRACT(EPOCH FROM (c."firstResponseAt" - c."createdAt")) / 60)
        FILTER (WHERE c."firstResponseAt" IS NOT NULL) AS avg_first_response,
      AVG(EXTRACT(EPOCH FROM (c."resolvedAt" - c."createdAt")) / 60)
        FILTER (WHERE c."resolvedAt" IS NOT NULL) AS avg_resolution,
      -- 只算客人自評（issue #339 決定 8）：客服代評不算進客服自己的滿意度
      (AVG(c."csatScore") FILTER (WHERE c."csatScore" IS NOT NULL AND c."csatRatedBy" IS DISTINCT FROM 'agent'))::float AS csat_avg,
      COUNT(c.id) FILTER (WHERE c."slaDueAt" IS NOT NULL AND c."resolvedAt" IS NOT NULL)::bigint AS sla_total,
      COUNT(c.id) FILTER (WHERE c."slaDueAt" IS NOT NULL AND c."resolvedAt" IS NOT NULL AND c."resolvedAt" <= c."slaDueAt")::bigint AS sla_achieved
    FROM agents a
    LEFT JOIN cases c ON c."assigneeId" = a.id
      AND c."createdAt" >= ${from}
      AND c."createdAt" <= ${to}
      ${channelSql(accessible, 'c."channelId"')}
    WHERE a."tenantId" = ${ctx.tenantId}::uuid
      AND a."isActive" = true
      ${agentFilter}
    GROUP BY a.id, a.name, a.role
    ${visibleAgentsOnly}
    ORDER BY cases_handled DESC
  `;

  return rows.map((r) => ({
    agentId: r.agent_id,
    name: r.agent_name,
    role: r.agent_role,
    casesHandled: Number(r.cases_handled),
    casesResolved: Number(r.cases_resolved),
    avgFirstResponseMinutes: r.avg_first_response
      ? Math.round(r.avg_first_response * 10) / 10
      : null,
    avgResolutionMinutes: r.avg_resolution
      ? Math.round(r.avg_resolution * 10) / 10
      : null,
    csatAvg: r.csat_avg ? Math.round(r.csat_avg * 10) / 10 : null,
    slaAchievementRate:
      Number(r.sla_total) > 0
        ? Math.round((Number(r.sla_achieved) / Number(r.sla_total)) * 100)
        : null,
  }));
}

/* -------------------------------------------------------------------------- */
/*  2e. Channel Analytics                                                      */
/* -------------------------------------------------------------------------- */

export async function getChannelAnalytics(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  from: Date,
  to: Date,
) {
  // Messages per channel
  const msgRows = await ctx.tx.$queryRaw<
    { channel_type: string; count: bigint }[]
  >`
    SELECT c."channelType" AS channel_type, COUNT(*)::bigint AS count
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${ctx.tenantId}::uuid
      AND m."createdAt" >= ${from}
      AND m."createdAt" <= ${to}
      ${channelSql(accessible, 'c."channelId"')}
    GROUP BY 1
  `;

  const messagesByChannel = msgRows.map((r) => ({
    name: r.channel_type,
    value: Number(r.count),
  }));

  // Conversations per channel
  const convRows = await ctx.tx.$queryRaw<
    { channel_type: string; count: bigint }[]
  >`
    SELECT "channelType" AS channel_type, COUNT(*)::bigint AS count
    FROM conversations
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
  `;

  const conversationsByChannel = convRows.map((r) => ({
    name: r.channel_type,
    value: Number(r.count),
  }));

  // Bot vs human
  const botHumanRows = await ctx.tx.$queryRaw<
    { status: string; count: bigint }[]
  >`
    SELECT status, COUNT(*)::bigint AS count
    FROM conversations
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
      AND status IN ('BOT_HANDLED', 'AGENT_HANDLED')
    GROUP BY 1
  `;

  const botVsHuman = botHumanRows.map((r) => ({
    name: r.status === 'BOT_HANDLED' ? 'Bot 處理' : '人工處理',
    value: Number(r.count),
  }));

  // New contacts per channel
  const contactRows = await ctx.tx.$queryRaw<
    { channel_type: string; count: bigint }[]
  >`
    SELECT ci."channelType" AS channel_type, COUNT(*)::bigint AS count
    FROM channel_identities ci
    JOIN contacts c ON c.id = ci."contactId"
    WHERE c."tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, 'ci."channelId"')}
      AND ci."linkedAt" >= ${from}
      AND ci."linkedAt" <= ${to}
    GROUP BY 1
  `;

  const newContactsByChannel = contactRows.map((r) => ({
    name: r.channel_type,
    value: Number(r.count),
  }));

  return {
    messagesByChannel,
    conversationsByChannel,
    botVsHuman,
    newContactsByChannel,
  };
}

/* -------------------------------------------------------------------------- */
/*  2f. Contact Analytics                                                      */
/* -------------------------------------------------------------------------- */

export async function getContactAnalytics(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  from: Date,
  to: Date,
) {
  // New contacts trend
  const trendRows = await ctx.tx.$queryRaw<
    { date: Date; count: bigint }[]
  >`
    SELECT date_trunc('day', "createdAt") AS date, COUNT(*)::bigint AS count
    FROM contacts
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${contactSql(accessible, 'contacts.id')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;

  const newContactsTrend = trendRows.map((r) => ({
    date: toIso(r.date),
    count: Number(r.count),
  }));

  // Active contacts (have conversation in range)
  const activeRows = await ctx.tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT "contactId")::bigint AS count
    FROM conversations
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${channelSql(accessible, '"channelId"')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;

  const activeContacts = Number(activeRows[0]?.count || 0n);

  // Top 10 tags
  const tagRows = await ctx.tx.$queryRaw<
    { name: string; count: bigint }[]
  >`
    SELECT t.name, COUNT(ct.id)::bigint AS count
    FROM contact_tags ct
    JOIN tags t ON t.id = ct."tagId"
    WHERE t."tenantId" = ${ctx.tenantId}::uuid
      ${contactSql(accessible, 'ct."contactId"')}
    GROUP BY t.name
    ORDER BY count DESC
    LIMIT 10
  `;

  const topTags = tagRows.map((r) => ({
    name: r.name,
    value: Number(r.count),
  }));

  // Total new contacts（與新聯絡人趨勢用同一個可見條件，含依保留方判斷的已合併聯絡人）
  const totalRows = await ctx.tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM contacts
    WHERE "tenantId" = ${ctx.tenantId}::uuid
      ${contactSql(accessible, 'contacts.id')}
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  const totalNew = Number(totalRows[0]?.count ?? 0n);

  return {
    newContactsTrend,
    activeContacts,
    totalNewContacts: totalNew,
    topTags,
  };
}

/* -------------------------------------------------------------------------- */
/*  2g. My Performance                                                         */
/* -------------------------------------------------------------------------- */

export async function getMyPerformance(
  ctx: TenantCtx,
  agentId: string,
) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [agents] = await Promise.all([
    // 個人數據只含自己的工單，不另依渠道過濾
    getAgentPerformance(ctx, ALL_CHANNELS, startOfMonth, endOfMonth, agentId),
  ]);

  const myStats = agents[0] || {
    agentId,
    name: '',
    role: '',
    casesHandled: 0,
    casesResolved: 0,
    avgFirstResponseMinutes: null,
    avgResolutionMinutes: null,
    csatAvg: null,
    slaAchievementRate: null,
  };

  // Pending cases
  const pendingCases = await ctx.tx.case.count({
    where: {
      tenantId: ctx.tenantId,
      assigneeId: agentId,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
  });

  // SLA about to expire (within 30 min)
  const soonDue = await ctx.tx.case.count({
    where: {
      tenantId: ctx.tenantId,
      assigneeId: agentId,
      status: { notIn: ['CLOSED', 'RESOLVED'] },
      slaDueAt: {
        gte: now,
        lte: new Date(now.getTime() + 30 * 60 * 1000),
      },
    },
  });

  return {
    ...myStats,
    pendingCases,
    slaSoonExpiring: soonDue,
  };
}

/* -------------------------------------------------------------------------- */
/*  2i. CSAT Report                                                            */
/* -------------------------------------------------------------------------- */

/** 期間內送出問卷的工單。讀出全部工單後在這裡計算，資料量大時會變慢（AUDIT ANA-02） */
export async function getCsatReport(ctx: TenantCtx, accessible: AccessibleChannels, from: Date, to: Date) {
  const cases = await ctx.tx.case.findMany({
    where: {
      tenantId: ctx.tenantId,
      csatSentAt: { gte: from, lte: to },
      ...caseChannelWhere(accessible),
    },
    select: {
      csatScore: true,
      csatSentAt: true,
      csatRespondedAt: true,
      csatComment: true,
      csatRatedBy: true,
      id: true,
      title: true,
    },
  });

  const totalSent = cases.length;
  // 回覆、平均、滿意率與低分工單只算客人自評；沒有來源的舊評分視為客人自評（issue #339 決定 8）
  const agentRatedCount = cases.filter((c) => c.csatScore !== null && c.csatRatedBy === 'agent').length;
  const responded = cases.filter((c) => c.csatScore !== null && c.csatRatedBy !== 'agent');
  const responseRate = totalSent > 0 ? responded.length / totalSent : 0;
  const scores = responded.map((c) => c.csatScore!);
  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const satisfiedCount = scores.filter((s) => s >= 4).length;
  const csatRate = scores.length > 0 ? satisfiedCount / scores.length : 0;
  const lowScoreCases = responded
    .filter((c) => c.csatScore! <= 2)
    .map((c) => ({ id: c.id, title: c.title, score: c.csatScore }));

  return {
    totalSent,
    totalResponded: responded.length,
    responseRate: Math.round(responseRate * 100) / 100,
    avgScore: Math.round(avgScore * 100) / 100,
    csatRate: Math.round(csatRate * 100) / 100,
    lowScoreCount: lowScoreCases.length,
    lowScoreCases: lowScoreCases.slice(0, 20),
    agentRatedCount,
  };
}

/* -------------------------------------------------------------------------- */
/*  2h. CSV Export                                                             */
/* -------------------------------------------------------------------------- */

/** UTF-8 BOM：沒有它 Excel 會以系統編碼開啟，中文變亂碼（G12） */
const UTF8_BOM = '\uFEFF';

export async function exportCsv(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  reportType: string,
  from: Date,
  to: Date,
): Promise<string> {
  return UTF8_BOM + (await buildCsv(ctx, accessible, reportType, from, to));
}

async function buildCsv(
  ctx: TenantCtx,
  accessible: AccessibleChannels,
  reportType: string,
  from: Date,
  to: Date,
): Promise<string> {
  switch (reportType) {
    case 'overview': {
      const data = await getOverviewStats(ctx, accessible, from, to);
      return `${csvRow(Object.keys(data))}\n${csvRow(Object.values(data))}`;
    }

    case 'cases': {
      const cases = await ctx.tx.case.findMany({
        where: { tenantId: ctx.tenantId, createdAt: { gte: from, lte: to }, ...caseChannelWhere(accessible) },
        include: {
          assignee: { select: { name: true } },
          contact: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const headers = csvRow(['ID', '標題', '狀態', '優先級', '分類', '指派客服', '聯絡人', '建立時間', '解決時間', 'CSAT']);
      const rows = cases.map((c) =>
        csvRow([
          c.id,
          c.title || '',
          c.status,
          c.priority,
          c.category || '',
          c.assignee?.name || '',
          c.contact?.displayName || '',
          c.createdAt.toISOString(),
          c.resolvedAt?.toISOString() || '',
          c.csatScore ?? '',
        ]),
      );
      return `${headers}\n${rows.join('\n')}`;
    }

    case 'agents': {
      const agents = await getAgentPerformance(ctx, accessible, from, to);
      const headers = csvRow(['客服ID', '姓名', '角色', '處理案件數', '已解決', '平均首次回應(分)', '平均解決時間(分)', 'CSAT', 'SLA達成率(%)']);
      const rows = agents.map((a) =>
        csvRow([
          a.agentId,
          a.name,
          a.role,
          a.casesHandled,
          a.casesResolved,
          a.avgFirstResponseMinutes ?? '',
          a.avgResolutionMinutes ?? '',
          a.csatAvg ?? '',
          a.slaAchievementRate ?? '',
        ]),
      );
      return `${headers}\n${rows.join('\n')}`;
    }

    case 'channels': {
      const data = await getChannelAnalytics(ctx, accessible, from, to);
      const headers = csvRow(['渠道', '訊息數', '對話數']);
      const channelMap = new Map<string, { msgs: number; convs: number }>();
      for (const m of data.messagesByChannel) {
        channelMap.set(m.name, { msgs: m.value, convs: 0 });
      }
      for (const c of data.conversationsByChannel) {
        const existing = channelMap.get(c.name) || { msgs: 0, convs: 0 };
        existing.convs = c.value;
        channelMap.set(c.name, existing);
      }
      // 渠道欄寫顯示名稱（Instagram），不寫系統代號（THREADS）
      const rows = Array.from(channelMap.entries()).map(
        ([name, v]) => csvRow([channelDisplayName(name), v.msgs, v.convs]),
      );
      return `${headers}\n${rows.join('\n')}`;
    }

    default:
      return 'Unsupported report type';
  }
}
