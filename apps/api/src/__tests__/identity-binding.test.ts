/**
 * 跨渠道綁定代碼引擎整合測試（真實 Postgres；每個案例在交易內執行並 rollback，不留資料）。
 * 對應 spec cross-channel-binding-code 的各 Scenario。Redis 換成可快轉時間的記憶體實作。
 *
 * 執行：DATABASE_URL=... tsx src/__tests__/identity-binding.test.ts
 * 需 DB 已套用本 change 的 migration，且有 RLS_TEST_TENANT_A（預設 seed 租戶）。
 */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { withTenant, type TenantDb } from '../lib/tenant-db.js';
import { extractBindingCode } from '../modules/identity-binding/binding-code.js';
import { memBindingStore as memStore } from './helpers/mem-binding-store.js';
import {
  detectBindingIntent,
  executeBindingIntent,
  issueBindingCode,
  redeemBindingCode,
  unbindByCustomer,
  type BindingActor,
  type BindingDeps,
} from '../modules/identity-binding/identity-binding.service.js';
import { mergeContacts } from '../modules/contact/contact-merge.service.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP identity-binding: 需 DATABASE_URL');
  process.exit(0);
}

const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

class Rollback extends Error {}

interface Fixture {
  tx: TenantDb;
  deps: BindingDeps;
  clock: { now: number };
  sent: Array<{ conversationId: string; text: string }>;
  failConversations: Set<string>;
  fb: BindingActor;
  line: BindingActor;
  lineChannelId: string;
}

let seq = 0;

/** 建立測試場景：LINE（有導流識別）、FB（有）、IG（沒有）；顧客 A 在 FB、顧客 B 在 LINE */
async function setup(tx: TenantDb, enabled = true): Promise<Fixture> {
  const tag = `ib-test-${Date.now()}-${seq++}`;
  await tx.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { enabled } },
    update: { identityBinding: { enabled } },
  });
  // 本機既有渠道會被列入可綁定清單，先停用避免干擾（交易 rollback 後恢復）
  await tx.channel.updateMany({ where: { tenantId: T }, data: { isActive: false } });

  const mk = (channelType: 'LINE' | 'FB' | 'THREADS', displayName: string, settings: object) =>
    tx.channel.create({
      data: { tenantId: T, channelType, displayName, credentialsEncrypted: 'x', settings, isActive: true },
    });
  const lineCh = await mk('LINE', '測試 LINE', { bindingHandleAuto: '@line1234' });
  const fbCh = await mk('FB', '測試粉專', { bindingHandle: 'test.page' });
  await mk('THREADS', '測試 IG', {});

  const actor = async (channel: { id: string; channelType: string }, name: string): Promise<BindingActor> => {
    const contact = await tx.contact.create({ data: { tenantId: T, displayName: name } });
    const uid = `${tag}-${name}`;
    const identity = await tx.channelIdentity.create({
      data: { contactId: contact.id, channelId: channel.id, channelType: channel.channelType as never, uid },
    });
    const conv = await tx.conversation.create({
      data: { tenantId: T, contactId: contact.id, channelId: channel.id, channelType: channel.channelType as never },
    });
    return {
      tenantId: T,
      channelId: channel.id,
      channelType: channel.channelType,
      channelIdentityId: identity.id,
      uid,
      contactId: contact.id,
      conversationId: conv.id,
    };
  };

  const clock = { now: Date.now() };
  const sent: Fixture['sent'] = [];
  const failConversations = new Set<string>();
  const deps: BindingDeps = {
    store: memStore(clock),
    now: () => clock.now,
    deliver: async (_db, conversationId, text) => {
      sent.push({ conversationId, text });
      return !failConversations.has(conversationId);
    },
  };
  return {
    tx,
    deps,
    clock,
    sent,
    failConversations,
    fb: await actor(fbCh, 'A-fb'),
    line: await actor(lineCh, 'B-line'),
    lineChannelId: lineCh.id,
  };
}

// 依序執行（各案例共用同一租戶資料，不可並行）。@open333crm/core 載入時會建立 BullMQ／Redis
// 連線使進程不會自行結束，因此同其他測試檔以自訂計數 + process.exit 收尾。
const scenarios: Array<{ name: string; fn: (f: Fixture) => Promise<void>; enabled: boolean }> = [];

function scenario(name: string, fn: (f: Fixture) => Promise<void>, enabled = true) {
  scenarios.push({ name, fn, enabled });
}

