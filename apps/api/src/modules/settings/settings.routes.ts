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
}

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
});

const chatModelsQuery = z.object({
  provider: z.enum(['ollama', 'gemini']),
  baseUrl: z.string().url().optional(),
});
