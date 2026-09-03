import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config/env.js';
import { verifyPartnerApiKey } from '../modules/auth/partner-api-key.service.js';
import { verifyCliSession } from '../modules/auth/cli-session.service.js';

export interface AgentPayload {
  id: string;
  tenantId: string;
  role: string;
  /** 細粒度 RBAC：指向 Role 表；過渡期可能為 null（尚未回填）。權限判斷用。 */
  roleId?: string | null;
  /** Set when authenticated via partner API key (not a real human agent). */
  isPartnerKey?: boolean;
  /** PartnerApiKey row id, only present when isPartnerKey=true */
  apiKeyId?: string;
  /** Set when authenticated via CLI session token. */
  isCliSession?: boolean;
  cliSession?: {
    id: string;
    name: string;
    scopes: string[];
    expiresAt: Date;
    lastUsedAt: Date | null;
    tokenPrefix: string;
    tokenSuffix: string;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateCliSession: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authenticateJwtOrCliSession: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authenticateJwtOrPartnerKey: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    authenticatePlatformSuperuser: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    agent: AgentPayload;
    platformUser?: { id: string; role: 'PLATFORM_SUPERUSER'; mustChangePassword: boolean };
  }
}

function extractBearerToken(request: FastifyRequest): string | undefined {
  const auth = request.headers.authorization ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function attachCliAgent(
  request: FastifyRequest,
  result: Extract<Awaited<ReturnType<typeof verifyCliSession>>, { ok: true }>,
): void {
  request.agent = {
    id: result.agent.id,
    tenantId: result.agent.tenantId,
    role: result.agent.role,
    isCliSession: true,
    cliSession: {
      id: result.session.id,
      name: result.session.name,
      scopes: result.scopes,
      expiresAt: result.session.expiresAt,
      lastUsedAt: result.session.lastUsedAt,
      tokenPrefix: result.session.tokenPrefix,
      tokenSuffix: result.session.tokenSuffix,
    },
  };
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      agentId: string;
      tenantId: string;
      role: string;
      roleId?: string | null;
      rememberMe?: boolean;
    };
    user: {
      agentId: string;
      tenantId: string;
      role: string;
      roleId?: string | null;
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

  // 平台 superuser JWT：獨立 secret + namespace，與租戶 JWT 完全分離
  // （租戶 JWT 永遠簽不出、也驗不過平台 token）。secret 未設時平台功能停用。
  if (config.PLATFORM_JWT_SECRET) {
    await fastify.register(fastifyJwt, {
      secret: config.PLATFORM_JWT_SECRET,
      namespace: 'platform',
      sign: { expiresIn: config.PLATFORM_JWT_EXPIRES_IN },
    });
  }

  fastify.decorate(
    'authenticatePlatformSuperuser',
    async function (request: FastifyRequest, reply: FastifyReply) {
      if (!config.PLATFORM_JWT_SECRET) {
        return reply.status(503).send({
          success: false,
          error: { code: 'PLATFORM_DISABLED', message: 'Platform control plane not configured' },
        });
      }
      try {
        // @ts-expect-error namespace 方法由 @fastify/jwt 動態掛載
        const payload = await request.platformJwtVerify();
        if (payload.role !== 'PLATFORM_SUPERUSER') {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not a platform superuser' },
          });
        }
        // mustChangePassword 即時查 DB（非信任 JWT payload 快照）：改密碼後立即生效，
        // 不需等舊 token 過期或重新登入。
        const user = await fastify.prismaAdmin.platformUser.findUnique({
          where: { id: payload.platformUserId },
          select: { mustChangePassword: true },
        });
        if (!user) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid or expired platform token' },
          });
        }
        request.platformUser = {
          id: payload.platformUserId,
          role: 'PLATFORM_SUPERUSER',
          mustChangePassword: user.mustChangePassword,
        };
      } catch {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired platform token' },
        });
      }
    },
  );

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const payload = request.user;
      request.agent = {
        id: payload.agentId,
        tenantId: payload.tenantId,
        role: payload.role,
        roleId: payload.roleId ?? null,
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

  fastify.decorate(
    'authenticateCliSession',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const token = extractBearerToken(request);
      if (!token) {
        reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing CLI token' },
        });
        return;
      }

      const result = await verifyCliSession(fastify.prismaAdmin, token);
      if (!result.ok) {
        reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: result.reason },
        });
        return;
      }

      attachCliAgent(request, result);
    },
  );

  fastify.decorate(
    'authenticateJwtOrCliSession',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const token = extractBearerToken(request);
      if (token?.startsWith('cli_')) {
        const result = await verifyCliSession(fastify.prismaAdmin, token);
        if (!result.ok) {
          reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: result.reason },
          });
          return;
        }
        attachCliAgent(request, result);
        return;
      }

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
      const token = extractBearerToken(request);

      if (token && token.startsWith('pk_')) {
        const result = await verifyPartnerApiKey(fastify.prismaAdmin, token);
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
