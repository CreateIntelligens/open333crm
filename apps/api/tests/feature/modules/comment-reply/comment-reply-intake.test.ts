/**
 * 留言收件（change add-comment-keyword-private-reply tasks 4.1、4.2；spec comment-private-reply
 * 「命中規則的新留言建立處理中紀錄」「不處理的留言不留紀錄」「留言事件依帳號分派到所屬租戶」「留言處理失敗不影響私訊」
 * 「同一則留言只建立一筆紀錄」「留言被刪除時清除內容」「留言處理不把個資寫進工作與日誌」）。
 *
 * 走真的入口：webhook.service（與 webhook.routes 相同的連線與 Redis），部分情境經 Fastify inject 打真的 webhook.routes；
 * 真的 FB／IG 外掛，只攔對外 fetch（fake-meta-graph）。自建租戶，afterAll 刪除。
 */
import {
  adminDb,
  cleanupCommentReplyData,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  jobs,
  owner,
  PLATFORM_APP_SECRET,
  postToChannel,
  postToPlatform,
  redis,
  resetHarness,
  resetPlatformSettings,
  setPlatformSetting,
  tenantDb,
  clearRateBuckets,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, test, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload, fbMessagePayload, igCommentPayload, signed } from '#tests/support/meta-webhook.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { bumpCommentReplyRulesVersion } from '#src/modules/comment-reply/comment-reply-rule-cache.js';
import jsonPayloadGuardPlugin from '#src/plugins/json-payload-guard.plugin.js';
import { DEFAULT_JSON_PAYLOAD_LIMITS } from '#src/shared/utils/json-payload-limits.js';
import webhookRoutes from '#src/modules/webhook/webhook.routes.js';
import { urls } from '#tests/setup/feature-config.js';

const fx = createCommentReplyFixtures(owner);
/** 留言時間預設為現在（fixture 的預設時間是 2024 年，會被判為超過 7 天） */
const fbComments = (list: Parameters<typeof fbCommentPayload>[0]) =>
  fbCommentPayload(list!.map((c) => ({ createdTime: Math.floor(Date.now() / 1000), ...c })));
const graph = useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;

function okSend() {
  graph.on('POST', 'graph.facebook.com', '/v21.0/me/messages', { body: { recipient_id: 'PSID-intake', message_id: uid('m_') } });
  graph.on('POST', 'graph.instagram.com', '/v21.0/me/messages', { body: { recipient_id: 'IGSID-intake', message_id: uid('ig_') } });
}

async function logsOf(channelId: string) {
  return owner.commentReplyLog.findMany({ where: { channelId }, orderBy: { createdAt: 'asc' } });
}

/** 方案含 comment_reply 的租戶＋平台模式 FB 渠道＋一條「+1」規則 */
async function setup(options: { plan?: { features: string[] } | null; channelMode?: 'platform' | 'own_app'; appSecret?: string } = {}) {
  const tenant = await fx.tenant({ plan: options.plan === undefined ? { features: ['inbox', 'core', 'comment_reply'] } : options.plan });
  const fb = await fx.fbChannel(tenant.id, { mode: options.channelMode ?? 'platform', appSecret: options.appSecret });
  const rule = await createRule(tenant.id, fb.id, { keywords: ['+1'] });
  return { tenant, fb, rule };
}