async function runScenario(fn: (f: Fixture) => Promise<void>, enabled: boolean) {
  try {
    await withTenant(prisma, T, async (tx) => {
      await fn(await setup(tx, enabled));
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** 發碼並從送出的邀請訊息中取出代碼（測試不直接用回傳值，確保顧客真的收得到） */
async function issueAndGetCode(f: Fixture, actor: BindingActor): Promise<string> {
  const r = await issueBindingCode(f.tx, f.deps, actor);
  assert.equal(r.status, 'sent');
  const invite = f.sent.filter((s) => s.conversationId === actor.conversationId).at(-1)!;
  const code = extractBindingCode(invite.text);
  assert.ok(code, '邀請訊息內必須有代碼');
  return code;
}

async function contactOf(tx: TenantDb, channelIdentityId: string) {
  const ci = await tx.channelIdentity.findFirst({ where: { id: channelIdentityId }, select: { contactId: true } });
  return ci?.contactId;
}

// ── 啟用與關鍵字 ─────────────────────────────────────────────────────────────

scenario(
  '未啟用：綁定關鍵字與代碼都視為一般訊息',
  async (f) => {
    assert.equal(await detectBindingIntent(f.tx, { tenantId: T, contactId: f.fb.contactId, text: '綁定帳號', code: null }), null);
    assert.equal(
      await detectBindingIntent(f.tx, { tenantId: T, contactId: f.fb.contactId, text: '', code: 'BIND-7K2M9QH4TX' }),
      null,
    );
  },
  false,
);

scenario('發碼：列出其他渠道連結，不含顧客所在渠道與未設定導流識別的渠道', async (f) => {
  const intent = await detectBindingIntent(f.tx, { tenantId: T, contactId: f.fb.contactId, text: '綁定帳號', code: null });
  assert.deepEqual(intent, { kind: 'issue' });
  await executeBindingIntent(f.tx, f.deps, f.fb, intent!);

  const invite = f.sent.at(-1)!;
  assert.equal(invite.conversationId, f.fb.conversationId);
  assert.ok(invite.text.includes('https://line.me/R/ti/p/%40line1234'), '列出 LINE 加好友連結');
  assert.ok(invite.text.includes('https://line.me/R/oaMessage/%40line1234/'), '列出 LINE 送出代碼連結');
  assert.ok(!invite.text.includes('m.me/'), '不列出顧客所在的 FB');
  assert.ok(!invite.text.includes('ig.me/'), '未設定導流識別的 IG 不列出');
  const msg = await f.tx.message.findFirst({ where: { conversationId: f.fb.conversationId }, orderBy: { createdAt: 'desc' } });
  assert.equal(msg?.senderType, 'SYSTEM', '邀請訊息寫入對話紀錄');
});

scenario('發碼：沒有其他可綁定渠道時回覆說明且不產生代碼', async (f) => {
  await f.tx.channel.updateMany({ where: { id: f.lineChannelId }, data: { isActive: false } });
  const r = await issueBindingCode(f.tx, f.deps, f.fb);
  assert.equal(r.status, 'no_targets');
  assert.ok(f.sent.at(-1)!.text.includes('沒有其他可以綁定的帳號'));
  assert.equal(extractBindingCode(f.sent.at(-1)!.text), null);
});

scenario('發碼：同一身分一小時第 6 次被擋', async (f) => {
  for (let i = 0; i < 5; i++) assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'sent');
  assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'rate_limited');
  f.clock.now += 61 * MIN;
  assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'sent', '一小時後恢復');
});

// ── 兌換 ────────────────────────────────────────────────────────────────────

scenario('兌換：LINE 送出（改動過的）預填文字 → 合併、寫 IdentityMap、雙邊通知', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const text = `${code.toLowerCase()} 謝謝`;
  const intent = await detectBindingIntent(f.tx, {
    tenantId: T,
    contactId: f.line.contactId,
    text,
    code: extractBindingCode(text),
  });
  assert.deepEqual(intent, { kind: 'redeem', code });
  const r = await redeemBindingCode(f.tx, f.deps, f.line, code);
  assert.equal(r.status, 'bound');

  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.fb.contactId, 'LINE 身分併到發碼方（FB 聯絡人）');
  const merged = await f.tx.contact.findFirst({ where: { id: f.line.contactId, tenantId: T } });
  assert.equal(merged?.isArchived, true);

  const im = await f.tx.identityMap.findFirst({ where: { tenantId: T, channelType: 'LINE', uid: f.line.uid } });
  assert.equal(im?.source, 'BINDING_CODE');
  assert.equal(im?.confidence, 1);
  assert.equal(im?.contactId, f.fb.contactId);

  const log = await f.tx.contactMergeLog.findFirst({ where: { tenantId: T, survivorId: f.fb.contactId } });
  assert.equal(log?.source, 'BINDING_CODE');

  const bound = f.sent.filter((s) => s.text.startsWith('已完成帳號綁定'));
  assert.deepEqual(bound.map((s) => s.conversationId).sort(), [f.fb.conversationId, f.line.conversationId].sort());
  assert.ok(bound.every((s) => s.text.includes('解除綁定')), '通知含解除方式');
});

scenario('兌換：同一代碼第二次送出 → 無效，不再合併', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'bound');
  const logsBefore = await f.tx.contactMergeLog.count({ where: { tenantId: T } });
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'invalid');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T } }), logsBefore);
  assert.ok(f.sent.at(-1)!.text.includes('無效或已過期'));
});

scenario('兌換：超過 30 分鐘 → 無效', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  f.clock.now += 31 * MIN;
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'invalid');
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.line.contactId, '未合併');
});

