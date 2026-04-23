import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginRequestSchema } from './auth.schema.js';
import { login, getAgentById } from './auth.service.js';
import { success } from '../../shared/utils/response.js';
import { getConfig, type EnvConfig } from '../../config/env.js';

interface TokenPayload {
  agentId: string;
  tenantId: string;
  role: string;
}

function signAccessToken(fastify: FastifyInstance, payload: TokenPayload, config: EnvConfig): string {
  return fastify.jwt.sign(payload, { expiresIn: config.ACCESS_TOKEN_EXPIRES_IN });
}

function signRefreshToken(fastify: FastifyInstance, payload: TokenPayload, config: EnvConfig): string {
  return fastify.jwt.sign(payload, { expiresIn: config.REFRESH_TOKEN_EXPIRES_IN });
}

function setRefreshCookie(reply: FastifyReply, token: string, maxAge?: number): void {
  reply.setCookie('refreshToken', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    ...(maxAge !== undefined ? { maxAge } : {}),
  });
}

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/login
  fastify.post('/login', async (request, reply) => {
    const config = getConfig();
    const body = loginRequestSchema.parse(request.body);

    const agent = await login(fastify.prisma, body.email, body.password);

    const payload: TokenPayload = { agentId: agent.id, tenantId: agent.tenantId, role: agent.role };
    const accessToken = signAccessToken(fastify, payload, config);
    const refreshToken = signRefreshToken(fastify, payload, config);

    const maxAge = body.rememberMe ? config.REMEMBER_ME_DAYS * 24 * 60 * 60 : undefined;
    setRefreshCookie(reply, refreshToken, maxAge);

    return reply.send(
      success({
        accessToken,
        agent: {
          id: agent.id,
          email: agent.email,
          name: agent.name,
          role: agent.role,
          avatarUrl: agent.avatarUrl,
          tenantId: agent.tenantId,
        },
      }),
    );
  });

  // POST /api/v1/auth/refresh — reads refreshToken from HttpOnly Cookie
  fastify.post('/refresh', async (request, reply) => {
    const config = getConfig();
    const token = request.cookies?.refreshToken;

    if (!token) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'No refresh token' },
      });
    }

    try {
      const payload = fastify.jwt.verify<TokenPayload>(token);
      const tokenPayload: TokenPayload = { agentId: payload.agentId, tenantId: payload.tenantId, role: payload.role };

      const accessToken = signAccessToken(fastify, tokenPayload, config);
      const newRefreshToken = signRefreshToken(fastify, tokenPayload, config);
      setRefreshCookie(reply, newRefreshToken, config.REFRESH_COOKIE_MAX_AGE);

      return reply.send(success({ accessToken }));
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' },
      });
    }
  });

  // POST /api/v1/auth/logout — clears refreshToken Cookie
  fastify.post('/logout', async (request, reply) => {
    setRefreshCookie(reply, '', 0);
    return reply.send(success({ loggedOut: true }));
  });

  // GET /api/v1/auth/me
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const agent = await getAgentById(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );

    return reply.send(success(agent));
  });
}
