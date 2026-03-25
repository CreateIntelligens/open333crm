import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

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

/* -------------------------------------------------------------------------- */
/*  2a. Overview Stats                                                         */
/* -------------------------------------------------------------------------- */

export async function getOverviewStats(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
) {
  // Total messages in range (via conversations belonging to tenant)
  const messageStats = await prisma.$queryRaw<
    { total: bigint; inbound: bigint; outbound: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE m.direction = 'INBOUND')::bigint AS inbound,
      COUNT(*) FILTER (WHERE m.direction = 'OUTBOUND')::bigint AS outbound
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${tenantId}::uuid
      AND m."createdAt" >= ${from}
      AND m."createdAt" <= ${to}
  `;

  const msg = messageStats[0] || { total: 0n, inbound: 0n, outbound: 0n };

  // Open cases (current snapshot)
  const openCases = await prisma.case.count({
    where: {
      tenantId,
      status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] },
    },
  });

  // New cases in range
  const newCases = await prisma.case.count({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
    },
  });

  // Resolved cases in range
  const resolvedCases = await prisma.case.count({
    where: {
      tenantId,
      resolvedAt: { gte: from, lte: to, not: null },
    },
  });

  // SLA achievement rate
  const slaRows = await prisma.$queryRaw<
    { total: bigint; achieved: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "resolvedAt" <= "slaDueAt")::bigint AS achieved
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
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
  const timeRows = await prisma.$queryRaw<
    { avg_first_response: number | null; avg_resolution: number | null }[]
  >`
    SELECT
      AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)
        FILTER (WHERE "firstResponseAt" IS NOT NULL) AS avg_first_response,
      AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 60)
        FILTER (WHERE "resolvedAt" IS NOT NULL) AS avg_resolution
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  const times = timeRows[0] || { avg_first_response: null, avg_resolution: null };

  // CSAT
  const csatRows = await prisma.$queryRaw<
    { avg_score: number | null; total: bigint; positive: bigint }[]
  >`
    SELECT
      AVG("csatScore")::float AS avg_score,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "csatScore" >= 4)::bigint AS positive
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
      AND "csatScore" IS NOT NULL
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;
  const csat = csatRows[0] || { avg_score: null, total: 0n, positive: 0n };

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
  };
}

/* -------------------------------------------------------------------------- */
/*  2b. Message Trend                                                          */
/* -------------------------------------------------------------------------- */

export async function getMessageTrend(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
  groupBy: string = 'day',
) {
  const trunc = groupByClause(groupBy);

  const rows = await prisma.$queryRaw<
    { date: Date; channel_type: string; count: bigint }[]
  >`
    SELECT
      ${trunc} AS date,
      c."channelType" AS channel_type,
      COUNT(*)::bigint AS count
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${tenantId}::uuid
      AND m."createdAt" >= ${from}
      AND m."createdAt" <= ${to}
    GROUP BY 1, 2
    ORDER BY 1
  `;

  // Pivot: { date, LINE, FB, WEBCHAT, total }
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = toIso(row.date);
    if (!map.has(key)) {
      map.set(key, { date: 0, LINE: 0, FB: 0, WEBCHAT: 0, WHATSAPP: 0, total: 0 });
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
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
) {
  // Trend: daily opened / closed
  const trendRows = await prisma.$queryRaw<
    { date: Date; opened: bigint; closed: bigint }[]
  >`
    SELECT
      date_trunc('day', "createdAt") AS date,
      COUNT(*)::bigint AS opened,
      COUNT(*) FILTER (WHERE "resolvedAt" IS NOT NULL)::bigint AS closed
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
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
  const categoryRows = await prisma.$queryRaw<
    { category: string | null; count: bigint }[]
  >`
    SELECT COALESCE(category, '未分類') AS category, COUNT(*)::bigint AS count
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
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
  const priorityRows = await prisma.$queryRaw<
    { priority: string; count: bigint }[]
  >`
    SELECT priority, COUNT(*)::bigint AS count
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
  `;

  const priorityDistribution = priorityRows.map((r) => ({
    name: r.priority,
    value: Number(r.count),
  }));

  // Status distribution
  const statusRows = await prisma.$queryRaw<
    { status: string; count: bigint }[]
  >`
    SELECT status, COUNT(*)::bigint AS count
    FROM cases
    WHERE "tenantId" = ${tenantId}::uuid
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
  `;

  const statusDistribution = statusRows.map((r) => ({
    name: r.status,
    value: Number(r.count),
  }));

  // SLA violations
  const slaViolations = await prisma.case.findMany({
    where: {
      tenantId,
      status: { notIn: ['CLOSED', 'RESOLVED'] },
      slaDueAt: { lt: new Date() },
    },
    include: {
      assignee: { select: { id: true, name: true } },
      contact: { select: { id: true, displayName: true } },
    },
    orderBy: { slaDueAt: 'asc' },
    take: 50,
  });

  // Escalation rate
  const totalInRange = await prisma.case.count({
    where: { tenantId, createdAt: { gte: from, lte: to } },
  });
  const escalatedInRange = await prisma.case.count({
    where: { tenantId, createdAt: { gte: from, lte: to }, status: 'ESCALATED' },
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
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
  agentId?: string,
) {
  const agentFilter = agentId ? Prisma.sql`AND c."assigneeId" = ${agentId}::uuid` : Prisma.sql``;

  const rows = await prisma.$queryRaw<
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
      AVG(c."csatScore")::float FILTER (WHERE c."csatScore" IS NOT NULL) AS csat_avg,
      COUNT(c.id) FILTER (WHERE c."slaDueAt" IS NOT NULL AND c."resolvedAt" IS NOT NULL)::bigint AS sla_total,
      COUNT(c.id) FILTER (WHERE c."slaDueAt" IS NOT NULL AND c."resolvedAt" IS NOT NULL AND c."resolvedAt" <= c."slaDueAt")::bigint AS sla_achieved
    FROM agents a
    LEFT JOIN cases c ON c."assigneeId" = a.id
      AND c."createdAt" >= ${from}
      AND c."createdAt" <= ${to}
    WHERE a."tenantId" = ${tenantId}::uuid
      AND a."isActive" = true
      ${agentFilter}
    GROUP BY a.id, a.name, a.role
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
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
) {
  // Messages per channel
  const msgRows = await prisma.$queryRaw<
    { channel_type: string; count: bigint }[]
  >`
    SELECT c."channelType" AS channel_type, COUNT(*)::bigint AS count
    FROM messages m
    JOIN conversations c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${tenantId}::uuid
      AND m."createdAt" >= ${from}
      AND m."createdAt" <= ${to}
    GROUP BY 1
  `;

  const messagesByChannel = msgRows.map((r) => ({
    name: r.channel_type,
    value: Number(r.count),
  }));

  // Conversations per channel
  const convRows = await prisma.$queryRaw<
    { channel_type: string; count: bigint }[]
  >`
    SELECT "channelType" AS channel_type, COUNT(*)::bigint AS count
    FROM conversations
    WHERE "tenantId" = ${tenantId}::uuid
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
    GROUP BY 1
  `;

  const conversationsByChannel = convRows.map((r) => ({
    name: r.channel_type,
    value: Number(r.count),
  }));

  // Bot vs human
  const botHumanRows = await prisma.$queryRaw<
    { status: string; count: bigint }[]
  >`
    SELECT status, COUNT(*)::bigint AS count
    FROM conversations
    WHERE "tenantId" = ${tenantId}::uuid
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
  const contactRows = await prisma.$queryRaw<
    { channel_type: string; count: bigint }[]
  >`
    SELECT "channelType" AS channel_type, COUNT(*)::bigint AS count
    FROM channel_identities
    WHERE "linkedAt" >= ${from}
      AND "linkedAt" <= ${to}
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
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
) {
  // New contacts trend
  const trendRows = await prisma.$queryRaw<
    { date: Date; count: bigint }[]
  >`
    SELECT date_trunc('day', "createdAt") AS date, COUNT(*)::bigint AS count
    FROM contacts
    WHERE "tenantId" = ${tenantId}::uuid
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
  const activeRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT "contactId")::bigint AS count
    FROM conversations
    WHERE "tenantId" = ${tenantId}::uuid
      AND "createdAt" >= ${from}
      AND "createdAt" <= ${to}
  `;

  const activeContacts = Number(activeRows[0]?.count || 0n);

  // Top 10 tags
  const tagRows = await prisma.$queryRaw<
    { name: string; count: bigint }[]
  >`
    SELECT t.name, COUNT(ct.id)::bigint AS count
    FROM contact_tags ct
    JOIN tags t ON t.id = ct."tagId"
    WHERE t."tenantId" = ${tenantId}::uuid
    GROUP BY t.name
    ORDER BY count DESC
    LIMIT 10
  `;

  const topTags = tagRows.map((r) => ({
    name: r.name,
    value: Number(r.count),
  }));

  // Total new contacts
  const totalNew = await prisma.contact.count({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
    },
  });

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
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [agents] = await Promise.all([
    getAgentPerformance(prisma, tenantId, startOfMonth, endOfMonth, agentId),
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
  const pendingCases = await prisma.case.count({
    where: {
      tenantId,
      assigneeId: agentId,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
  });

  // SLA about to expire (within 30 min)
  const soonDue = await prisma.case.count({
    where: {
      tenantId,
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
/*  2h. CSV Export                                                             */
/* -------------------------------------------------------------------------- */

export async function exportCsv(
  prisma: PrismaClient,
  tenantId: string,
  reportType: string,
  from: Date,
  to: Date,
): Promise<string> {
  switch (reportType) {
    case 'overview': {
      const data = await getOverviewStats(prisma, tenantId, from, to);
      const headers = Object.keys(data).join(',');
      const values = Object.values(data)
        .map((v) => (v === null ? '' : String(v)))
        .join(',');
      return `${headers}\n${values}`;
    }

    case 'cases': {
      const cases = await prisma.case.findMany({
        where: { tenantId, createdAt: { gte: from, lte: to } },
        include: {
          assignee: { select: { name: true } },
          contact: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const headers = 'ID,標題,狀態,優先級,分類,指派客服,聯繫人,建立時間,解決時間,CSAT';
      const rows = cases.map((c) =>
        [
          c.id,
          `"${(c.title || '').replace(/"/g, '""')}"`,
          c.status,
          c.priority,
          c.category || '',
          c.assignee?.name || '',
          c.contact?.displayName || '',
          c.createdAt.toISOString(),
          c.resolvedAt?.toISOString() || '',
          c.csatScore ?? '',
        ].join(','),
      );
      return `${headers}\n${rows.join('\n')}`;
    }

    case 'agents': {
      const agents = await getAgentPerformance(prisma, tenantId, from, to);
      const headers = '客服ID,姓名,角色,處理案件數,已解決,平均首次回應(分),平均解決時間(分),CSAT,SLA達成率(%)';
      const rows = agents.map((a) =>
        [
          a.agentId,
          a.name,
          a.role,
          a.casesHandled,
          a.casesResolved,
          a.avgFirstResponseMinutes ?? '',
          a.avgResolutionMinutes ?? '',
          a.csatAvg ?? '',
          a.slaAchievementRate ?? '',
        ].join(','),
      );
      return `${headers}\n${rows.join('\n')}`;
    }

    case 'channels': {
      const data = await getChannelAnalytics(prisma, tenantId, from, to);
      const headers = '渠道,訊息數,對話數';
      const channelMap = new Map<string, { msgs: number; convs: number }>();
      for (const m of data.messagesByChannel) {
        channelMap.set(m.name, { msgs: m.value, convs: 0 });
      }
      for (const c of data.conversationsByChannel) {
        const existing = channelMap.get(c.name) || { msgs: 0, convs: 0 };
        existing.convs = c.value;
        channelMap.set(c.name, existing);
      }
      const rows = Array.from(channelMap.entries()).map(
        ([name, v]) => `${name},${v.msgs},${v.convs}`,
      );
      return `${headers}\n${rows.join('\n')}`;
    }

    default:
      return 'Unsupported report type';
  }
}
