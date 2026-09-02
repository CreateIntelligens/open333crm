import type { FastifyInstance, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { ChatboxMessageInput } from '@open333crm/shared';
import { success } from '../../shared/utils/response.js';
import {
  bootstrapChatboxSession,
  createChatboxSession,
  handleChatboxMessage,
  uploadChatboxMedia,
} from './chatbox.service.js';
import { consumePublicWebchatLimit, getPublicWebchatKey } from '../webchat/public-webchat-limits.js';

const fingerprintSchema = z.object({
  browserFamily: z.string().optional(),
  osFamily: z.string().optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  screenBucket: z.string().optional(),
}).optional();

const createSessionSchema = z.object({
  channel: z.string().min(1, 'channel publicKey is required'),
  fingerprint: fingerprintSchema,
});

const verifySessionSchema = z.object({
  sessionId: z.string().min(32),
  fingerprint: fingerprintSchema,
});

const messageSchema = z.object({
  sessionId: z.string().min(32),
  claimToken: z.string().min(32),
  clientMessageId: z.string().min(1).max(128),
  type: z.enum(['text', 'image', 'video', 'file', 'emoji', 'system']),
  payload: z.record(z.unknown()),
  locale: z.string().optional(),
  sentAt: z.string().datetime().optional(),
  fingerprint: fingerprintSchema,
});

function getUserAgent(app: FastifyInstance, headers: Record<string, unknown>): string {
  const ua = headers['user-agent'];
  return typeof ua === 'string' ? ua : '';
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function checkPublicLimit(reply: FastifyReply, limits: Array<{ key: string; max: number; windowMs?: number }>): boolean {
  for (const limit of limits) {
    const result = consumePublicWebchatLimit(limit.key, limit.max, Date.now(), limit.windowMs);
    if (!result.allowed) {
      reply.log.warn({ requestId: reply.request.id, limitKey: limit.key }, 'Public Chatbox rate limit exceeded');
      reply
        .header('Retry-After', String(result.retryAfterSeconds))
        .status(429)
        .send({ code: 'RATE_LIMITED', message: 'Too many requests' });
      return false;
    }
  }
  return true;
}

export default async function chatboxRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  app.post<{ Body: unknown }>('/sessions', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = createSessionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const result = await createChatboxSession(req.server.prismaAdmin, req.server.io, {
      channelPublicKey: body.data.channel,
      fingerprint: body.data.fingerprint,
      userAgent: getUserAgent(req.server, req.headers),
    });
    req.log.info({ requestId: req.id, channelId: result.config.channelId }, 'Public Chatbox session created');
    return reply.send(success(result));
  });

  app.post<{ Body: unknown }>('/sessions/verify', async (req, reply) => {
    const body = verifySessionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const result = await bootstrapChatboxSession(req.server.prismaAdmin, {
      sessionId: body.data.sessionId,
      fingerprint: body.data.fingerprint,
      userAgent: getUserAgent(req.server, req.headers),
    }, req.server.chatboxClaimRedis);
    req.log.info({ requestId: req.id, channelId: result.config.channelId }, 'Public Chatbox session claimed');
    return reply.send(success(result));
  });

  app.post<{ Body: unknown }>('/messages', {
    bodyLimit: 128 * 1024,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = messageSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    if (!checkPublicLimit(reply, [
      { key: getPublicWebchatKey('ip', req.ip), max: 30 },
      { key: getPublicWebchatKey('session', body.data.sessionId), max: 30 },
    ])) return;

    const userAgent = getUserAgent(req.server, req.headers);
    const session = await req.server.chatboxSessionVerifier.verify({
      sessionId: body.data.sessionId,
      claimToken: body.data.claimToken,
      fingerprint: body.data.fingerprint,
      userAgent,
    });
    if (!checkPublicLimit(reply, [
      { key: getPublicWebchatKey('channel', session.channelId), max: 300 },
      { key: getPublicWebchatKey('session-ai', session.id), max: 20, windowMs: 60 * 60 * 1000 },
      { key: getPublicWebchatKey('channel-ai', session.channelId), max: 1_000, windowMs: 60 * 60 * 1000 },
    ])) return;

    const result = await handleChatboxMessage(
      req.server.prismaAdmin,
      req.server.io,
      req.server.chatboxMessageRegistry,
      ({
        ...body.data,
        userAgent,
      } as unknown) as ChatboxMessageInput & { fingerprint?: typeof body.data.fingerprint; userAgent?: string },
      req.server.chatboxClaimRedis,
    );

    return reply.send(success({ ok: true, duplicate: result.duplicate, message: result.message }));
  });

  app.post('/media', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!checkPublicLimit(reply, [
      { key: getPublicWebchatKey('ip-media', req.ip), max: 10 },
    ])) return;

    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const sessionId = data.fields?.sessionId as { value?: string } | undefined;
    if (!sessionId?.value) {
      return reply.status(400).send({ error: 'sessionId is required' });
    }
    const claimToken = data.fields?.claimToken as { value?: string } | undefined;
    if (!claimToken?.value) {
      return reply.status(400).send({ error: 'claimToken is required' });
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
      userAgent: getUserAgent(req.server, req.headers),
    });

    const buffer = await data.toBuffer();
    const result = await uploadChatboxMedia(
      req.server.prismaAdmin,
      session,
      buffer,
      data.filename,
      data.mimetype,
    );

    return reply.send(success(result));
  });
}
