/**
 * 關閉 app 時，進行中的 webhook 背景處理仍完成（change add-comment-keyword-private-reply tasks 4.4，design D3）。
 *
 * webhook 先回 200、在背景處理；部署重啟時 Meta 不會重送已回 200 的事件。真的 webhook.routes 經 Fastify inject 收到留言後
 * 馬上關閉 app：app.close() 回來時紀錄必須已經寫好。為了讓背景處理一定還在進行，Redis 的 SET（記錄最後留言時間，
 * 背景處理的第一步）延遲 300ms。
 */
import {
  adminDb,
  cleanupCommentReplyData,
  createRule,
  disconnectAll,
  enableAllCapabilities,
  owner,
  PLATFORM_APP_SECRET,
  redis,
  resetHarness,
  resetPlatformSettings,
  tenantDb,
} from '#tests/support/comment-reply-harness.js';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import Fastify from 'fastify';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';
import { fbCommentPayload, signed } from '#tests/support/meta-webhook.js';
import jsonPayloadGuardPlugin from '#src/plugins/json-payload-guard.plugin.js';
import { DEFAULT_JSON_PAYLOAD_LIMITS } from '#src/shared/utils/json-payload-limits.js';
import webhookRoutes from '#src/modules/webhook/webhook.routes.js';

const fx = createCommentReplyFixtures(owner);
useFakeMetaGraph();

beforeAll(async () => {
  resetHarness();
  await enableAllCapabilities();
});

afterAll(async () => {
  await resetPlatformSettings();
  await fx.cleanup(cleanupCommentReplyData);
  await disconnectAll();
});

test('關閉 app 時進行中的留言背景處理仍完成', async () => {
  const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
  const fb = await fx.fbChannel(tenant.id);
  await createRule(tenant.id, fb.id, { keywords: ['+1'] });

  const slowRedis = new Proxy(redis, {
    get(target, prop, receiver) {
      if (prop === 'set') {
        return async (...args: unknown[]) => {
          await new Promise((r) => setTimeout(r, 300));
          return (target.set as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  const app = Fastify();
  app.decorate('prismaAdmin', adminDb as never);
  app.decorate('prisma', tenantDb as never);
  app.decorate('redis', slowRedis as never);
  app.decorate('io', { to: () => ({ emit() {} }), emit() {} } as never);
  await app.register(jsonPayloadGuardPlugin, { limits: DEFAULT_JSON_PAYLOAD_LIMITS });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.ready();

  const payload = fbCommentPayload([
    { pageId: fb.externalAccountId, commentId: `drain-${Date.now()}`, createdTime: Math.floor(Date.now() / 1000) },
  ]);
  const { raw, headers } = signed(payload, PLATFORM_APP_SECRET);
  const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', headers, payload: raw });
  assert.equal(res.statusCode, 200);

  await app.close();
  assert.equal(await owner.commentReplyLog.count({ where: { channelId: fb.id } }), 1);
});
