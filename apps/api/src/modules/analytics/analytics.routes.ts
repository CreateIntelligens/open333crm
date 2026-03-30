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
import { requireSupervisor } from '../../guards/rbac.guard.js';

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
  fastify.addHook('preHandler', requireSupervisor());

  // GET /analytics/overview
  fastify.get('/overview', async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getOverviewStats(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/message-trend
  fastify.get('/message-trend', async (request, reply) => {
    const { from, to, groupBy } = messageTrendSchema.parse(request.query);
    const data = await getMessageTrend(fastify.prisma, request.agent.tenantId, from, to, groupBy);
    return reply.send(success(data));
  });

  // GET /analytics/cases
  fastify.get('/cases', async (request, reply) => {
    const { from, to } = caseStatsSchema.parse(request.query);
    const data = await getCaseStats(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/agents
  fastify.get('/agents', async (request, reply) => {
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
  fastify.get('/channels', async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getChannelAnalytics(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/contacts
  fastify.get('/contacts', async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getContactAnalytics(fastify.prisma, request.agent.tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/my
  fastify.get('/my', async (request, reply) => {
    const data = await getMyPerformance(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
    );
    return reply.send(success(data));
  });

  // GET /analytics/csat — CSAT report statistics
  fastify.get('/csat', async (request, reply) => {
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
  fastify.post('/export', async (request, reply) => {
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
