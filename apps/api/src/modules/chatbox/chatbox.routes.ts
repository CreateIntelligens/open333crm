import type { FastifyInstance } from 'fastify';
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

export default async function chatboxRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  app.post<{ Body: unknown }>('/sessions', async (req, reply) => {
    const body = createSessionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const result = await createChatboxSession(req.server.prisma, req.server.io, {
      channelPublicKey: body.data.channel,
      fingerprint: body.data.fingerprint,
      userAgent: getUserAgent(req.server, req.headers),
    });
    return reply.send(success(result));
  });

  app.post<{ Body: unknown }>('/sessions/verify', async (req, reply) => {
    const body = verifySessionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const result = await bootstrapChatboxSession(req.server.prisma, {
      sessionId: body.data.sessionId,
      fingerprint: body.data.fingerprint,
      userAgent: getUserAgent(req.server, req.headers),
    }, req.server.chatboxClaimRedis);
    return reply.send(success(result));
  });

  app.post<{ Body: unknown }>('/messages', async (req, reply) => {
    const body = messageSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const result = await handleChatboxMessage(
      req.server.prisma,
      req.server.io,
      req.server.chatboxMessageRegistry,
      ({
        ...body.data,
        userAgent: getUserAgent(req.server, req.headers),
      } as unknown) as ChatboxMessageInput & { fingerprint?: typeof body.data.fingerprint; userAgent?: string },
      req.server.chatboxClaimRedis,
    );

    return reply.send(success({ ok: true, duplicate: result.duplicate, message: result.message }));
  });

  app.post('/media', async (req, reply) => {
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
      req.server.prisma,
      session,
      buffer,
      data.filename,
      data.mimetype,
    );

    return reply.send(success(result));
  });
}
