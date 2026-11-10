/**
 * Chat 設定與 Gemini 金鑰的 flow（change migrate-ai-llm-tenant-ctx，design D8；spec chat-settings）。
 *
 * 讀設定與金鑰在交易內，列出模型與檢查健康狀態在交易外。修改設定或金鑰時，資料與稽核在同一個交易寫入：
 * 稽核寫入失敗時，設定或金鑰一起 rollback。
 */
import type { PrismaClient } from '@prisma/client';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { checkChatHealth, getProviderList, listChatModels } from '../ai/llm-client.js';
import { getTenantGeminiKeyStatus, resolveGeminiKey, setTenantGeminiKey } from '../ai/ai-key.service.js';
import {
  CLARIFY_SYSTEM_PROMPT,
  CRM_REPLY_SYSTEM_PROMPT,
  MODEL_GUIDE_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
} from '../ai/llm.service.js';
import { getChatSettings, updateChatSettings, type ChatSettings } from './chat-settings.service.js';

/** 設定與健康檢查要用的金鑰：provider 是 Gemini 時，用這次呼叫 LLM 會用的金鑰（租戶自備的金鑰，否則平台的金鑰） */
async function readSettingsForHealth(ctx: TenantCtx): Promise<{ settings: ChatSettings; apiKey: string | undefined }> {
  const settings = await getChatSettings(ctx);
  const apiKey = settings.provider === 'gemini' ? (await resolveGeminiKey(ctx)).key : undefined;
  return { settings, apiKey };
}

function checkHealth({ settings, apiKey }: { settings: ChatSettings; apiKey: string | undefined }) {
  return checkChatHealth(settings.provider, settings.model, settings.baseUrl, apiKey);
}

/** `GET /settings/chat`：設定、provider 清單、模型、健康狀態與各段預設提示詞 */
export async function getChatSettingsPageFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  const read = await inTenant(deps.prisma, tenantId, (scope) => readSettingsForHealth(scope));
  const [models, health] = await Promise.all([
    listChatModels(read.settings.provider, read.settings.baseUrl),
    checkHealth(read),
  ]);
  return {
    settings: read.settings,
    providers: getProviderList(),
    models,
    health,
    defaults: {
      chatSystemPrompt: CRM_REPLY_SYSTEM_PROMPT,
      summarizeSystemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      clarifySystemPrompt: CLARIFY_SYSTEM_PROMPT,
      modelGuideSystemPrompt: MODEL_GUIDE_SYSTEM_PROMPT,
    },
  };
}

/** `POST /settings/chat/health` */
export async function checkChatHealthFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  return checkHealth(await inTenant(deps.prisma, tenantId, (scope) => readSettingsForHealth(scope)));
}

/** `PUT /settings/chat`：稽核只記變更的欄位名，不放 prompt、model 的值 */
export function updateChatSettingsFlow(deps: { prisma: PrismaClient }, actor: RequestActor, patch: Partial<ChatSettings>) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await updateChatSettings(scope, patch);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'chat', keys: Object.keys(patch) },
      ip: actor.ip,
    });
    return result;
  });
}

/** `GET /settings/gemini-key`：只回 configured 與遮罩後的金鑰 */
export function getGeminiKeyStatusFlow(deps: { prisma: PrismaClient }, tenantId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => getTenantGeminiKeyStatus(scope));
}

/** `PUT /settings/gemini-key`：apiKey 是 null 時清除。稽核只記「設定」或「清除」，不記金鑰 */
export function setGeminiKeyFlow(deps: { prisma: PrismaClient }, actor: RequestActor, apiKey: string | null) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await setTenantGeminiKey(scope, apiKey);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'gemini-key', operation: apiKey ? 'set' : 'clear' },
      ip: actor.ip,
    });
    return getTenantGeminiKeyStatus(scope);
  });
}
