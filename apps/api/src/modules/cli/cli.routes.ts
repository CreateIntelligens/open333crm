import type { FastifyInstance } from 'fastify';
import { success } from '../../shared/utils/response.js';
import { hasCliScope } from '../auth/cli-session.service.js';
import {
  cliRoutesFromEndpoints,
  flattenCliEndpoints,
  visibleCliCapabilities,
} from './cli-endpoints.js';

export default async function cliRoutes(fastify: FastifyInstance) {
  fastify.get('/apis', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    const session = request.agent.cliSession;
    const scopes = session?.scopes ?? [];

    if (!session || !hasCliScope(scopes, 'cli:apis')) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: 'CLI token requires cli:apis scope',
        },
      });
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
}
