/**
 * AI 用量的記錄、月額度的計數與檢查，以及觸發用量告警的條件。
 * 主規格：token-quota、usage-quota-alerts、ai-usage-recording「記錄金鑰來源」、
 * model-pricing「成本計算公式」、trial-lifecycle「試用 token 額度硬擋（簡化版）」。
 *
 * Redis 換成記憶體版本（支援 NX 與「無法連線」），provider 換成假的，
 * 其餘走真的 generateReply → recordAiUsage → token-quota。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-usage-quota-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
process.env.GEMINI_API_KEY = 'platform-gemini-key';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const redisState = vi.hoisted(() => ({ store: new Map<string, string>(), down: false }));
vi.mock('@open333crm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open333crm/core')>();
  const check = () => {
    if (redisState.down) throw new Error('redis down');
  };
  return {
    ...actual,
    redis: {
      get: async (key: string) => (check(), redisState.store.get(key) ?? null),
      set: async (key: string, value: string | number, ...args: unknown[]) => {
        check();
        if (args.includes('NX') && redisState.store.has(key)) return null;
        redisState.store.set(key, String(value));
        return 'OK';
      },
      exists: async (key: string) => (check(), redisState.store.has(key) ? 1 : 0),
      incrby: async (key: string, n: number) => {
        check();
        const next = Number(redisState.store.get(key) ?? 0) + n;
        redisState.store.set(key, String(next));
        return next;
      },
      del: async (...keys: string[]) => (check(), keys.filter((k) => redisState.store.delete(k)).length),
    },
  };
});

const providerState = vi.hoisted(() => ({
  id: 'gemini' as 'gemini' | 'ollama',
  calls: [] as Array<{ apiKey?: string }>,
  fail: false,
  usage: { promptTokens: 1000, cachedTokens: 0, candidatesTokens: 500, thoughtsTokens: 0 },
}));
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: providerState.id,
    generate: async (opts: { apiKey?: string }) => {
      providerState.calls.push({ apiKey: opts.apiKey });
      if (providerState.fail) throw new Error('provider failed');
      return { text: 'LLM 的回覆', usage: providerState.usage };
    },
  }),
}));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({
    provider: providerState.id,
    model: providerState.id === 'gemini' ? 'gemini-2.5-flash' : 'qwen2.5:3b',
    temperature: 0.3,
    maxTokens: 500,
    baseUrl: 'http://localhost:11434',
    chatSystemPrompt: '',
    summarizeSystemPrompt: '',
  }),
}));

import { Prisma } from '@prisma/client';
import { loadEnvConfig, getConfig } from '#src/config/env.js';
import { eventBus } from '#src/events/event-bus.js';
import { generateReply } from '#src/modules/ai/llm.service.js';
import { encryptApiKey } from '#src/modules/ai/ai-key.service.js';
import { clearPricingCache } from '#src/modules/ai/pricing.service.js';
import { checkQuotaThresholdCrossing, isMonthlyTokenExceeded } from '#src/modules/trial/token-quota.service.js';
import { AppError } from '#src/shared/utils/response.js';

loadEnvConfig();

const TENANT = '11111111-1111-4111-8111-111111111111';

interface UsageRow {
  tenantId: string;
  keySource: string;
  success: boolean;
  totalTokens: number;
  costUsd: Prisma.Decimal;
  usageMissing: boolean;
  createdAt: Date;
}

/** 只實作 generateReply、recordAiUsage 與 token-quota 用到的 Prisma 方法 */
function createDb(opts: { monthlyTokens?: number | null; byokKey?: string; slug?: string } = {}) {
  const usages: UsageRow[] = [];
  const pricingLookups: string[] = [];
  const limits = opts.monthlyTokens === undefined ? {} : { monthlyTokens: opts.monthlyTokens };
  const prisma = {
    tenant: {
      findUnique: async () => ({ limitOverrides: {}, plan: { slug: opts.slug ?? 'standard', limits } }),
    },
    tenantSettings: {
      findUnique: async () => ({ geminiApiKeyEnc: opts.byokKey ? encryptApiKey(opts.byokKey) : null }),
    },
    modelPricing: {
      findFirst: async ({ where }: { where: { model: string } }) => {
        pricingLookups.push(where.model);
        return {
          model: where.model,
          inputPer1M: new Prisma.Decimal('0.30'),
          outputPer1M: new Prisma.Decimal('2.50'),
          cachedPer1M: new Prisma.Decimal('0.03'),
          tierThreshold: null,
          tierInputPer1M: null,
          tierOutputPer1M: null,
        };
      },
    },
    aiUsage: {
      create: async ({ data }: { data: Omit<UsageRow, 'createdAt'> }) => {
        usages.push({ ...data, createdAt: new Date() });
      },
      aggregate: async ({ where }: { where: { tenantId: string; success: boolean; keySource: string; createdAt: { gte: Date } } }) => ({
        _sum: {
          totalTokens: usages
            .filter((u) => u.tenantId === where.tenantId && u.success === where.success && u.keySource === where.keySource && u.createdAt >= where.createdAt.gte)
            .reduce((sum, u) => sum + u.totalTokens, 0),
        },
      }),
    },
  };
  return { prisma: prisma as never, usages, pricingLookups };
}

