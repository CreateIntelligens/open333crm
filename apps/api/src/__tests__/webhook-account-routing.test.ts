/**
 * FB／IG webhook 依帳號 ID 分派渠道與租戶（change fix-meta-webhook-page-routing，tasks 3.7）。
 *
 * 走真正的 processWebhookEvent＋真實資料庫：兩個粉專共用同一個 Meta App（同一個 App Secret），
 * 回呼網址都指向租戶 A 的渠道，確認各粉專的事件落到各自的渠道與租戶、對不上的事件不落地。
 *
 * 需要 DATABASE_URL（自動讀 repo 根目錄 .env，但只接受本機資料庫）與 Redis。
 * 執行：pnpm --filter @open333crm/api test:webhook-account-routing
 */
import './helpers/load-root-env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, fbPlugin, threadsPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '../config/env.js';
import { encryptCredentials } from '../modules/channel/channel.service.js';
import { processWebhookEvent } from '../modules/webhook/webhook.service.js';

if (!process.env.DATABASE_URL) {
  console.log('SKIP webhook-account-routing：repo 根目錄 .env 與環境變數都沒有 DATABASE_URL');
  process.exit(0);
}

loadEnvConfig();
registerChannelPlugin(fbPlugin);
registerChannelPlugin(threadsPlugin);
// 測試裡的假 token 不能真的打到 Meta：攔下所有對外 fetch
globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'offline test' } }), { status: 400 })) as typeof fetch;

const prisma = new PrismaClient();
const io = { to: () => ({ emit: () => {} }), emit: () => {} } as never;
const stamp = Date.now();
const SHARED_SECRET = `shared-app-secret-${stamp}`;
const OTHER_SECRET = `other-app-secret-${stamp}`;
const T_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';

const page = (name: string) => `PAGE_${name}_${stamp}`;
const psid = (name: string) => `PSID_${name}_${stamp}`;

function signedFb(entries: Array<{ pageId: string; psid: string; text: string }>, secret = SHARED_SECRET) {
  const body = {
    object: 'page',
    entry: entries.map((e, i) => ({
      id: e.pageId,
      time: Date.now(),
      messaging: [{
        sender: { id: e.psid },
        recipient: { id: e.pageId },
        timestamp: Date.now(),
        message: { mid: `mid-${e.psid}-${stamp}-${i}-${Math.random()}`, text: e.text },
      }],
    })),
  };
  const raw = Buffer.from(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, headers: { 'x-hub-signature-256': `sha256=${sig}` } };
}

/** 某渠道是否收到某位顧客的訊息（依渠道身份＋對話） */
async function received(channelId: string, uid: string) {
  const identity = await prisma.channelIdentity.findFirst({ where: { channelId, uid }, select: { contactId: true } });
  if (!identity) return false;
  return (await prisma.conversation.count({ where: { channelId, contactId: identity.contactId } })) > 0;
}
async function anyChannelReceived(uid: string) {
  return (await prisma.channelIdentity.count({ where: { uid } })) > 0;
}
async function routingWarning(channelId: string) {
  const c = await prisma.channel.findUnique({ where: { id: channelId }, select: { settings: true } });
  return ((c?.settings ?? {}) as Record<string, any>).webhookRouting as { reason: string; accountId: string | null } | undefined;
}

let failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}`);
    console.error(err);
  }
}

const cleanup: Array<() => Promise<unknown>> = [];
const mkChannel = async (tenantId: string, name: string, externalAccountId: string | null, appSecret: string, settings: object = {}) => {
  const ch = await prisma.channel.create({
    data: {
      tenantId,
      channelType: 'FB',
      displayName: `CI 分派 ${name} ${stamp}`,
      externalAccountId,
      credentialsEncrypted: encryptCredentials({ pageAccessToken: `token-${name}`, appSecret, verifyToken: 'v' }),
      settings: settings as never,
    },
  });
  cleanup.unshift(async () => {
    const convs = await prisma.conversation.findMany({ where: { channelId: ch.id }, select: { id: true, contactId: true } });
    await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { channelId: ch.id } });
    const idents = await prisma.channelIdentity.findMany({ where: { channelId: ch.id }, select: { contactId: true } });
    await prisma.channelIdentity.deleteMany({ where: { channelId: ch.id } });
    await prisma.contact.deleteMany({ where: { id: { in: idents.map((i) => i.contactId) }, tenantId } });
    await prisma.channel.deleteMany({ where: { id: ch.id } });
  });
  return ch;
};

try {
  const tenantB = await prisma.tenant.create({ data: { name: `CI 分派租戶 B ${stamp}` } });
  const tenantOff = await prisma.tenant.create({ data: { name: `CI 分派停用租戶 ${stamp}`, isActive: false } });
  cleanup.push(async () => {
    const ids = [tenantB.id, tenantOff.id];
    // 入站管線會替租戶建 tenant_settings，要先刪才能刪租戶
    await prisma.tenantSettings.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  });

  // 租戶 A 的網址渠道（回呼網址指向它）、租戶 B 同一個 App 的另一個粉專、另一個 App 的粉專、停用租戶的粉專
  const chA = await mkChannel(T_A, 'A', page('A'), SHARED_SECRET);
  const chB = await mkChannel(tenantB.id, 'B', page('B'), SHARED_SECRET);
  const chOtherApp = await mkChannel(tenantB.id, 'OtherApp', page('OTHERAPP'), OTHER_SECRET);
  const chOff = await mkChannel(tenantOff.id, 'Off', page('OFF'), SHARED_SECRET);
  const chLegacy = await mkChannel(T_A, 'Legacy', null, `legacy-secret-${stamp}`);
  const chDownstream = await mkChannel(T_A, 'Downstream', page('DS'), SHARED_SECRET, {
    downstreamWebhook: { enabled: true, url: 'https://example.invalid/hook', mode: 'after' },
  });

  const run = (urlChannelId: string, payload: ReturnType<typeof signedFb>) =>
    processWebhookEvent(prisma, io, urlChannelId, 'FB', payload.raw, payload.headers);

  await check('共用 App：B 粉專的事件打到 A 的網址，落在 B 渠道與 B 租戶，A 租戶沒有', async () => {
    await run(chA.id, signedFb([{ pageId: page('B'), psid: psid('toB'), text: 'hi' }]));
    assert.ok(await received(chB.id, psid('toB')), 'B 渠道應收到');
    assert.equal(await received(chA.id, psid('toB')), false, 'A 渠道不可收到');
    const ident = await prisma.channelIdentity.findFirst({ where: { uid: psid('toB') }, select: { contact: { select: { tenantId: true } } } });
    assert.equal(ident?.contact.tenantId, tenantB.id, '聯絡人要建在 B 租戶');
  });

  await check('一包兩個粉專：各自落在自己的渠道', async () => {
    await run(chA.id, signedFb([
      { pageId: page('A'), psid: psid('mixA'), text: 'a' },
      { pageId: page('B'), psid: psid('mixB'), text: 'b' },
    ]));
    assert.ok(await received(chA.id, psid('mixA')));
    assert.ok(await received(chB.id, psid('mixB')));
    assert.equal(await received(chA.id, psid('mixB')), false);
  });

  await check('沒有渠道認領的帳號：丟棄，網址渠道留下警示', async () => {
    await run(chA.id, signedFb([{ pageId: page('NOBODY'), psid: psid('nobody'), text: 'x' }]));
    assert.equal(await anyChannelReceived(psid('nobody')), false, '不可落進任何渠道');
    const w = await routingWarning(chA.id);
    assert.equal(w?.reason, 'unrouted_account');
    assert.equal(w?.accountId, page('NOBODY'));
  });

  await check('認領帳號的渠道用不同的 Meta App：丟棄並警示', async () => {
    await run(chA.id, signedFb([{ pageId: page('OTHERAPP'), psid: psid('otherapp'), text: 'x' }]));
    assert.equal(await anyChannelReceived(psid('otherapp')), false);
    assert.equal((await routingWarning(chA.id))?.reason, 'app_mismatch');
  });

  await check('目標租戶已停用：丟棄', async () => {
    await run(chA.id, signedFb([{ pageId: page('OFF'), psid: psid('off'), text: 'x' }]));
    assert.equal(await anyChannelReceived(psid('off')), false);
  });

  await check('相容模式：網址渠道尚無帳號 ID，照舊收件並提示去驗證', async () => {
    const legacySecret = `legacy-secret-${stamp}`;
    await run(chLegacy.id, signedFb([{ pageId: page('UNKNOWN'), psid: psid('legacy'), text: 'x' }], legacySecret));
    assert.ok(await received(chLegacy.id, psid('legacy')), '相容模式應照舊收件');
    const w = await routingWarning(chLegacy.id);
    assert.equal(w?.reason, 'account_id_missing');
  });

  await check('相容模式也不搶別人的粉專：已被認領的帳號仍派給認領的渠道', async () => {
    // chLegacy 用不同 secret，B 粉專屬共用 App → 不同 App 丟棄，不落進 chLegacy
    const legacySecret = `legacy-secret-${stamp}`;
    await run(chLegacy.id, signedFb([{ pageId: page('B'), psid: psid('legacyToB'), text: 'x' }], legacySecret));
    assert.equal(await received(chLegacy.id, psid('legacyToB')), false, '不可落進網址渠道');
    assert.equal(await received(chB.id, psid('legacyToB')), false, '不同 App 的簽章不可灌進 B');
  });

  await check('下游轉發：整包含其他渠道事件時不轉發，並留下警示', async () => {
    await run(chDownstream.id, signedFb([
      { pageId: page('DS'), psid: psid('ds'), text: 'a' },
      { pageId: page('B'), psid: psid('dsB'), text: 'b' },
    ]));
    assert.ok(await received(chDownstream.id, psid('ds')), '自己的事件照常進 CRM（after 模式）');
    assert.ok(await received(chB.id, psid('dsB')));
    assert.equal((await routingWarning(chDownstream.id))?.reason, 'downstream_skipped');
  });

  await check('回滾開關 META_WEBHOOK_ROUTING=legacy：退回純網址分派', async () => {
    process.env.META_WEBHOOK_ROUTING = 'legacy';
    try {
      await run(chA.id, signedFb([{ pageId: page('B'), psid: psid('flag'), text: 'x' }]));
      assert.ok(await received(chA.id, psid('flag')), '開關開啟時照舊落在網址渠道');
    } finally {
      delete process.env.META_WEBHOOK_ROUTING;
    }
  });

  await check('簽章不符：整包拒絕', async () => {
    await assert.rejects(run(chA.id, signedFb([{ pageId: page('A'), psid: psid('badsig'), text: 'x' }], 'wrong-secret')));
    assert.equal(await anyChannelReceived(psid('badsig')), false);
  });
} finally {
  for (const fn of cleanup) await fn().catch((err) => console.error('清理失敗', err));
  await prisma.$disconnect();
}

console.log(`# fail ${failed}`);
process.exit(failed === 0 ? 0 : 1);
