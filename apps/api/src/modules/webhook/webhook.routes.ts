import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  processPlatformMetaWebhook,
  processWebhookEvent,
  verifyWebhookRequest,
  type WebhookVerification,
} from './webhook.service.js';
import { getMetaAppConfig } from '../meta-connect/meta-connect.service.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';

export default async function webhookRoutes(fastify: FastifyInstance) {
  // TODO(rls): 本檔皆為公開（無 JWT）入站 webhook 端點，無認證租戶身分，
  // 無法用 request.tenantPrisma（會拋）；tenant 由 channelId 反查解析，
  // 故一律使用 fastify.prismaAdmin（未套 RLS）。
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

      // 回應前先驗簽：簽章缺少或錯誤時回 403（主規格 line-webhook-events，AUDIT CHAN-03）。
      // 驗簽只查渠道與計算 HMAC，不影響 30 秒內回應；事件處理仍在回 200 之後於背景執行。
      let verification: WebhookVerification;
      try {
        verification = await verifyWebhookRequest(fastify.prismaAdmin, channelId, CHANNEL_TYPE.LINE, rawBody, headers);
      } catch (err: any) {
        logger.error('[Webhook] LINE verification failed', { channelId, error: err?.message ?? String(err), stack: err?.stack });
        return reply.status(500).send({ success: false });
      }

      if (!verification.ok) {
        if (verification.reason === 'invalid_signature' || verification.reason === 'channel_type_mismatch') {
          return reply.status(403).send({ success: false });
        }
        // 渠道不存在或租戶停用：維持原本的 200，丟棄事件
        return reply.status(200).send({ success: true });
      }

      processWebhookEvent(
        fastify.prismaAdmin,
        fastify.io,
        channelId,
        CHANNEL_TYPE.LINE,
        rawBody,
        headers,
        verification.verified,
      ).catch((err) => {
        logger.error('[Webhook] LINE processing failed', { channelId, error: err?.message ?? String(err), stack: err?.stack });
      });

      return reply.status(200).send({ success: true });
    },
  );

  // ─── 平台 Meta App Webhook（change fix-meta-webhook-page-routing 第 3 階段）──
  // 以 Facebook 登入連結的粉專，事件統一打到這裡，依 entry.id 分派渠道與租戶

  fastify.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>('/meta', async (request, reply) => {
    const cfg = getMetaAppConfig();
    if (!cfg) return reply.status(503).send('Platform Meta App is not configured');
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];
    const expected = Buffer.from(cfg.verifyToken);
    const given = Buffer.from(token ?? '');
    const tokenOk = given.length === expected.length && timingSafeEqual(given, expected);
    if (mode !== 'subscribe' || !challenge || !tokenOk) {
      return reply.status(403).send('Forbidden');
    }
    return reply.status(200).type('text/plain').send(challenge);
  });

  fastify.post('/meta', async (request, reply) => {
    if (!getMetaAppConfig()) return reply.status(503).send('Platform Meta App is not configured');
    const body = request.body as Record<string, unknown> | undefined;
    const rawBody = (body as any)?.__rawBody as Buffer | undefined;
    if (!rawBody) return reply.status(400).send('Bad Request');
    const headers = request.headers as Record<string, string>;
    // 先回 200，非同步處理（避免 Meta 重試或自動停用 webhook）
    processPlatformMetaWebhook(fastify.prismaAdmin, fastify.io, rawBody, headers).catch((err) => {
      fastify.log.error({ err: err?.message ?? err }, 'Platform Meta webhook processing failed');
    });
    return reply.status(200).send('EVENT_RECEIVED');
  });

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
      const channel = await fastify.prismaAdmin.channel.findFirst({
        where: { id: channelId, channelType: CHANNEL_TYPE.FB },
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
        fastify.prismaAdmin,
        fastify.io,
        channelId,
        CHANNEL_TYPE.FB,
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

  // GET /api/v1/webhooks/threads/:channelId
  // Instagram(Threads) Webhook Verification Challenge（機制同 FB）
  fastify.get<{
    Params: { channelId: string };
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>('/threads/:channelId', async (request, reply) => {
    const { channelId } = request.params;
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode !== 'subscribe' || !token || !challenge) {
      return reply.status(403).send('Forbidden');
    }

    try {
      const channel = await fastify.prismaAdmin.channel.findFirst({
        where: { id: channelId, channelType: CHANNEL_TYPE.THREADS },
      });

      if (!channel) {
        fastify.log.warn({ channelId }, 'IG webhook verify: channel not found');
        return reply.status(404).send('Channel not found');
      }

      const credentials = decryptCredentials(channel.credentialsEncrypted);
      const expectedVerifyToken = credentials.verifyToken as string;

      if (token === expectedVerifyToken) {
        fastify.log.info({ channelId }, 'IG webhook verified successfully');
        return reply.status(200).type('text/plain').send(challenge);
      }

      fastify.log.warn({ channelId }, 'IG webhook verify: token mismatch');
      return reply.status(403).send('Verify token mismatch');
    } catch (err) {
      fastify.log.error({ err, channelId }, 'IG webhook verification failed');
      return reply.status(500).send('Internal error');
    }
  });

  // POST /api/v1/webhooks/threads/:channelId
  // Receives Instagram Direct messages
  fastify.post<{ Params: { channelId: string } }>(
    '/threads/:channelId',
    async (request, reply) => {
      const { channelId } = request.params;
      const body = request.body as Record<string, unknown>;
      const rawBody = (body as any).__rawBody as Buffer;
      const headers = request.headers as Record<string, string>;

      // 立即回 200，非同步處理（避免 Meta 重試 / webhook 自動停用）
      fastify.log.info({ channelId, hasRawBody: !!rawBody }, 'IG webhook received, starting async processing');
      processWebhookEvent(
        fastify.prismaAdmin,
        fastify.io,
        channelId,
        CHANNEL_TYPE.THREADS,
        rawBody,
        headers,
      ).then(() => {
        fastify.log.info({ channelId }, 'IG webhook processed successfully');
      }).catch((err) => {
        fastify.log.error({ err: err?.message ?? err, stack: err?.stack, channelId }, 'IG webhook processing failed');
      });

      return reply.status(200).send('EVENT_RECEIVED');
    },
  );
}
