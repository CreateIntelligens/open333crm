/**
 * Agent 執行不在交易內等待外部呼叫（change migrate-ai-agent-tenant-ctx：
 * agentic-llm-orchestration「Agent 執行不在交易內等待外部呼叫」）。
 *
 * 經由 A2A 的 handleA2ATask() 執行：搬遷前只有 A2A 把整段 Agent 包在一個交易內。
 * 連線是 app_tenant（RLS）。provider 是 LLM 呼叫的最低邊界，換成照腳本回覆的假 provider；
 * 天氣工具換成假的；A2A Hub 的 HTTP 呼叫以注入的 fetch 記錄。設定、月額度與交易都是真的。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createRedisClient } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';

type Turn = { text: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };
const script = vi.hoisted(() => ({
  /** 每一輪 LLM 的回覆，依序取用 */
  turns: [] as Array<() => Promise<Turn>>,
  llmCalls: 0,
  /** 每次天氣工具的回傳值，依序取用 */
  toolResults: [] as string[],
}));

vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'gemini',
    generate: async () => ({ text: '' }),
    generateToolTurn: async () => {
      const next = script.turns[script.llmCalls];
      script.llmCalls += 1;
      if (!next) throw new Error('腳本沒有下一輪');
      return next();
    },
  }),
}));
vi.mock('#src/modules/ai/agent/weather.js', () => ({
  getLiveWeather: async () => script.toolResults.shift() ?? '晴天',
}));

loadEnvConfig();
const { handleA2ATask } = await import('#src/modules/settings/a2a-bridge.worker.js');

const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const redis = createRedisClient(process.env.REDIS_URL!, 'command');
const MARK = `ci-agent-flow-${Date.now()}`;
const tenantIds: string[] = [];

async function makeTenant(label: string) {
  const id = (await owner.tenant.create({ data: { name: `${MARK}-${label}` } })).id;
  tenantIds.push(id);
  return id;
}

const toolCall = (n: number): Turn => ({ text: '', toolCalls: [{ id: `t${n}`, name: 'get_live_weather', arguments: { location: `城市${n}` } }] });
const finalAnswer = (text: string): Turn => ({ text, toolCalls: [] });

/** 以這個租戶執行一個 A2A 任務；回傳 Hub 收到的回覆 */
async function runTask(tenantId: string) {
  const hubCalls: Array<{ url: string; body: { message: string } }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    hubCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  await handleA2ATask(
    {
      prisma: tenantDb,
      // 執行任務的租戶由 prismaAdmin 決定（AUDIT A2A-01），測試固定成這個租戶
      prismaAdmin: { tenant: { findFirst: async () => ({ id: tenantId }) } } as never,
      redis,
      hub: { url: 'https://hub.test', agentId: 'crm-agent', agentToken: 'token' },
      canPublishWiki: false,
      fetchImpl,
    },
    { sequence: 1, taskId: 'task-1', requesterAgentId: 'other-agent', targetAgentId: 'crm-agent', message: '查天氣', createdAt: new Date().toISOString() },
  );
  return hubCalls;
}

const runsOf = (tenantId: string) =>
  owner.agentRun.findMany({ where: { tenantId }, include: { toolCalls: { orderBy: { turn: 'asc' } } } });

beforeEach(() => {
  script.turns = [];
  script.llmCalls = 0;
  script.toolResults = [];
});

afterAll(async () => {
  for (const tenantId of tenantIds) {
    await owner.agentToolCall.deleteMany({ where: { tenantId } });
    await owner.agentRun.deleteMany({ where: { tenantId } });
    await owner.aiUsage.deleteMany({ where: { tenantId } });
    await owner.outbox.deleteMany({ where: { tenantId } });
    await owner.tenant.deleteMany({ where: { id: tenantId } });
  }
  redis.disconnect();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

test('A2A 任務執行超過 5 秒：bridge 收到這個回答，執行紀錄的狀態是 COMPLETED', async () => {
  const t = await makeTenant('slow');
  script.turns = [async () => {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    return finalAnswer('台北今天晴天');
  }];

  const hubCalls = await runTask(t);

  assert.equal(hubCalls.length, 1);
  assert.equal(hubCalls[0]!.body.message, '台北今天晴天');
  const [run] = await runsOf(t);
  assert.equal(run?.status, 'COMPLETED');
}, 20_000);

test('執行到一半失敗時保留之前的工具紀錄；工具紀錄寫入失敗時不再呼叫 LLM，呼叫端收到錯誤', async () => {
  const t = await makeTenant('half');
  script.turns = [async () => toolCall(1), async () => toolCall(2), async () => finalAnswer('不該執行到這裡')];
  // 第 2 次的工具結果含 NUL 字元，PostgreSQL 的 text 欄位拒收，寫入工具紀錄的交易失敗
  script.toolResults = ['晴天', '多雲\u0000'];

  await assert.rejects(runTask(t));

  assert.equal(script.llmCalls, 2, '寫入工具紀錄失敗之後不再呼叫 LLM');
  const [run] = await runsOf(t);
  assert.equal(run?.status, 'FAILED');
  assert.deepEqual(run?.toolCalls.map((c) => c.turn), [1], '第 1 輪的工具紀錄仍然保存');
});
