import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod/v3';
import type { getCaseStats } from '../analytics/analytics.service.js';
import {
  getCaseStatsFlow,
  getChannelAnalyticsFlow,
  getMessageTrendFlow,
  getMyPerformanceFlow,
  getOverviewStatsFlow,
} from '../analytics/analytics.flow.js';
import { actorOf } from '../../lib/request-actor.js';
import { success } from '../../shared/utils/response.js';
import {
  CLI_ANALYTICS_READ_SCOPE,
  CLI_APIS_SCOPE,
  hasCliScope,
} from '../auth/cli-session.service.js';
import {
  cliRoutesFromEndpoints,
  flattenCliEndpoints,
  visibleCliCapabilities,
} from './cli-endpoints.js';

const dateRangeSchema = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  to: z.coerce.date().default(() => new Date()),
});

const messageTrendSchema = dateRangeSchema.extend({
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

function sendInsufficientScope(reply: FastifyReply, scope: string) {
  return reply.status(403).send({
    success: false,
    error: {
      code: 'INSUFFICIENT_SCOPE',
      message: `CLI token requires ${scope} scope`,
    },
  });
}

function hasCurrentCliScope(request: FastifyRequest, scope: string): boolean {
  const session = request.agent.cliSession;
  return Boolean(session && hasCliScope(session.scopes, scope));
}

function summarizeCaseStats(data: Awaited<ReturnType<typeof getCaseStats>>) {
  const { slaViolations, ...safeData } = data;
  return {
    ...safeData,
    slaViolationCount: slaViolations.length,
  };
}

export default async function cliRoutes(fastify: FastifyInstance) {
  fastify.get('/apis', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    const session = request.agent.cliSession;
    const scopes = session?.scopes ?? [];

    if (!session || !hasCliScope(scopes, CLI_APIS_SCOPE)) {
      return sendInsufficientScope(reply, CLI_APIS_SCOPE);
    }

    const capabilities = visibleCliCapabilities(scopes);
    const endpoints = flattenCliEndpoints(capabilities);

    return reply.send(
      success({
        token: {
          id: session.id,
          name: session.name,
          scopes,
          expiresAt: session.expiresAt.toISOString(),
          lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
          tokenPrefix: session.tokenPrefix,
          tokenSuffix: session.tokenSuffix,
        },
        endpoints,
        capabilities: capabilities.map((capability) => ({
          ...capability,
          routes: cliRoutesFromEndpoints(capability.endpoints),
        })),
      }),
    );
  });

  fastify.get('/analytics/overview', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    if (!hasCurrentCliScope(request, CLI_ANALYTICS_READ_SCOPE)) {
      return sendInsufficientScope(reply, CLI_ANALYTICS_READ_SCOPE);
    }

    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getOverviewStatsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(data));
  });

  fastify.get('/analytics/message-trend', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    if (!hasCurrentCliScope(request, CLI_ANALYTICS_READ_SCOPE)) {
      return sendInsufficientScope(reply, CLI_ANALYTICS_READ_SCOPE);
    }

    const { from, to, groupBy } = messageTrendSchema.parse(request.query);
    const data = await getMessageTrendFlow(fastify, actorOf(request).tenantId, from, to, groupBy);
    return reply.send(success(data));
  });

  fastify.get('/analytics/cases', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    if (!hasCurrentCliScope(request, CLI_ANALYTICS_READ_SCOPE)) {
      return sendInsufficientScope(reply, CLI_ANALYTICS_READ_SCOPE);
    }

    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getCaseStatsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(summarizeCaseStats(data)));
  });

  fastify.get('/analytics/channels', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    if (!hasCurrentCliScope(request, CLI_ANALYTICS_READ_SCOPE)) {
      return sendInsufficientScope(reply, CLI_ANALYTICS_READ_SCOPE);
    }

    const { from, to } = dateRangeSchema.parse(request.query);
    const data = await getChannelAnalyticsFlow(fastify, actorOf(request).tenantId, from, to);
    return reply.send(success(data));
  });

  fastify.get('/analytics/my', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    if (!hasCurrentCliScope(request, CLI_ANALYTICS_READ_SCOPE)) {
      return sendInsufficientScope(reply, CLI_ANALYTICS_READ_SCOPE);
    }

    const actor = actorOf(request);
    const data = await getMyPerformanceFlow(fastify, actor.tenantId, actor.agentId);
    return reply.send(success(data));
  });
}
