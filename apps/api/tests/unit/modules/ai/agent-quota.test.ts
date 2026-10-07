/** Agent 回覆的月額度檢查（主規格 token-quota「Agent 回覆達到上限」） */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-agent-quota-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const providerCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('#src/modules/settings/chat-settings.service.js', () => ({
  getChatSettings: async () => ({ provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.3, maxTokens: 500, baseUrl: '' }),
}));
vi.mock('#src/modules/ai/providers/index.js', () => ({
  getChatProvider: () => ({
    id: 'gemini',
    generate: async () => {
      providerCalls.count += 1;
      return { text: 'reply' };
    },
  }),
}));
vi.mock('#src/modules/ai/ai-key.service.js', () => ({
  resolveGeminiKey: async () => ({ key: 'platform-gemini-key', source: 'platform' }),
}));
vi.mock('#src/modules/trial/token-quota.service.js', () => ({
  isMonthlyTokenExceeded: async () => true,
}));

import { runAgentReply } from '#src/modules/ai/agent/agent.service.js';
import { AppError } from '#src/shared/utils/response.js';
import { loadEnvConfig } from '#src/config/env.js';

loadEnvConfig();

test('Agent 回覆達到上限：拋出 403 PLAN_LIMIT_EXCEEDED，不呼叫 LLM，也不建立執行紀錄', async () => {
  const createdRuns: unknown[] = [];
  const prisma = {
    conversation: { findFirst: async () => ({ id: 'conversation-1' }) },
    agentRun: {
      create: async (args: unknown) => {
        createdRuns.push(args);
        return { id: 'run-1', expiresAt: new Date() };
      },
    },
  };

  await assert.rejects(
    runAgentReply(prisma as never, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      userMessage: '幫我查訂單',
      conversationId: '22222222-2222-4222-8222-222222222222',
      initiatedById: '33333333-3333-4333-8333-333333333333',
    } as never),
    (err: unknown) => {
      assert.ok(err instanceof AppError, `應為 AppError，實際是 ${String(err)}`);
      assert.equal(err.code, 'PLAN_LIMIT_EXCEEDED');
      assert.equal(err.statusCode, 403);
      assert.deepEqual(err.details, { limitKey: 'monthlyTokens' });
      return true;
    },
  );
  assert.equal(providerCalls.count, 0);
  assert.equal(createdRuns.length, 0);
});
