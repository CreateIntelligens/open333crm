/**
 * 留言私訊的背景送出（change add-comment-keyword-private-reply tasks 5.3；spec comment-private-reply
 * 「背景送出私訊」「私訊內容的渲染」「送出前重新檢查」「超過 7 天的留言不送出」「重複執行的工作不重複私訊」
 * 「私訊失敗的原因與可否重試」「網路錯誤自動重試」「Meta 限流時排隊而不是失敗」「公開回覆留言」）。
 *
 * 留言經真的 webhook 入口收件，job 以 index.ts 同一個工廠處理（createCommentReplyProcessor(createCommentReplyJobRunner())）；
 * 真的 FB／IG 外掛，Graph API 由 fake-meta-graph 攔下；限流 bucket 用真的 Redis（Lua）。
 */
import {
  cleanupCommentReplyData,
  clearRateBuckets,
  createRule,
  disconnectAll,
  drainJobs,
  enableAllCapabilities,
  jobs,
  jobsForLog,
  owner,
  postToChannel,
  postToPlatform,
  resetHarness,
  resetPlatformSettings,
  runJobOnce,
  setPlatformSetting,
  redis,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload, igCommentPayload } from '#tests/support/meta-webhook.js';
import { createCommentReplyJobRunner, createCommentReplyProcessor } from '#src/modules/comment-reply/comment-reply.worker.js';

process.env.WEB_BASE_URL ??= 'https://crm.example.com';

const fx = createCommentReplyFixtures(owner);
const graph = useFakeMetaGraph();
let seq = 0;
const uid = (p: string) => `${p}${Date.now()}${++seq}`;
const nowSec = () => Math.floor(Date.now() / 1000);
const FB_SEND = '/v21.0/me/messages';
const graphError = (code: number, extra: Record<string, unknown> = {}) => ({ status: 400, body: { error: { message: `meta error ${code}`, type: 'OAuthException', code, fbtrace_id: 'TRACE', ...extra } } });

