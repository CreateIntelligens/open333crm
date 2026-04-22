import type { FastifyInstance } from 'fastify';
import { processWebhookEvent } from './webhook.service.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { logger } from '@open333crm/core';

export default async function webhookRoutes(fastify: FastifyInstance) {
  // Override content type parser to get raw body for signature verification
  // This is scoped to this plugin only (Fastify encapsulation)
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: any, body: Buffer, done: (err: Error | null, result?: unknown) => void) => {
      try {
        const json = JSON.parse(body.toString());
        // Store raw body on the parsed result for later access
        (json as any).__rawBody = body;
        done(null, json);
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // POST /api/v1/webhooks/line/:channelId
  // Public endpoint - NO JWT auth (LINE sends webhooks without auth tokens)
  fastify.post<{ Params: { channelId: string } }>(
    '/line/:channelId',
    async (request, reply) => {
      const { channelId } = request.params;
      const body = request.body as Record<string, unknown>;
      const rawBody = (body as any).__rawBody as Buffer;
      const headers = request.headers as Record<string, string>;

      // Respond 200 immediately - LINE expects quick responses
      // Process asynchronously
      processWebhookEvent(
        fastify.prisma,
        fastify.io,
        channelId,
        'LINE',
        rawBody,
        headers,
      ).catch((err) => {
        logger.error('[Webhook] LINE processing failed', { channelId, error: err?.message ?? String(err), stack: err?.stack });
      });

      return reply.status(200).send({ success: true });
    },
  );

  // ─── Facebook Messenger Webhook ──────────────────────────────────────────

  // GET /api/v1/webhooks/fb/:channelId
  // Facebook Webhook Verification Challenge
  // Facebook sends a GET request with hub.mode, hub.verify_token, hub.challenge
  fastify.get<{
    Params: { channelId: string };
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>('/fb/:channelId', async (request, reply) => {
    const { channelId } = request.params;
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode !== 'subscribe' || !token || !challenge) {
      return reply.status(403).send('Forbidden');
    }

    // Load channel and verify the token matches
    try {
      const channel = await fastify.prisma.channel.findFirst({
        where: { id: channelId, channelType: 'FB' },
      });

      if (!channel) {
        fastify.log.warn({ channelId }, 'FB webhook verify: channel not found');
        return reply.status(404).send('Channel not found');
      }

      const credentials = decryptCredentials(channel.credentialsEncrypted);
      const expectedVerifyToken = credentials.verifyToken as string;

      if (token === expectedVerifyToken) {
        fastify.log.info({ channelId }, 'FB webhook verified successfully');
        // Facebook expects the challenge echoed back as plain text
        return reply.status(200).type('text/plain').send(challenge);
      }

      fastify.log.warn({ channelId }, 'FB webhook verify: token mismatch');
      return reply.status(403).send('Verify token mismatch');
    } catch (err) {
      fastify.log.error({ err, channelId }, 'FB webhook verification failed');
      return reply.status(500).send('Internal error');
    }
  });

  // POST /api/v1/webhooks/fb/:channelId
  // Receives messages from Facebook Messenger
  fastify.post<{ Params: { channelId: string } }>(
    '/fb/:channelId',
    async (request, reply) => {
      const { channelId } = request.params;
      const body = request.body as Record<string, unknown>;
      const rawBody = (body as any).__rawBody as Buffer;
      const headers = request.headers as Record<string, string>;

      // Respond 200 immediately - Facebook expects quick responses
      fastify.log.info({ channelId, hasRawBody: !!rawBody, bodyKeys: Object.keys(body).filter(k => k !== '__rawBody') }, 'FB webhook received, starting async processing');
      processWebhookEvent(
        fastify.prisma,
        fastify.io,
        channelId,
        'FB',
        rawBody,
        headers,
      ).then(() => {
        fastify.log.info({ channelId }, 'FB webhook processed successfully');
      }).catch((err) => {
        fastify.log.error({ err: err?.message ?? err, stack: err?.stack, channelId }, 'FB webhook processing failed');
      });

      return reply.status(200).send('EVENT_RECEIVED');
    },
  );
}