beforeAll(async () => {
  await enableAllCapabilities();
});

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function webhookApp(options: { redisOverride?: unknown } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('prismaAdmin', adminDb as never);
  app.decorate('prisma', tenantDb as never);
  app.decorate('redis', (options.redisOverride ?? redis) as never);
  app.decorate('io', { to: () => ({ emit() {} }), emit() {} } as never);
  await app.register(jsonPayloadGuardPlugin, { limits: DEFAULT_JSON_PAYLOAD_LIMITS });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.ready();
  return app;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor 逾時');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('命中規則的新留言建立處理中紀錄', () => {
  test('FB 留言命中規則', async () => {
    const { fb, tenant } = await setup();
    const app = await webhookApp();
    try {
      const payload = fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: uid('U'), name: '王小明' } }]);
      const { raw, headers } = signed(payload, PLATFORM_APP_SECRET);
      const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers, payload: raw });
      assert.equal(res.statusCode, 200);
      const logs = await waitFor(async () => {
        const l = await logsOf(fb.id);
        return l.length ? l : null;
      });
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.status, 'PENDING');
      const outbox = await owner.outbox.findMany({ where: { tenantId: tenant.id, queueName: 'comment-reply' } });
      assert.equal(outbox.length, 1);
      assert.deepEqual(Object.keys(outbox[0]!.payload as object).sort(), ['logId', 'tenantId']);
    } finally {
      await app.close();
    }
  });

  test('舊模式渠道網址', async () => {
    const secret = uid('own-secret-');
    const { fb } = await setup({ channelMode: 'own_app', appSecret: secret });
    await postToChannel(fb, fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: uid('U'), name: 'A' } }]), secret);
    const logs = await logsOf(fb.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.status, 'PENDING');
    assert.equal(jobs.length, 1);
  });

  test('IG 留言命中規則', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const secret = uid('ig-secret-');
    const ig = await fx.igChannel(tenant.id, { mode: 'own_app', appSecret: secret });
    await createRule(tenant.id, ig.id, { keywords: ['+1'] });
    await postToChannel(ig, igCommentPayload([{ accountId: ig.externalAccountId, commentId: uid('igc'), from: { id: uid('IGSID'), username: 'amy' }, text: '+1' }]), secret);
    const logs = await logsOf(ig.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.status, 'PENDING');
    assert.equal(logs[0]!.createdAtSource, 'notification');
  });
});

describe('不處理的留言不留紀錄', () => {
  test('沒命中規則', async () => {
    const { fb } = await setup();
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), message: '請問營業時間' }]));
    assert.equal((await logsOf(fb.id)).length, 0);
  });

  test('粉專自己的留言', async () => {
    const { fb } = await setup();
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: fb.externalAccountId, name: '粉專' } }]));
    await drainJobs();
    assert.equal((await logsOf(fb.id)).length, 0);
    assert.equal(graph.recorded.length, 0);
  });

  test('方案不含留言自動私訊', async () => {
    const { fb } = await setup({ plan: { features: ['inbox', 'core'] } });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    await drainJobs();
    assert.equal((await logsOf(fb.id)).length, 0);
    assert.equal(graph.recorded.length, 0);
  });

  test('租戶沒有方案', async () => {
    const { fb } = await setup({ plan: null });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    const logs = await logsOf(fb.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.status, 'PENDING');
  });

  test('簽章錯誤', async () => {
    const { fb } = await setup();
    await assert.rejects(
      postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]), { badSignature: true }),
      /Invalid webhook signature/,
    );
    assert.equal((await logsOf(fb.id)).length, 0);
  });

  test('渠道停用', async () => {
    const { fb } = await setup();
    await owner.channel.update({ where: { id: fb.id }, data: { isActive: false } });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 0);
  });

  test('租戶停用', async () => {
    const { fb, tenant } = await setup();
    await owner.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 0);
  });

  test('下游轉發 immediate 模式時留言也不處理', async () => {
    const secret = uid('own-secret-');
    const { fb } = await setup({ channelMode: 'own_app', appSecret: secret });
    await owner.channel.update({
      where: { id: fb.id },
      data: { settings: { downstreamWebhook: { enabled: true, url: 'https://downstream.invalid/hook', mode: 'immediate' } } },
    });
    await postToChannel(fb, fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]), secret);
    assert.equal((await logsOf(fb.id)).length, 0);
  });

  test('沒有啟用規則的渠道不寫資料', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const fb = await fx.fbChannel(tenant.id);
    await createRule(tenant.id, fb.id, { isActive: false });
    const contactsBefore = await owner.contact.count({ where: { tenantId: tenant.id } });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 0);
    assert.equal(await owner.contact.count({ where: { tenantId: tenant.id } }), contactsBefore);
    assert.equal(await owner.commentAuthor.count({ where: { tenantId: tenant.id } }), 0);
  });

  test('緊急停止後的留言', async () => {
    const { fb } = await setup();
    await setPlatformSetting('emergencyStop', { stopped: true, reason: '測試' });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 0);
  });

  test('緊急停止不影響私訊', async () => {
    const { fb } = await setup();
    await setPlatformSetting('emergencyStop', { stopped: true });
    graph.on('GET', 'graph.facebook.com', /.*/, { status: 400, body: { error: { message: 'offline', code: 100 } } });
    const psid = uid('PSID');
    await postToPlatform(fbMessagePayload([{ pageId: fb.externalAccountId, psid, text: '你好' }]));
    const identity = await owner.channelIdentity.findFirst({ where: { channelId: fb.id, uid: psid } });
    assert.ok(identity);
    assert.equal(await owner.conversation.count({ where: { channelId: fb.id, contactId: identity.contactId } }), 1);
  });

  test('平台關閉 FB 私訊能力時不收件', async () => {
    const { fb } = await setup();
    await setPlatformSetting('capabilities', { fbPrivateReply: false, igPrivateReply: true });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 0);
  });
});