const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const counterKey = (d?: Date) => `aiquota:${TENANT}:${monthKey(d)}`;
const setCounter = (n: number) => redisState.store.set(counterKey(), String(n));
const counter = () => Number(redisState.store.get(counterKey()));
/** 用量的累加與告警是 fire-and-forget，等它們跑完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const published: Array<{ name: string; payload: { level: string } }> = [];

beforeEach(() => {
  redisState.store.clear();
  redisState.down = false;
  providerState.id = 'gemini';
  providerState.calls = [];
  providerState.fail = false;
  providerState.usage = { promptTokens: 1000, cachedTokens: 0, candidatesTokens: 500, thoughtsTokens: 0 };
  published.length = 0;
  clearPricingCache();
  vi.spyOn(eventBus, 'publish').mockImplementation((event) => {
    published.push(event as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  getConfig().USAGE_QUOTA_ALERTS_ENABLED = 1;
});

const reply = (db: ReturnType<typeof createDb>) => generateReply(db.prisma, TENANT, '你好');
const levels = () => published.filter((e) => e.name === 'usage.quota.threshold').map((e) => e.payload.level);

// ── token-quota：本月 AI 用量的計數 ──

test('成功的呼叫累加用量：計數器從 400000 變成 401500', async () => {
  const db = createDb({ monthlyTokens: 1_000_000 });
  setCounter(400_000);

  await reply(db);
  await settle();

  assert.equal(counter(), 401_500);
});

test('自備金鑰與失敗的呼叫不累加：計數器不變', async () => {
  const byok = createDb({ monthlyTokens: 1_000_000, byokKey: 'tenant-gemini-key' });
  setCounter(400_000);
  await reply(byok);
  await settle();
  assert.equal(counter(), 400_000);

  const platform = createDb({ monthlyTokens: 1_000_000 });
  providerState.fail = true;
  await assert.rejects(reply(platform), /provider failed/);
  await settle();
  assert.equal(counter(), 400_000);
});

test('計數器不存在時從 AiUsage 建立：只加總平台金鑰的成功呼叫', async () => {
  const db = createDb({ monthlyTokens: 3000 });
  const row = { tenantId: TENANT, costUsd: new Prisma.Decimal(0), usageMissing: false, createdAt: new Date() };
  db.usages.push(
    { ...row, keySource: 'platform', success: true, totalTokens: 3000 },
    { ...row, keySource: 'byok', success: true, totalTokens: 5000 },
    // 失敗的呼叫實際上是 0 tokens；這裡給 700，才能確認加總排除了失敗的呼叫
    { ...row, keySource: 'platform', success: false, totalTokens: 700 },
    { ...row, keySource: 'platform', success: true, totalTokens: 9000, createdAt: new Date(Date.UTC(2000, 0, 1)) },
  );

  assert.equal(await isMonthlyTokenExceeded(db.prisma, TENANT), true);
  assert.equal(counter(), 3000);
  redisState.store.clear();
  assert.equal(await isMonthlyTokenExceeded(createDbWithUsages(db.usages, 3001), TENANT), false);
});

/** 同一批用量、不同上限 */
function createDbWithUsages(usages: UsageRow[], monthlyTokens: number) {
  const db = createDb({ monthlyTokens });
  db.usages.push(...usages);
  return db.prisma;
}