beforeEach(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

async function setupFb(options: { rule?: Parameters<typeof createRule>[2]; plan?: { features: string[]; limits?: Record<string, number | null> } } = {}) {
  const tenant = await fx.tenant({ plan: options.plan ?? { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  const rule = await createRule(tenant.id, fb.id, { keywords: ['+1'], messageText: '感謝留言，活動連結在這裡', ...options.rule });
  await clearRateBuckets([fb.id]);
  return { tenant, fb, rule };
}

/** 經真的 webhook 收一則留言，回傳紀錄 */
async function comment(fb: { id: string; externalAccountId: string }, input: { from?: { id: string; name?: string }; message?: string; createdTime?: number; commentId?: string } = {}) {
  const commentId = input.commentId ?? uid('c');
  await postToPlatform(
    fbCommentPayload([{ pageId: fb.externalAccountId, commentId, from: input.from ?? { id: uid('U'), name: '王小明' }, message: input.message ?? '+1', createdTime: input.createdTime ?? nowSec() }]),
  );
  const log = await owner.commentReplyLog.findFirst({ where: { channelId: fb.id, commentId } });
  assert.ok(log, '留言已收件');
  return log;
}

const reload = (id: string) => owner.commentReplyLog.findUniqueOrThrow({ where: { id } });

function okFb(recipientId = 'PSID-1') {
  graph.on('POST', 'graph.facebook.com', FB_SEND, { body: { recipient_id: recipientId, message_id: uid('m_') } });
}

describe('背景送出私訊', () => {
  test('FB 文字規則送出成功', async () => {
    const { fb } = await setupFb();
    okFb('PSID-ok');
    const log = await comment(fb);
    await drainJobs();
    const calls = graph.calls('POST', FB_SEND);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.body!.recipient, { comment_id: log.commentId });
    assert.equal(calls[0]!.body!.recipient.id, undefined);
    assert.equal(calls[0]!.body!.message.text, '感謝留言，活動連結在這裡');
    const after = await reload(log.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.recipientUid, 'PSID-ok');
    assert.ok(after.sentAt);
    assert.ok(after.sentMessageId);
    assert.ok(after.sentContentSnapshot);
    // 成功時沒有呼叫 getProfile
    assert.equal(graph.calls('GET').length, 0);
  });

  test('IG 文字規則送出成功', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const secret = uid('ig-');
    const ig = await fx.igChannel(tenant.id, { mode: 'own_app', appSecret: secret });
    await createRule(tenant.id, ig.id, { keywords: ['+1'], messageText: 'IG 私訊' });
    graph.on('POST', 'graph.instagram.com', FB_SEND, { body: { recipient_id: 'IGSID-ok', message_id: uid('ig_') } });
    const commentId = uid('igc');
    await postToChannel(ig, igCommentPayload([{ accountId: ig.externalAccountId, commentId, from: { id: uid('IGSID'), username: 'amy' }, text: '+1', time: Date.now() }]), secret);
    await drainJobs();
    const calls = graph.calls('POST', FB_SEND, 'graph.instagram.com');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body!.recipient.comment_id, commentId);
    const log = await owner.commentReplyLog.findFirstOrThrow({ where: { channelId: ig.id } });
    assert.equal(log.status, 'SENT');
  });

  test('Meta 呼叫不在交易內', async () => {
    const { fb } = await setupFb();
    let seen: { status: string; sendAttemptedAt: Date | null } | null = null;
    const log = await comment(fb);
    graph.on('POST', 'graph.facebook.com', FB_SEND, async () => {
      seen = await owner.commentReplyLog.findUniqueOrThrow({ where: { id: log.id }, select: { status: true, sendAttemptedAt: true } });
      return { body: { recipient_id: 'PSID-tx', message_id: 'm-tx' } };
    });
    await drainJobs();
    assert.ok(seen);
    assert.equal(seen!.status, 'SENDING');
    assert.ok(seen!.sendAttemptedAt);
  });
});

describe('私訊內容的渲染', () => {
  test('素材含留言者名稱與變數', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const fb = await fx.fbChannel(tenant.id);
    const material = await owner.material.create({
      data: {
        tenantId: tenant.id,
        name: '春季活動',
        channelType: 'fb',
        contentType: 'fb_text',
        body: { text: '{commenter.name} 你好，{{coupon_name}}{{no_default}}' },
        variables: [{ key: 'coupon_name', defaultValue: '春季券' }, { key: 'no_default' }],
      },
    });
    await createRule(tenant.id, fb.id, { keywords: ['+1'], contentType: 'material', materialId: material.id });
    okFb();
    await comment(fb, { from: { id: uid('U'), name: '林小美' } });
    await drainJobs();
    const text = graph.calls('POST', FB_SEND)[0]!.body!.message.text as string;
    assert.equal(text, '林小美 你好，春季券');
    assert.ok(!text.includes('{{') && !text.includes('}}'));
  });

  test('FB 素材規則站內路徑換公開網址', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const fb = await fx.fbChannel(tenant.id);
    const material = await owner.material.create({
      data: { tenantId: tenant.id, name: '圖片', channelType: 'fb', contentType: 'fb_image', body: { url: '/material-samples/a.png' } },
    });
    await createRule(tenant.id, fb.id, { keywords: ['+1'], contentType: 'material', materialId: material.id });
    okFb();
    await comment(fb);
    await drainJobs();
    const url = graph.calls('POST', FB_SEND)[0]!.body!.message.attachment.payload.url as string;
    assert.match(url, /^https:\/\/.+\/material-samples\/a\.png$/);
  });
});

