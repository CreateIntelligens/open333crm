/**
 * 跨渠道綁定代碼引擎整合測試（真實 Postgres；每個案例在交易內執行並 rollback，不留資料）。
 * 對應 spec cross-channel-binding-code 的各 Scenario。Redis 換成可快轉時間的記憶體實作。
 *
 * 執行：pnpm --filter @open333crm/api test:identity-binding
 * 會自動讀 repo 根目錄 .env；.env 的 DATABASE_URL 只接受本機資料庫（要測遠端請明確 export）
 * 需 DB 已套用本 change 的 migration，且有 RLS_TEST_TENANT_A（預設 seed 租戶）。
 */
import './helpers/load-root-env.js';
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
  confirmBinding,
  unbindByCustomer,
  invalidateIdentityBindingSettings,
  type BindingActor,
  type BindingDeps,
} from '../modules/identity-binding/identity-binding.service.js';
import { mergeContacts } from '../modules/contact/contact-merge.service.js';
import { patchChannelSettings, updateChannel } from '../modules/channel/channel.service.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP identity-binding：repo 根目錄 .env 與環境變數都沒有 DATABASE_URL');
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
  igChannel: { id: string; channelType: string };
  lineChannel: { id: string; channelType: string };
  newActor: (channel: { id: string; channelType: string }, name: string) => Promise<BindingActor>;
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
  invalidateIdentityBindingSettings();
  // 本機既有渠道會被列入可綁定清單，先停用避免干擾（交易 rollback 後恢復）
  await tx.channel.updateMany({ where: { tenantId: T }, data: { isActive: false } });

  const mk = (channelType: 'LINE' | 'FB' | 'THREADS', displayName: string, settings: object) =>
    tx.channel.create({
      data: { tenantId: T, channelType, displayName, credentialsEncrypted: 'x', settings, isActive: true },
    });
  const lineCh = await mk('LINE', '測試 LINE', { bindingHandleAuto: '@line1234' });
  const fbCh = await mk('FB', '測試粉專', { bindingHandle: 'test.page' });
  const igCh = await mk('THREADS', '測試 IG', {});

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
    igChannel: igCh,
    lineChannel: lineCh,
    newActor: actor,
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

/** 兌換並確認（兩段式綁定的完整流程），回傳確認後的結果 */
async function bind(f: Fixture, actor: BindingActor, code: string) {
  const redeemed = await redeemBindingCode(f.tx, f.deps, actor, code);
  if (redeemed.status !== 'pending_confirm') return redeemed;
  return confirmBinding(f.tx, f.deps, actor);
}

async function contactOf(tx: TenantDb, channelIdentityId: string) {
  const ci = await tx.channelIdentity.findFirst({ where: { id: channelIdentityId }, select: { contactId: true } });
  return ci?.contactId;
}

// ── 啟用與關鍵字 ─────────────────────────────────────────────────────────────

scenario(
  '未啟用：綁定關鍵字與代碼都視為一般訊息',
  async (f) => {
    assert.equal(await detectBindingIntent(f.tx, { tenantId: T, contactId: f.fb.contactId, text: '綁定帳號', code: null, getChannelIdentityId: async () => f.fb.channelIdentityId, hasPendingConfirm: async () => false }), null);
    assert.equal(
      await detectBindingIntent(f.tx, { tenantId: T, contactId: f.fb.contactId, text: '', code: 'BIND-7K2M9QH4TX', getChannelIdentityId: async () => f.fb.channelIdentityId, hasPendingConfirm: async () => false }),
      null,
    );
  },
  false,
);

scenario('發碼：列出其他渠道連結，不含顧客所在渠道與未設定導流識別的渠道', async (f) => {
  const intent = await detectBindingIntent(f.tx, { tenantId: T, contactId: f.fb.contactId, text: '綁定帳號', code: null, getChannelIdentityId: async () => f.fb.channelIdentityId, hasPendingConfirm: async () => false });
  assert.deepEqual(intent, { kind: 'issue' });
  await executeBindingIntent(f.tx, f.deps, f.fb, intent!);

  const invite = f.sent.at(-1)!;
  assert.equal(invite.conversationId, f.fb.conversationId);
  assert.ok(invite.text.includes('https://line.me/R/ti/p/%40line1234'), '列出 LINE 加好友連結');
  assert.ok(invite.text.includes('https://line.me/R/oaMessage/%40line1234/'), '列出 LINE 送出代碼連結');
  assert.ok(!invite.text.includes('m.me/'), '不列出顧客所在的 FB');
  assert.ok(!invite.text.includes('ig.me/'), '未設定導流識別的 IG 不列出');
  const msg = await f.tx.message.findFirst({ where: { conversationId: f.fb.conversationId }, orderBy: { createdAt: 'desc' } });
  assert.equal(msg?.senderType, 'BOT', '邀請訊息寫入對話紀錄');
});

