import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import {
  exportCsvFlow,
  getAgentPerformanceFlow,
  getCaseStatsFlow,
  getChannelAnalyticsFlow,
  getContactAnalyticsFlow,
  getCsatReportFlow,
  getMessageTrendFlow,
  getMyPerformanceFlow,
  getOverviewStatsFlow,
} from './analytics.flow.js';
import { getCouponAnalyticsFlow } from '../coupon/coupon-stats.flow.js';
import { success } from '../../shared/utils/response.js';
import { requirePermission, requireAnyPermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { dateRangeFields, dateRangeSchema, messageTrendSchema, ordered } from './analytics-query.js';

const caseStatsSchema = ordered(
  dateRangeFields.extend({
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
    category: z.string().optional(),
  }),
);

const agentSchema = ordered(
  dateRangeFields.extend({
    agentId: z.string().uuid().optional(),
  }),
);

const exportSchema = ordered(
  dateRangeFields.extend({
    reportType: z.enum(['overview', 'cases', 'agents', 'channels']),
  }),
);

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
    const data = await getOverviewStatsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/message-trend
  fastify.get('/message-trend', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to, groupBy } = messageTrendSchema.parse(request.query);
    const data = await getMessageTrendFlow(fastify, actorOf(request).tenantId, from, to, groupBy);
    return reply.send(success(data));
  });

  // GET /analytics/cases
  fastify.get('/cases', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = caseStatsSchema.parse(request.query);
    const data = await getCaseStatsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/agents
  fastify.get('/agents', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to, agentId } = agentSchema.parse(request.query);
    const data = await getAgentPerformanceFlow(fastify, actorOf(request).tenantId, from, to, agentId);
    return reply.send(success(data));
  });

  // GET /analytics/channels
  fastify.get('/channels', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getChannelAnalyticsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/contacts
  fastify.get('/contacts', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getContactAnalyticsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(data));
  });

  // GET /analytics/coupons — 優惠券成效（add-coupon-system 12.16）
  fastify.get('/coupons', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    return reply.send(success(await getCouponAnalyticsFlow(fastify, actorOf(request).tenantId, from, to)));
  });

  // GET /analytics/my — 看自己的個人數據；不掛額外 requirePermission，
  // 靠 module-level 的 requireAnyPermission 放行（analytics.view.self 即可，一般專員也看得到）。
  fastify.get('/my', async (request, reply) => {
    const actor = actorOf(request);
    const data = await getMyPerformanceFlow(fastify, actor.tenantId, actor.agentId);
    return reply.send(success(data));
  });

  // GET /analytics/csat — CSAT report statistics
  fastify.get('/csat', { preHandler: requirePermission('analytics.view') }, async (request, reply) => {
    const { from, to } = dateRangeSchema.parse(request.query);
    return reply.send(success(await getCsatReportFlow(fastify, actorOf(request).tenantId, from, to)));
  });

  // POST /analytics/export
  fastify.post('/export', { preHandler: requirePermission('analytics.export') }, async (request, reply) => {
    const { reportType, from, to } = exportSchema.parse(request.body);
    const csv = await exportCsvFlow(fastify, actorOf(request).tenantId, reportType, from, to);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${reportType}_report.csv"`)
      .send(csv);
  });
}