describe('送出前重新檢查', () => {
  test('排隊期間規則被停用', async () => {
    const { fb, rule } = await setupFb();
    const log = await comment(fb);
    await owner.commentReplyRule.update({ where: { id: rule.id }, data: { isActive: false } });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    const after = await reload(log.id);
    assert.equal(after.status, 'SKIPPED');
    assert.equal(after.reasonCode, 'RULE_INACTIVE');
  });

  test('排隊期間方案移除功能', async () => {
    const { fb, tenant } = await setupFb();
    const log = await comment(fb);
    await owner.plan.update({ where: { id: tenant.plan!.id }, data: { features: ['inbox'] } });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    const after = await reload(log.id);
    assert.equal(after.status, 'SKIPPED');
    assert.equal(after.reasonCode, 'PLAN_FEATURE_DISABLED');
  });

  // 05-qa §3.3 整合缺口：單元測試的「渠道停用」「租戶停用」略過分支，經真入口收件後由真 runner 走過
  test('排隊期間渠道停用', async () => {
    const { fb } = await setupFb();
    const log = await comment(fb);
    await owner.channel.update({ where: { id: fb.id }, data: { isActive: false } });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    const after = await reload(log.id);
    assert.equal(after.status, 'SKIPPED');
    assert.equal(after.reasonCode, 'CHANNEL_INACTIVE');
  });

  test('排隊期間租戶停用', async () => {
    const { fb, tenant } = await setupFb();
    const log = await comment(fb);
    await owner.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    const after = await reload(log.id);
    assert.equal(after.status, 'SKIPPED');
    assert.equal(after.reasonCode, 'TENANT_DISABLED');
  });

  test('排隊期間素材被停用', async () => {
    const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
    const fb = await fx.fbChannel(tenant.id);
    const material = await owner.material.create({ data: { tenantId: tenant.id, name: 'm', channelType: 'fb', contentType: 'fb_text', body: { text: 'hi' } } });
    await createRule(tenant.id, fb.id, { keywords: ['+1'], contentType: 'material', materialId: material.id });
    const log = await comment(fb);
    await owner.material.update({ where: { id: material.id }, data: { isActive: false } });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    assert.equal((await reload(log.id)).reasonCode, 'MATERIAL_UNAVAILABLE');
  });

  test('緊急停止時已排隊的工作', async () => {
    const { fb } = await setupFb();
    const log = await comment(fb);
    await setPlatformSetting('emergencyStop', { stopped: true });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    assert.equal((await reload(log.id)).reasonCode, 'EMERGENCY_STOPPED');
  });

  test('關閉私訊能力後的排隊工作', async () => {
    const { fb } = await setupFb();
    const log = await comment(fb);
    await setPlatformSetting('capabilities', { fbPrivateReply: false });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    assert.equal((await reload(log.id)).reasonCode, 'CAPABILITY_DISABLED');
  });
});

describe('超過 7 天的留言不送出', () => {
  test('7 天前的留言', async () => {
    const { fb } = await setupFb();
    const log = await comment(fb, { createdTime: nowSec() - 7 * 86400 - 60 });
    await drainJobs();
    assert.equal(graph.calls('POST', FB_SEND).length, 0);
    const after = await reload(log.id);
    assert.equal(after.status, 'EXPIRED');
    assert.equal(after.reasonCode, 'WINDOW_EXPIRED');
  });

  test('Unix 秒的留言時間', async () => {
    const { fb } = await setupFb();
    const log = await comment(fb, { createdTime: 1731470000 });
    assert.equal(log.commentCreatedAt.toISOString().slice(0, 10), '2024-11-13');
  });
});

