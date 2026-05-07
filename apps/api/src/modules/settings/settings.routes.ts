import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { getOfficeHours, updateOfficeHours } from './office-hours.service.js';
import {
  getEmbeddingSettings,
  updateEmbeddingSettings,
  checkOllamaHealth,
  listOllamaModels,
  getEmbeddingStats,
  EMBEDDING_VECTOR_DIM,
} from './embedding-settings.service.js';
import {
  getChatSettings,
  updateChatSettings,
  listChatModels,
  checkChatHealth,
  getProviderList,
} from './chat-settings.service.js';
import {
  createPartnerApiKey,
  listPartnerApiKeys,
  revokePartnerApiKey,
} from '../auth/partner-api-key.service.js';
import {
  getBotInactivitySettings,
  updateBotInactivitySettings,
} from './bot-inactivity-settings.service.js';
import {
  CRM_REPLY_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  CLARIFY_SYSTEM_PROMPT,
} from '../ai/llm.service.js';
import { requireSupervisor } from '../../guards/rbac.guard.js';

const dayScheduleSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).nullable();

const officeHoursSchema = z.object({
  timezone: z.string().default('Asia/Taipei'),
  officeHours: z.object({
    enabled: z.boolean(),
    schedule: z.object({
      mon: dayScheduleSchema.optional(),
      tue: dayScheduleSchema.optional(),
      wed: dayScheduleSchema.optional(),
      thu: dayScheduleSchema.optional(),
      fri: dayScheduleSchema.optional(),
      sat: dayScheduleSchema.optional(),
      sun: dayScheduleSchema.optional(),
    }),
    holidays: z.array(z.string()).default([]),
    outsideHoursMessage: z.string().default('您好！目前為非營業時間，我們將在營業時間內盡速回覆您。'),
  }),
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requireSupervisor());

  // GET /api/v1/settings/office-hours
  fastify.get('/office-hours', async (request, reply) => {
    const result = await getOfficeHours(fastify.prisma, request.agent.tenantId);
    return reply.send(success(result));
  });

  // PUT /api/v1/settings/office-hours
  fastify.put('/office-hours', async (request, reply) => {
    const data = officeHoursSchema.parse(request.body);
    const result = await updateOfficeHours(
      fastify.prisma,
      request.agent.tenantId,
      data.timezone,
      data.officeHours as any,
    );
    return reply.send(success(result));
  });

  // ─── Embedding Settings ──────────────────────────────────────────────────
  // GET /api/v1/settings/embedding — settings + Ollama health + models + stats
  fastify.get('/embedding', async (request, reply) => {
    const tenantId = request.agent.tenantId;
    const settings = await getEmbeddingSettings(fastify.prisma, tenantId);
    const [health, models, stats] = await Promise.all([
      checkOllamaHealth(settings.baseUrl, settings.model),
      listOllamaModels(settings.baseUrl),
      getEmbeddingStats(fastify.prisma, tenantId),
    ]);
    return reply.send(
      success({
        settings,
        health,
        models,
        stats,
        vectorDim: EMBEDDING_VECTOR_DIM,
      }),
    );
  });

  // PUT /api/v1/settings/embedding — update settings (returns modelChanged hint)
  fastify.put('/embedding', async (request, reply) => {
    const patch = embeddingSettingsSchema.parse(request.body);
    const result = await updateEmbeddingSettings(
      fastify.prisma,
      request.agent.tenantId,
      patch,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/settings/embedding/health — re-check health on demand
  fastify.post('/embedding/health', async (request, reply) => {
    const settings = await getEmbeddingSettings(fastify.prisma, request.agent.tenantId);
    const health = await checkOllamaHealth(settings.baseUrl, settings.model);
    return reply.send(success(health));
  });

  // ─── Chat Settings ───────────────────────────────────────────────────────
  // GET /api/v1/settings/chat — settings + provider list + models + health + prompt defaults
  fastify.get('/chat', async (request, reply) => {
    const tenantId = request.agent.tenantId;
    const settings = await getChatSettings(fastify.prisma, tenantId);
    const [models, health] = await Promise.all([
      listChatModels(settings.provider, settings.baseUrl),
      checkChatHealth(settings.provider, settings.model, settings.baseUrl),
    ]);
    return reply.send(
      success({
        settings,
        providers: getProviderList(),
        models,
        health,
        defaults: {
          chatSystemPrompt: CRM_REPLY_SYSTEM_PROMPT,
          summarizeSystemPrompt: SUMMARIZE_SYSTEM_PROMPT,
          clarifySystemPrompt: CLARIFY_SYSTEM_PROMPT,
        },
      }),
    );
  });

  // PUT /api/v1/settings/chat — update settings
  fastify.put('/chat', async (request, reply) => {
    const patch = chatSettingsSchema.parse(request.body);
    const result = await updateChatSettings(
      fastify.prisma,
      request.agent.tenantId,
      patch,
    );
    return reply.send(success(result));
  });

  // GET /api/v1/settings/chat/models?provider=gemini&baseUrl=...
  fastify.get('/chat/models', async (request, reply) => {
    const q = chatModelsQuery.parse(request.query);
    const models = await listChatModels(q.provider, q.baseUrl);
    return reply.send(success({ models }));
  });

  // POST /api/v1/settings/chat/health — re-check health on demand
  fastify.post('/chat/health', async (request, reply) => {
    const settings = await getChatSettings(fastify.prisma, request.agent.tenantId);
    const health = await checkChatHealth(settings.provider, settings.model, settings.baseUrl);
    return reply.send(success(health));
  });

  // ─── BOT Inactivity Auto-Close ───────────────────────────────────────────
  // GET /api/v1/settings/bot-inactivity → { botInactivityMinutes }
  fastify.get('/bot-inactivity', async (request, reply) => {
    const result = await getBotInactivitySettings(fastify.prisma, request.agent.tenantId);
    return reply.send(success(result));
  });

  // PUT /api/v1/settings/bot-inactivity body { botInactivityMinutes }
  fastify.put('/bot-inactivity', async (request, reply) => {
    const patch = botInactivitySchema.parse(request.body);
    const result = await updateBotInactivitySettings(
      fastify.prisma,
      request.agent.tenantId,
      patch,
    );
    return reply.send(success(result));
  });

  // ─── Handoff Fallback ────────────────────────────────────────────────────
  // Default assignee when conversation.handoff fires but no rule matches.
  fastify.get('/handoff-fallback', async (request, reply) => {
    const tenantId = request.agent.tenantId;
    let s = await fastify.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!s) s = await fastify.prisma.tenantSettings.create({ data: { tenantId } });
    return reply.send(success({
      handoffFallbackAgentId: s.handoffFallbackAgentId,
      handoffFallbackTeamId: s.handoffFallbackTeamId,
    }));
  });

  fastify.put('/handoff-fallback', async (request, reply) => {
    const patch = handoffFallbackSchema.parse(request.body);
    const tenantId = request.agent.tenantId;
    const updated = await fastify.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        handoffFallbackAgentId: patch.handoffFallbackAgentId ?? null,
        handoffFallbackTeamId: patch.handoffFallbackTeamId ?? null,
      },
      update: {
        handoffFallbackAgentId: patch.handoffFallbackAgentId ?? null,
        handoffFallbackTeamId: patch.handoffFallbackTeamId ?? null,
      },
    });
    return reply.send(success({
      handoffFallbackAgentId: updated.handoffFallbackAgentId,
      handoffFallbackTeamId: updated.handoffFallbackTeamId,
    }));
  });

  // ─── Partner API Keys ────────────────────────────────────────────────────
  // GET /api/v1/settings/api-keys — list (masked)
  fastify.get('/api-keys', async (request, reply) => {
    const rows = await listPartnerApiKeys(fastify.prisma, request.agent.tenantId);
    return reply.send(
      success(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          masked: `${r.keyPrefix}…${r.keySuffix}`,
          isActive: r.isActive,
          expiresAt: r.expiresAt,
          lastUsedAt: r.lastUsedAt,
          createdAt: r.createdAt,
        })),
      ),
    );
  });

  // POST /api/v1/settings/api-keys — create (returns raw key once)
  fastify.post('/api-keys', async (request, reply) => {
    const body = createApiKeySchema.parse(request.body);
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const result = await createPartnerApiKey(fastify.prisma, {
      tenantId: request.agent.tenantId,
      createdById: request.agent.id,
      name: body.name,
      expiresAt,
    });

    return reply.status(201).send(
      success({
        // The raw key is only available here. Store it on the client side
        // immediately — the server will never return it again.
        key: result.key,
        id: result.apiKey.id,
        name: result.apiKey.name,
        masked: `${result.apiKey.keyPrefix}…${result.apiKey.keySuffix}`,
        expiresAt: result.apiKey.expiresAt,
        createdAt: result.apiKey.createdAt,
      }),
    );
  });

  // DELETE /api/v1/settings/api-keys/:id — revoke (soft-delete; isActive=false)
  fastify.delete<{ Params: { id: string } }>('/api-keys/:id', async (request, reply) => {
    await revokePartnerApiKey(fastify.prisma, request.agent.tenantId, request.params.id);
    return reply.send(success({ revoked: true }));
  });
}

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  // null / undefined / 0 → never expires
  expiresInDays: z.number().int().positive().nullable().optional(),
});

