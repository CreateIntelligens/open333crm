import type { FastifyInstance, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { ChatboxMessageInput } from '@open333crm/shared';
import { AppError, success } from '../../shared/utils/response.js';
import {
  createChatboxSession,
  handleChatboxMessage,
  uploadChatboxMedia,
} from '../chatbox/chatbox.service.js';
import { ensureChannelPublicKey } from '../channel/channel.service.js';
import { consumePublicWebchatLimit, getPublicWebchatKey } from './public-webchat-limits.js';
import { isValidUuid } from './webchat.service.js';

const fingerprintSchema = z.object({
  browserFamily: z.string().optional(),
  osFamily: z.string().optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  screenBucket: z.string().optional(),
}).optional();

const messageBodySchema = z.object({
  sessionId: z.string().min(32),
  claimToken: z.string().min(32),
  clientMessageId: z.string().min(1).max(128),
  type: z.enum(['text', 'image', 'video', 'file', 'emoji', 'system']),
  payload: z.record(z.unknown()),
  locale: z.string().optional(),
  sentAt: z.string().datetime().optional(),
  fingerprint: fingerprintSchema,
});

const sessionBodySchema = z.object({
  fingerprint: fingerprintSchema,
});

function getUserAgent(headers: Record<string, unknown>): string {
  const userAgent = headers['user-agent'];
  return typeof userAgent === 'string' ? userAgent : '';
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function rejectRateLimited(reply: FastifyReply, retryAfterSeconds: number): void {
  reply
    .header('Retry-After', String(retryAfterSeconds))
    .status(429)
    .send({ code: 'RATE_LIMITED', message: 'Too many requests' });
}

function checkPublicLimit(reply: FastifyReply, limits: Array<{ key: string; max: number; windowMs?: number }>): boolean {
  for (const limit of limits) {
    const result = consumePublicWebchatLimit(limit.key, limit.max, Date.now(), limit.windowMs);
    if (!result.allowed) {
      reply.log?.warn({ requestId: reply.request?.id, limitKey: limit.key }, 'Public WebChat rate limit exceeded');
      rejectRateLimited(reply, result.retryAfterSeconds);
      return false;
    }
  }
  return true;
}

export default async function webchatRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  app.post<{ Params: { channelId: string }; Body: unknown }>(
    '/:channelId/sessions',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // Strict mode is the default. The opt-in migration endpoint accepts no
      // visitor token; it only creates the same secure Chatbox session.
      if (process.env.WEBCHAT_LEGACY_ROUTES_ENABLED !== 'true') {
        req.log.info({ requestId: req.id }, 'Legacy WebChat session route retired');
        return reply.status(410).send({
          code: 'WEBCHAT_LEGACY_ROUTE_RETIRED',
          message: 'Use the secure Chatbox session flow',
        });
      }

      const body = sessionBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const channel = await req.server.prismaAdmin.channel.findFirst({
        where: { id: req.params.channelId, channelType: 'WEBCHAT', isActive: true },
        select: { id: true, tenantId: true, publicKey: true },
      });
      if (!channel) throw new AppError('Channel not found', 'NOT_FOUND', 404);

      const { publicKey } = channel.publicKey
        ? { publicKey: channel.publicKey }
        : await ensureChannelPublicKey(req.server.prismaAdmin, channel.id, channel.tenantId);
      const result = await createChatboxSession(req.server.prismaAdmin, req.server.io, {
        channelPublicKey: publicKey,
        fingerprint: body.data.fingerprint,
        userAgent: getUserAgent(req.headers),
      });
      return reply.send(success(result));
    },
  );

  app.post<{ Params: { channelId: string }; Body: unknown }>(
    '/:channelId/messages',
    {
      bodyLimit: 128 * 1024,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = messageBodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const { channelId } = req.params;
      if (!isValidUuid(channelId)) {
        return reply.status(400).send({ error: 'Invalid channelId' });
      }

      if (!checkPublicLimit(reply, [
        { key: getPublicWebchatKey('ip', req.ip), max: 30 },
        { key: getPublicWebchatKey('session', body.data.sessionId), max: 30 },
        { key: getPublicWebchatKey('channel', channelId), max: 300 },
      ])) return;

      const userAgent = getUserAgent(req.headers);
      const session = await req.server.chatboxSessionVerifier.verify({
        sessionId: body.data.sessionId,
        claimToken: body.data.claimToken,
        fingerprint: body.data.fingerprint,
        userAgent,
      });
      if (session.channelId !== channelId) {
        throw new AppError('Channel not found', 'NOT_FOUND', 404);
      }

      if (!checkPublicLimit(reply, [
        { key: getPublicWebchatKey('session-ai', session.id), max: 20, windowMs: 60 * 60 * 1000 },
        { key: getPublicWebchatKey('channel-ai', session.channelId), max: 1_000, windowMs: 60 * 60 * 1000 },
      ])) return;

      const result = await handleChatboxMessage(
        req.server.prisma,
        req.server.io,
        req.server.chatboxMessageRegistry,
        ({ ...body.data, userAgent } as unknown) as ChatboxMessageInput & {
          fingerprint?: typeof body.data.fingerprint;
          userAgent?: string;
        },
        req.server.chatboxClaimRedis,
      );

      return reply.send(success({ ok: true, duplicate: result.duplicate, message: result.message }));
    },
  );

  app.post<{ Params: { channelId: string } }>(
    '/:channelId/media',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { channelId } = req.params;
      if (!isValidUuid(channelId)) {
        return reply.status(400).send({ error: 'Invalid channelId' });
      }

      if (!checkPublicLimit(reply, [
        { key: getPublicWebchatKey('ip', req.ip), max: 10 },
        { key: getPublicWebchatKey('channel-media', channelId), max: 100 },
      ])) return;

      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const sessionId = data.fields?.sessionId as { value?: string } | undefined;
      const claimToken = data.fields?.claimToken as { value?: string } | undefined;
      if (!sessionId?.value || !claimToken?.value) {
        return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Secure chatbox session required' });
      }

      if (!checkPublicLimit(reply, [
        { key: getPublicWebchatKey('session-media', sessionId.value), max: 10 },
      ])) return;

      const fingerprintField = data.fields?.fingerprint as { value?: string } | undefined;
      const fingerprint = fingerprintSchema.safeParse(parseJsonField(fingerprintField?.value));
      const session = await req.server.chatboxSessionVerifier.verify({
        sessionId: sessionId.value,
        claimToken: claimToken.value,
        fingerprint: fingerprint.success ? fingerprint.data : undefined,
        userAgent: getUserAgent(req.headers),
      });
      if (session.channelId !== channelId) {
        throw new AppError('Channel not found', 'NOT_FOUND', 404);
      }

      const buffer = await data.toBuffer();
      const result = await uploadChatboxMedia(
        req.server.prisma,
        session,
        buffer,
        data.filename,
        data.mimetype,
      );

      return reply.send(success(result));
    },
  );
}
