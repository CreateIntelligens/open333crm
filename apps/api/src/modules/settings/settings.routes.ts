import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { success } from "../../shared/utils/response.js";
import { getOfficeHours, updateOfficeHours } from "./office-hours.service.js";
import {
  getEmbeddingSettings,
  updateEmbeddingSettings,
  checkOllamaHealth,
  listOllamaModels,
  getEmbeddingStats,
  EMBEDDING_VECTOR_DIM,
} from "./embedding-settings.service.js";
import {
  getChatSettings,
  updateChatSettings,
  listChatModels,
  checkChatHealth,
  getProviderList,
} from "./chat-settings.service.js";
import {
  createPartnerApiKey,
  listPartnerApiKeys,
  revokePartnerApiKey,
} from "../auth/partner-api-key.service.js";
import {
  createCliSession,
  revokeCliSession,
  parseCliScopes,
  DEFAULT_CLI_SCOPES,
} from "../auth/cli-session.service.js";
import { MCP_READ_SCOPE } from "../mcp/mcp.constants.js";
import {
  CRM_REPLY_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  CLARIFY_SYSTEM_PROMPT,
  MODEL_GUIDE_SYSTEM_PROMPT,
} from "../ai/llm.service.js";
import { getTenantGeminiKeyStatus, setTenantGeminiKey } from "../ai/ai-key.service.js";
import { requirePermission } from "../../guards/rbac.guard.js";
import { writeTenantAudit } from "../tenant-audit/tenant-audit.service.js";

const dayScheduleSchema = z
  .object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .nullable();