scenario('兌換：在發碼的同一身分送回 → 提示到別的渠道，代碼仍可在其他渠道使用', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.fb, code)).status, 'same_identity');
  assert.ok(f.sent.at(-1)!.text.includes('另一個'));
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'bound');
});

scenario('兌換：兩個身分已是同一聯絡人 → 已完成綁定，不重複合併', async (f) => {
  const first = await issueAndGetCode(f, f.fb);
  await redeemBindingCode(f.tx, f.deps, f.line, first);
  const lineNow = { ...f.line, contactId: f.fb.contactId };
  const second = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, lineNow, second)).status, 'already_bound');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T, survivorId: f.fb.contactId } }), 1);
});

scenario('兌換：A 租戶的代碼送到 B 租戶 → 無效，不透露代碼存在', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const otherTenant = { ...f.line, tenantId: '00000000-0000-0000-0000-0000000000bb' };
  assert.equal((await redeemBindingCode(f.tx, f.deps, otherTenant, code)).status, 'invalid');
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'bound', '原租戶的代碼不因此被耗掉');
});

scenario('兌換：發碼方中途已被併入他人 → 沿 mergedIntoId 併到現存聯絡人', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const d = await f.tx.contact.create({ data: { tenantId: T, displayName: 'D' } });
  await mergeContacts(f.tx, { tenantId: T, survivorId: d.id, mergedId: f.fb.contactId, source: 'MANUAL' });
  const r = await redeemBindingCode(f.tx, f.deps, f.line, code);
  assert.equal(r.status, 'bound');
  assert.equal(r.status === 'bound' && r.survivorId, d.id);
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), d.id);
});

scenario('兌換：一邊通知送出失敗 → 該對話留客服可見的系統提示，合併不回滾', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  f.failConversations.add(f.fb.conversationId);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'bound');
  const note = await f.tx.message.findFirst({
    where: { conversationId: f.fb.conversationId, contentType: 'system' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok((note?.content as { text?: string }).text?.includes('送出失敗'));
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.fb.contactId);
});

scenario('兌換：同一身分一小時失敗 10 次後，第 11 次起不再回覆', async (f) => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, 'BIND-0000000000')).status, 'invalid');
  }
  const before = f.sent.length;
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, 'BIND-0000000000')).status, 'throttled');
  assert.equal(f.sent.length, before, '被擋時不回覆任何訊息');
});

// ── 解除 ────────────────────────────────────────────────────────────────────

scenario('解除：7 天內顧客回覆「解除綁定」→ 恢復兩個聯絡人並雙邊通知', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  await redeemBindingCode(f.tx, f.deps, f.line, code);
  f.clock.now += 2 * DAY;

  const lineNow = { ...f.line, contactId: f.fb.contactId };
  const intent = await detectBindingIntent(f.tx, { tenantId: T, contactId: lineNow.contactId, text: '解除綁定', code: null });
  assert.deepEqual(intent, { kind: 'unbind' });
  const r = await unbindByCustomer(f.tx, f.deps, lineNow);
  assert.equal(r.status, 'unbound');

  const restored = await f.tx.contact.findFirst({ where: { id: f.line.contactId, tenantId: T } });
  assert.equal(restored?.isArchived, false);
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.line.contactId, 'LINE 身分搬回');
  const conv = await f.tx.conversation.findFirst({ where: { id: f.line.conversationId, tenantId: T } });
  assert.equal(conv?.contactId, f.line.contactId, 'LINE 對話搬回');
  const im = await f.tx.identityMap.findFirst({ where: { tenantId: T, channelType: 'LINE', uid: f.line.uid } });
  assert.equal(im?.contactId, f.line.contactId, 'IdentityMap 指回被恢復的聯絡人');

  const unbound = f.sent.filter((s) => s.text.startsWith('已解除帳號綁定')).map((s) => s.conversationId).sort();
  assert.deepEqual(unbound, [f.fb.conversationId, f.line.conversationId].sort());
});

scenario('解除：超過 7 天 → 請聯繫客服，不撤銷', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  await redeemBindingCode(f.tx, f.deps, f.line, code);
  // createdAt 由 DB 寫入，把時鐘推到 10 天後
  f.clock.now = Date.now() + 10 * DAY;
  const r = await unbindByCustomer(f.tx, f.deps, { ...f.line, contactId: f.fb.contactId });
  assert.equal(r.status, 'expired');
  assert.ok(f.sent.at(-1)!.text.includes('聯繫客服'));
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.fb.contactId, '仍維持合併');
});

scenario('解除：從未綁定的顧客傳「解除綁定」→ 視為一般訊息', async (f) => {
  assert.equal(await detectBindingIntent(f.tx, { tenantId: T, contactId: f.line.contactId, text: '解除綁定', code: null }), null);
});

let failed = 0;
for (const [i, sc] of scenarios.entries()) {
  try {
    await runScenario(sc.fn, sc.enabled);
    console.log(`ok ${i + 1} - ${sc.name}`);
  } catch (err) {
    failed++;
    console.log(`not ok ${i + 1} - ${sc.name}`);
    console.error(err);
  }
}
console.log(`# pass ${scenarios.length - failed}`);
console.log(`# fail ${failed}`);
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
