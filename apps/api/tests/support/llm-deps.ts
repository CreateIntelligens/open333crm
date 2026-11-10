/**
 * 單元測試呼叫 LLM 的 flow 用的假依賴（change migrate-ai-llm-tenant-ctx）。
 *
 * tx 是測試的 Prisma mock。LLM 的三段會另外讀寫這些表，測試沒有給時用預設值：
 * - tenant.findUnique → null：沒有方案上限，不檢查月額度。
 * - platformSetting.findUnique → null：遮罩政策關閉。
 * - modelPricing.findFirst → null；aiUsage.create／aggregate → 不保存。
 * 測試給的 model 方法蓋過預設值。
 *
 * Redis 預設每個指令都失敗，與 tests/setup/unit.setup.ts 的 ioredis mock 相同（像 Redis 無法連線）。
 */
import type { LlmDeps } from '#src/modules/ai/llm.flow.js';
import { createFlowLog, mockTransactionPrisma, recordingPublisher, type FlowLog } from './flow-harness.js';

const DEFAULT_TX: Record<string, Record<string, unknown>> = {
  tenant: { findUnique: async () => null },
  platformSetting: { findUnique: async () => null },
  modelPricing: { findFirst: async () => null },
  aiUsage: { create: async () => ({}), aggregate: async () => ({ _sum: { totalTokens: 0 } }) },
};

export const downRedis = new Proxy(
  {},
  { get: () => async () => { throw new Error('redis down (unit test)'); } },
) as LlmDeps['redis'];

export function mockLlmDeps(
  tx: unknown,
  opts: { redis?: LlmDeps['redis']; log?: FlowLog } = {},
): LlmDeps & { log: FlowLog } {
  const log = opts.log ?? createFlowLog();
  const given = (tx ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...given };
  for (const [model, methods] of Object.entries(DEFAULT_TX)) {
    merged[model] = { ...methods, ...((given[model] as Record<string, unknown> | undefined) ?? {}) };
  }
  return {
    prisma: mockTransactionPrisma(log, merged),
    redis: opts.redis ?? downRedis,
    events: recordingPublisher(log),
    log,
  };
}