test('Redis 無法使用時改用資料庫的加總：本月用量是 3000', async () => {
  const row = { tenantId: TENANT, keySource: 'platform', success: true, totalTokens: 3000, costUsd: new Prisma.Decimal(0), usageMissing: false, createdAt: new Date() };
  redisState.down = true;

  assert.equal(await isMonthlyTokenExceeded(createDbWithUsages([row], 3000), TENANT), true);
  assert.equal(await isMonthlyTokenExceeded(createDbWithUsages([row], 3001), TENANT), false);
});

test('每個月重新計數：進入 2026-09 之後，不採用 2026-08 的計數', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T00:00:05Z'));
  redisState.store.set(`aiquota:${TENANT}:2026-08`, '950000');

  assert.equal(await isMonthlyTokenExceeded(createDb({ monthlyTokens: 1000 }).prisma, TENANT), false);
  assert.equal(redisState.store.get(`aiquota:${TENANT}:2026-09`), '0');
});

// ── token-quota：呼叫 LLM 之前檢查月額度 ──

test('未達上限時照常呼叫：回傳 LLM 的回覆', async () => {
  setCounter(400_000);
  assert.equal(await reply(createDb({ monthlyTokens: 1_000_000 })), 'LLM 的回覆');
  assert.equal(providerState.calls.length, 1);
});

test('達到上限時不呼叫 LLM：拋出 403 PLAN_LIMIT_EXCEEDED，limitKey 是 monthlyTokens', async () => {
  setCounter(1_000_000);

  await assert.rejects(reply(createDb({ monthlyTokens: 1_000_000 })), (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'PLAN_LIMIT_EXCEEDED');
    assert.equal(err.statusCode, 403);
    assert.deepEqual(err.details, { limitKey: 'monthlyTokens' });
    return true;
  });
  assert.equal(providerState.calls.length, 0);
});

test('自備金鑰的呼叫不檢查月額度：平台用量超過上限仍呼叫 LLM', async () => {
  setCounter(2_000_000);
  assert.equal(await reply(createDb({ monthlyTokens: 1_000_000, byokKey: 'tenant-gemini-key' })), 'LLM 的回覆');
  assert.equal(providerState.calls.length, 1);
});

test('沒有上限時不檢查：monthlyTokens 是 null 時呼叫 LLM', async () => {
  setCounter(50_000_000);
  assert.equal(await reply(createDb({ monthlyTokens: null })), 'LLM 的回覆');
  assert.equal(providerState.calls.length, 1);
});

// ── trial-lifecycle ──

test('試用租戶用盡 token：LLM 不被呼叫，錯誤是 PLAN_LIMIT_EXCEEDED', async () => {
  setCounter(200_000);
  await assert.rejects(reply(createDb({ monthlyTokens: 200_000, slug: 'trial' })), { code: 'PLAN_LIMIT_EXCEEDED' });
  assert.equal(providerState.calls.length, 0);
});

// ── ai-usage-recording：記錄金鑰來源 ──

test('租戶設定了自備金鑰：以租戶的金鑰呼叫，keySource 是 byok', async () => {
  const db = createDb({ monthlyTokens: 1_000_000, byokKey: 'tenant-gemini-key' });
  await reply(db);
  await settle();

  assert.equal(providerState.calls[0]!.apiKey, 'tenant-gemini-key');
  assert.equal(db.usages[0]!.keySource, 'byok');
});

test('租戶沒有設定自備金鑰：以平台的金鑰呼叫，keySource 是 platform', async () => {
  const db = createDb({ monthlyTokens: 1_000_000 });
  await reply(db);
  await settle();

  assert.equal(providerState.calls[0]!.apiKey, 'platform-gemini-key');
  assert.equal(db.usages[0]!.keySource, 'platform');
});

