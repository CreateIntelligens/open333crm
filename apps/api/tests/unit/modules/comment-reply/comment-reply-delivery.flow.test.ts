/**
 * 留言私訊消費者的分支（change add-comment-keyword-private-reply tasks 5.1；design「資料流」步驟 0～6、D9～D14）。
 *
 * mock executor：只實作消費者會呼叫的 model 方法，紀錄以記憶體中的一筆列模擬狀態機（條件更新照 where.status 判斷）。
 * 外掛換成替身。每一個分支都另有 feature 情境走過真的入口（planning/05-qa.md §3.3），這裡只釘住分支與步驟順序。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'vitest';
import { deliverCommentReply, META_RATE_LIMIT_MAX_HITS } from '#src/modules/comment-reply/comment-reply-delivery.flow.js';
import { clearCommentReplyPlatformSettingsCache as invalidateCommentReplyPlatformSettings } from '#src/modules/comment-reply/comment-reply-platform-settings.js';
import { createCommentReplyProcessor } from '#src/modules/comment-reply/comment-reply.worker.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import type { ChannelPlugin, CommentSendResult, MetaErrorInfo } from '@open333crm/channel-plugins';
import type { RateGate } from '#src/modules/comment-reply/comment-reply-rate-gate.js';
import { DelayedError } from 'bullmq';

process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'unit-test-credential-encryption-key-32chars!';
/** 能力開關 6 個鍵都要在（平台設定的型別），沒給的補 false */
const caps = (on: Record<string, boolean>) => ({
  fbPrivateReply: false, fbPostPicker: false, fbPublicReply: false, igPrivateReply: false, igPostPicker: false, igPublicReply: false, ...on,
});
const TENANT = 'a0000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-11-13T04:00:00Z');

type Row = Record<string, any>;

interface World {
  log: Row;
  rule: Row;
  channel: Row;
  material: Row | null;
  tenant: Row;
  settings: Record<string, unknown>;
  usage: { sentCount: number; publicReplyCount: number; limit: number | null };
  steps: string[];
  inTx: boolean;
}

let w: World;

function baseWorld(): World {
  return {
    log: {
      id: 'log-1',
      tenantId: TENANT,
      channelId: 'ch-1',
      ruleId: 'rule-1',
      commentAuthorId: 'author-1',
      commentId: 'c-1',
      commenterId: 'U1',
      commenterName: '王小明',
      commenterUsername: null,
      commentCreatedAt: new Date(NOW.getTime() - 3600_000),
      status: 'PENDING',
      reasonCode: null,
      dedupeKey: null,
      quotaMonth: null,
      sendAttemptedAt: null,
      metaRateLimitHits: 0,
      publicReplyStatus: 'NOT_CONFIGURED',
      publicReplyReasonCode: null,
      recipientUid: null,
      conversationId: null,
      attemptCount: 0,
    },
    rule: {
      id: 'rule-1',
      isActive: true,
      deletedAt: null,
      contentType: 'text',
      messageText: '{commenter.name} 你好',
      publicReplyEnabled: false,
      publicReplyTexts: [],
    },
    channel: { id: 'ch-1', channelType: 'FB', isActive: true, credentialsEncrypted: encryptCredentials({ pageAccessToken: 't', connectMode: 'platform' }), externalAccountId: 'P1' },
    material: null,
    tenant: { isActive: true, planId: 'plan-1', plan: { features: ['comment_reply'], limits: {} }, limitOverrides: {} },
    settings: {
      'commentReply.capabilities': caps({ fbPrivateReply: true, fbPublicReply: true, igPrivateReply: true, igPublicReply: true }),
      'commentReply.testPhase': { fb: false, ig: false },
    },
    usage: { sentCount: 0, publicReplyCount: 0, limit: null },
    steps: [],
    inTx: false,
  };
}

function statusMatches(cond: unknown, value: unknown): boolean {
  if (cond === undefined) return true;
  if (cond && typeof cond === 'object' && 'in' in (cond as object)) return ((cond as { in: unknown[] }).in).includes(value);
  return cond === value;
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + (v as { increment: number }).increment;
    else if (v !== undefined) row[k] = v;
  }
}

function sqlOf(strings: TemplateStringsArray | string[]): string {
  return Array.from(strings).join('?');
}

