import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { AppError, success } from "../../shared/utils/response.js";
import {
  checkEmbeddingHealthFlow,
  getEmbeddingSettingsPageFlow,
  updateEmbeddingSettingsFlow,
} from "./embedding-settings.flow.js";
import { actorOf } from "../../lib/request-actor.js";
import {
  getChatSettings,
  updateChatSettings,
  listChatModels,
  checkChatHealth,
  getProviderList,
} from "./chat-settings.service.js";
import {
  CRM_REPLY_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  CLARIFY_SYSTEM_PROMPT,
  MODEL_GUIDE_SYSTEM_PROMPT,
} from "../ai/llm.service.js";
import { getTenantGeminiKeyStatus, setTenantGeminiKey, resolveGeminiKey } from "../ai/ai-key.service.js";
import { requirePermission } from "../../guards/rbac.guard.js";
import { writeTenantAudit } from "../tenant-audit/tenant-audit.service.js";
import { getConfig } from "../../config/env.js";
import { buildA2AStatus } from "./a2a-status.service.js";
import { httpUrlSchema } from '../../shared/utils/url-schemes.js';
import {
  applyIdentityBindingUpdate,
  findIdentityBindingKeywordIssue,
  parseIdentityBindingSettings,
} from "../identity-binding/binding-links.js";
import { CONFIRM_KEYWORD } from "../identity-binding/binding-code.js";
import {
  getIdentityBindingSettings,
  invalidateIdentityBindingSettings,
} from "../identity-binding/identity-binding.service.js";
import officeHoursRoutes from "./office-hours.routes.js";
import trackingSettingsRoutes from "./tracking-settings.routes.js";
import partnerApiKeyRoutes from "./partner-api-key.routes.js";
import cliSessionRoutes from "./cli-session.routes.js";

const bindingKeywordsSchema = z
  .array(z.string().trim().min(1, "關鍵字不可為空白").max(20, "關鍵字不可超過 20 字"))
  .min(1, "至少需要一個關鍵字")
  .max(5, "最多 5 個關鍵字");

