/**
 * 手機登記與自動歸戶整合測試（真實 Postgres；每個案例在交易內執行並 rollback，不留資料）。
 * 對應 spec phone-identity-merge 的各 Scenario（change add-phone-identity-merge）。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant, type TenantDb } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import {
  detectBindingIntent,
  executeBindingIntent,
  invalidateIdentityBindingSettings,
  type BindingActor,
} from '#src/modules/identity-binding/identity-binding.service.js';
import {
  PHONE_REG_TTL_MS,
  describePhoneRegistration,
  issuePhoneRegistrationLink,
  readPhoneRegistration,
  sendPhoneRegistrationNotices,
  submitPhoneRegistration,
  type PhoneRegistrationDeps,
} from '#src/modules/identity-binding/phone-registration.service.js';

const prisma = new PrismaClient();
const T = TENANT_A;
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

type ChannelRow = { id: string; channelType: string };

interface Fixture {
  tx: TenantDb;
  deps: PhoneRegistrationDeps;
  clock: { now: number };
  sent: Array<{ conversationId: string; text: string }>;
  lineCh: ChannelRow;
  fbCh: ChannelRow;
  /** 建立聯絡人；channel 為 null 時只建聯絡人（例如客服手動建立） */
  person: (
    name: string,
    opts?: { channel?: ChannelRow | null; phone?: string; email?: string; createdAt?: Date; archived?: boolean; conversation?: boolean },
  ) => Promise<BindingActor>;
}

let seq = 0;

