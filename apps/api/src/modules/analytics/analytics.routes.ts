import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getOverviewStats,
  getMessageTrend,
  getCaseStats,
  getAgentPerformance,
  getChannelAnalytics,
  getContactAnalytics,
  getMyPerformance,
  exportCsv,
} from './analytics.service.js';
import { success } from '../../shared/utils/response.js';
import { requirePermission, requireAnyPermission } from '../../guards/rbac.guard.js';

const dateRangeSchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  to: z.coerce.date().default(() => new Date()),
});

const messageTrendSchema = dateRangeSchema.extend({
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

const caseStatsSchema = dateRangeSchema.extend({
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  category: z.string().optional(),
});

const agentSchema = dateRangeSchema.extend({
  agentId: z.string().uuid().optional(),
});

const exportSchema = z.object({
  reportType: z.enum(['overview', 'cases', 'agents', 'channels']),
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  to: z.coerce.date().default(() => new Date()),
});

export default async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  // module-level 只做「進得了 analytics 模組」的最低門檻：有 analytics.view 或 analytics.view.self 其一。
  // Fastify 的 addHook 掛在整個 plugin scope，per-route preHandler 無法「移除」它，
  // 故這裡放寬到任一命中，讓只有 analytics.view.self 的一般專員能通過而抵達 /my；
  // 其餘每條需要完整報表的路由再各自掛 requirePermission('analytics.view') 嚴格把關，
  // 確保只有 view.self 的角色打不到 /overview、/agents 等端點。
  fastify.addHook('preHandler', requireAnyPermission(['analytics.view', 'analytics.view.self']));

  // GET /analytics/overview
  fastify.get('/overview', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getOverviewStats(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/message-trend
  fastify.get('/message-trend', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to, groupBy } = messageTrendSchema.parse(request.query);
    const data = await getMessageTrend(fastify.prisma, request.agent.tenantId, from, to, groupBy);
    return reply.send(success(data));
  });

  // GET /analytics/cases
  fastify.get('/cases', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = caseStatsSchema.parse(request.query);
    const data = await getCaseStats(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/agents
  fastify.get('/agents', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to, agentId } = agentSchema.parse(request.query);
    const data = await getAgentPerformance(
      fastify.prisma,
      request.agent.tenantId,
      from,
      to,
      agentId,
    );
    return reply.send(success(data));
  });

  // GET /analytics/channels
  fastify.get('/channels', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getChannelAnalytics(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/contacts
  fastify.get('/contacts', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getContactAnalytics(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/my — 看自己的個人數據；不掛額外 requirePermission，
  // 靠 module-level 的 requireAnyPermission 放行（analytics.view.self 即可，一般專員也看得到）。
  fastify.get('/my', async (request, reply) => {
    const data = await getMyPerformance(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
    );
    return reply.send(success(data));
  });

  // GET /analytics/csat — CSAT report statistics
  fastify.get('/csat', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const tenantId = request.agent.tenantId;

    const cases = await fastify.prisma.case.findMany({
      where: {
        tenantId,
        csatSentAt: { gte: from, lte: to },
      },
      select: {
        csatScore: true,
        csatSentAt: true,
        csatRespondedAt: true,
        csatComment: true,
        id: true,
        title: true,
      },
    });

    const totalSent = cases.length;
    const responded = cases.filter((c) => c.csatScore !== null);
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

    return reply.send(success({
      totalSent,
      totalResponded: responded.length,
      responseRate: Math.round(responseRate * 100) / 100,
      avgScore: Math.round(avgScore * 100) / 100,
      csatRate: Math.round(csatRate * 100) / 100,
      lowScoreCount: lowScoreCases.length,
      lowScoreCases: lowScoreCases.slice(0, 20),
    }));
  });

  // POST /analytics/export
  fastify.post('/export', { preHandler: requirePermission('analytics.export') }, async (request, reply) => {
    const { reportType, from, to } = exportSchema.parse(request.body);
    const csv = await exportCsv(
      fastify.prisma,
      request.agent.tenantId,
      reportType,
      from,
      to,
    );
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${reportType}_report.csv"`)
      .send(csv);
  });
}
