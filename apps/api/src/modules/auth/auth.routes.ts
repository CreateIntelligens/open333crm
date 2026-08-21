import type { FastifyInstance, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {
  cliLoginRequestSchema,
  loginRequestSchema,
  passkeyAuthenticationOptionsSchema,
  passkeyAuthenticationVerifySchema,
  passkeyIdParamsSchema,
  passkeyRenameSchema,
  passkeyRegistrationVerifySchema,
} from './auth.schema.js';
import { login, getActiveAgentForAuth, getAgentById } from './auth.service.js';
import { getEffectiveTenantPermissions } from '../../services/permission.service.js';
import { getTenantPlanId } from '../../services/tenant-plan.cache.js';
import { AppError, success } from '../../shared/utils/response.js';
import { getConfig, type EnvConfig } from '../../config/env.js';
import { FastifyJWT } from '@fastify/jwt';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  createPasskeyChallengeId,
  getPasskeyConfig,
  storePasskeyChallenge,
  takePasskeyChallenge,
} from './passkey.service.js';
import {
  createCliSession,
  parseCliScopes,
  revokeCliSession,
} from './cli-session.service.js';

type TokenPayload = FastifyJWT['payload'];

function signAccessToken(fastify: FastifyInstance, payload: TokenPayload, config: EnvConfig): string {
  return fastify.jwt.sign(payload, { expiresIn: config.ACCESS_TOKEN_EXPIRES_IN });
}

function signRefreshToken(
  fastify: FastifyInstance,
  payload: TokenPayload,
  config: EnvConfig,
  rememberMe: boolean,
): string {
  return fastify.jwt.sign({ ...payload, rememberMe }, { expiresIn: config.REFRESH_TOKEN_EXPIRES_IN });
}

function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}

function cookieMaxAge(rememberMe: boolean, config: EnvConfig): number | undefined {
  return rememberMe ? parseDurationToSeconds(config.REFRESH_TOKEN_EXPIRES_IN) : undefined;
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

type SessionAgent = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  roleId: string | null; // RBAC：細粒度權限判斷用，進 JWT
  avatarUrl: string | null;
};

function issueAgentSession(
  fastify: FastifyInstance,
  reply: FastifyReply,
  agent: SessionAgent,
  config: EnvConfig,
  rememberMe: boolean,
) {
  const payload: TokenPayload = { agentId: agent.id, tenantId: agent.tenantId, role: agent.role, roleId: agent.roleId };
  const accessToken = signAccessToken(fastify, payload, config);
  const refreshToken = signRefreshToken(fastify, payload, config, rememberMe);

  setRefreshCookie(reply, refreshToken, cookieMaxAge(rememberMe, config));

  return {
    accessToken,
    agent: {
      id: agent.id,
      email: agent.email,
      name: agent.name,
      role: agent.role,
      avatarUrl: agent.avatarUrl,
      tenantId: agent.tenantId,
    },
  };
}

function normalizeTransports(value: unknown): AuthenticatorTransportFuture[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<AuthenticatorTransportFuture>([
    'ble',
    'cable',
    'hybrid',
    'internal',
    'nfc',
    'smart-card',
    'usb',
  ]);
  return value.filter((item): item is AuthenticatorTransportFuture => (
    typeof item === 'string' && allowed.has(item as AuthenticatorTransportFuture)
  ));
}

function invalidPasskeyError(): Error {
  return new AppError('Invalid passkey response', 'UNAUTHORIZED', 401);
}