scenario('發碼：沒有其他可綁定渠道時回覆說明且不產生代碼', async (f) => {
  await f.tx.channel.updateMany({ where: { id: f.lineChannelId }, data: { isActive: false } });
  const r = await issueBindingCode(f.tx, f.deps, f.fb);
  assert.equal(r.status, 'no_targets');
  assert.ok(f.sent.at(-1)!.text.includes('沒有其他可以綁定的帳號'));
  assert.equal(extractBindingCode(f.sent.at(-1)!.text), null);
});

scenario('發碼：邀請訊息沒送到顧客 → 回報 delivery_failed 並作廢代碼', async (f) => {
  f.failConversations.add(f.fb.conversationId);
  const r = await issueBindingCode(f.tx, f.deps, f.fb);
  assert.equal(r.status, 'delivery_failed', '客服代發按鈕不可顯示成功');
  const code = extractBindingCode(f.sent.at(-1)!.text)!;
  assert.equal(await f.deps.store.get(`bindcode:${T}:${code}`), null, '顧客沒收到的代碼要作廢');
});

scenario('發碼：客服代發超過次數只回報給客服，不在顧客對話送「次數過多」，也不佔顧客自己的額度', async (f) => {
  for (let i = 0; i < 5; i++) assert.equal((await issueBindingCode(f.tx, f.deps, f.fb, 'agent')).status, 'sent');
  const before = f.sent.length;
  assert.equal((await issueBindingCode(f.tx, f.deps, f.fb, 'agent')).status, 'rate_limited');
  assert.equal(f.sent.length, before, '不發訊息給顧客');
  assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'sent', '顧客自己要求不受影響');
});

scenario('發碼：同一身分一小時第 6 次被擋', async (f) => {
  for (let i = 0; i < 5; i++) assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'sent');
  assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'rate_limited');
  assert.ok(f.sent.at(-1)!.text.includes('次數過多'), '第一次超過時回覆一次');
  const before = f.sent.length;
  for (let i = 0; i < 3; i++) assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'rate_limited');
  assert.equal(f.sent.length, before, '之後不再回覆（避免被拿來洗訊息、佔推播額度）');
  f.clock.now += 61 * MIN;
  assert.equal((await issueBindingCode(f.tx, f.deps, f.fb)).status, 'sent', '一小時後恢復');
});

scenario('渠道設定局部更新（驗證／導流識別 API）只動指定欄位，其他設定保留', async (f) => {
  await f.tx.channel.update({ where: { id: f.lineChannelId }, data: { settings: { bindingHandleAuto: '@line1234', botConfig: { botMode: 'AI' }, bindingHandle: '@manual' } } });
  await patchChannelSettings(f.tx, f.lineChannelId, T, { bindingHandleAuto: '@new' }, ['bindingHandle']);
  const ch = await f.tx.channel.findFirst({ where: { id: f.lineChannelId, tenantId: T }, select: { settings: true } });
  assert.deepEqual(ch?.settings, { bindingHandleAuto: '@new', botConfig: { botMode: 'AI' } });
});