describe('留言事件依帳號分派到所屬租戶', () => {
  test('一個請求帶兩個租戶的留言', async () => {
    const a = await setup();
    const b = await setup();
    await postToPlatform(
      fbComments([
        { pageId: a.fb.externalAccountId, commentId: uid('ca'), from: { id: uid('UA'), name: 'A' } },
        { pageId: b.fb.externalAccountId, commentId: uid('cb'), from: { id: uid('UB'), name: 'B' } },
      ]),
    );
    assert.equal((await logsOf(a.fb.id)).length, 1);
    assert.equal((await logsOf(b.fb.id)).length, 1);
    const seenByB = await withTenant(tenantDb, b.tenant.id, (tx) => tx.commentReplyLog.count({ where: { channelId: a.fb.id } }));
    assert.equal(seenByB, 0);
  });

  test('回呼網址與粉專屬於不同租戶', async () => {
    const secret = uid('shared-app-');
    const a = await setup({ channelMode: 'own_app', appSecret: secret });
    const b = await setup({ channelMode: 'own_app', appSecret: secret });
    await postToChannel(a.fb, fbComments([{ pageId: b.fb.externalAccountId, commentId: uid('c') }]), secret);
    assert.equal((await logsOf(b.fb.id)).length, 1);
    assert.equal((await logsOf(a.fb.id)).length, 0);
    assert.equal(await owner.commentReplyLog.count({ where: { tenantId: a.tenant.id } }), 0);
  });
});