describe('重複執行的工作不重複私訊', () => {
  test('同一筆紀錄的工作執行兩次', async () => {
    const { fb } = await setupFb();
    okFb();
    const log = await comment(fb);
    const [job] = jobsForLog(log.id);
    // 兩次執行同時開始：每個交易提交後延遲 100ms，兩邊都先讀到 PENDING 再搶認領（只有認領的條件更新能擋下第二次）
    const slow = new Proxy(tenantDb, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return async (...args: unknown[]) => {
            const r = await (target.$transaction as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            await new Promise((res) => setTimeout(res, 100));
            return r;
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const processor = createCommentReplyProcessor(createCommentReplyJobRunner({ prisma: slow, redis }));
    const fakeJob = () => ({ data: job!.row.payload, attemptsMade: 0, opts: { attempts: 5 }, moveToDelayed: async () => {} });
    await Promise.all([processor(fakeJob()), processor(fakeJob())]);
    await runJobOnce({ ...job!, state: 'pending' });
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
    assert.equal((await reload(log.id)).status, 'SENT');
  });

  test('送出後寫結果前中斷', async () => {
    const { fb } = await setupFb();
    const log = await comment(fb);
    // Meta 已送達、寫結果前行程中斷：紀錄停在 SENDING，3 分鐘前開始送
    await owner.commentReplyLog.update({ where: { id: log.id }, data: { status: 'SENDING', sendAttemptedAt: new Date(Date.now() - 3 * 60_000), quotaMonth: '2026-11' } });
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(10900));
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.reasonCode, 'SENT_UNCONFIRMED');
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
  });
});

describe('私訊失敗的原因與可否重試', () => {
  // 05-qa §3.3 整合缺口：「已私訊過」在非復原時是 FAILED（不是 SENT_UNCONFIRMED）、Meta 回期限已過是 EXPIRED
  test('第一次送出就回已私訊過', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(10900));
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'FAILED');
    assert.equal(after.reasonCode, 'ALREADY_REPLIED');
    assert.equal(after.metaErrorCode, 10900);
    assert.equal(jobsForLog(log.id)[0]!.state, 'completed', '業務失敗不讓 BullMQ 重試');
  });

  test('Meta 回超過可私訊的期限', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(10903));
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'EXPIRED');
    assert.equal(after.reasonCode, 'EXPIRED_BY_META');
    assert.equal(jobsForLog(log.id)[0]!.state, 'completed');
  });

  test('權杖失效', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(190, { error_subcode: 463 }));
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'FAILED');
    assert.equal(after.reasonCode, 'TOKEN_EXPIRED');
    assert.equal(after.metaErrorCode, 190);
    assert.equal(jobsForLog(log.id)[0]!.state, 'completed');
  });

  test('使用者無法接收', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(551));
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.reasonCode, 'USER_UNAVAILABLE');
    assert.equal(jobsForLog(log.id)[0]!.state, 'completed', '業務失敗：job 正常完成、沒有進 failed set');
  });

  test('測試階段的權限錯誤', async () => {
    const { fb } = await setupFb();
    await setPlatformSetting('testPhase', { fb: true, ig: true });
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(10));
    const log = await comment(fb);
    await drainJobs();
    assert.equal((await reload(log.id)).reasonCode, 'APP_NOT_APPROVED');
  });

  test('未對照的錯誤', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(12345));
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.reasonCode, 'UNKNOWN');
    assert.equal(after.reasonMessage, 'meta error 12345');
  });

  test('測試階段不擋送出', async () => {
    const { fb } = await setupFb();
    await setPlatformSetting('testPhase', { fb: true, ig: true });
    okFb();
    const log = await comment(fb);
    await drainJobs();
    assert.equal((await reload(log.id)).status, 'SENT');
  });
});

describe('網路錯誤自動重試', () => {
  test('第一次網路錯誤第二次成功', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, { throwError: 'ECONNRESET' }, { body: { recipient_id: 'PSID-2', message_id: 'm-2' } });
    const log = await comment(fb);
    await drainJobs();
    assert.equal((await reload(log.id)).status, 'SENT');
    assert.equal(await owner.commentReplyLog.count({ where: { channelId: fb.id } }), 1);
    assert.equal(jobsForLog(log.id)[0]!.attemptsMade, 1);
  });

  test('一直回 500', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, { status: 500, body: { error: { message: 'server error' } } });
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'FAILED');
    assert.equal(after.reasonCode, 'NETWORK');
    assert.equal(graph.calls('POST', FB_SEND).length, 5);
    assert.equal(jobsForLog(log.id)[0]!.state, 'completed', '最後一次記 FAILED 後 job 正常完成');
  });
});

