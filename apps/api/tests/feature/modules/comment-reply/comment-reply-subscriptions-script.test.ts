/**
 * 補訂閱腳本 src/scripts/comment-reply-subscriptions.ts 的結束碼（PR #526 審查第 4 點）。
 *
 * 單一渠道失敗只記錄、不中斷，但整批跑完只要有渠道失敗，結束碼必須非 0，維運用 `--apply || exit 1` 才看得到。
 * 用憑證無法解密的渠道製造失敗：解密在呼叫 Meta 之前，dry-run 也會走到，不會發出任何對外請求。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, test } from 'vitest';
import { owner } from '#tests/support/comment-reply-harness.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';

const fx = createCommentReplyFixtures(owner);
const apiDir = fileURLToPath(new URL('../../../../', import.meta.url));

afterAll(async () => {
  await fx.cleanup();
});

describe('補訂閱腳本的結束碼', () => {
  test('有渠道失敗時結束碼為 1，並印出失敗數', async () => {
    const tenant = await fx.tenant({ plan: { features: ['inbox', 'core', 'comment_reply'] } });
    const fb = await fx.fbChannel(tenant.id, { mode: 'platform' });
    await owner.channel.updateMany({ where: { id: fb.id, tenantId: tenant.id }, data: { credentialsEncrypted: 'not-a-valid-ciphertext' } });

    const res = spawnSync('node_modules/.bin/tsx', ['src/scripts/comment-reply-subscriptions.ts', '--mode', 'resubscribe', '--channel', fb.id], {
      cwd: apiDir,
      env: process.env,
      encoding: 'utf8',
      timeout: 60_000,
    });

    assert.match(res.stdout, /完成：成功 0、失敗 1/, res.stderr);
    assert.equal(res.status, 1);
  }, 90_000);
});