describe('留言處理失敗不影響私訊', () => {
  test('同一請求有私訊與留言', async () => {
    const { fb } = await setup();
    graph.on('GET', 'graph.facebook.com', /.*/, { status: 400, body: { error: { message: 'offline', code: 100 } } });
    const psid = uid('PSID');
    const comment = fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]);
    const dm = fbMessagePayload([{ pageId: fb.externalAccountId, psid, text: '你好' }]);
    const mixed = { object: 'page', entry: [{ ...dm.entry[0], changes: comment.entry[0]!.changes }] };
    await postToPlatform(mixed);
    assert.ok(await owner.channelIdentity.findFirst({ where: { channelId: fb.id, uid: psid } }));
    assert.equal((await logsOf(fb.id)).length, 1);
  });

  test('留言收件丟錯', async () => {
    const { fb } = await setup();
    graph.on('GET', 'graph.facebook.com', /.*/, { status: 400, body: { error: { message: 'offline', code: 100 } } });
    // 租戶連線壞掉：讀規則時丟錯
    const broken = new PrismaClient({ datasources: { db: { url: urls.tenant.replace(/:[^:@/]+@/, ':wrong-password@') } } });
    const { processPlatformMetaWebhook } = await import('#src/modules/webhook/webhook.service.js');
    const psid = uid('PSID');
    const comment = fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]);
    const dm = fbMessagePayload([{ pageId: fb.externalAccountId, psid, text: '你好' }]);
    const mixed = { object: 'page', entry: [{ ...dm.entry[0], changes: comment.entry[0]!.changes }] };
    const { raw, headers } = signed(mixed, PLATFORM_APP_SECRET);
    try {
      await processPlatformMetaWebhook(adminDb, { to: () => ({ emit() {} }), emit() {} } as never, raw, headers, { tenantPrisma: broken, redis });
    } finally {
      await broken.$disconnect();
    }
    assert.ok(await owner.channelIdentity.findFirst({ where: { channelId: fb.id, uid: psid } }), '私訊仍落地');
    const ch = await owner.channel.findUnique({ where: { id: fb.id }, select: { settings: true } });
    assert.equal((ch!.settings as any).webhookRouting?.reason, 'comment_intake_failed');
    assert.equal((await logsOf(fb.id)).length, 0);
  });
});

describe('同一則留言只建立一筆紀錄', () => {
  test('同一個請求重送三次', async () => {
    const { fb } = await setup();
    okSend();
    const payload = fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: uid('U'), name: 'A' } }]);
    for (let i = 0; i < 3; i++) await postToPlatform(payload);
    assert.equal(jobs.length, 1, '只排入一個送出工作');
    await drainJobs();
    assert.equal((await logsOf(fb.id)).length, 1);
    assert.equal(graph.calls('POST', '/v21.0/me/messages').length, 1);
  });

  test('兩個入口並行', async () => {
    // 自備 App 的渠道沿用平台 App 當自己的 App：/webhooks/meta 與渠道網址都會收到同一則留言
    const { fb } = await setup({ channelMode: 'own_app', appSecret: PLATFORM_APP_SECRET });
    okSend();
    const payload = fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: uid('U'), name: 'A' } }]);
    await Promise.all([postToPlatform(payload), postToChannel(fb, payload, PLATFORM_APP_SECRET), postToPlatform(payload)]);
    assert.equal(jobs.length, 1, '只排入一個送出工作');
    await drainJobs();
    assert.equal((await logsOf(fb.id)).length, 1);
    assert.equal(graph.calls('POST', '/v21.0/me/messages').length, 1);
    assert.equal(await owner.commentAuthor.count({ where: { channelId: fb.id } }), 1);
  });
});

describe('留言被刪除時清除內容', () => {
  test('顧客刪除留言', async () => {
    const { fb } = await setup();
    const commentId = uid('c');
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId, from: { id: uid('U'), name: 'A' } }]));
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId, verb: 'remove', from: null, message: '' }]));
    const logs = await logsOf(fb.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.commentText, null);
    assert.ok(logs[0]!.commentDeletedAt);
  });
});

describe('留言處理不把個資寫進工作與日誌', () => {
  test('日誌不含留言內容', async () => {
    const { fb, rule } = await setup();
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { keywords: ['領券'], messageText: '專屬私訊文字 XYZ987' } });
    okSend();
    const captured: string[] = [];
    const capture = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(logger, m).mockImplementation(capture as never));
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(capture));
    try {
      await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), from: { id: uid('U'), name: '陳秘密' }, message: '0912345678 我要領券' }]));
      await drainJobs();
    } finally {
      for (const s of [...spies, ...consoleSpies]) s.mockRestore();
    }
    assert.equal((await logsOf(fb.id))[0]!.status, 'SENT');
    const all = captured.join('\n');
    assert.ok(captured.length > 0, '有擷取到日誌');
    assert.ok(!all.includes('0912345678'));
    assert.ok(!all.includes('陳秘密'));
    assert.ok(!all.includes('XYZ987'));
    assert.deepEqual(Object.keys(jobs[0]!.row.payload as object).sort(), ['logId', 'tenantId']);
  });
});

