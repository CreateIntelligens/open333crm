/**
 * 系統固定訊息不被去識別化改壞（2026-10-27 UAT：「請點選下方連結」被改成「請點選下[姓名]」）。
 * change add-admin-ai-deidentification，spec ai-input-deidentification
 * 「Fixed system wording keeps its authored text」。
 *
 * 只替換最低層的 HTTP 呼叫（global fetch）：模擬 2md 把一般詞誤判成人名的回應，
 * 回應格式與正式服務相同（code/data.status/data.text，另帶 mapping）。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-system-template-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import type { TenantDb } from '#src/lib/tenant-db.js';
import type { BindingActor } from '#src/modules/identity-binding/binding-common.js';
import { issueEmailRegistrationLink } from '#src/modules/identity-binding/email-registration.service.js';
import { handoffConversation, returnConversationToBot } from '#src/modules/conversation/conversation.service.js';
import { readModelMessageContent } from '#src/modules/ai/deidentification.service.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
/** 2026-10-27 UAT 實際被誤判成人名的詞，加上一個真的人名（座席「小美」） */
const misjudge = (text: string) => text.replace(/方連結|鐘內|小美|客服人員|0912345678/g, '[姓名]');
const deidRequests: string[] = [];

beforeEach(() => {
  deidRequests.length = 0;
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string) as { text: string };
    deidRequests.push(request.text);
    return Response.json({ code: 200, data: { status: 'ok', text: misjudge(request.text), mappings: [] } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const privacyOn = { platformSetting: { findUnique: async () => ({ value: { enabled: true } }) } };

function maskedCopy(metadata: unknown): Record<string, unknown> {
  return (metadata as { privacy: { maskedContent: Record<string, unknown> } }).privacy.maskedContent;
}

test('System template message keeps its authored text: email registration link', async () => {
  const sent: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const db = {
    ...privacyOn,
    tenantSettings: { findFirst: async () => ({ identityBinding: { emailEnabled: true } }) },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'm1', createdAt: new Date(), ...data };
      },
    },
    conversation: { updateMany: async () => ({ count: 1 }) },
  } as unknown as TenantDb;
  const clock = { now: 1_000_000 };
  const deps = {
    store: memBindingStore(clock),
    now: () => clock.now,
    webBaseUrl: 'https://crm.example.com',
    deliver: async (_db: TenantDb, _conversationId: string, text: string) => {
      sent.push(text);
      return true;
    },
  };
  const actor: BindingActor = {
    tenantId: TENANT, channelId: 'ch1', channelType: 'THREADS', channelIdentityId: 'ci1',
    uid: 'IG1', contactId: 'c1', conversationId: 'conv1',
  };

  assert.deepEqual(await issueEmailRegistrationLink(db, deps, actor), { status: 'sent' });

  assert.equal(sent.length, 1);
  assert.match(sent[0], /請點選下方連結登記您的 email/, '送給顧客的是原文');
  assert.match(sent[0], /連結 30 分鐘內有效/);
  assert.match(sent[0], /https:\/\/crm\.example\.com\/bind\/email\/[A-Za-z0-9_-]+/, '系統插入的連結原樣送出');
  const stored = created[0].content as { text: string };
  assert.equal(stored.text, sent[0], '對話紀錄存的就是顧客收到的內容');
  const metadata = created[0].metadata as { privacy: { mode: string } };
  assert.equal(metadata.privacy.mode, 'system_template');
  assert.match(String(maskedCopy(metadata).text), /請點選下\[姓名\]/, '遮罩版仍另存給模型讀');
  assert.equal(readModelMessageContent(stored, metadata), maskedCopy(metadata).text, 'AI 讀取仍只用遮罩版');
});

test('System template message keeps its authored text: return-to-bot note', async () => {
  const messages: Array<Record<string, unknown>> = [];
  const prisma = {
    ...privacyOn,
    conversation: {
      findFirst: async () => ({ id: 'c1', tenantId: TENANT, status: 'AGENT_HANDLED', channel: { settings: {} } }),
      updateMany: async () => ({ count: 1 }),
      findFirstOrThrow: async () => ({ id: 'c1', status: 'BOT_HANDLED', assignedToId: null, unreadCount: 0, updatedAt: new Date() }),
    },
    agent: { findFirst: async () => ({ name: '小美' }) },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        messages.push(data);
        return { id: 'm1', ...data, createdAt: new Date() };
      },
    },
  } as never;
  const io = { to: () => ({ emit: () => {} }) } as never;

  await returnConversationToBot(prisma, io, 'c1', TENANT, 'agent-b');

  assert.equal((messages[0].content as { text: string }).text, '小美 把對話交回 Bot');
  assert.equal(maskedCopy(messages[0].metadata).text, '[姓名] 把對話交回 Bot');
});

function handoffFixture() {
  const messages: Array<Record<string, unknown>> = [];
  const prisma = {
    ...privacyOn,
    conversation: {
      findFirst: async () => ({ id: 'c1', tenantId: TENANT, status: 'BOT_HANDLED' }),
      update: async () => ({ id: 'c1', status: 'AGENT_HANDLED', assignedToId: 'agent-a', unreadCount: 0, updatedAt: new Date() }),
      // deliverToChannel 找不到對話就不送（這裡只檢查要送出與存入的內容）
      findUnique: async () => null,
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        messages.push(data);
        return { id: 'm1', ...data, createdAt: new Date() };
      },
    },
  } as never;
  const io = { to: () => ({ emit: () => {} }) } as never;
  return { prisma, io, messages };
}

test('System template message keeps its authored text: default handoff notice', async () => {
  const f = handoffFixture();
  await handoffConversation(f.prisma, f.io, 'c1', TENANT, 'agent-a', {});
  assert.equal((f.messages[0].content as { text: string }).text, '稍等，正在為您轉接客服人員');
  assert.equal(maskedCopy(f.messages[0].metadata).text, '稍等，正在為您轉接[姓名]');
});

test('Agent-typed handoff notice stays masked', async () => {
  const f = handoffFixture();
  await handoffConversation(f.prisma, f.io, 'c1', TENANT, 'agent-a', { handoffMessage: '請撥 0912345678 找我們' });
  assert.equal((f.messages[0].content as { text: string }).text, '請撥 [姓名] 找我們', '座席輸入的文字維持原本的遮罩');
});