async function setup(tx: TenantDb): Promise<Fixture> {
  const tag = `pr-test-${Date.now()}-${seq++}`;
  await tx.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { phoneEnabled: true } },
    update: { identityBinding: { phoneEnabled: true } },
  });
  invalidateIdentityBindingSettings();
  const mk = (channelType: 'LINE' | 'FB', displayName: string, settings: object) =>
    tx.channel.create({ data: { tenantId: T, channelType, displayName, credentialsEncrypted: 'x', settings, isActive: true } });
  const lineCh = await mk('LINE', '測試 LINE', { bindingHandleAuto: '@line1234' });
  const fbCh = await mk('FB', '測試粉專', { bindingHandle: 'test.page' });

  const person: Fixture['person'] = async (name, opts = {}) => {
    const channel = opts.channel === undefined ? lineCh : opts.channel;
    const contact = await tx.contact.create({
      data: {
        tenantId: T,
        displayName: name,
        phone: opts.phone ?? null,
        email: opts.email ?? null,
        isArchived: opts.archived ?? false,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
    if (!channel) {
      return { tenantId: T, channelId: '', channelType: '', channelIdentityId: '', uid: '', contactId: contact.id, conversationId: '' };
    }
    const uid = `${tag}-${name}`;
    const identity = await tx.channelIdentity.create({
      data: { contactId: contact.id, channelId: channel.id, channelType: channel.channelType as never, uid, profileName: `${name} 的暱稱` },
    });
    const conv =
      opts.conversation === false
        ? null
        : await tx.conversation.create({
            data: { tenantId: T, contactId: contact.id, channelId: channel.id, channelType: channel.channelType as never },
          });
    return {
      tenantId: T,
      channelId: channel.id,
      channelType: channel.channelType,
      channelIdentityId: identity.id,
      uid,
      contactId: contact.id,
      conversationId: conv?.id ?? '',
    };
  };

  const clock = { now: Date.now() };
  const sent: Fixture['sent'] = [];
  const deps: PhoneRegistrationDeps = {
    store: memBindingStore(clock),
    now: () => clock.now,
    webBaseUrl: 'https://crm.example.com',
    deliver: async (_db, conversationId, text) => {
      sent.push({ conversationId, text });
      return true;
    },
  };
  return { tx, deps, clock, sent, lineCh, fbCh, person };
}

function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    try {
      await withTenant(prisma, T, async (tx) => {
        await fn(await setup(tx));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
}

afterAll(() => prisma.$disconnect());

/** 發連結並從送出的訊息取出 token（確保顧客真的收得到） */
async function linkFor(f: Fixture, actor: BindingActor): Promise<string> {
  assert.equal((await issuePhoneRegistrationLink(f.tx, f.deps, actor)).status, 'sent');
  const msg = f.sent.filter((s) => s.conversationId === actor.conversationId).at(-1)!;
  const token = /\/bind\/phone\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
  assert.ok(token, '訊息內必須有登記連結');
  return token;
}

async function submit(f: Fixture, token: string, phone: string) {
  const { result, notices } = await submitPhoneRegistration(f.tx, f.deps, token, phone);
  await sendPhoneRegistrationNotices(f.tx, f.deps, T, notices);
  return result;
}

const textsTo = (f: Fixture, conversationId: string) => f.sent.filter((s) => s.conversationId === conversationId).map((s) => s.text);
const phoneOf = async (f: Fixture, contactId: string) => (await f.tx.contact.findFirst({ where: { id: contactId } }))?.phone ?? null;

// ── 連結 ────────────────────────────────────────────────────────────────────

scenario('開啟登記頁', async (f) => {
  const a = await f.person('A', { phone: '0987654321' });
  const payload = await readPhoneRegistration(f.deps.store, await linkFor(f, a));
  const info = await describePhoneRegistration(f.tx, payload!);
  assert.deepEqual(info, { channelType: 'LINE', channelLabel: 'LINE（@line1234）', profileName: 'A 的暱稱' });
  assert.ok(!JSON.stringify(info).includes('0987654321'), '不顯示聯絡人目前的電話');
});

scenario('連結使用後失效', async (f) => {
  const a = await f.person('A');
  const token = await linkFor(f, a);
  assert.equal((await submit(f, token, '0912345678')).status, 'registered');
  assert.equal((await submit(f, token, '0987654321')).status, 'expired');
  assert.equal(await phoneOf(f, a.contactId), '0912345678', '第二次送出不更改資料');
});

scenario('連結過期', async (f) => {
  const a = await f.person('A');
  const token = await linkFor(f, a);
  f.clock.now += PHONE_REG_TTL_MS + 60_000;
  assert.equal((await submit(f, token, '0912345678')).status, 'expired');
  assert.equal(await phoneOf(f, a.contactId), null);
});

// ── 寫入電話 ────────────────────────────────────────────────────────────────

scenario('國際格式', async (f) => {
  const a = await f.person('A', { phone: '02-1234-5678' });
  assert.equal((await submit(f, await linkFor(f, a), '+886 912-345-678')).status, 'registered');
  assert.equal(await phoneOf(f, a.contactId), '0912345678', '統一格式並覆蓋原本的電話');
});

scenario('市話', async (f) => {
  const a = await f.person('A');
  const token = await linkFor(f, a);
  assert.equal((await submit(f, token, '02-2345-6789')).status, 'invalid_phone');
  assert.equal(await phoneOf(f, a.contactId), null);
  assert.equal((await submit(f, token, '0912345678')).status, 'registered', '連結仍可再次送出');
});

scenario('沒有相同號碼', async (f) => {
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'registered');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T, mergedId: a.contactId } }), 0);
  assert.ok(textsTo(f, a.conversationId).includes('已登記您的手機號碼。'));
});

test('其他租戶有相同號碼', async () => {
  const other = await withTenant(prisma, TENANT_B, (tx) =>
    tx.contact.create({ data: { tenantId: TENANT_B, displayName: 'B 租戶', phone: '0912345678' } }),
  );
  try {
    await withTenant(prisma, T, async (tx) => {
      const f = await setup(tx);
      const a = await f.person('A');
      assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'registered');
      throw new Rollback();
    }).catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  } finally {
    await withTenant(prisma, TENANT_B, (tx) => tx.contact.delete({ where: { id: other.id } }));
  }
});

// ── 自動合併 ────────────────────────────────────────────────────────────────

scenario('既有電話是其他格式', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912-345-678' });
  const a = await f.person('A');
  const result = await submit(f, await linkFor(f, a), '+886912345678');
  assert.equal(result.status, 'merged');
  const archived = await f.tx.contact.findFirst({ where: { id: a.contactId } });
  assert.equal(archived?.isArchived, true);
  assert.equal(archived?.mergedIntoId, b.contactId);
  assert.equal((await f.tx.channelIdentity.findFirst({ where: { id: a.channelIdentityId } }))?.contactId, b.contactId);
  assert.equal((await f.tx.conversation.findFirst({ where: { id: a.conversationId } }))?.contactId, b.contactId);
  const log = await f.tx.contactMergeLog.findFirst({ where: { tenantId: T, mergedId: a.contactId } });
  assert.equal(log?.source, 'PHONE');
  assert.equal(log?.survivorId, b.contactId);
});