export const identityBindingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    bindKeywords: bindingKeywordsSchema,
    unbindKeywords: bindingKeywordsSchema,
    // email 登記（change add-email-identity-merge）：沒送時沿用已儲存的值（見 applyIdentityBindingUpdate）
    emailEnabled: z.boolean().optional(),
    emailKeywords: bindingKeywordsSchema.optional(),
    // 手機登記（change add-phone-identity-merge）：同 email，沒送時沿用已儲存的值
    phoneEnabled: z.boolean().optional(),
    phoneKeywords: bindingKeywordsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    for (const [path, list] of [["bindKeywords", data.bindKeywords], ["unbindKeywords", data.unbindKeywords]] as const) {
      if (list.some((k) => k === CONFIRM_KEYWORD)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `「${CONFIRM_KEYWORD}」是顧客確認綁定用的回覆字，不可設為關鍵字`,
        });
      }
    }
    const bind = new Set(data.bindKeywords.map((k) => k.toLowerCase()));
    if (data.unbindKeywords.some((k) => bind.has(k.toLowerCase()))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unbindKeywords"],
        message: "綁定與解除關鍵字不可相同",
      });
    }
    // email、手機登記關鍵字的衝突在路由對合併後的設定檢查（findIdentityBindingKeywordIssue）
  });

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", requirePermission("settings.manage"));

  // 各資源的路由在自己的檔案（AGENTS.md 結構規則 3）。子 plugin 繼承上面的 hook，同樣要求登入與 settings.manage
  await fastify.register(officeHoursRoutes);
  await fastify.register(trackingSettingsRoutes);
  await fastify.register(partnerApiKeyRoutes);
  await fastify.register(cliSessionRoutes);

  // GET /api/v1/settings/a2a — safe bridge status only; credentials never leave deployment secrets.
  fastify.get("/a2a", async (_request, reply) => {
    return reply.send(success(buildA2AStatus(getConfig())));
  });

  // ─── Identity Binding（跨渠道 One ID）──────────────────────────────────────
  // GET /api/v1/settings/identity-binding
  fastify.get("/identity-binding", async (request, reply) => {
    return reply.send(success(await getIdentityBindingSettings(request.tenantPrisma, request.agent.tenantId)));
  });

  // PUT /api/v1/settings/identity-binding
  fastify.put("/identity-binding", async (request, reply) => {
    const data = identityBindingSettingsSchema.parse(request.body);
    const tenantId = request.agent.tenantId;
    const value = applyIdentityBindingUpdate(await getIdentityBindingSettings(request.tenantPrisma, tenantId), data);
    const issue = findIdentityBindingKeywordIssue(value);
    if (issue) throw new AppError(issue.message, "VALIDATION_ERROR", 400, { issues: [issue] });
    await request.tenantPrisma.tenantSettings.upsert({
      where: { tenantId },
      // 展開成物件字面值：介面型別沒有索引簽章，不能直接當成 JSON 欄位的值
      create: { tenantId, identityBinding: { ...value } },
      update: { identityBinding: { ...value } },
    });
    invalidateIdentityBindingSettings(tenantId);
    await writeTenantAudit(request.tenantPrisma, {
      tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "identity-binding", enabled: value.enabled, emailEnabled: value.emailEnabled, phoneEnabled: value.phoneEnabled },
      ip: request.ip,
    });
    return reply.send(success(parseIdentityBindingSettings(value)));
  });

  // ─── Embedding Settings ──────────────────────────────────────────────────
  // GET /api/v1/settings/embedding — settings + Ollama health + models + stats
  fastify.get("/embedding", async (request, reply) => {
    return reply.send(success(await getEmbeddingSettingsPageFlow(fastify, actorOf(request).tenantId)));
  });

  // PUT /api/v1/settings/embedding — update settings (returns modelChanged hint)
  fastify.put("/embedding", async (request, reply) => {
    const patch = embeddingSettingsSchema.parse(request.body);
    return reply.send(success(await updateEmbeddingSettingsFlow(fastify, actorOf(request), patch)));
  });

  // POST /api/v1/settings/embedding/health — re-check health on demand
  fastify.post("/embedding/health", async (request, reply) => {
    return reply.send(success(await checkEmbeddingHealthFlow(fastify, actorOf(request).tenantId)));
  });

  // ─── Chat Settings ───────────────────────────────────────────────────────
  // GET /api/v1/settings/chat — settings + provider list + models + health + prompt defaults
  fastify.get("/chat", async (request, reply) => {
    const tenantId = request.agent.tenantId;
    const settings = await getChatSettings(request.tenantPrisma, tenantId);
    // gemini 健康檢查要走三層 fallback 取租戶 BYOK key（否則 env 未設會誤報 not configured）。
    const chatApiKey =
      settings.provider === "gemini"
        ? (await resolveGeminiKey(request.tenantPrisma, tenantId)).key
        : undefined;
    const [models, health] = await Promise.all([
      listChatModels(settings.provider, settings.baseUrl),
      checkChatHealth(settings.provider, settings.model, settings.baseUrl, chatApiKey),
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
      request.tenantPrisma,
      request.agent.tenantId,
      patch,
    );
    // 稽核：變更 Chat/LLM 設定（只記變更的欄位名，不放 prompt/model 明文）
    await writeTenantAudit(request.tenantPrisma, {
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
    const status = await getTenantGeminiKeyStatus(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(status));
  });

  // PUT /api/v1/settings/gemini-key — 設定/清除 BYOK key（body: { apiKey: string | null }）
  fastify.put("/gemini-key", async (request, reply) => {
    const { apiKey } = z
      .object({ apiKey: z.string().min(1).nullable() })
      .parse(request.body);
    await setTenantGeminiKey(request.tenantPrisma, request.agent.tenantId, apiKey);
    // 稽核：設定/清除 BYOK 金鑰（絕不記金鑰明文，只記「設定」或「清除」動作）
    await writeTenantAudit(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "gemini-key", operation: apiKey ? "set" : "clear" },
      ip: request.ip,
    });
    const status = await getTenantGeminiKeyStatus(request.tenantPrisma, request.agent.tenantId);
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
      request.tenantPrisma,
      request.agent.tenantId,
    );
    // gemini 健康檢查要走三層 fallback 取租戶 BYOK key（否則 env 未設會誤報 not configured）。
    const chatApiKey =
      settings.provider === "gemini"
        ? (await resolveGeminiKey(request.tenantPrisma, request.agent.tenantId)).key
        : undefined;
    const health = await checkChatHealth(
      settings.provider,
      settings.model,
      settings.baseUrl,
      chatApiKey,
    );
    return reply.send(success(health));
  });
}

/** System prompt 長度上限：直接影響每次 LLM 呼叫的 token 成本 */
export const MAX_SYSTEM_PROMPT_LENGTH = 8000;

const systemPromptSchema = z
  .string()
  .max(MAX_SYSTEM_PROMPT_LENGTH, `提示詞不可超過 ${MAX_SYSTEM_PROMPT_LENGTH} 字`);

const embeddingSettingsSchema = z.object({
  // 後端會 fetch 這個位址（健康檢查／向量化）→ 不限 scheme 等於 SSRF 面
  baseUrl: httpUrlSchema.optional(),
  model: z.string().min(1).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  threshold: z.number().min(0).max(1).optional(),
});

const chatSettingsSchema = z.object({
  provider: z.enum(["ollama", "gemini"]).optional(),
  model: z.string().min(1).optional(),
  // 後端會 fetch 這個位址（健康檢查／向量化）→ 不限 scheme 等於 SSRF 面
  baseUrl: httpUrlSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  // 這四段會直接進 LLM context，無上限等於可撐爆 token 預算。
  // 上限 8000 字：專案內建的四段預設 prompt 最長 360 字（CLARIFY），
  // 8000 留了 20 倍以上的客製空間，同時擋住 10 萬字這種明顯失控的輸入。
  chatSystemPrompt: systemPromptSchema.optional(),
  summarizeSystemPrompt: systemPromptSchema.optional(),
  clarifySystemPrompt: systemPromptSchema.optional(),
  modelGuideSystemPrompt: systemPromptSchema.optional(),
  clarifyThreshold: z.number().min(0).max(1).optional(),
  clarifyMaxAttempts: z.number().int().min(0).max(5).optional(),
});

const chatModelsQuery = z.object({
  provider: z.enum(["ollama", "gemini"]),
  // 後端會 fetch 這個位址（健康檢查／向量化）→ 不限 scheme 等於 SSRF 面
  baseUrl: httpUrlSchema.optional(),
});
