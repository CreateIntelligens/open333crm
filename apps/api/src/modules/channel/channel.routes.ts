import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHANNEL_TYPE } from '@open333crm/shared';
import {
  listChannels,
  createChannel,
  getChannel,
  updateChannel,
  deleteChannel,
  verifyChannel,
  updateWebhookBaseUrl,
  ensureChannelPublicKey,
} from './channel.service.js';
import { AppError, success } from '../../shared/utils/response.js';
import { requireAdmin, requireSupervisor } from '../../guards/rbac.guard.js';
import { autoSetupLineWebhook } from './line-webhook-setup.service.js';
import { checkFbTokenStatus } from './fb-token-monitor.service.js';
import { generateEmbedCode } from './webchat-embed.service.js';
import { uploadFile } from '../storage/storage.service.js';

const lineCredentialsSchema = z.object({
  channelSecret: z.string().min(1),
  channelAccessToken: z.string().min(1),
});

const fbCredentialsSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().min(1),
  pageAccessToken: z.string().min(1),
  pageId: z.string().optional(),
});

const webchatCredentialsSchema = z.record(z.unknown());

const createChannelSchema = z.object({
  channelType: z.enum([CHANNEL_TYPE.LINE, CHANNEL_TYPE.FB, CHANNEL_TYPE.WEBCHAT, CHANNEL_TYPE.WHATSAPP] as [string, ...string[]]),
  displayName: z.string().min(1).max(100),
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
  webhookBaseUrl: z.string().url().optional(),
}).superRefine((data, ctx) => {
  if (data.channelType === CHANNEL_TYPE.LINE) {
    const result = lineCredentialsSchema.safeParse(data.credentials);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        ctx.addIssue({ ...issue, path: ['credentials', ...issue.path] });
      });
    }
  } else if (data.channelType === CHANNEL_TYPE.FB) {
    const result = fbCredentialsSchema.safeParse(data.credentials);
    if (!result.success) {
      result.error.issues.forEach((issue) => {
        ctx.addIssue({ ...issue, path: ['credentials', ...issue.path] });
      });
    }
  }
});

const updateWebhookBaseUrlSchema = z.object({
  baseUrl: z.string().min(1),
});

const chatboxLinkSchema = z.object({
  domain: z.string().url(),
});

const updateChannelSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

const chatboxThemeSchema = z.object({
  backgroundImageUrl: z.null().optional(),
  backgroundImageKey: z.null().optional(),
  backgroundSize: z.enum(['cover', 'contain']).optional(),
  backgroundPosition: z.string().max(80).optional(),
  foregroundColor: z.string().max(32).optional(),
  accentColor: z.string().max(32).optional(),
});

async function getTenantWebchatChannel(fastify: FastifyInstance, id: string, tenantId: string) {
  const channel = await fastify.prisma.channel.findFirst({
    where: { id, tenantId, channelType: CHANNEL_TYPE.WEBCHAT },
  });
  if (!channel) {
    throw new AppError('WEBCHAT channel not found', 'NOT_FOUND', 404);
  }
  return channel;
}