describe('大量 feed 事件', () => {
  test('1,000 筆 feed changes 不超過 payload 上限且回應時間不因留言變長', async () => {
    const { fb } = await setup();
    const app = await webhookApp();
    try {
      const changes = Array.from({ length: 1000 }, (_, i) => ({
        field: 'feed',
        value: { item: 'reaction', verb: 'add', post_id: `${fb.externalAccountId}_1`, reaction_type: 'like', from: { id: `R${i}` } },
      }));
      const payload = { object: 'page', entry: [{ id: fb.externalAccountId, time: Date.now(), changes }] };
      const { raw, headers } = signed(payload, PLATFORM_APP_SECRET);
      const started = performance.now();
      const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers, payload: raw });
      const elapsed = performance.now() - started;
      assert.equal(res.statusCode, 200);
      assert.ok(elapsed < 1000, `回應花了 ${elapsed}ms`);
    } finally {
      await app.close();
    }
    assert.equal((await logsOf(fb.id)).length, 0);
  });
});

describe('指定貼文與規則順序（tasks 4.2）', () => {
  test('手動輸入的貼文 ID 命中 webhook 留言', async () => {
    const { tenant, fb, rule } = await setup();
    const ext = getChannelPlugin('FB')!.extensions!.comments!;
    const postId = ext.parsePostReference('987654321', { accountId: fb.externalAccountId });
    assert.ok(postId);
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { postScope: 'selected', postIds: [postId] } });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), postId: `${fb.externalAccountId}_987654321` }]));
    assert.equal((await logsOf(fb.id)).length, 1);
    void tenant;
  });

  test('從最近貼文挑選的 ID 命中 webhook 留言', async () => {
    const { fb, rule } = await setup();
    const ext = getChannelPlugin('FB')!.extensions!.comments!;
    graph.on('GET', 'graph.facebook.com', new RegExp(`/v21.0/${fb.externalAccountId}/published_posts`), {
      body: { data: [{ id: `${fb.externalAccountId}_555`, message: '新品', created_time: '2026-11-01T00:00:00+0000' }] },
    });
    const { posts } = await ext.listRecentPosts(fb.credentials);
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { postScope: 'selected', postIds: [posts[0]!.postId] } });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), postId: `${fb.externalAccountId}_555` }]));
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c'), postId: `${fb.externalAccountId}_556` }]));
    assert.equal((await logsOf(fb.id)).length, 1);
  });

  test('刪除後不再命中', async () => {
    const { fb, rule } = await setup();
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 1);
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { deletedAt: new Date() } });
    await bumpCommentReplyRulesVersion(redis, fb.id);
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id)).length, 1);
  });

  test('兩條規則都命中', async () => {
    const { tenant, fb, rule } = await setup();
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { priority: 1 } });
    const first = await createRule(tenant.id, fb.id, { keywords: ['+1'], priority: 0 });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    const logs = await logsOf(fb.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.ruleId, first.id);
  });

  test('調整順序後套用新的第一條', async () => {
    const { tenant, fb, rule } = await setup();
    const second = await createRule(tenant.id, fb.id, { keywords: ['+1'], priority: 1 });
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    assert.equal((await logsOf(fb.id))[0]!.ruleId, rule.id);
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { priority: 1 } });
    await owner.commentReplyRule.update({ where: { id: second.id }, data: { priority: 0 } });
    await bumpCommentReplyRulesVersion(redis, fb.id);
    await postToPlatform(fbComments([{ pageId: fb.externalAccountId, commentId: uid('c') }]));
    const logs = await logsOf(fb.id);
    assert.equal(logs[1]!.ruleId, second.id);
    await clearRateBuckets([fb.id]);
  });
});
