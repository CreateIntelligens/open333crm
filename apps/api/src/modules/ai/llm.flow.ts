/**
 * LLM 呼叫的 flow：交易 1 → 交易外呼叫 LLM → 交易 2（change migrate-ai-llm-tenant-ctx，design D2、D4）。
 *
 * - prepareLlmCall()：交易 1 讀 Chat 設定、金鑰、遮罩政策與月額度上限；交易外以 Redis 計數器檢查月額度。
 * - runLlmCall()：呼叫 LLM，然後 recordLlmUsage()。
 * - recordLlmUsage()：交易 2 寫 AiUsage，寫完才回傳；commit 之後累加計數器，跨過門檻時以交易 3 把
 *   usage.quota.threshold 寫進 outbox。每一步失敗都只記 log，不影響 AI 回覆（ai-usage-recording、usage-quota-alerts）。
 * - generateReply()：prepareLlmCall() 加上 runLlmCall()。
 *
 * 一次請求要呼叫多次 LLM 時（建議回覆），呼叫一次 prepareLlmCall()，每次呼叫 runLlmCall()。
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { logger } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';
import { callChatModel } from './llm-client.js';
import {
  composeSystemPrompt,
  readLlmInputs,
  writeAiUsage,
  type AiUsageInput,
  type AiUsageMeta,
  type LlmInputs,
  type LlmPrompt,
} from './llm.service.js';
import {
  claimCrossedThresholds,
  incrMonthlyTokens,
  isMonthlyTokenExceeded,
  readMonthlyTokensFromDb,
  type ReadDbTotal,
} from '../trial/token-quota.service.js';

export type { LlmPrompt } from './llm.service.js';

/**
 * - prisma：inTenant() 的基礎連線（app_tenant）。
 * - redis：月額度計數器與告警旗標。API 行程用 fastify.redis（'command'，Redis 不回應時每個指令最多 1 秒就失敗）。
 * - events：寫 outbox 的 publisher。
 */
export interface LlmDeps {
  prisma: PrismaClient;
  redis: Redis;
  events: EventPublisher;
}

export interface PreparedLlmCall extends LlmInputs {
  tenantId: string;
}

function dbTotalReader(deps: LlmDeps, tenantId: string): ReadDbTotal {
  return () => inTenant(deps.prisma, tenantId, (scope) => readMonthlyTokensFromDb(scope));
}

/** 月額度已滿時丟出 403 PLAN_LIMIT_EXCEEDED，不呼叫 LLM（真人回覆不受影響） */
export async function prepareLlmCall(deps: LlmDeps, tenantId: string): Promise<PreparedLlmCall> {
  const inputs = await inTenant(deps.prisma, tenantId, (scope) => readLlmInputs(scope));
  // monthlyTokens 只在平台金鑰時讀取；自備金鑰時是 null，不檢查（readLlmInputs）
  if (await isMonthlyTokenExceeded(deps.redis, tenantId, inputs.monthlyTokens, dbTotalReader(deps, tenantId))) {
    throw new AppError('已達方案 AI 月額度上限', 'PLAN_LIMIT_EXCEEDED', 403, { limitKey: 'monthlyTokens' });
  }
  return { tenantId, ...inputs };
}

/**
 * 記一次 LLM 呼叫的用量。不丟錯：每一步失敗都只記 log。
 * Agent 的每一輪也呼叫這個函式（design D6）。
 */
export async function recordLlmUsage(
  deps: LlmDeps,
  prepared: PreparedLlmCall,
  input: Omit<AiUsageInput, 'keySource'>,
): Promise<void> {
  const { tenantId } = prepared;
  let quotaTokens: number;
  try {
    ({ quotaTokens } = await inTenant(deps.prisma, tenantId, (scope) =>
      writeAiUsage(scope, { ...input, keySource: prepared.keySource }),
    ));
  } catch (err) {
    // 沒有這次的紀錄，計數器也不累加；不補寫（用量紀錄最多一次）
    logger.error('[AiUsage] failed to record usage:', err);
    return;
  }

  // AiUsage 已 commit：計數器不存在、以資料庫加總回填時，加總已經包含這次的用量
  const after = await incrMonthlyTokens(deps.redis, tenantId, quotaTokens, dbTotalReader(deps, tenantId));
  if (after === null || getConfig().USAGE_QUOTA_ALERTS_ENABLED !== 1) return;

  const crossed = await claimCrossedThresholds(deps.redis, tenantId, prepared.monthlyTokens, quotaTokens, after);
  if (crossed.length === 0) return;
  try {
    await inTenant(deps.prisma, tenantId, async (scope) => {
      for (const c of crossed) {
        await publishEvent(scope, deps.events, 'usage.quota.threshold', {
          level: c.level,
          usedTokens: c.usedTokens,
          limitTokens: c.limitTokens,
          monthKey: c.monthKey,
        });
      }
    });
  } catch (err) {
    // 門檻的 Redis 旗標已寫入，這個月不再發送這個門檻的告警（spec usage-quota-alerts「告警事件寫入失敗」）
    logger.error('[TokenQuota] 用量告警事件寫入失敗:', err);
  }
}

/** provider 失敗時寫一筆 success=false 的紀錄，再丟出原本的錯誤 */
export async function runLlmCall(
  deps: LlmDeps,
  prepared: PreparedLlmCall,
  prompt: LlmPrompt,
  meta?: AiUsageMeta,
): Promise<string> {
  const usageBase = { provider: prepared.settings.provider, model: prepared.settings.model, meta };
  let result;
  try {
    result = await callChatModel(prepared, {
      systemPrompt: composeSystemPrompt(prepared.settings, prompt),
      userMessage: prompt.userMessage,
      history: prompt.history,
    });
  } catch (err) {
    await recordLlmUsage(deps, prepared, {
      ...usageBase,
      success: false,
      errorCode: (err as Error).message?.slice(0, 200),
    });
    throw err;
  }
  await recordLlmUsage(deps, prepared, { ...usageBase, usage: result.usage, success: true });
  return result.text;
}

/**
 * 以租戶的 Chat 設定產生回覆。
 *
 * `options.promptKind`、`overrideSystemPrompt` 見 LlmPrompt；`meta` 是用量紀錄的來源標記與關聯（未傳 feature 記為 unknown）。
 */
export async function generateReply(
  deps: LlmDeps,
  tenantId: string,
  userMessage: string,
  kbContext = '',
  options: Omit<LlmPrompt, 'userMessage' | 'kbContext'> & { meta?: AiUsageMeta } = {},
): Promise<string> {
  const { meta, ...prompt } = options;
  const prepared = await prepareLlmCall(deps, tenantId);
  return runLlmCall(deps, prepared, { ...prompt, userMessage, kbContext }, meta);
}