export default async function channelRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/channels
  fastify.get('/', { preHandler: requireSupervisor() }, async (request, reply) => {
    const channels = await listChannels(fastify.prisma, request.agent.tenantId);
    return reply.send(success(channels));
  });

  // POST /api/v1/channels
  fastify.post('/', { preHandler: requireAdmin() }, async (request, reply) => {
    const data = createChannelSchema.parse(request.body);

    const channel = await createChannel(fastify.prisma, request.agent.tenantId, data);

    return reply.status(201).send(success(channel));
  });

  // GET /api/v1/channels/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: requireSupervisor() }, async (request, reply) => {
    const channel = await getChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(channel));
  });

  // PATCH /api/v1/channels/:id
  fastify.patch<{ Params: { id: string } }>('/:id', { preHandler: requireAdmin() }, async (request, reply) => {
    const data = updateChannelSchema.parse(request.body);

    const channel = await updateChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(channel));
  });

  // DELETE /api/v1/channels/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: requireAdmin() }, async (request, reply) => {
    const result = await deleteChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(result));
  });

  // POST /api/v1/channels/:id/verify
  fastify.post<{ Params: { id: string } }>('/:id/verify', async (request, reply) => {
    const result = await verifyChannel(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(result));
  });

  // POST /api/v1/channels/webhook-base-url — 批次更新所有渠道的 Webhook URL
  fastify.post('/webhook-base-url', async (request, reply) => {
    const data = updateWebhookBaseUrlSchema.parse(request.body);

    const result = await updateWebhookBaseUrl(
      fastify.prisma,
      request.agent.tenantId,
      data.baseUrl,
    );

    return reply.send(success(result));
  });

  // POST /api/v1/channels/:id/setup-webhook — LINE auto webhook setup
  fastify.post<{ Params: { id: string } }>('/:id/setup-webhook', async (request, reply) => {
    const result = await autoSetupLineWebhook(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // GET /api/v1/channels/:id/status — channel health status
  fastify.get<{ Params: { id: string } }>('/:id/status', async (request, reply) => {
    const channel = await fastify.prisma.channel.findFirst({
      where: { id: request.params.id, tenantId: request.agent.tenantId },
    });

    if (!channel) {
      return reply.status(404).send({ error: { message: 'Channel not found' } });
    }

    if (channel.channelType === CHANNEL_TYPE.FB) {
      const tokenStatus = await checkFbTokenStatus(
        fastify.prisma,
        request.params.id,
        request.agent.tenantId,
      );
      return reply.send(success({
        channelType: channel.channelType,
        isActive: channel.isActive,
        lastVerifiedAt: channel.lastVerifiedAt,
        tokenStatus,
      }));
    }

    return reply.send(success({
      channelType: channel.channelType,
      isActive: channel.isActive,
      lastVerifiedAt: channel.lastVerifiedAt,
    }));
  });

  // GET /api/v1/channels/:id/embed-code — WebChat embed code
  fastify.get<{ Params: { id: string } }>('/:id/embed-code', async (request, reply) => {
    const result = await generateEmbedCode(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/channels/:id/chatbox-link — WebChat standalone page link
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/:id/chatbox-link',
    { preHandler: requireSupervisor() },
    async (request, reply) => {
      const body = chatboxLinkSchema.parse(request.body);
      const channel = await fastify.prisma.channel.findFirst({
        where: {
          id: request.params.id,
          tenantId: request.agent.tenantId,
          channelType: CHANNEL_TYPE.WEBCHAT,
        },
        select: { id: true, publicKey: true },
      });

      if (!channel) {
        throw new AppError('WEBCHAT channel not found', 'NOT_FOUND', 404);
      }

      const { publicKey } = channel.publicKey
        ? { publicKey: channel.publicKey }
        : await ensureChannelPublicKey(fastify.prisma, channel.id, request.agent.tenantId);

      if (!publicKey) {
        throw new AppError('publicKey is required', 'BAD_REQUEST', 400);
      }

      const domain = body.domain.replace(/\/+$/, '');
      return reply.send(success({
        publicKey,
        url: `${domain}/chatbox?channel=${encodeURIComponent(publicKey)}`,
      }));
    },
  );

  // PATCH /api/v1/channels/:id/chatbox-theme — WebChat chatbox public theme
  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/:id/chatbox-theme',
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const body = chatboxThemeSchema.parse(request.body);
      const channel = await getTenantWebchatChannel(fastify, request.params.id, request.agent.tenantId);
      const settings = (channel.settings || {}) as Record<string, unknown>;
      const currentTheme = (settings.chatboxTheme || {}) as Record<string, unknown>;

      const themeUpdate = {
        ...body,
        ...(body.backgroundImageUrl === null ? { backgroundImageUrl: null, backgroundImageKey: null } : {}),
      };

      const updated = await fastify.prisma.channel.update({
        where: { id: channel.id },
        data: {
          settings: {
            ...settings,
            chatboxTheme: {
              ...currentTheme,
              ...themeUpdate,
            },
          },
        },
        select: { id: true, settings: true },
      });

      return reply.send(success({ id: updated.id, chatboxTheme: (updated.settings as any).chatboxTheme ?? {} }));
    },
  );

  // POST /api/v1/channels/:id/chatbox-theme/background — upload tenant-owned background image
  fastify.post<{ Params: { id: string } }>(
    '/:id/chatbox-theme/background',
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const channel = await getTenantWebchatChannel(fastify, request.params.id, request.agent.tenantId);
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
        return reply.status(400).send({ error: 'Unsupported background image type' });
      }

      const buffer = await file.toBuffer();
      const uploaded = await uploadFile(
        buffer,
        file.filename,
        file.mimetype,
        request.agent.tenantId,
        'media',
        'chatbox-backgrounds',
      );
      const settings = (channel.settings || {}) as Record<string, unknown>;
      const currentTheme = (settings.chatboxTheme || {}) as Record<string, unknown>;
      const updatedTheme = {
        ...currentTheme,
        backgroundImageUrl: uploaded.url,
        backgroundImageKey: uploaded.key,
        backgroundSize: currentTheme.backgroundSize ?? 'cover',
        backgroundPosition: currentTheme.backgroundPosition ?? 'center',
      };

      await fastify.prisma.channel.update({
        where: { id: channel.id },
        data: { settings: { ...settings, chatboxTheme: updatedTheme } },
      });

      return reply.status(201).send(success({ ...uploaded, chatboxTheme: updatedTheme }));
    },
  );
}