const embeddingSettingsSchema = z.object({
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  threshold: z.number().min(0).max(1).optional(),
});

const chatSettingsSchema = z.object({
  provider: z.enum(['ollama', 'gemini']).optional(),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  chatSystemPrompt: z.string().optional(),
  summarizeSystemPrompt: z.string().optional(),
  clarifySystemPrompt: z.string().optional(),
  clarifyThreshold: z.number().min(0).max(1).optional(),
  clarifyMaxAttempts: z.number().int().min(0).max(5).optional(),
  handoffOnNegativeSentiment: z.boolean().optional(),
  negativeSentimentThreshold: z.number().min(0).max(1).optional(),
  sentimentTriggersHandoff: z.boolean().optional(),
});

const handoffFallbackSchema = z.object({
  // mutually exclusive: pick agent OR team (not both); both null disables fallback
  handoffFallbackAgentId: z.string().uuid().nullable().optional(),
  handoffFallbackTeamId: z.string().uuid().nullable().optional(),
}).refine(
  (data) => !(data.handoffFallbackAgentId && data.handoffFallbackTeamId),
  { message: 'Pick either agent or team, not both' },
);

const botInactivitySchema = z.object({
  // 60 min ~ 7 days (10080 min)
  botInactivityMinutes: z.number().int().min(60).max(7 * 24 * 60),
});

const chatModelsQuery = z.object({
  provider: z.enum(['ollama', 'gemini']),
  baseUrl: z.string().url().optional(),
});
