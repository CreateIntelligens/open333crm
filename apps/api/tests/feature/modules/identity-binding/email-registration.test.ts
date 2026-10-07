/**
 * Email 登記與自動歸戶整合測試（真實 Postgres；每個案例在交易內執行並 rollback，不留資料）。
 * 對應 spec email-identity-merge 的各 Scenario。Redis 換成可快轉時間的記憶體實作。
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
  EMAIL_REG_TTL_MS,
  describeEmailRegistration,
  issueEmailRegistrationLink,
  readEmailRegistration,
  sendEmailRegistrationNotices,
  submitEmailRegistration,
  type EmailRegistrationDeps,
} from '#src/modules/identity-binding/email-registration.service.js';
import { loadOtherChannelContext } from '#src/modules/ai/other-channel-context.js';

const prisma = new PrismaClient();
const T = TENANT_A;
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

type ChannelRow = { id: string; channelType: string };

interface Fixture {
  tx: TenantDb;
  deps: EmailRegistrationDeps;
  clock: { now: number };
  sent: Array<{ conversationId: string; text: string }>;
  lineCh: ChannelRow;
  fbCh: ChannelRow;
  /** 建立聯絡人；channel 為 null 時只建聯絡人（例如客服手動建立） */
  person: (
    name: string,
    opts?: { channel?: ChannelRow | null; email?: string; createdAt?: Date; archived?: boolean; conversation?: boolean },
  ) => Promise<BindingActor>;
}

let seq = 0;

async function setup(tx: TenantDb): Promise<Fixture> {
  const tag = `er-test-${Date.now()}-${seq++}`;
  await tx.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { emailEnabled: true } },
    update: { identityBinding: { emailEnabled: true } },
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
  const deps: EmailRegistrationDeps = {
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
  assert.equal((await issueEmailRegistrationLink(f.tx, f.deps, actor)).status, 'sent');
  const msg = f.sent.filter((s) => s.conversationId === actor.conversationId).at(-1)!;
  const token = /\/bind\/email\/([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];
  assert.ok(token, '訊息內必須有登記連結');
  return token;
}

async function submit(f: Fixture, token: string, email: string) {
  const { result, notices } = await submitEmailRegistration(f.tx, f.deps, token, email);
  await sendEmailRegistrationNotices(f.tx, f.deps, T, notices);
  return result;
}

const textsTo = (f: Fixture, conversationId: string) => f.sent.filter((s) => s.conversationId === conversationId).map((s) => s.text);

// ── 連結 ────────────────────────────────────────────────────────────────────

scenario('開啟登記頁', async (f) => {
  const a = await f.person('A', { email: 'secret@example.com' });
  const payload = await readEmailRegistration(f.deps.store, await linkFor(f, a));
  const info = await describeEmailRegistration(f.tx, payload!);
  assert.deepEqual(info, { channelType: 'LINE', channelLabel: 'LINE（@line1234）', profileName: 'A 的暱稱' });
  assert.ok(!JSON.stringify(info).includes('secret@example.com'), '不顯示聯絡人目前的 email');
});

scenario('連結使用後失效', async (f) => {
  const a = await f.person('A');
  const token = await linkFor(f, a);
  assert.equal((await submit(f, token, 'amy@example.com')).status, 'registered');
  assert.equal((await submit(f, token, 'other@example.com')).status, 'expired');
  const c = await f.tx.contact.findFirst({ where: { id: a.contactId } });
  assert.equal(c?.email, 'amy@example.com', '第二次送出不更改資料');
});

scenario('連結過期', async (f) => {
  const a = await f.person('A');
  const token = await linkFor(f, a);
  f.clock.now += EMAIL_REG_TTL_MS + 60_000;
  assert.equal((await submit(f, token, 'amy@example.com')).status, 'expired');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.email, null);
});

scenario('不存在的連結', async (f) => {
  assert.equal((await submit(f, 'x'.repeat(43), 'amy@example.com')).status, 'expired');
});

// ── 寫入 email ──────────────────────────────────────────────────────────────

scenario('格式錯誤', async (f) => {
  const a = await f.person('A');
  const token = await linkFor(f, a);
  assert.equal((await submit(f, token, 'amy@')).status, 'invalid_email');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.email, null);
  assert.equal((await submit(f, token, 'amy@example.com')).status, 'registered', '連結仍可再次送出');
});