scenario('既有電話是國際格式', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '+886 (912) 345 678' });
  const a = await f.person('A');
  const result = await submit(f, await linkFor(f, a), '0912345678');
  assert.equal(result.status === 'merged' && result.survivorId, b.contactId);
});

scenario('多位聯絡人使用相同號碼', async (f) => {
  const c = await f.person('C', { channel: f.fbCh, phone: '0912345678', createdAt: new Date(Date.now() - DAY) });
  const b = await f.person('B', { channel: f.fbCh, phone: '0912 345 678', createdAt: new Date(Date.now() - 2 * DAY) });
  const a = await f.person('A');
  const result = await submit(f, await linkFor(f, a), '0912345678');
  assert.equal(result.status === 'merged' && result.survivorId, b.contactId, '併入建立時間最早的一位');
  assert.equal((await f.tx.contact.findFirst({ where: { id: c.contactId } }))?.isArchived, false);
});

scenario('登記方本身就是最早使用該號碼的聯絡人', async (f) => {
  const b = await f.person('B', { phone: '0912-345-678', createdAt: new Date(Date.now() - 2 * DAY) });
  const c = await f.person('C', { channel: f.fbCh, phone: '0912345678', createdAt: new Date(Date.now() - DAY) });
  const result = await submit(f, await linkFor(f, b), '0912345678');
  assert.equal(result.status, 'registered', '不把最早的一位併入較新的一位');
  assert.equal(await phoneOf(f, b.contactId), '0912345678');
  assert.equal((await f.tx.contact.findFirst({ where: { id: c.contactId } }))?.isArchived, false);
});

scenario('已封存的聯絡人不列入比對', async (f) => {
  await f.person('B', { channel: f.fbCh, phone: '0912345678', archived: true });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'registered');
});

scenario('含分機的電話不列入比對', async (f) => {
  await f.person('B', { channel: f.fbCh, phone: '0912345678#12' });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'registered');
});

scenario('同一個 LINE OA 的兩個帳號', async (f) => {
  const b = await f.person('B', { phone: '0912345678' }); // 與 A 同一個 LINE 渠道
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'channel_conflict');
  assert.equal(await phoneOf(f, a.contactId), null, '不寫入電話');
  assert.equal((await f.tx.contact.findFirst({ where: { id: b.contactId } }))?.isArchived, false);
  assert.ok(textsTo(f, a.conversationId).some((t) => t.includes('無法自動整合')));
});

// ── 通知 ────────────────────────────────────────────────────────────────────

scenario('雙邊收到通知', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912345678' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), '0912345678');
  const toA = textsTo(f, a.conversationId).at(-1)!;
  const toB = textsTo(f, b.conversationId).at(-1)!;
  assert.ok(toA.includes('Facebook（test.page）') && toA.includes('解除綁定'), toA);
  assert.ok(!toA.includes('B 的暱稱') && !toA.includes('B'), `登記方看不到對方名稱：${toA}`);
  assert.ok(toB.includes('LINE（@line1234）') && toB.includes('A 的暱稱') && toB.includes('解除綁定'), toB);
});

scenario('對方沒有對話', async (f) => {
  const b = await f.person('B', { channel: null, phone: '0912345678' });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'merged');
  assert.ok(textsTo(f, a.conversationId).at(-1)!.includes('相同手機號碼的顧客資料'));
  assert.equal(f.sent.filter((s) => s.conversationId !== a.conversationId).length, 0);
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.mergedIntoId, b.contactId);
});

// ── 自助解除 ────────────────────────────────────────────────────────────────

async function sendUnbind(f: Fixture, actor: BindingActor, contactId: string) {
  const intent = await detectBindingIntent(f.tx, {
    tenantId: T,
    contactId,
    text: '解除綁定',
    code: null,
    getChannelIdentityId: async () => actor.channelIdentityId,
    hasPendingConfirm: async () => false,
  });
  if (!intent) return 'not_intercepted';
  return executeBindingIntent(f.tx, f.deps, { ...actor, contactId }, intent);
}

