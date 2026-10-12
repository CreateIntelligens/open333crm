/**
 * Email 登記：設定、關鍵字攔截、登記連結的發放與次數限制（不需資料庫）。
 * change add-email-identity-merge，spec email-identity-merge。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import type { TenantDb } from '#src/lib/tenant-db.js';
import { parseIdentityBindingSettings } from '#src/modules/identity-binding/binding-links.js';
import { detectBindingIntent } from '#src/modules/identity-binding/identity-binding.service.js';
import {
  EMAIL_REG_TTL_MS,
  issueEmailRegistrationLink,
  readEmailRegistration,
  sendEmailRegistrationNotices,
} from '#src/modules/identity-binding/email-registration.service.js';
import type { BindingActor } from '#src/modules/identity-binding/binding-common.js';

let tenantSeq = 0;
/** 每個案例用不同的租戶 id，避開設定快取 */
const nextTenant = () => `e0000000-0000-0000-0000-${String(++tenantSeq).padStart(12, '0')}`;

function settingsDb(identityBinding: object) {
  return {
    tenantSettings: { findFirst: async () => ({ identityBinding }) },
  } as unknown as TenantDb;
}

function detect(db: TenantDb, tenantId: string, text: string) {
  return detectBindingIntent(db, {
    tenantId,
    contactId: 'c1',
    text,
    code: null,
    getChannelIdentityId: async () => null,
    hasPendingConfirm: async () => false,
  });
}

test('設定：email 登記預設關閉，關鍵字預設「登記email」', () => {
  const s = parseIdentityBindingSettings({});
  assert.equal(s.emailEnabled, false);
  assert.deepEqual(s.emailKeywords, ['登記email']);
  assert.equal(parseIdentityBindingSettings({ emailEnabled: true }).emailEnabled, true);
  assert.equal(parseIdentityBindingSettings({ emailEnabled: 'true' }).emailEnabled, false, '只接受布林 true');
});

test('未啟用時關鍵字不攔截', async () => {
  const tenantId = nextTenant();
  assert.equal(await detect(settingsDb({ enabled: true }), tenantId, '登記email'), null);
});

test('顧客輸入關鍵字', async () => {
  const tenantId = nextTenant();
  assert.deepEqual(await detect(settingsDb({ emailEnabled: true }), tenantId, ' 登記EMAIL '), { kind: 'email_link' });
});

test('一般對話提到關鍵字', async () => {
  const tenantId = nextTenant();
  assert.equal(await detect(settingsDb({ emailEnabled: true }), tenantId, '請問要怎麼登記email？'), null);
});

test('只啟用 email 登記時，綁定代碼關鍵字不攔截', async () => {
  const tenantId = nextTenant();
  assert.equal(await detect(settingsDb({ emailEnabled: true }), tenantId, '綁定帳號'), null);
});

function issueFixture() {
  const clock = { now: 1_000_000 };
  const store = memBindingStore(clock);
  const sent: Array<{ conversationId: string; text: string }> = [];
  const created: Array<Record<string, unknown>> = [];
  const db = {
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `m${created.length}`, createdAt: new Date(), ...data };
      },
    },
    conversation: { updateMany: async () => ({ count: 1 }) },
  } as unknown as TenantDb;
  const deps = {
    store,
    now: () => clock.now,
    webBaseUrl: 'https://crm.example.com/',
    deliver: async (_db: TenantDb, conversationId: string, text: string) => {
      sent.push({ conversationId, text });
      return true;
    },
  };
  const actor: BindingActor = {
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    channelId: 'ch1',
    channelType: 'LINE',
    channelIdentityId: 'ci1',
    uid: 'U1',
    contactId: 'c1',
    conversationId: 'conv1',
  };
  return { clock, store, sent, created, db, deps, actor };
}

const tokenIn = (text: string) => /\/bind\/email\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;

test('發出的連結指向登記頁，token 綁定租戶、渠道身分與對話', async () => {
  const f = issueFixture();
  assert.deepEqual(await issueEmailRegistrationLink(f.db, f.deps, f.actor), { status: 'sent' });
  assert.equal(f.sent.length, 1);
  assert.ok(f.sent[0].text.includes('https://crm.example.com/bind/email/'), '網址前綴去掉結尾斜線');
  const token = tokenIn(f.sent[0].text);
  assert.ok(token && token.length >= 40, 'token 至少 32 bytes');
  const payload = await readEmailRegistration(f.store, token);
  assert.equal(payload?.tenantId, f.actor.tenantId);
  assert.equal(payload?.channelIdentityId, 'ci1');
  assert.equal(payload?.conversationId, 'conv1');
  assert.equal((f.created[0].metadata as { source: string }).source, 'identity_binding', 'AI 看不到登記訊息');
});

test('連結過期（30 分鐘後讀不到）', async () => {
  const f = issueFixture();
  await issueEmailRegistrationLink(f.db, f.deps, f.actor);
  const token = tokenIn(f.sent[0].text)!;
  f.clock.now += EMAIL_REG_TTL_MS - 1;
  assert.ok(await readEmailRegistration(f.store, token));
  f.clock.now += 1;
  assert.equal(await readEmailRegistration(f.store, token), null);
});

test('不存在的連結', async () => {
  const f = issueFixture();
  assert.equal(await readEmailRegistration(f.store, 'A'.repeat(43)), null);
  assert.equal(await readEmailRegistration(f.store, '../etc'), null, '格式不符的 token 不查 Redis');
});

test('超過發連結次數', async () => {
  const f = issueFixture();
  for (let i = 0; i < 5; i++) assert.equal((await issueEmailRegistrationLink(f.db, f.deps, f.actor)).status, 'sent');
  assert.equal((await issueEmailRegistrationLink(f.db, f.deps, f.actor)).status, 'rate_limited');
  assert.ok(f.sent.at(-1)!.text.includes('次數過多'), '第一次超過時回覆說明');
  assert.equal((await issueEmailRegistrationLink(f.db, f.deps, f.actor)).status, 'rate_limited');
  assert.equal(f.sent.length, 6, '之後不再回覆');
});

test('送不出去時作廢 token', async () => {
  const f = issueFixture();
  f.deps.deliver = async (_db, conversationId, text) => {
    f.sent.push({ conversationId, text });
    return false;
  };
  assert.deepEqual(await issueEmailRegistrationLink(f.db, f.deps, f.actor), { status: 'delivery_failed' });
  assert.equal(await readEmailRegistration(f.store, tokenIn(f.sent[0].text)!), null);
});

test('其中一則通知送出時拋錯，其他通知照常送出', async () => {
  const f = issueFixture();
  f.deps.deliver = async (_db, conversationId, text) => {
    if (conversationId === 'conv-a') throw new Error('推播逾時');
    f.sent.push({ conversationId, text });
    return true;
  };
  await sendEmailRegistrationNotices(f.db, f.deps, f.actor.tenantId, [
    { conversationId: 'conv-a', text: '通知 A', kind: 'email_merged' },
    { conversationId: 'conv-b', text: '通知 B', kind: 'email_merged' },
  ]);
  assert.deepEqual(f.sent.map((s) => s.conversationId), ['conv-b']);
});