function tx() {
  return {
    commentReplyLog: {
      findFirst: async ({ where }: { where: Row }) => {
        if (where.dedupeKey) return null;
        if (where.id && where.id !== w.log.id) return null;
        return { ...w.log, rule: { ...w.rule, material: w.material }, channel: w.channel };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (where.id && where.id !== w.log.id) return { count: 0 };
        if (!statusMatches(where.status, w.log.status)) return { count: 0 };
        if (!statusMatches(where.publicReplyStatus, w.log.publicReplyStatus)) return { count: 0 };
        if (where.conversationId === null && w.log.conversationId !== null) return { count: 0 };
        applyData(w.log, data);
        w.steps.push(`update:${w.log.status}${data.reasonCode !== undefined ? `/${data.reasonCode}` : ''}`);
        return { count: 1 };
      },
    },
    platformSetting: { findMany: async () => Object.entries(w.settings).map(([key, value]) => ({ key, value })) },
    tenant: { findUnique: async () => w.tenant },
    planChangeRequest: { aggregate: async () => ({ _sum: { topupTokens: 0 } }) },
    commentAuthor: {
      findFirst: async () => ({ id: 'author-1', contactId: 'contact-1', createdContact: true, displayName: '王小明', username: null }),
      updateMany: async () => ({ count: 1 }),
    },
    channelIdentity: { findFirst: async () => null },
    contact: { findFirst: async () => ({ isArchived: false }) },
    message: { findFirst: async () => null },
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      if (sql.includes('GREATEST("sentCount" - 1')) w.usage.sentCount = Math.max(0, w.usage.sentCount - 1);
      return 1;
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      if (sql.includes('UPDATE comment_reply_usages')) {
        const limit = w.tenant.plan?.limits?.monthlyCommentReplies ?? null;
        if (limit !== null && w.usage.sentCount >= limit) return [];
        w.usage.sentCount += 1;
        return [{ sentCount: w.usage.sentCount }];
      }
      if (sql.includes('INSERT INTO channel_identities')) return [{ id: 'ci-1' }];
      return [];
    },
  };
}

const prisma = {
  platformSetting: { findMany: async () => Object.entries(w.settings).map(([key, value]) => ({ key, value })) },
  async $transaction(cb: (t: unknown) => Promise<unknown>) {
    w.inTx = true;
    try {
      const r = await cb(tx());
      w.steps.push('commit');
      return r;
    } catch (err) {
      w.steps.push('rollback');
      throw err;
    } finally {
      w.inTx = false;
    }
  },
} as never;

/** 外掛替身：依序回傳 responses；記錄呼叫時是否在交易內 */
function plugin(opts: { send?: CommentSendResult[]; reply?: Array<{ ok: true; replyId: string } | { ok: false; error: MetaErrorInfo }>; withComments?: boolean } = {}) {
  const sends = [...(opts.send ?? [{ ok: true, recipientId: 'PSID-1', messageId: 'm-1' }])];
  const replies = [...(opts.reply ?? [{ ok: true as const, replyId: 'r-1' }])];
  const calls = { send: [] as Array<{ commentId: string; payload: unknown; inTx: boolean }>, reply: 0 };
  const p = {
    channelType: 'FB',
    extensions:
      opts.withComments === false
        ? {}
        : {
            comments: {
              capabilities: { platform: 'fb', privateReplyContentTypes: ['text', 'fb_text'], publicReply: true, materialChannelType: 'fb', postLinkLabel: '' },
              sendPrivateReply: async (commentId: string, payload: unknown) => {
                calls.send.push({ commentId, payload, inTx: w.inTx });
                w.steps.push('meta:send');
                return sends.length > 1 ? sends.shift()! : sends[0]!;
              },
              replyToComment: async () => {
                calls.reply += 1;
                w.steps.push('meta:reply');
                return replies.length > 1 ? replies.shift()! : replies[0]!;
              },
            },
          },
  } as unknown as ChannelPlugin;
  return { p, calls };
}

function gate(opts: { pm?: boolean; pr?: boolean } = {}): RateGate & { paused: number[] } {
  const paused: number[] = [];
  return {
    paused,
    take: async (kind) => ((kind === 'pm' ? opts.pm : opts.pr) === false ? { ok: false, retryAfterMs: 5000 } : { ok: true }),
    pause: async (_k, _c, ms) => {
      paused.push(ms);
    },
  };
}

function run(p: ChannelPlugin, g: RateGate = gate(), attempt = { attemptsMade: 0, attempts: 5 }) {
  return deliverCommentReply({ prisma, rateGate: g, plugins: () => p, now: () => NOW }, TENANT, 'log-1', attempt);
}

const metaError = (reason: MetaErrorInfo['reason'], extra: Partial<MetaErrorInfo> = {}): CommentSendResult => ({
  ok: false,
  error: { message: `meta ${reason}`, reason, transient: reason === 'NETWORK' || reason === 'RATE_LIMITED', ...extra },
});