scenario('渠道設定整包更新（例如其他設定視窗用舊快照儲存）不會洗掉導流識別', async (f) => {
  // 前端快照是舊的：帶著舊的自動導流識別，以及資料庫裡已被清空的手動導流識別
  await updateChannel(f.tx, f.lineChannelId, T, {
    settings: { botConfig: { botMode: 'OFF' }, bindingHandleAuto: '@stale-old', bindingHandle: '@cleared-before' },
  });
  const ch = await f.tx.channel.findFirst({ where: { id: f.lineChannelId, tenantId: T }, select: { settings: true } });
  const settings = ch?.settings as Record<string, unknown>;
  assert.equal(settings.bindingHandleAuto, '@line1234', '導流識別以資料庫現值為準，不被舊快照蓋掉');
  assert.equal(settings.bindingHandle, undefined, '資料庫已清空的欄位不會被快照寫回來');
  assert.deepEqual(settings.botConfig, { botMode: 'OFF' }, '送來的設定照常寫入');
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
    getChannelIdentityId: async () => f.line.channelIdentityId,
    hasPendingConfirm: async () => (await f.deps.store.get(`bindcode:pending:${T}:${f.line.channelIdentityId}`)) !== null,
  });
  assert.deepEqual(intent, { kind: 'redeem', code });
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'pending_confirm');
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.line.contactId, '送出代碼還不會合併');
  const prompt = f.sent.at(-1)!;
  assert.equal(prompt.conversationId, f.line.conversationId);
  assert.ok(prompt.text.includes('Facebook（test.page）帳號「A-fb」'), '確認訊息顯示對方的公開帳號（粉專 username）與帳號名稱');
  assert.ok(!prompt.text.includes('測試粉專'), '不可出現後台自取的渠道名稱');
  assert.ok(prompt.text.includes('確認綁定'));

  const confirm = await detectBindingIntent(f.tx, {
    tenantId: T,
    contactId: f.line.contactId,
    text: '確認綁定',
    code: null,
    getChannelIdentityId: async () => f.line.channelIdentityId,
    hasPendingConfirm: async () => (await f.deps.store.get(`bindcode:pending:${T}:${f.line.channelIdentityId}`)) !== null,
  });
  assert.deepEqual(confirm, { kind: 'confirm' });
  const r = await confirmBinding(f.tx, f.deps, f.line);
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
  // 同一租戶可能接多個 LINE OA／粉專：通知要寫出是哪一個渠道
  assert.ok(bound.find((s) => s.conversationId === f.line.conversationId)!.text.includes('Facebook（test.page）'));
  assert.ok(bound.find((s) => s.conversationId === f.fb.conversationId)!.text.includes('LINE（@line1234）'));
  assert.ok(bound.every((s) => !s.text.includes('測試粉專') && !s.text.includes('測試 LINE')), '完成通知不可出現後台渠道名稱');
});

scenario('安全：轉傳的連結被別人點開，只要不回覆確認就不會合併（逾時後也不會）', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'pending_confirm');
  f.clock.now += 11 * 60 * 1000; // 超過 10 分鐘確認時限
  assert.equal((await confirmBinding(f.tx, f.deps, f.line)).status, 'no_pending');
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.line.contactId, '沒有合併');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T, survivorId: f.fb.contactId } }), 0);
  assert.ok(f.sent.at(-1)!.text.includes('沒有待確認的綁定'));
});

scenario('確認：沒有待確認的綁定時傳「確認綁定」→ 提示重新取得代碼', async (f) => {
  assert.equal((await confirmBinding(f.tx, f.deps, f.line)).status, 'no_pending');
});

scenario('確認：待確認期間對方已和別人合併到同一渠道 → 確認時重新檢查並拒絕', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'pending_confirm');
  // 確認前，A 已經透過別的方式綁了另一個 LINE 帳號
  const other = await f.newActor(f.lineChannel, 'E-line');
  await mergeContacts(f.tx, { tenantId: T, survivorId: f.fb.contactId, mergedId: other.contactId, source: 'MANUAL' });
  assert.equal((await confirmBinding(f.tx, f.deps, f.line)).status, 'channel_conflict');
});

scenario('安全：別人點開連結但不確認，不會讓本人的代碼失效', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const stranger = await f.newActor(f.igChannel, 'X-ig-stranger');
  assert.equal((await redeemBindingCode(f.tx, f.deps, stranger, code)).status, 'pending_confirm');
  // 陌生人沒有確認；本人在 LINE 仍可完成綁定
  assert.equal((await bind(f, f.line, code)).status, 'bound');
  assert.equal(await contactOf(f.tx, stranger.channelIdentityId), stranger.contactId, '陌生人沒有被合併');
});

scenario('確認：兩人同時等待確認同一代碼，只有先確認的成功', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const other = await f.newActor(f.igChannel, 'Y-ig');
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'pending_confirm');
  assert.equal((await redeemBindingCode(f.tx, f.deps, other, code)).status, 'pending_confirm');
  assert.equal((await confirmBinding(f.tx, f.deps, f.line)).status, 'bound');
  assert.equal((await confirmBinding(f.tx, f.deps, other)).status, 'invalid', '代碼已被用掉');
  assert.equal(await contactOf(f.tx, other.channelIdentityId), other.contactId);
});

scenario('確認：發碼身分在確認前被移到別的聯絡人 → 併入它目前所屬的聯絡人', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'pending_confirm');
  const moved = await f.tx.contact.create({ data: { tenantId: T, displayName: 'FB-owner-now' } });
  await f.tx.channelIdentity.update({ where: { id: f.fb.channelIdentityId }, data: { contactId: moved.id } });
  const r = await confirmBinding(f.tx, f.deps, f.line);
  assert.equal(r.status, 'bound');
  assert.equal(r.status === 'bound' && r.survivorId, moved.id, '不是發碼當下的舊聯絡人');
});