test('Ollama 的呼叫：keySource 是 platform', async () => {
  providerState.id = 'ollama';
  const db = createDb({ monthlyTokens: 1_000_000 });
  await reply(db);
  await settle();

  assert.equal(db.usages[0]!.keySource, 'platform');
});

// ── model-pricing：成本計算公式 ──

test('Ollama 本機模型成本為零：不查 ModelPricing，costUsd 是 0', async () => {
  providerState.id = 'ollama';
  const db = createDb({ monthlyTokens: 1_000_000 });
  await reply(db);
  await settle();

  assert.deepEqual(db.pricingLookups, []);
  assert.equal(db.usages[0]!.costUsd.toString(), '0');
});

test('自備金鑰的呼叫成本為零：不查 ModelPricing，costUsd 是 0，usageMissing 是 false', async () => {
  const db = createDb({ monthlyTokens: 1_000_000, byokKey: 'tenant-gemini-key' });
  await reply(db);
  await settle();

  assert.deepEqual(db.pricingLookups, []);
  assert.equal(db.usages[0]!.costUsd.toString(), '0');
  assert.equal(db.usages[0]!.usageMissing, false);
});

// ── usage-quota-alerts：觸發條件 ──

/** 上限 1000 tokens，本次呼叫用 150 tokens */
async function crossFrom(start: number, opts: { monthlyTokens?: number | null; byokKey?: string } = {}) {
  providerState.usage = { promptTokens: 100, cachedTokens: 0, candidatesTokens: 50, thoughtsTokens: 0 };
  if (start >= 0) setCounter(start);
  await reply(createDb({ monthlyTokens: 1000, ...opts }));
  await settle();
}

test('用量首次跨越 80%：發送 warning 告警', async () => {
  await crossFrom(700);
  assert.deepEqual(levels(), ['warning']);
});

test('用量跨越 100%：發送 critical 告警', async () => {
  await crossFrom(900);
  assert.deepEqual(levels(), ['critical']);
});

test('一次呼叫同時跨越 80% 與 100%：warning 與 critical 各一次', async () => {
  providerState.usage = { promptTokens: 300, cachedTokens: 0, candidatesTokens: 100, thoughtsTokens: 0 };
  setCounter(700);
  await reply(createDb({ monthlyTokens: 1000 }));
  await settle();
  assert.deepEqual(levels(), ['warning', 'critical']);
});

test('關閉告警：USAGE_QUOTA_ALERTS_ENABLED 是 0 時不發送', async () => {
  getConfig().USAGE_QUOTA_ALERTS_ENABLED = 0;
  await crossFrom(700);
  assert.deepEqual(levels(), []);
  assert.equal(counter(), 850);
});

test('同月重複跨越同一個門檻：不再發送 warning 告警', async () => {
  await crossFrom(700);
  await crossFrom(700);
  assert.deepEqual(levels(), ['warning']);
});

test('兩次累加同時跨越同一個門檻：只發送一次告警', async () => {
  const db = createDb({ monthlyTokens: 1000 });
  const results = await Promise.all([
    checkQuotaThresholdCrossing(db.prisma, TENANT, 150, 850),
    checkQuotaThresholdCrossing(db.prisma, TENANT, 150, 850),
  ]);
  assert.equal(results.flat().length, 1);
});

test('進入新的月份：上個月發送過 warning，新月份再次發送', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
  await crossFrom(700);
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
  await crossFrom(700);
  assert.deepEqual(levels(), ['warning', 'warning']);
});

test('沒有上限的租戶不告警', async () => {
  await crossFrom(700, { monthlyTokens: null });
  assert.deepEqual(levels(), []);
});

test('自備金鑰的用量不告警：不累加計數器，也不發送', async () => {
  await crossFrom(700, { byokKey: 'tenant-gemini-key' });
  assert.deepEqual(levels(), []);
  assert.equal(counter(), 700);
});

test('Redis 無法使用時跳過告警：AI 回覆照常完成', async () => {
  redisState.down = true;
  const db = createDb({ monthlyTokens: 1000 });
  assert.equal(await reply(db), 'LLM 的回覆');
  await settle();
  assert.deepEqual(levels(), []);
});
