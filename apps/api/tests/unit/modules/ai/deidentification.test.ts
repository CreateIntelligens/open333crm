process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-deid-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { ChatGenerateOptions, ToolTurnOptions, ToolTurnResult } from '#src/modules/ai/providers/types.js';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(async (_options: ChatGenerateOptions) => ({ text: '完成' })),
  turn: vi.fn<(options: ToolTurnOptions) => Promise<ToolTurnResult>>(),
  executeTool: vi.fn(),
}));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ provider: 'gemini', model: 'test', temperature: 0.2, maxTokens: 500, baseUrl: '', chatSystemPrompt: '聯絡 qa@example.invalid', summarizeSystemPrompt: '' }),
}));
vi.mock('#src/modules/settings/embedding-settings.service.js', () => ({
  getEmbeddingSettings: async () => ({ baseUrl: 'http://localhost:11434', model: 'bge-m3' }),
}));
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({ id: 'gemini', generate: mocks.generate, generateToolTurn: mocks.turn }),
}));
vi.mock('#src/modules/ai/ai-key.service.js', () => ({ resolveGeminiKey: async () => ({ key: 'never-send-this-key-to-deid', source: 'byok' }) }));
vi.mock('#src/modules/trial/token-quota.service.js', () => ({ isMonthlyTokenExceeded: async () => false }));
vi.mock('#src/modules/ai/agent/tool-registry.js', () => ({ getAgentToolDefinitions: () => [], executeAgentTool: mocks.executeTool }));

import { generateReply } from '#src/modules/ai/llm.service.js';
import { generateEmbedding } from '#src/modules/embedding/embedding.service.js';
import { runAgentReply } from '#src/modules/ai/agent/agent.service.js';
import { loadEnvConfig } from '#src/config/env.js';

loadEnvConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const PHONE = '0912345678';
const EMAIL = 'qa@example.invalid';
const sanitize = (text: string) => text.replaceAll(PHONE, '[手機]').replaceAll(EMAIL, '[電子郵件]');
const deidRequests: Array<Record<string, unknown>> = [];
const embedRequests: Array<Record<string, unknown>> = [];
const records: unknown[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function db(value: unknown = { enabled: true }) {
  return {
    platformSetting: { findUnique: vi.fn(async () => value === null ? null : { value }) },
    aiUsage: { create: async (args: unknown) => { records.push(args); } },
    agentRun: {
      create: async () => ({ id: 'run', expiresAt: new Date() }),
      updateMany: async (args: unknown) => { records.push(args); },
    },
    agentToolCall: { create: async (args: unknown) => { records.push(args); } },
  };
}

function deidResponse(text: string) {
  return Response.json({ code: 200, status: 20000, data: { status: 'ok', text: sanitize(text), mappings: [{ original: PHONE }], csvMapping: `original,${PHONE}`, privacyScore: { raw: PHONE } } });
}

beforeEach(() => {
  mocks.generate.mockClear();
  mocks.turn.mockReset();
  mocks.turn.mockResolvedValue({ text: '完成', toolCalls: [] });
  mocks.executeTool.mockReset();
  deidRequests.length = 0;
  embedRequests.length = 0;
  records.length = 0;
  fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (url.endsWith('/api/embed')) {
      embedRequests.push(body);
      return Response.json({ embeddings: [[0.1, 0.2]] });
    }
    deidRequests.push(body);
    assert.equal(url, 'https://2md.aiurl.tw/api/deid');
    assert.equal(options.redirect, 'error');
    return deidResponse(body.text);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

test('Disabled AI call', async () => {
  for (const value of [null, { enabled: false }]) {
    const prisma = db(value);
    await generateReply(prisma as never, TENANT, PHONE);
    assert.equal(mocks.generate.mock.calls.at(-1)![0].userMessage, PHONE);
    await generateEmbedding(prisma as never, TENANT, PHONE);
    assert.equal(embedRequests.at(-1)!.input, PHONE);
    await runAgentReply(prisma as never, { tenantId: TENANT, userMessage: PHONE });
    assert.equal(mocks.turn.mock.calls.at(-1)![0].messages.at(-1)!.content, PHONE);
  }
  assert.equal(deidRequests.length, 0);
});

test('Enabled Chat and Embedding calls', async () => {
  const prisma = db();
  const history = [{ role: 'user' as const, content: `歷史 ${PHONE}` }];
  await generateReply(prisma as never, TENANT, PHONE, `知識庫 ${EMAIL}`, { history, otherChannelContext: `其他渠道 ${PHONE}` });
  const received = mocks.generate.mock.calls[0]![0];
  assert.equal(received.userMessage, '[手機]');
  assert.equal(received.history![0].content, '歷史 [手機]');
  assert.equal(received.systemPrompt.includes(PHONE), false);
  assert.equal(received.systemPrompt.includes(EMAIL), false);
  assert.equal(received.apiKey, 'never-send-this-key-to-deid');
  assert.equal(history[0].content, `歷史 ${PHONE}`);
  await generateEmbedding(prisma as never, TENANT, PHONE);
  assert.equal(embedRequests[0]!.input, '[手機]');
  for (const request of deidRequests) {
    assert.equal(request.mode, 'label');
    assert.equal(request.retentionMode, 'none');
    assert.equal(request.score, false);
    assert.equal(JSON.stringify(request).includes('never-send-this-key-to-deid'), false);
  }
});

test('Agent tool result and arguments', async () => {
  const call = { id: 'call-1', name: 'search_web', arguments: { query: PHONE, nested: [EMAIL, { value: PHONE, count: 2, flag: true }], nullable: null } };
  mocks.turn.mockResolvedValueOnce({ text: `查詢 ${PHONE}`, toolCalls: [call] }).mockResolvedValueOnce({ text: '完成', toolCalls: [] });
  mocks.executeTool.mockResolvedValue({ contact: PHONE, text: EMAIL });
  const result = await runAgentReply(db() as never, { tenantId: TENANT, userMessage: PHONE });
  assert.equal(result.status, 'completed');
  const second = mocks.turn.mock.calls[1]![0];
  assert.equal(second.messages[0].content, '[手機]');
  assert.equal(second.messages[1].content, '查詢 [手機]');
  assert.equal(second.messages[2].content.includes(PHONE), false);
  assert.deepEqual(second.messages[1].toolCalls![0], { ...call, arguments: { query: '[手機]', nested: ['[電子郵件]', { value: '[手機]', count: 2, flag: true }], nullable: null } });
  assert.equal(call.arguments.query, PHONE, 'caller-owned tool arguments stay unchanged');
});

test('Privacy service unavailable', async () => {
  const failures = [
    async () => new Response(PHONE, { status: 503 }),
    async () => { throw new Error(PHONE); },
    async () => Response.json({ data: { text: PHONE } }),
    async () => Response.json({ code: 200, data: { status: 'ok', text: '' } }),
    async () => new Response('invalid-json'),
    async () => new Response('x'.repeat(1_048_577)),
  ];
  for (const failure of failures) {
    fetchMock.mockImplementation(failure);
    await assert.rejects(generateReply(db() as never, TENANT, PHONE), (error: any) => {
      assert.equal(error.code, 'AI_DEIDENTIFICATION_UNAVAILABLE');
      assert.equal(error.message.includes(PHONE), false);
      return true;
    });
  }
  await assert.rejects(generateReply(db() as never, TENANT, 'x'.repeat(100_001)));
  assert.equal(mocks.generate.mock.calls.length, 0);
  assert.equal(JSON.stringify(records).includes(PHONE), false);
});

test('Privacy timeout aborts request before model dispatch', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = assert.rejects(generateReply(db() as never, TENANT, PHONE), (error: any) => error.code === 'AI_DEIDENTIFICATION_UNAVAILABLE');
  await vi.advanceTimersByTimeAsync(10_001);
  await pending;
  assert.equal(mocks.generate.mock.calls.length, 0);
});

test('Policy unavailable', async () => {
  for (const value of [{ enabled: 'false' }, {}, false]) {
    await assert.rejects(generateReply(db(value) as never, TENANT, PHONE));
  }
  const prisma = db();
  prisma.platformSetting.findUnique.mockRejectedValue(new Error(PHONE));
  await assert.rejects(generateReply(prisma as never, TENANT, PHONE), (error: any) => {
    assert.equal(error.message.includes(PHONE), false);
    return true;
  });
  assert.equal(mocks.generate.mock.calls.length, 0);
});

test('Privacy service unavailable blocks Embedding and Agent dispatch', async () => {
  fetchMock.mockImplementation(async () => new Response(PHONE, { status: 503 }));
  await assert.rejects(generateEmbedding(db() as never, TENANT, PHONE), (error: any) => error.code === 'AI_DEIDENTIFICATION_UNAVAILABLE');
  assert.equal(embedRequests.length, 0);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await runAgentReply(db() as never, { tenantId: TENANT, userMessage: PHONE });
  assert.equal(result.status, 'failed');
  assert.equal(mocks.turn.mock.calls.length, 0);
  assert.equal(JSON.stringify(log.mock.calls).includes(PHONE), false);
});

test('Policy unavailable blocks Embedding and Agent dispatch', async () => {
  const prisma = db({ enabled: 'false' });
  await assert.rejects(generateEmbedding(prisma as never, TENANT, PHONE), (error: any) => error.code === 'AI_PRIVACY_POLICY_UNAVAILABLE');
  await assert.rejects(runAgentReply(prisma as never, { tenantId: TENANT, userMessage: PHONE }), (error: any) => error.code === 'AI_PRIVACY_POLICY_UNAVAILABLE');
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(mocks.turn.mock.calls.length, 0);
});

test('Mapping remains outside model input', async () => {
  const log = vi.spyOn(console, 'log');
  const error = vi.spyOn(console, 'error');
  await generateReply(db() as never, TENANT, PHONE);
  await runAgentReply(db() as never, { tenantId: TENANT, userMessage: PHONE });
  for (const value of [mocks.generate.mock.calls, mocks.turn.mock.calls, records, log.mock.calls, error.mock.calls]) {
    assert.equal(JSON.stringify(value).includes(PHONE), false);
    assert.equal(JSON.stringify(value).includes('csvMapping'), false);
  }
  const previous = deidRequests.length;
  await generateReply(db() as never, '22222222-2222-4222-8222-222222222222', PHONE);
  assert.ok(deidRequests.length > previous, 'no shared text cache across tenants or calls');
});