scenario('確認：沒有待確認的綁定時傳「確認綁定」→ 不攔截，當一般訊息交給 AI／關鍵字', async (f) => {
  const intent = await detectBindingIntent(f.tx, {
    tenantId: T,
    contactId: f.line.contactId,
    text: '確認綁定',
    code: null,
    getChannelIdentityId: async () => f.line.channelIdentityId,
    hasPendingConfirm: async () => false,
  });
  assert.equal(intent, null);
});

scenario('確認：合併當下失敗（例如同時有人在合併）→ 代碼與待確認狀態放回，顧客再確認一次即可', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'pending_confirm');
  // 讓寫入合併紀錄時失敗
  const failing = new Proxy(f.tx, {
    get(target, prop, receiver) {
      if (prop === 'contactMergeLog') {
        return { ...target.contactMergeLog, create: async () => { throw new Error('simulated failure'); } };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  await assert.rejects(confirmBinding(failing as never, f.deps, f.line), /simulated failure/);
  assert.notEqual(await f.deps.store.get(`bindcode:${T}:${code}`), null, '代碼放回');
  assert.equal(await f.deps.store.get(`bindcode:pending:${T}:${f.line.channelIdentityId}`), code, '待確認狀態放回');
});

scenario('兌換：同一代碼第二次送出 → 無效，不再合併', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  assert.equal((await bind(f, f.line, code)).status, 'bound');
  const logsBefore = await f.tx.contactMergeLog.count({ where: { tenantId: T } });
  assert.equal((await redeemBindingCode(f.tx, f.deps, f.line, code)).status, 'invalid');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T } }), logsBefore);
  assert.ok(f.sent.at(-1)!.text.includes('代碼無效'));
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
  assert.equal((await bind(f, f.line, code)).status, 'bound');
});

scenario('兌換：兩個身分已是同一聯絡人 → 已完成綁定，不重複合併', async (f) => {
  const first = await issueAndGetCode(f, f.fb);
  await bind(f, f.line, first);
  const lineNow = { ...f.line, contactId: f.fb.contactId };
  const second = await issueAndGetCode(f, f.fb);
  assert.equal((await redeemBindingCode(f.tx, f.deps, lineNow, second)).status, 'already_bound');
  assert.equal(await f.tx.contactMergeLog.count({ where: { tenantId: T, survivorId: f.fb.contactId } }), 1);
});

scenario('兌換：A 租戶的代碼送到 B 租戶 → 無效，不透露代碼存在', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const otherTenant = { ...f.line, tenantId: '00000000-0000-0000-0000-0000000000bb' };
  assert.equal((await redeemBindingCode(f.tx, f.deps, otherTenant, code)).status, 'invalid');
  assert.equal((await bind(f, f.line, code)).status, 'bound', '原租戶的代碼不因此被耗掉');
});

scenario('兌換：發碼方中途已被併入他人 → 沿 mergedIntoId 併到現存聯絡人', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  const d = await f.tx.contact.create({ data: { tenantId: T, displayName: 'D' } });
  await mergeContacts(f.tx, { tenantId: T, survivorId: d.id, mergedId: f.fb.contactId, source: 'MANUAL' });
  const r = await bind(f, f.line, code);
  assert.equal(r.status, 'bound');
  assert.equal(r.status === 'bound' && r.survivorId, d.id);
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), d.id);
});

scenario('兌換：一邊通知送出失敗 → 該則訊息標為送出失敗（客服可見），合併不回滾', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  f.failConversations.add(f.fb.conversationId);
  assert.equal((await bind(f, f.line, code)).status, 'bound');
  const bound = await f.tx.message.findFirst({
    where: { conversationId: f.fb.conversationId, senderType: 'BOT' },
    orderBy: { createdAt: 'desc' },
  });
  const meta = bound?.metadata as { deliveryFailed?: boolean; deliveryError?: string };
  assert.equal(meta.deliveryFailed, true, '該則訊息標為送出失敗（收件匣顯示紅色提示）');
  assert.ok(meta.deliveryError?.includes('沒有送到顧客'));
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.fb.contactId);
});