scenario('登記方解除', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912345678' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), '0912345678');
  f.clock.now += 3 * DAY;
  assert.equal(await sendUnbind(f, a, b.contactId), 'unbound', '只啟用手機登記時也處理解除關鍵字');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.isArchived, false);
  assert.equal((await f.tx.channelIdentity.findFirst({ where: { id: a.channelIdentityId } }))?.contactId, a.contactId);
  assert.equal((await f.tx.conversation.findFirst({ where: { id: a.conversationId } }))?.contactId, a.contactId);
});

scenario('超過 7 天', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912345678' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), '0912345678');
  await f.tx.contactMergeLog.updateMany({ where: { tenantId: T, mergedId: a.contactId }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
  assert.equal(await sendUnbind(f, a, b.contactId), 'expired');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.isArchived, true, '合併不變');
});

// ── 另一種識別不一致（design D6） ────────────────────────────────────────────

scenario('兩邊的 email 不同', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912345678', email: 'b@example.com' });
  const a = await f.person('A', { email: 'a@example.com' });
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'identity_conflict');
  assert.equal(await phoneOf(f, a.contactId), null, '不寫入電話');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.isArchived, false, '不合併');
  assert.equal((await f.tx.contact.findFirst({ where: { id: b.contactId } }))?.isArchived, false);
  assert.ok(textsTo(f, a.conversationId).some((t) => t.includes('客服確認')), '對話收到需要客服確認的說明');
  assert.equal(textsTo(f, b.conversationId).length, 0, '不通知對方');
});

scenario('兩邊的 email 相同', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912345678', email: 'Amy@Example.com' });
  const a = await f.person('A', { email: 'amy@example.com' });
  const result = await submit(f, await linkFor(f, a), '0912345678');
  assert.equal(result.status === 'merged' && result.survivorId, b.contactId);
});

scenario('一邊已經用 email 歸戶過', async (f) => {
  // A（LINE）先以 a@example.com 與 FB 帳號歸戶：歸戶後的聯絡人留有 a@example.com
  const fbA = await f.person('A-FB', { channel: f.fbCh, email: 'a@example.com', createdAt: new Date(Date.now() - DAY) });
  const a = await f.person('A');
  const { mergeContacts } = await import('#src/modules/contact/contact-merge.service.js');
  await mergeContacts({ tx: f.tx, tenantId: T }, { survivorId: fbA.contactId, mergedId: a.contactId, source: 'EMAIL' });
  const ig = await f.tx.channel.create({ data: { tenantId: T, channelType: 'THREADS', displayName: '測試 IG', credentialsEncrypted: 'x', isActive: true } });
  const b = await f.person('B', { channel: { id: ig.id, channelType: 'THREADS' }, phone: '0912345678', email: 'b@example.com' });
  const result = await submit(f, await linkFor(f, { ...a, contactId: fbA.contactId }), '0912345678');
  assert.equal(result.status, 'identity_conflict');
  assert.equal((await f.tx.contact.findFirst({ where: { id: b.contactId } }))?.isArchived, false);
  assert.equal((await f.tx.contact.findFirst({ where: { id: fbA.contactId } }))?.isArchived, false);
});

// ── 歸戶驗證時間（add-coupon-system「歸戶驗證完成時記錄時間」）──────────────────

// 手機登記沒有簡訊驗證，任何人都能填別人的號碼：不記錄歸戶驗證（2026-10-21 code review 決定）
scenario('手機登記不記錄', async (f) => {
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'registered');
  const c = await f.tx.contact.findFirst({ where: { id: a.contactId } });
  assert.equal(c?.phone, '0912345678', '手機照樣寫入');
  assert.equal(c?.identityVerifiedAt, null);
});

scenario('手機登記觸發合併也不記錄', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, phone: '0912345678', createdAt: new Date(Date.now() - DAY) });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), '0912345678')).status, 'merged');
  const survivor = await f.tx.contact.findFirst({ where: { id: b.contactId } });
  assert.equal(survivor?.identityVerifiedAt, null, '冒填別人的手機被併入後，不能拿到對方的票券夾');
});

scenario('客服手動填寫的手機不算歸戶', async (f) => {
  const a = await f.person('A', { phone: '0912345678' });
  const c = await f.tx.contact.findFirst({ where: { id: a.contactId } });
  assert.equal(c?.identityVerifiedAt, null);
});
