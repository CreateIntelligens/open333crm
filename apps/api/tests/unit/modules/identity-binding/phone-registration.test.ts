/**
 * 手機登記：號碼格式、設定、關鍵字攔截、登記連結的發放與次數限制（不需資料庫）。
 * change add-phone-identity-merge，spec phone-identity-merge。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import type { TenantDb } from '#src/lib/tenant-db.js';
import { parseIdentityBindingSettings } from '#src/modules/identity-binding/binding-links.js';
import { detectBindingIntent } from '#src/modules/identity-binding/identity-binding.service.js';
import {
  PHONE_REG_TTL_MS,
  issuePhoneRegistrationLink,
  normalizeTaiwanMobile,
  readPhoneRegistration,
} from '#src/modules/identity-binding/phone-registration.service.js';
import type { BindingActor } from '#src/modules/identity-binding/binding-common.js';

// ── 號碼格式 ────────────────────────────────────────────────────────────────

test('國際格式', () => {
  assert.equal(normalizeTaiwanMobile('+886 912-345-678'), '0912345678');
  assert.equal(normalizeTaiwanMobile('+886912345678'), '0912345678');
  assert.equal(normalizeTaiwanMobile('886912345678'), '0912345678');
  assert.equal(normalizeTaiwanMobile('+886 0912 345 678'), '0912345678', '國碼後多寫 0 也接受');
  assert.equal(normalizeTaiwanMobile('(0912) 345-678'), '0912345678');
  assert.equal(normalizeTaiwanMobile(' 0912345678 '), '0912345678');
});

test('市話', () => {
  assert.equal(normalizeTaiwanMobile('02-2345-6789'), null);
  assert.equal(normalizeTaiwanMobile('+886 2 2345 6789'), null);
});

test('不接受的格式', () => {
  for (const raw of ['912345678', '09123456789', '091234567', '0912345678#12', '+1 415 555 0100', '0912.345.678', '', null, 912345678]) {
    assert.equal(normalizeTaiwanMobile(raw), null, String(raw));
  }
  assert.equal(normalizeTaiwanMobile('0'.repeat(1000)), null, '過長不處理');
});

// ── 設定與關鍵字 ────────────────────────────────────────────────────────────

let tenantSeq = 0;
/** 每個案例用不同的租戶 id，避開設定快取 */
const nextTenant = () => `f0000000-0000-0000-0000-${String(++tenantSeq).padStart(12, '0')}`;

function settingsDb(identityBinding: object) {
  return { tenantSettings: { findFirst: async () => ({ identityBinding }) } } as unknown as TenantDb;
}

function detect(db: TenantDb, tenantId: string, text: string, channelIdentityId: string | null = null) {
  return detectBindingIntent(db, {
    tenantId,
    contactId: 'c1',
    text,
    code: null,
    getChannelIdentityId: async () => channelIdentityId,
    hasPendingConfirm: async () => false,
  });
}

test('設定：手機登記預設關閉，關鍵字預設「登記手機」', () => {
  const s = parseIdentityBindingSettings({});
  assert.equal(s.phoneEnabled, false);
  assert.deepEqual(s.phoneKeywords, ['登記手機']);
  assert.equal(parseIdentityBindingSettings({ phoneEnabled: true }).phoneEnabled, true);
  assert.equal(parseIdentityBindingSettings({ phoneEnabled: 'true' }).phoneEnabled, false, '只接受布林 true');
});

test('未啟用時關鍵字不攔截', async () => {
  assert.equal(await detect(settingsDb({ enabled: true, emailEnabled: true }), nextTenant(), '登記手機'), null);
});

test('顧客輸入關鍵字', async () => {
  assert.deepEqual(await detect(settingsDb({ phoneEnabled: true }), nextTenant(), ' 登記手機 '), { kind: 'phone_link' });
});

test('一般對話提到關鍵字', async () => {
  assert.equal(await detect(settingsDb({ phoneEnabled: true }), nextTenant(), '請問要怎麼登記手機？'), null);
});

test('只啟用手機登記時，email 與綁定代碼關鍵字不攔截', async () => {
  const db = settingsDb({ phoneEnabled: true });
  assert.equal(await detect(db, nextTenant(), '登記email'), null);
  assert.equal(await detect(db, nextTenant(), '綁定帳號'), null);
});

test('只啟用手機登記時也處理解除關鍵字', async () => {
  // 有可解除的手機歸戶時攔截：查詢合併紀錄的條件要包含 PHONE
  const sources: unknown[] = [];
  const db = {
    tenantSettings: { findFirst: async () => ({ identityBinding: { phoneEnabled: true } }) },
    contactMergeLog: {
      findMany: async (args: { where: { source: unknown } }) => {
        sources.push(args.where.source);
        return [{ id: 'log1', survivorId: 'c1' }];
      },
    },
  } as unknown as TenantDb;
  assert.deepEqual(await detect(db, nextTenant(), '解除綁定', 'ci1'), { kind: 'unbind', mergeLogId: 'log1' });
  assert.ok(JSON.stringify(sources[0]).includes('PHONE'), JSON.stringify(sources[0]));
});

// ── 登記連結 ────────────────────────────────────────────────────────────────

function issueFixture() {
  const clock = { now: 1_000_000 };
  const store = memBindingStore(clock);
  const sent: Array<{ conversationId: string; text: string }> = [];
  const db = {
    message: { create: async ({ data }: { data: object }) => ({ id: 'm1', createdAt: new Date(), ...data }) },
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
  return { clock, store, sent, db, deps, actor };
}

const tokenIn = (text: string) => /\/bind\/phone\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;

test('發出的連結指向手機登記頁，30 分鐘後失效', async () => {
  const f = issueFixture();
  assert.deepEqual(await issuePhoneRegistrationLink(f.db, f.deps, f.actor), { status: 'sent' });
  assert.ok(f.sent[0].text.includes('手機'), f.sent[0].text);
  const token = tokenIn(f.sent[0].text);
  assert.ok(token, f.sent[0].text);
  assert.equal((await readPhoneRegistration(f.store, token))?.channelIdentityId, 'ci1');
  f.clock.now += PHONE_REG_TTL_MS;
  assert.equal(await readPhoneRegistration(f.store, token), null);
});

test('超過發連結次數', async () => {
  const f = issueFixture();
  for (let i = 0; i < 5; i++) assert.equal((await issuePhoneRegistrationLink(f.db, f.deps, f.actor)).status, 'sent');
  assert.equal((await issuePhoneRegistrationLink(f.db, f.deps, f.actor)).status, 'rate_limited');
  assert.ok(f.sent.at(-1)!.text.includes('次數過多'));
  assert.equal(f.sent.length, 6);
});

test('手機與 email 的連結各自計次、互不通用', async () => {
  const f = issueFixture();
  const { issueEmailRegistrationLink, readEmailRegistration } = await import(
    '#src/modules/identity-binding/email-registration.service.js'
  );
  for (let i = 0; i < 5; i++) await issueEmailRegistrationLink(f.db, f.deps, f.actor);
  assert.equal((await issuePhoneRegistrationLink(f.db, f.deps, f.actor)).status, 'sent', 'email 用完次數不影響手機');
  const token = tokenIn(f.sent.at(-1)!.text)!;
  assert.equal(await readEmailRegistration(f.store, token), null, '手機連結不能拿去登記 email');
});