scenario('兌換：同一渠道的另一個人（例如被轉傳代碼的朋友）→ 拒絕合併，代碼仍可給本人使用', async (f) => {
  // B 在 LINE 發碼；同一個 LINE OA 的另一位使用者 C 拿到代碼送出
  const code = await issueAndGetCode(f, f.line);
  const friend = await f.newActor(f.lineChannel, 'C-line-friend');
  assert.equal((await redeemBindingCode(f.tx, f.deps, friend, code)).status, 'channel_conflict');
  assert.equal(await contactOf(f.tx, friend.channelIdentityId), friend.contactId, '朋友沒有被合併');
  assert.ok(f.sent.at(-1)!.text.includes('同一個渠道只能綁定一個帳號'));
  // 代碼放回去了：B 本人在 FB 仍可兌換
  assert.equal((await bind(f, f.fb, code)).status, 'bound');
});

scenario('兌換：發碼方在兌換方的渠道已有帳號 → 拒絕（同一渠道不可有兩個帳號）', async (f) => {
  // A(FB) 先綁了 LINE 的 B；A 再發碼，LINE 上另一位 C 兌換 → A 會在 LINE 有兩個身分
  await bind(f, f.line, await issueAndGetCode(f, f.fb));
  const c = await f.newActor(f.lineChannel, 'C-line');
  assert.equal((await redeemBindingCode(f.tx, f.deps, c, await issueAndGetCode(f, f.fb))).status, 'channel_conflict');
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
  await bind(f, f.line, code);
  f.clock.now += 2 * DAY;

  const lineNow = { ...f.line, contactId: f.fb.contactId };
  const intent = await detectBindingIntent(f.tx, { tenantId: T, contactId: lineNow.contactId, text: '解除綁定', code: null, getChannelIdentityId: async () => f.line.channelIdentityId, hasPendingConfirm: async () => false });
  assert.equal(intent?.kind, 'unbind');
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

scenario('解除：綁了兩個渠道，在其中一個回覆「解除綁定」只拆那一個', async (f) => {
  // A(FB) 綁 LINE 的 B（第 1 筆），再綁 IG 的 D（第 2 筆，較新）
  await bind(f, f.line, await issueAndGetCode(f, f.fb));
  const d = await f.newActor(f.igChannel, 'D-ig');
  assert.equal((await bind(f, d, await issueAndGetCode(f, f.fb))).status, 'bound');

  // 在 LINE 回覆解除 → 應拆 LINE 那筆（較舊），IG 維持綁定
  const r = await unbindByCustomer(f.tx, f.deps, { ...f.line, contactId: f.fb.contactId });
  assert.equal(r.status, 'unbound');
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.line.contactId, 'LINE 被拆開');
  assert.equal(await contactOf(f.tx, d.channelIdentityId), f.fb.contactId, 'IG 仍綁著');
});

scenario('解除：發碼方之後又被併入別人 → 另一邊（目前持有者）仍收到解除通知', async (f) => {
  await bind(f, f.line, await issueAndGetCode(f, f.fb));
  // A（含 FB、LINE）之後被手動併入 Z
  const z = await f.tx.contact.create({ data: { tenantId: T, displayName: 'Z' } });
  await mergeContacts(f.tx, { tenantId: T, survivorId: z.id, mergedId: f.fb.contactId, source: 'MANUAL' });

  const r = await unbindByCustomer(f.tx, f.deps, { ...f.line, contactId: z.id });
  assert.equal(r.status, 'unbound');
  const unbound = f.sent.filter((s) => s.text.startsWith('已解除帳號綁定')).map((s) => s.conversationId).sort();
  assert.deepEqual(unbound, [f.fb.conversationId, f.line.conversationId].sort(), '雙邊都收到');
});

scenario('解除：超過 7 天 → 請聯繫客服，不撤銷', async (f) => {
  const code = await issueAndGetCode(f, f.fb);
  await bind(f, f.line, code);
  // createdAt 由 DB 寫入，把時鐘推到 10 天後
  f.clock.now = Date.now() + 10 * DAY;
  const r = await unbindByCustomer(f.tx, f.deps, { ...f.line, contactId: f.fb.contactId });
  assert.equal(r.status, 'expired');
  assert.ok(f.sent.at(-1)!.text.includes('聯繫客服'));
  assert.equal(await contactOf(f.tx, f.line.channelIdentityId), f.fb.contactId, '仍維持合併');
});

scenario('解除：從未綁定的顧客傳「解除綁定」→ 視為一般訊息', async (f) => {
  assert.equal(await detectBindingIntent(f.tx, { tenantId: T, contactId: f.line.contactId, text: '解除綁定', code: null, getChannelIdentityId: async () => f.line.channelIdentityId, hasPendingConfirm: async () => false }), null);
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