beforeEach(() => {
  w = baseWorld();
  invalidateCommentReplyPlatformSettings();
});

describe('送出前重新檢查：每一種 SKIPPED 原因', () => {
  const cases: Array<[string, () => void, string, string]> = [
    ['租戶停用', () => (w.tenant.isActive = false), 'SKIPPED', 'TENANT_DISABLED'],
    ['緊急停止', () => (w.settings['commentReply.emergencyStop'] = { stopped: true }), 'SKIPPED', 'EMERGENCY_STOPPED'],
    ['能力關閉', () => (w.settings['commentReply.capabilities'] = caps({ fbPrivateReply: false })), 'SKIPPED', 'CAPABILITY_DISABLED'],
    ['方案不含功能', () => (w.tenant.plan.features = ['inbox']), 'SKIPPED', 'PLAN_FEATURE_DISABLED'],
    ['渠道停用', () => (w.channel.isActive = false), 'SKIPPED', 'CHANNEL_INACTIVE'],
    ['規則停用', () => (w.rule.isActive = false), 'SKIPPED', 'RULE_INACTIVE'],
    ['規則刪除', () => (w.rule.deletedAt = new Date()), 'SKIPPED', 'RULE_INACTIVE'],
    ['素材停用', () => Object.assign(w.rule, { contentType: 'material' }, (w.material = { id: 'm', channelType: 'fb', contentType: 'fb_text', isActive: false, body: {}, variables: [] }) && {}), 'SKIPPED', 'MATERIAL_UNAVAILABLE'],
    ['素材刪除', () => Object.assign(w.rule, { contentType: 'material' }), 'SKIPPED', 'MATERIAL_UNAVAILABLE'],
    ['素材類型不支援', () => Object.assign(w.rule, { contentType: 'material' }, (w.material = { id: 'm', channelType: 'fb', contentType: 'fb_receipt', isActive: true, body: {}, variables: [] }) && {}), 'SKIPPED', 'MATERIAL_UNSUPPORTED'],
    ['7 天前的留言', () => (w.log.commentCreatedAt = new Date(NOW.getTime() - 7 * 86_400_000 - 60_000)), 'EXPIRED', 'WINDOW_EXPIRED'],
  ];
  for (const [name, arrange, status, reason] of cases) {
    test(name, async () => {
      arrange();
      const { p, calls } = plugin();
      const out = await run(p);
      assert.deepEqual(out, { kind: 'done', status, reasonCode: reason });
      assert.equal(w.log.status, status);
      assert.equal(w.log.reasonCode, reason);
      assert.equal(calls.send.length, 0);
    });
  }

  test('沒有留言擴充的渠道記 CHANNEL_INACTIVE', async () => {
    const { p, calls } = plugin({ withComments: false });
    assert.equal((await run(p)).kind, 'done');
    assert.equal(w.log.reasonCode, 'CHANNEL_INACTIVE');
    assert.equal(calls.send.length, 0);
  });
});

describe('Meta 呼叫不在交易內', () => {
  test('步驟順序：T1 認領提交 → 呼叫 Meta → T2 寫 SENT', async () => {
    const { p, calls } = plugin();
    const out = await run(p);
    assert.deepEqual(out, { kind: 'done', status: 'SENT' });
    assert.equal(calls.send.length, 1);
    assert.equal(calls.send[0]!.inTx, false);
    const sendIdx = w.steps.indexOf('meta:send');
    const claimIdx = w.steps.indexOf('update:SENDING/null');
    assert.ok(claimIdx >= 0 && claimIdx < sendIdx);
    assert.equal(w.steps[claimIdx + 1], 'commit');
    assert.ok(w.steps.indexOf('update:SENT/null') > sendIdx);
    assert.equal(w.log.recipientUid, 'PSID-1');
    assert.equal((calls.send[0]!.payload as any).content.text, '王小明 你好');
  });
});