describe('Meta 限流時排隊而不是失敗', () => {
  test('本小時額度用完', async () => {
    const { fb } = await setupFb();
    await setPlatformSetting('rateLimits', { fbPerHour: 12, igPerHour: 12, publicReplyPerHour: 300 }); // 容量 1
    okFb();
    const first = await comment(fb);
    const second = await comment(fb);
    await drainJobs();
    assert.equal((await reload(first.id)).status, 'SENT');
    const queued = await reload(second.id);
    assert.equal(queued.status, 'PENDING');
    assert.equal(queued.reasonCode, 'RATE_LIMIT_QUEUED');
    assert.ok(queued.nextAttemptAt);
    const job = jobsForLog(second.id)[0]!;
    assert.ok(job.delayedUntil && job.delayedUntil > Date.now());
    assert.equal(job.attemptsMade, 0, '重試次數沒有增加');
    assert.equal(graph.calls('POST', FB_SEND).length, 1);
  });

  test('另一個渠道不受影響', async () => {
    await setPlatformSetting('rateLimits', { fbPerHour: 12, igPerHour: 12, publicReplyPerHour: 300 });
    const a = await setupFb();
    const b = await setupFb();
    okFb();
    await comment(a.fb);
    const queued = await comment(a.fb);
    const other = await comment(b.fb);
    await drainJobs();
    assert.equal((await reload(queued.id)).status, 'PENDING');
    assert.equal((await reload(other.id)).status, 'SENT');
  });

  test('Meta 回限流一次', async () => {
    const { fb } = await setupFb();
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(613), { body: { recipient_id: 'PSID-3', message_id: 'm-3' } });
    const log = await comment(fb);
    await drainJobs();
    assert.equal((await reload(log.id)).status, 'PENDING');
    await clearRateBuckets([fb.id]);
    await drainJobs({ includeDelayed: true });
    assert.equal((await reload(log.id)).status, 'SENT');
    assert.notEqual(jobsForLog(log.id)[0]!.state, 'failed');
  });
});

describe('公開回覆留言', () => {
  const PUBLIC_REPLY = /\/v21\.0\/.+\/comments$/;

  test('私訊成功後公開回覆', async () => {
    const { fb } = await setupFb({ rule: { publicReplyEnabled: true, publicReplyTexts: ['已私訊你', '請看私訊'] } });
    okFb();
    graph.on('POST', 'graph.facebook.com', PUBLIC_REPLY, { body: { id: 'REPLY-1' } });
    const log = await comment(fb);
    await drainJobs();
    const replies = graph.calls('POST', PUBLIC_REPLY);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]!.path, `/v21.0/${log.commentId}/comments`);
    assert.ok(['已私訊你', '請看私訊'].includes(replies[0]!.body!.message));
    const after = await reload(log.id);
    assert.equal(after.publicReplyStatus, 'SENT');
    assert.equal(after.publicReplyCommentId, 'REPLY-1');
  });

  test('私訊失敗不公開回覆', async () => {
    const { fb } = await setupFb({ rule: { publicReplyEnabled: true, publicReplyTexts: ['已私訊你'] } });
    graph.on('POST', 'graph.facebook.com', FB_SEND, graphError(551));
    const log = await comment(fb);
    await drainJobs();
    assert.equal(graph.calls('POST', PUBLIC_REPLY).length, 0);
    assert.equal((await reload(log.id)).publicReplyStatus, 'SKIPPED');
  });

  test('公開回覆缺權限', async () => {
    const { fb } = await setupFb({ rule: { publicReplyEnabled: true, publicReplyTexts: ['已私訊你'] } });
    okFb();
    graph.on('POST', 'graph.facebook.com', PUBLIC_REPLY, graphError(200));
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.publicReplyStatus, 'FAILED');
    assert.equal(after.publicReplyReasonCode, 'PERMISSION_MISSING');
  });

  test('公開回覆額度用完', async () => {
    const { fb } = await setupFb({ rule: { publicReplyEnabled: true, publicReplyTexts: ['已私訊你'] } });
    okFb();
    await redis.set(`cr:rate:pr:${fb.id}:paused`, String(Date.now() + 3_600_000), 'PX', 3_600_000);
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.publicReplyStatus, 'SKIPPED');
    assert.equal(after.publicReplyReasonCode, 'RATE_LIMITED');
    assert.equal(graph.calls('POST', PUBLIC_REPLY).length, 0);
  });

  test('關閉公開回覆能力後送出', async () => {
    const { fb } = await setupFb({ rule: { publicReplyEnabled: true, publicReplyTexts: ['已私訊你'] } });
    await setPlatformSetting('capabilities', { fbPrivateReply: true, fbPublicReply: false });
    okFb();
    const log = await comment(fb);
    await drainJobs();
    const after = await reload(log.id);
    assert.equal(after.status, 'SENT');
    assert.equal(after.publicReplyStatus, 'SKIPPED');
    assert.equal(after.publicReplyReasonCode, 'CAPABILITY_DISABLED');
  });
});

void jobs;