export default async function authRoutes(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: false,
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  // POST /api/v1/auth/login
  fastify.post('/login', async (request, reply) => {
    const config = getConfig();
    const body = loginRequestSchema.parse(request.body);

    const agent = await login(fastify.prisma, body.email, body.password);

    return reply.send(success(issueAgentSession(fastify, reply, agent, config, !!body.rememberMe)));
  });

  // POST /api/v1/auth/passkeys/register/options
  fastify.get('/passkeys/capability', async (_request, reply) => {
    try {
      getPasskeyConfig();
      return reply.send(success({ enabled: true }));
    } catch (error) {
      if (error instanceof AppError && error.code === 'SERVICE_UNAVAILABLE') {
        return reply.send(success({ enabled: false }));
      }
      throw error;
    }
  });

  // POST /api/v1/auth/passkeys/register/options
  fastify.post('/passkeys/register/options', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const config = getPasskeyConfig();
    const agent = await getActiveAgentForAuth(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );
    const existingCredentials = await fastify.prisma.passkeyCredential.findMany({
      where: {
        tenantId: request.agent.tenantId,
        agentId: request.agent.id,
        revokedAt: null,
      },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: Buffer.from(agent.id),
      userName: agent.email,
      userDisplayName: agent.name,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials: existingCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: normalizeTransports(credential.transports),
      })),
    });
    const challengeId = createPasskeyChallengeId();

    await storePasskeyChallenge({
      challengeId,
      challenge: options.challenge,
      purpose: 'registration',
      tenantId: request.agent.tenantId,
      agentId: request.agent.id,
    });

    return reply.send(success({ challengeId, options }));
  });

  // POST /api/v1/auth/passkeys/register/verify
  fastify.post('/passkeys/register/verify', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body = passkeyRegistrationVerifySchema.parse(request.body);
    const challenge = await takePasskeyChallenge(body.challengeId);

    if (
      challenge.purpose !== 'registration'
      || challenge.agentId !== request.agent.id
      || challenge.tenantId !== request.agent.tenantId
    ) {
      throw invalidPasskeyError();
    }

    const agent = await getActiveAgentForAuth(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );
    const config = getPasskeyConfig();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserPresence: true,
        requireUserVerification: true,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Passkey registration verification rejected');
      throw invalidPasskeyError();
    }

    if (!verification.verified) throw invalidPasskeyError();

    try {
      const registration = verification.registrationInfo;
      await fastify.prisma.passkeyCredential.create({
        data: {
          tenantId: agent.tenantId,
          agentId: agent.id,
          credentialId: registration.credential.id,
          publicKey: Buffer.from(registration.credential.publicKey),
          counter: BigInt(registration.credential.counter),
          transports: body.response.response.transports ?? [],
          deviceType: registration.credentialDeviceType,
          backedUp: registration.credentialBackedUp,
          name: body.name,
        },
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new AppError('Passkey is already registered', 'CONFLICT', 409);
      }
      throw error;
    }

    return reply.send(success({ registered: true }));
  });

  // POST /api/v1/auth/passkeys/authentication/options
  fastify.post('/passkeys/authentication/options', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = passkeyAuthenticationOptionsSchema.parse(request.body);
    const config = getPasskeyConfig();
    let agentId: string | undefined;
    let tenantId: string | undefined;
    let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];

    if (body.email) {
      const agent = await fastify.prisma.agent.findFirst({
        where: {
          email: body.email,
          isActive: true,
          tenant: { isActive: true },
        },
        select: {
          id: true,
          tenantId: true,
          passkeyCredentials: {
            where: { revokedAt: null },
            select: { credentialId: true, transports: true },
          },
        },
      });
      if (agent) {
        agentId = agent.id;
        tenantId = agent.tenantId;
        allowCredentials = agent.passkeyCredentials.map((credential) => ({
          id: credential.credentialId,
          transports: normalizeTransports(credential.transports),
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
      userVerification: 'required',
    });
    const challengeId = createPasskeyChallengeId();

    await storePasskeyChallenge({
      challengeId,
      challenge: options.challenge,
      purpose: 'authentication',
      tenantId,
      agentId,
      rememberMe: body.rememberMe,
    });

    return reply.send(success({ challengeId, options }));
  });

  // POST /api/v1/auth/passkeys/authentication/verify
  fastify.post('/passkeys/authentication/verify', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = passkeyAuthenticationVerifySchema.parse(request.body);
    const challenge = await takePasskeyChallenge(body.challengeId);
    if (challenge.purpose !== 'authentication') throw invalidPasskeyError();

    const credential = challenge.tenantId
      ? await fastify.prisma.passkeyCredential.findFirst({
        where: {
          credentialId: body.response.id,
          tenantId: challenge.tenantId,
          ...(challenge.agentId ? { agentId: challenge.agentId } : {}),
          revokedAt: null,
        },
        select: {
          id: true,
          tenantId: true,
          agentId: true,
          credentialId: true,
          publicKey: true,
          counter: true,
          transports: true,
          revokedAt: true,
        },
      })
      : await fastify.prisma.passkeyCredential.findUnique({
        where: { credentialId: body.response.id },
        select: {
          id: true,
          tenantId: true,
          agentId: true,
          credentialId: true,
          publicKey: true,
          counter: true,
          transports: true,
          revokedAt: true,
        },
      });

    if (!credential || ('revokedAt' in credential && credential.revokedAt)) {
      throw invalidPasskeyError();
    }

    const agent = await getActiveAgentForAuth(fastify.prisma, credential.agentId, credential.tenantId);
    const config = getPasskeyConfig();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
          transports: normalizeTransports(credential.transports),
        },
      });
    } catch (error) {
      request.log.warn({ err: error }, 'Passkey authentication verification rejected');
      throw invalidPasskeyError();
    }

    if (!verification.verified) throw invalidPasskeyError();

    const updated = await fastify.prisma.passkeyCredential.updateMany({
      where: {
        id: credential.id,
        tenantId: credential.tenantId,
        agentId: credential.agentId,
        revokedAt: null,
        counter: credential.counter,
      },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw invalidPasskeyError();

    const session = issueAgentSession(
      fastify,
      reply,
      agent,
      getConfig(),
      challenge.rememberMe === true,
    );
    return reply.send(success(session));
  });

  // GET /api/v1/auth/passkeys
  fastify.get('/passkeys', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const credentials = await fastify.prisma.passkeyCredential.findMany({
      where: {
        tenantId: request.agent.tenantId,
        agentId: request.agent.id,
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return reply.send(success(credentials));
  });

  // DELETE /api/v1/auth/passkeys/:id
  fastify.patch('/passkeys/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = passkeyIdParamsSchema.parse(request.params);
    const { name } = passkeyRenameSchema.parse(request.body);
    const result = await fastify.prisma.passkeyCredential.updateMany({
      where: {
        id,
        tenantId: request.agent.tenantId,
        agentId: request.agent.id,
        revokedAt: null,
      },
      data: { name },
    });
    if (result.count !== 1) {
      throw new AppError('Passkey not found', 'NOT_FOUND', 404);
    }
    return reply.send(success({ renamed: true }));
  });

  // DELETE /api/v1/auth/passkeys/:id
  fastify.delete('/passkeys/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = passkeyIdParamsSchema.parse(request.params);
    const result = await fastify.prisma.passkeyCredential.updateMany({
      where: {
        id,
        tenantId: request.agent.tenantId,
        agentId: request.agent.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new AppError('Passkey not found', 'NOT_FOUND', 404);
    }
    return reply.send(success({ revoked: true }));
  });

  // POST /api/v1/auth/cli/login
  fastify.post('/cli/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const body = cliLoginRequestSchema.parse(request.body);
    const agent = await login(fastify.prisma, body.email, body.password);
    const { token, session } = await createCliSession(fastify.prisma, {
      tenantId: agent.tenantId,
      agentId: agent.id,
      name: body.name ?? body.profile ?? 'Open333 CLI',
    });

    return reply.send(
      success({
        token,
        session: {
          id: session.id,
          name: session.name,
          tokenPrefix: session.tokenPrefix,
          tokenSuffix: session.tokenSuffix,
          scopes: parseCliScopes(session.scopes),
          expiresAt: session.expiresAt.toISOString(),
          lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
        },
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

  // POST /api/v1/auth/cli/logout
  fastify.post('/cli/logout', {
    preHandler: [fastify.authenticateCliSession],
  }, async (request, reply) => {
    const session = request.agent.cliSession;
    if (session) {
      await revokeCliSession(fastify.prisma, session.id, request.agent.tenantId);
    }
    return reply.send(success({ loggedOut: true }));
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
      const tokenPayload: TokenPayload = { agentId: payload.agentId, tenantId: payload.tenantId, role: payload.role, roleId: payload.roleId };

      const accessToken = signAccessToken(fastify, tokenPayload, config);
      const newRefreshToken = signRefreshToken(fastify, tokenPayload, config, !!payload.rememberMe);
      setRefreshCookie(reply, newRefreshToken, cookieMaxAge(!!payload.rememberMe, config));

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
    preHandler: [fastify.authenticateJwtOrCliSession],
  }, async (request, reply) => {
    const agent = await getAgentById(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );

    return reply.send(success(agent));
  });

  // GET /api/v1/auth/me/permissions — 當前使用者的有效權限碼清單（前端 gating 用）
  fastify.get('/me/permissions', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    // 前端 gating 用「使用者實際可用權限」= 角色權限 ∩ 方案天花板
    const planId = await getTenantPlanId(fastify.prisma, request.agent.tenantId);
    const eff = await getEffectiveTenantPermissions(fastify.prisma, request.agent.roleId, planId);
    return reply.send(success({ permissions: [...eff] }));
  });
}
