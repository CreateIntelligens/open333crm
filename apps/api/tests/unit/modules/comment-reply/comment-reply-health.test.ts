/**
 * 留言自動私訊的健康告警（change add-comment-keyword-private-reply tasks 10.2，design D25）。
 * evaluateCommentReplyHealth() 是純函式；runCommentReplyHealth() 的送出與租戶通知以注入的替身測。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import {
  evaluateCommentReplyHealth,
  runCommentReplyHealth,
  type HealthSnapshot,
} from '#src/modules/comment-reply/comment-reply-health.js';

const empty = (): HealthSnapshot => ({ channelStats: [], stuckPending: 0, expiringPending: 0, subscriptionMissing: [], signatureFailures: 0 });
const ch = (failedByReason: Record<string, number>, sent = 0) => ({ channelId: 'ch-1', tenantId: 't-1', displayName: '粉專', sent, failedByReason });

describe('evaluateCommentReplyHealth', () => {
  test('權杖連續失效', () => {
    const alerts = evaluateCommentReplyHealth({ ...empty(), channelStats: [ch({ TOKEN_EXPIRED: 2, PERMISSION_MISSING: 1 })] });
    const auth = alerts.find((a) => a.key === 'comment-reply-auth:ch-1');
    assert.ok(auth);
    assert.equal(auth.notifyTenant?.tenantId, 't-1');
    assert.equal(evaluateCommentReplyHealth({ ...empty(), channelStats: [ch({ TOKEN_EXPIRED: 2 })] }).length, 0);
  });

  test('卡住的處理中紀錄', () => {
    const alerts = evaluateCommentReplyHealth({ ...empty(), stuckPending: 3 });
    assert.deepEqual(alerts.map((a) => a.key), ['comment-reply-stuck']);
  });

  test('限流排隊不告警', () => {
    // 限流排隊的 PENDING 不算進 stuckPending（collectHealthSnapshot 以 reasonCode 排除），快照為 0 時不告警
    assert.deepEqual(evaluateCommentReplyHealth(empty()), []);
  });

  test('失敗率告警排除使用者端原因', () => {
    const userSide = evaluateCommentReplyHealth({ ...empty(), channelStats: [ch({ USER_UNAVAILABLE: 30, COMMENT_NOT_FOUND: 10 }, 5)] });
    assert.equal(userSide.filter((a) => a.key.startsWith('comment-reply-failure-rate')).length, 0);
    const system = evaluateCommentReplyHealth({ ...empty(), channelStats: [ch({ NETWORK: 15, UNKNOWN: 6 }, 10)] });
    assert.ok(system.some((a) => a.key === 'comment-reply-failure-rate:ch-1'));
    const lowRate = evaluateCommentReplyHealth({ ...empty(), channelStats: [ch({ NETWORK: 20 }, 30)] });
    assert.equal(lowRate.filter((a) => a.key.startsWith('comment-reply-failure-rate')).length, 0);
  });

  test('驗簽失敗告警', () => {
    assert.deepEqual(evaluateCommentReplyHealth({ ...empty(), signatureFailures: 50 }).map((a) => a.key), ['meta-webhook-signature']);
    assert.deepEqual(evaluateCommentReplyHealth({ ...empty(), signatureFailures: 49 }), []);
  });

  test('即將過期與訂閱不見了', () => {
    const alerts = evaluateCommentReplyHealth({
      ...empty(),
      expiringPending: 1,
      subscriptionMissing: [{ channelId: 'ch-2', tenantId: 't-2', displayName: 'IG' }],
    });
    assert.deepEqual(alerts.map((a) => a.key).sort(), ['comment-reply-expiring', 'comment-reply-subscription:ch-2']);
    assert.equal(alerts.find((a) => a.key.startsWith('comment-reply-subscription'))!.notifyTenant?.tenantId, 't-2');
  });
});

describe('runCommentReplyHealth', () => {
  test('送出告警，合併通過時才通知租戶管理員', async () => {
    const rows = [{ channelId: 'ch-1', tenantId: 't-1', status: 'FAILED', reasonCode: 'TOKEN_EXPIRED', n: 3n }];
    const admin = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('GROUP BY')) return rows;
        return [{ n: 0n }];
      },
      $executeRaw: async () => 0,
      channel: { findMany: async () => [{ id: 'ch-1', displayName: '粉專', tenantId: 't-1', settings: {} }] },
      commentReplyRule: { count: async () => 0 },
    } as never;
    const sent: string[] = [];
    const notified: string[] = [];
    const redis = { get: async () => null };
    await runCommentReplyHealth({
      admin,
      redis,
      sendAlert: async (a) => {
        sent.push(a.key);
        return true;
      },
      notifyTenantAdmins: async (tenantId) => void notified.push(tenantId),
    });
    assert.deepEqual(sent, ['comment-reply-auth:ch-1']);
    assert.deepEqual(notified, ['t-1']);

    sent.length = 0;
    notified.length = 0;
    await runCommentReplyHealth({ admin, redis, sendAlert: async (a) => (sent.push(a.key), false), notifyTenantAdmins: async (t) => void notified.push(t) });
    assert.deepEqual(notified, [], '10 分鐘內同一個鍵被合併時不再通知租戶');
  });
});