scenario('沒有相同 email', async (f) => {
  const a = await f.person('A', { email: 'old@example.com' });
  const token = await linkFor(f, a);
  assert.equal((await submit(f, token, ' Amy@Example.com ')).status, 'registered');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.email, 'amy@example.com', '覆蓋原本的 email');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T, mergedId: a.contactId } }), 0);
  assert.ok(textsTo(f, a.conversationId).includes('已登記您的 email。'));
});

test('其他租戶有相同 email', async () => {
  const other = await withTenant(prisma, TENANT_B, (tx) =>
    tx.contact.create({ data: { tenantId: TENANT_B, displayName: 'B 租戶', email: 'amy@example.com' } }),
  );
  try {
    await withTenant(prisma, T, async (tx) => {
      const f = await setup(tx);
      const a = await f.person('A');
      assert.equal((await submit(f, await linkFor(f, a), 'amy@example.com')).status, 'registered');
      throw new Rollback();
    }).catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  } finally {
    await withTenant(prisma, TENANT_B, (tx) => tx.contact.delete({ where: { id: other.id } }));
  }
});

// ── 自動合併 ────────────────────────────────────────────────────────────────

scenario('不同渠道的同一個人', async (f) => {
  // 客服手動輸入的 email 可能有大寫：比對不分大小寫
  const b = await f.person('B', { channel: f.fbCh, email: 'Amy@Example.com' });
  const a = await f.person('A');
  const result = await submit(f, await linkFor(f, a), 'AMY@example.com');
  assert.equal(result.status, 'merged');

  const archived = await f.tx.contact.findFirst({ where: { id: a.contactId } });
  assert.equal(archived?.isArchived, true);
  assert.equal(archived?.mergedIntoId, b.contactId);
  assert.equal((await f.tx.channelIdentity.findFirst({ where: { id: a.channelIdentityId } }))?.contactId, b.contactId);
  assert.equal((await f.tx.conversation.findFirst({ where: { id: a.conversationId } }))?.contactId, b.contactId);
  const log = await f.tx.contactMergeLog.findFirst({ where: { tenantId: T, mergedId: a.contactId } });
  assert.equal(log?.source, 'EMAIL');
  assert.equal(log?.survivorId, b.contactId);
});

scenario('多位聯絡人使用相同 email', async (f) => {
  const c = await f.person('C', { channel: f.fbCh, email: 'amy@example.com', createdAt: new Date(Date.now() - DAY) });
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com', createdAt: new Date(Date.now() - 2 * DAY) });
  const a = await f.person('A');
  const result = await submit(f, await linkFor(f, a), 'amy@example.com');
  assert.equal(result.status === 'merged' && result.survivorId, b.contactId, '併入建立時間最早的一位');
  assert.equal((await f.tx.contact.findFirst({ where: { id: c.contactId } }))?.isArchived, false);
});

scenario('登記方本身就是最早使用該 email 的聯絡人', async (f) => {
  const b = await f.person('B', { email: 'amy@example.com', createdAt: new Date(Date.now() - 2 * DAY) });
  const c = await f.person('C', { channel: f.fbCh, email: 'amy@example.com', createdAt: new Date(Date.now() - DAY) });
  const result = await submit(f, await linkFor(f, b), 'amy@example.com');
  assert.equal(result.status, 'registered', '不把最早的一位併入較新的一位');
  assert.equal((await f.tx.contact.findFirst({ where: { id: b.contactId } }))?.isArchived, false);
  assert.equal((await f.tx.contact.findFirst({ where: { id: c.contactId } }))?.isArchived, false);
});

scenario('已封存的聯絡人不列入比對', async (f) => {
  await f.person('B', { channel: f.fbCh, email: 'amy@example.com', archived: true });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), 'amy@example.com')).status, 'registered');
});

scenario('已經是同一位聯絡人', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), 'amy@example.com')).status, 'merged');
  // A 的 LINE 身分現在屬於 B，再登記一次 B 的 email
  const again = await submit(f, await linkFor(f, { ...a, contactId: b.contactId }), 'amy@example.com');
  assert.equal(again.status, 'registered');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T, survivorId: b.contactId } }), 1, '不再合併');
});