describe('ALREADY_REPLIED', () => {
  test('非當機復原：FAILED、還名額', async () => {
    const { p } = plugin({ send: [metaError('ALREADY_REPLIED')] });
    assert.deepEqual(await run(p), { kind: 'done', status: 'FAILED', reasonCode: 'ALREADY_REPLIED' });
    assert.equal(w.usage.sentCount, 0);
  });

  test('當機復原（SENDING 超過 2 分鐘）：SENT＋SENT_UNCONFIRMED、名額不還', async () => {
    Object.assign(w.log, { status: 'SENDING', sendAttemptedAt: new Date(NOW.getTime() - 3 * 60_000), quotaMonth: '2026-11' });
    w.usage.sentCount = 1;
    const { p, calls } = plugin({ send: [metaError('ALREADY_REPLIED')] });
    assert.deepEqual(await run(p), { kind: 'done', status: 'SENT', reasonCode: 'SENT_UNCONFIRMED' });
    assert.equal(calls.send.length, 1);
    assert.equal(w.log.recipientUid, null);
    assert.equal(w.usage.sentCount, 1);
  });

  test('SENDING 未滿 2 分鐘：不處理', async () => {
    Object.assign(w.log, { status: 'SENDING', sendAttemptedAt: new Date(NOW.getTime() - 30_000) });
    const { p, calls } = plugin();
    assert.deepEqual(await run(p), { kind: 'gone' });
    assert.equal(calls.send.length, 0);
  });
});

describe('限流延後不消耗 attempts', () => {
  test('私訊 bucket 空：PENDING＋RATE_LIMIT_QUEUED，job 延後且 attemptsMade 不變', async () => {
    const { p, calls } = plugin();
    const processor = createCommentReplyProcessor((data, attempt) =>
      deliverCommentReply({ prisma, rateGate: gate({ pm: false }), plugins: () => p, now: () => NOW }, data.tenantId, data.logId, attempt),
    );
    const job = { data: { tenantId: TENANT, logId: 'log-1' }, attemptsMade: 0, opts: { attempts: 5 }, delayed: 0, moveToDelayed: async (ts: number) => void (job.delayed = ts) };
    await assert.rejects(processor(job), (err) => err instanceof DelayedError);
    assert.equal(job.attemptsMade, 0);
    assert.equal(job.delayed, NOW.getTime() + 5000);
    assert.equal(w.log.status, 'PENDING');
    assert.equal(w.log.reasonCode, 'RATE_LIMIT_QUEUED');
    assert.equal(calls.send.length, 0);
  });

  test('Meta 回限流：暫停 bucket、退回 PENDING、延後', async () => {
    const g = gate();
    const { p } = plugin({ send: [metaError('RATE_LIMITED', { retryAfterMs: 120_000 })] });
    const out = await run(p, g);
    assert.equal(out.kind, 'delay');
    assert.deepEqual(g.paused, [120_000]);
    assert.equal(w.log.status, 'PENDING');
    assert.equal(w.log.metaRateLimitHits, 1);
  });

  test(`累計 ${META_RATE_LIMIT_MAX_HITS} 次 Meta 限流：FAILED/RATE_LIMITED`, async () => {
    w.log.metaRateLimitHits = META_RATE_LIMIT_MAX_HITS - 1;
    const { p } = plugin({ send: [metaError('RATE_LIMITED')] });
    assert.deepEqual(await run(p), { kind: 'done', status: 'FAILED', reasonCode: 'RATE_LIMITED' });
  });
});

describe('網路錯誤', () => {
  test('還有重試次數：退回 PENDING、丟給 BullMQ 重試、額度保留', async () => {
    const { p } = plugin({ send: [metaError('NETWORK')] });
    const out = await run(p, gate(), { attemptsMade: 0, attempts: 5 });
    assert.equal(out.kind, 'retry');
    assert.equal(w.log.status, 'PENDING');
    assert.equal(w.log.quotaMonth, '2026-11');
    assert.equal(w.usage.sentCount, 1);
  });

  test('最後一次：FAILED/NETWORK、不還名額', async () => {
    const { p } = plugin({ send: [metaError('NETWORK')] });
    assert.deepEqual(await run(p, gate(), { attemptsMade: 4, attempts: 5 }), { kind: 'done', status: 'FAILED', reasonCode: 'NETWORK' });
    assert.equal(w.usage.sentCount, 1);
  });

  test('重試時不重複扣額度', async () => {
    w.log.quotaMonth = '2026-11';
    w.usage.sentCount = 1;
    const { p } = plugin();
    await run(p);
    assert.equal(w.usage.sentCount, 1);
  });
});

