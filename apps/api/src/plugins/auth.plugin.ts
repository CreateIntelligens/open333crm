import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config/env.js';
import { verifyPartnerApiKey } from '../modules/auth/partner-api-key.service.js';

export interface AgentPayload {
  id: string;
  tenantId: string;
  role: string;
  /** Set when authenticated via partner API key (not a real human agent). */
  isPartnerKey?: boolean;
  /** PartnerApiKey row id, only present when isPartnerKey=true */
  apiKeyId?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateJwtOrPartnerKey: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    agent: AgentPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      agentId: string;
      tenantId: string;
      role: string;
      rememberMe?: boolean;
    };
    user: {
      agentId: string;
      tenantId: string;
      role: string;
    };
  }
}

async function authPlugin(fastify: FastifyInstance) {
  const config = getConfig();

  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.ACCESS_TOKEN_EXPIRES_IN,
    },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const payload = request.user;
      request.agent = {
        id: payload.agentId,
        tenantId: payload.tenantId,
        role: payload.role,
      };
    } catch (err) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
      });
    }
  });

  /**
   * Try Partner API key first (Authorization: Bearer pk_...), fall back to
   * agent JWT. Used by endpoints that accept either form (e.g. partner-ingest).
   *
   * On success, attaches `request.agent` with either real agent payload or
   * a synthetic agent for API key (role=SUPERVISOR, isPartnerKey=true,
   * apiKeyId set).
   */
  fastify.decorate(
    'authenticateJwtOrPartnerKey',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const auth = request.headers.authorization ?? '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      const token = m?.[1];

      if (token && token.startsWith('pk_')) {
        const result = await verifyPartnerApiKey(fastify.prisma, token);
        if (!result.ok) {
          reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: result.reason ?? 'Invalid API key' },
          });
          return;
        }
        request.agent = {
          id: result.apiKey.createdById,
          tenantId: result.apiKey.tenantId,
          role: 'SUPERVISOR',
          isPartnerKey: true,
          apiKeyId: result.apiKey.id,
        };
        return;
      }

      // Fall back to JWT
      try {
        await request.jwtVerify();
        const payload = request.user;
        request.agent = {
          id: payload.agentId,
          tenantId: payload.tenantId,
          role: payload.role,
        };
      } catch {
        reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
        });
      }
    },
  );
}

export default fp(authPlugin, {
  name: 'auth',
});