const officeHoursSchema = z.object({
  timezone: z.string().default("Asia/Taipei"),
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
    outsideHoursMessage: z
      .string()
      .default("您好！目前為非營業時間，我們將在營業時間內盡速回覆您。"),
  }),
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", requirePermission("settings.manage"));

  // GET /api/v1/settings/office-hours
  fastify.get("/office-hours", async (request, reply) => {
    const result = await getOfficeHours(fastify.prisma, request.agent.tenantId);
    return reply.send(success(result));
  });

  // PUT /api/v1/settings/office-hours
  fastify.put("/office-hours", async (request, reply) => {
    const data = officeHoursSchema.parse(request.body);
    const result = await updateOfficeHours(
      fastify.prisma,
      request.agent.tenantId,
      data.timezone,
      data.officeHours as any,
    );
    // 稽核：變更系統設定（只記變更的設定區塊，不放敏感值）
    await writeTenantAudit(fastify.prisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "office-hours" },
      ip: request.ip,
    });
    return reply.send(success(result));
  });

  // ─── Tracking Settings ──────────────────────────────────────────────────
  // GET /api/v1/settings/tracking
  fastify.get("/tracking", async (request, reply) => {
    const tenantId = request.agent.tenantId;
    let settings = await fastify.prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { gaId: true, metaPixelId: true },
    });
    if (!settings) {
      settings = await fastify.prisma.tenantSettings.create({
        data: { tenantId },
        select: { gaId: true, metaPixelId: true },
      });
    }
    return reply.send(success(settings));
  });

  // PUT /api/v1/settings/tracking
  fastify.put("/tracking", async (request, reply) => {
    const data = trackingSettingsSchema.parse(request.body);
    const tenantId = request.agent.tenantId;
    const settings = await fastify.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        gaId: data.gaId ?? null,
        metaPixelId: data.metaPixelId ?? null,
      },
      update: {
        gaId: data.gaId ?? null,
        metaPixelId: data.metaPixelId ?? null,
      },
      select: { gaId: true, metaPixelId: true },
    });
    // 稽核：變更追蹤設定（只記有無設定 GA/Pixel，不放 ID 值）
    await writeTenantAudit(fastify.prisma, {
      tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: {
        section: "tracking",
        gaIdSet: Boolean(data.gaId),
        metaPixelIdSet: Boolean(data.metaPixelId),
      },
      ip: request.ip,
    });
    return reply.send(success(settings));
  });

  // ─── Embedding Settings ──────────────────────────────────────────────────
  // GET /api/v1/settings/embedding — settings + Ollama health + models + stats
  fastify.get("/embedding", async (request, reply) => {
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
  fastify.put("/embedding", async (request, reply) => {
    const patch = embeddingSettingsSchema.parse(request.body);
    const result = await updateEmbeddingSettings(
      fastify.prisma,
      request.agent.tenantId,
      patch,
    );
    // 稽核：變更 Embedding 設定（只記變更的欄位名，不放 baseUrl 等值）
    await writeTenantAudit(fastify.prisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "embedding", keys: Object.keys(patch) },
      ip: request.ip,
    });
    return reply.send(success(result));
  });

  // POST /api/v1/settings/embedding/health — re-check health on demand
  fastify.post("/embedding/health", async (request, reply) => {
    const settings = await getEmbeddingSettings(
      fastify.prisma,
      request.agent.tenantId,
    );
    const health = await checkOllamaHealth(settings.baseUrl, settings.model);
    return reply.send(success(health));
  });

  // ─── Chat Settings ───────────────────────────────────────────────────────
  // GET /api/v1/settings/chat — settings + provider list + models + health + prompt defaults
  fastify.get("/chat", async (request, reply) => {
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
          modelGuideSystemPrompt: MODEL_GUIDE_SYSTEM_PROMPT,
        },
      }),
    );
  });

  // PUT /api/v1/settings/chat — update settings
  fastify.put("/chat", async (request, reply) => {
    const patch = chatSettingsSchema.parse(request.body);
    const result = await updateChatSettings(
      fastify.prisma,
      request.agent.tenantId,
      patch,
    );
    // 稽核：變更 Chat/LLM 設定（只記變更的欄位名，不放 prompt/model 明文）
    await writeTenantAudit(fastify.prisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "chat", keys: Object.keys(patch) },
      ip: request.ip,
    });
    return reply.send(success(result));
  });

  // GET /api/v1/settings/gemini-key — 查 BYOK key 狀態（遮罩，不回明文）
  fastify.get("/gemini-key", async (request, reply) => {
    const status = await getTenantGeminiKeyStatus(fastify.prisma, request.agent.tenantId);
    return reply.send(success(status));
  });

  // PUT /api/v1/settings/gemini-key — 設定/清除 BYOK key（body: { apiKey: string | null }）
  fastify.put("/gemini-key", async (request, reply) => {
    const { apiKey } = z
      .object({ apiKey: z.string().min(1).nullable() })
      .parse(request.body);
    await setTenantGeminiKey(fastify.prisma, request.agent.tenantId, apiKey);
    // 稽核：設定/清除 BYOK 金鑰（絕不記金鑰明文，只記「設定」或「清除」動作）
    await writeTenantAudit(fastify.prisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "gemini-key", operation: apiKey ? "set" : "clear" },
      ip: request.ip,
    });
    const status = await getTenantGeminiKeyStatus(fastify.prisma, request.agent.tenantId);
    return reply.send(success(status));
  });

  // GET /api/v1/settings/chat/models?provider=gemini&baseUrl=...
  fastify.get("/chat/models", async (request, reply) => {
    const q = chatModelsQuery.parse(request.query);
    const models = await listChatModels(q.provider, q.baseUrl);
    return reply.send(success({ models }));
  });

  // POST /api/v1/settings/chat/health — re-check health on demand
  fastify.post("/chat/health", async (request, reply) => {
    const settings = await getChatSettings(
      fastify.prisma,
      request.agent.tenantId,
    );
    const health = await checkChatHealth(
      settings.provider,
      settings.model,
      settings.baseUrl,
    );
    return reply.send(success(health));
  });

  // ─── Partner API Keys ────────────────────────────────────────────────────
  // GET /api/v1/settings/api-keys — list (masked)
  fastify.get("/api-keys", async (request, reply) => {
    const rows = await listPartnerApiKeys(
      fastify.prisma,
      request.agent.tenantId,
    );
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
  fastify.post("/api-keys", async (request, reply) => {
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
  fastify.delete<{ Params: { id: string } }>(
    "/api-keys/:id",
    async (request, reply) => {
      await revokePartnerApiKey(
        fastify.prisma,
        request.agent.tenantId,
        request.params.id,
      );
      return reply.send(success({ revoked: true }));
    },
  );

  // ─── CLI Sessions ──────────────────────────────────────────────────────
  // GET /api/v1/settings/cli-sessions — list CLI sessions for current tenant
  fastify.get("/cli-sessions", async (request, reply) => {
    const rows = await fastify.prisma.cliSession.findMany({
      where: {
        tenantId: request.agent.tenantId,
        revokedAt: null,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(
      success(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          agent: r.agent,
          tokenPrefix: r.tokenPrefix,
          tokenSuffix: r.tokenSuffix,
          scopes: parseCliScopes(r.scopes),
          expiresAt: r.expiresAt.toISOString(),
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      ),
    );
  });

  // POST /api/v1/settings/cli-sessions — create a new CLI session
  fastify.post("/cli-sessions", async (request, reply) => {
    const body = createCliSessionSchema.parse(request.body);
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const { token, session } = await createCliSession(fastify.prisma, {
      tenantId: request.agent.tenantId,
      agentId: request.agent.id,
      name: body.name,
      scopes: body.mcpRead
        ? [...new Set([...(body.scopes ?? DEFAULT_CLI_SCOPES), MCP_READ_SCOPE])]
        : body.scopes,
      expiresAt,
    });

    return reply.status(201).send(
      success({
        token,
        session: {
          id: session.id,
          name: session.name,
          tokenPrefix: session.tokenPrefix,
          tokenSuffix: session.tokenSuffix,
          scopes: parseCliScopes(session.scopes),
          expiresAt: session.expiresAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        },
      }),
    );
  });

  // DELETE /api/v1/settings/cli-sessions/:id — revoke a CLI session
  fastify.delete<{ Params: { id: string } }>(
    "/cli-sessions/:id",
    async (request, reply) => {
      await revokeCliSession(
        fastify.prisma,
        request.params.id,
        request.agent.tenantId,
      );
      return reply.send(success({ revoked: true }));
    },
  );
}

const trackingSettingsSchema = z.object({
  gaId: z.string().nullable().optional(),
  metaPixelId: z.string().nullable().optional(),
});

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
  provider: z.enum(["ollama", "gemini"]).optional(),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  chatSystemPrompt: z.string().optional(),
  summarizeSystemPrompt: z.string().optional(),
  clarifySystemPrompt: z.string().optional(),
  modelGuideSystemPrompt: z.string().optional(),
  clarifyThreshold: z.number().min(0).max(1).optional(),
  clarifyMaxAttempts: z.number().int().min(0).max(5).optional(),
});

const chatModelsQuery = z.object({
  provider: z.enum(["ollama", "gemini"]),
  baseUrl: z.string().url().optional(),
});

const createCliSessionSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  mcpRead: z.boolean().default(false),
  expiresInDays: z.number().int().positive().nullable().optional(),
});