scenario('同一個 LINE OA 的兩個帳號', async (f) => {
  const b = await f.person('B', { email: 'amy@example.com' }); // 與 A 同一個 LINE 渠道
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), 'amy@example.com')).status, 'channel_conflict');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.email, null, '不寫入 email');
  assert.equal((await f.tx.contact.findFirst({ where: { id: b.contactId } }))?.isArchived, false);
  assert.ok(textsTo(f, a.conversationId).some((t) => t.includes('無法自動整合')));
});

// ── 通知 ────────────────────────────────────────────────────────────────────

scenario('雙邊收到通知', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), 'amy@example.com');
  const toA = textsTo(f, a.conversationId).at(-1)!;
  const toB = textsTo(f, b.conversationId).at(-1)!;
  assert.ok(toA.includes('Facebook（test.page）') && toA.includes('B 的暱稱') && toA.includes('解除綁定'), toA);
  assert.ok(toB.includes('LINE（@line1234）') && toB.includes('A 的暱稱') && toB.includes('解除綁定'), toB);
});

scenario('對方沒有對話', async (f) => {
  const b = await f.person('B', { channel: null, email: 'amy@example.com' });
  const a = await f.person('A');
  assert.equal((await submit(f, await linkFor(f, a), 'amy@example.com')).status, 'merged');
  assert.ok(textsTo(f, a.conversationId).at(-1)!.includes('相同 email 的顧客資料'));
  assert.equal(f.sent.filter((s) => s.conversationId !== a.conversationId).length, 0);
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.mergedIntoId, b.contactId);
});

scenario('通知送不出去時合併結果不變，對話留下失敗紀錄', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  const token = await linkFor(f, a);
  f.deps.deliver = async () => false;
  assert.equal((await submit(f, token, 'amy@example.com')).status, 'merged');
  const failed = await f.tx.message.findFirst({
    where: { conversationId: b.conversationId, metadata: { path: ['deliveryFailed'], equals: true } },
  });
  assert.ok(failed, '客服看得到沒有送出');
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
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), 'amy@example.com');
  f.clock.now += 3 * DAY;
  assert.equal(await sendUnbind(f, a, b.contactId), 'unbound');
  const restored = await f.tx.contact.findFirst({ where: { id: a.contactId } });
  assert.equal(restored?.isArchived, false);
  assert.equal((await f.tx.channelIdentity.findFirst({ where: { id: a.channelIdentityId } }))?.contactId, a.contactId);
  assert.equal((await f.tx.conversation.findFirst({ where: { id: a.conversationId } }))?.contactId, a.contactId);
});

scenario('對方解除', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), 'amy@example.com');
  assert.equal(await sendUnbind(f, b, b.contactId), 'unbound');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.isArchived, false);
});

scenario('超過 7 天', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  await submit(f, await linkFor(f, a), 'amy@example.com');
  // 合併紀錄的時間由資料庫寫入，改它而不是快轉時鐘
  await f.tx.contactMergeLog.updateMany({ where: { tenantId: T, mergedId: a.contactId }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
  assert.equal(await sendUnbind(f, a, b.contactId), 'expired');
  assert.equal((await f.tx.contact.findFirst({ where: { id: a.contactId } }))?.isArchived, true, '合併不變');
});

// spec ai-cross-channel-context「解除後回覆」
scenario('解除後回覆', async (f) => {
  const b = await f.person('B', { channel: f.fbCh, email: 'amy@example.com' });
  const a = await f.person('A');
  await f.tx.message.create({
    data: { conversationId: a.conversationId, direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: 'A 在 LINE 的問題' } },
  });
  await submit(f, await linkFor(f, a), 'amy@example.com');
  assert.ok((await loadOtherChannelContext(f.tx, T, b.conversationId)).includes('A 在 LINE 的問題'), '合併後讀得到');
  assert.equal(await sendUnbind(f, a, b.contactId), 'unbound');
  assert.ok(!(await loadOtherChannelContext(f.tx, T, b.conversationId)).includes('A 在 LINE 的問題'), '解除後讀不到');
});