describe('Meta 明確拒絕與錯誤對照', () => {
  test('權杖失效：FAILED/TOKEN_EXPIRED、還名額', async () => {
    const { p } = plugin({ send: [metaError('TOKEN_EXPIRED', { code: 190 })] });
    assert.deepEqual(await run(p), { kind: 'done', status: 'FAILED', reasonCode: 'TOKEN_EXPIRED' });
    assert.equal(w.log.metaErrorCode, 190);
    assert.equal(w.usage.sentCount, 0);
  });

  test('測試階段的平台模式渠道：PERMISSION_MISSING 轉 APP_NOT_APPROVED', async () => {
    w.settings['commentReply.testPhase'] = { fb: true, ig: true };
    const { p } = plugin({ send: [metaError('PERMISSION_MISSING', { code: 10 })] });
    assert.deepEqual(await run(p), { kind: 'done', status: 'FAILED', reasonCode: 'APP_NOT_APPROVED' });
  });

  test('Meta 回超過期限：EXPIRED/EXPIRED_BY_META', async () => {
    const { p } = plugin({ send: [metaError('EXPIRED_BY_META')] });
    assert.deepEqual(await run(p), { kind: 'done', status: 'EXPIRED', reasonCode: 'EXPIRED_BY_META' });
  });

  test('本月已達上限：SKIPPED/PLAN_QUOTA_EXCEEDED、不呼叫 Meta', async () => {
    w.tenant.plan.limits = { monthlyCommentReplies: 1 };
    w.usage.sentCount = 1;
    const { p, calls } = plugin();
    assert.deepEqual(await run(p), { kind: 'done', status: 'SKIPPED', reasonCode: 'PLAN_QUOTA_EXCEEDED' });
    assert.equal(calls.send.length, 0);
  });
});

describe('公開回覆的子狀態', () => {
  beforeEach(() => {
    Object.assign(w.rule, { publicReplyEnabled: true, publicReplyTexts: ['謝謝', '已私訊'] });
    w.log.publicReplyStatus = 'PENDING';
  });

  test('私訊成功後公開回覆 SENT', async () => {
    const { p, calls } = plugin();
    await run(p);
    assert.equal(calls.reply, 1);
    assert.equal(w.log.publicReplyStatus, 'SENT');
    assert.ok(w.steps.indexOf('meta:reply') > w.steps.indexOf('update:SENT/null'));
  });

  test('私訊失敗：SKIPPED/PRIVATE_REPLY_NOT_SENT', async () => {
    const { p, calls } = plugin({ send: [metaError('USER_UNAVAILABLE')] });
    await run(p);
    assert.equal(calls.reply, 0);
    assert.equal(w.log.publicReplyStatus, 'SKIPPED');
    assert.equal(w.log.publicReplyReasonCode, 'PRIVATE_REPLY_NOT_SENT');
  });

  test('能力關閉：SKIPPED/CAPABILITY_DISABLED', async () => {
    w.settings['commentReply.capabilities'] = caps({ fbPrivateReply: true, fbPublicReply: false });
    const { p, calls } = plugin();
    await run(p);
    assert.equal(calls.reply, 0);
    assert.equal(w.log.publicReplyReasonCode, 'CAPABILITY_DISABLED');
  });

  test('公開回覆 bucket 空：SKIPPED/RATE_LIMITED，私訊照常 SENT', async () => {
    const { p } = plugin();
    await run(p, gate({ pr: false }));
    assert.equal(w.log.status, 'SENT');
    assert.equal(w.log.publicReplyStatus, 'SKIPPED');
    assert.equal(w.log.publicReplyReasonCode, 'RATE_LIMITED');
  });

  test('公開回覆缺權限：FAILED/PERMISSION_MISSING，私訊仍是 SENT', async () => {
    const { p } = plugin({ reply: [{ ok: false, error: { message: 'x', reason: 'PERMISSION_MISSING', transient: false } }] });
    await run(p);
    assert.equal(w.log.status, 'SENT');
    assert.equal(w.log.publicReplyStatus, 'FAILED');
    assert.equal(w.log.publicReplyReasonCode, 'PERMISSION_MISSING');
  });

  test('當機復原時公開回覆停在 SENDING：不重送，FAILED/UNKNOWN_AFTER_CRASH', async () => {
    Object.assign(w.log, { status: 'SENDING', sendAttemptedAt: new Date(NOW.getTime() - 3 * 60_000), publicReplyStatus: 'SENDING' });
    const { p, calls } = plugin({ send: [metaError('ALREADY_REPLIED')] });
    await run(p);
    assert.equal(calls.reply, 0);
    assert.equal(w.log.publicReplyStatus, 'FAILED');
    assert.equal(w.log.publicReplyReasonCode, 'UNKNOWN_AFTER_CRASH');
  });
});

describe('工作資料只有識別欄位', () => {
  test('缺 logId 的 job 直接丟錯', async () => {
    const processor = createCommentReplyProcessor(async () => ({ kind: 'gone' }));
    await assert.rejects(processor({ data: { tenantId: TENANT }, attemptsMade: 0, opts: {}, moveToDelayed: async () => {} }), /logId/);
  });
});
