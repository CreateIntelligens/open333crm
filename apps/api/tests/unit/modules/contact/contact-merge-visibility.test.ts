/**
 * 合併預覽與合併紀錄依渠道可見範圍（channel-scoped-visibility，PR #430 第六輪 review）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getMergePreview } from '#src/modules/contact/contact.service.js';
import { listMergeLogs } from '#src/modules/contact/contact-merge.service.js';
import { AppError } from '#src/shared/utils/response.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';
import { createMockTenantCtx } from '../../../support/mock-tenant-ctx.js';

const VISIBLE = new Set(['ch-visible']);

test('合併預覽：任一位聯絡人看不到時回 404，不回 403 透露它在其他分店有資料', async () => {
  const identities: Record<string, Array<{ channelId: string }>> = {
    a: [{ channelId: 'ch-visible' }],
    b: [{ channelId: 'ch-hidden' }],
  };
  const tx = {
    contact: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        identities[where.id] ? { id: where.id, mergedIntoId: null, channelIdentities: identities[where.id] } : null,
    },
    channelIdentity: { findFirst: async () => ({ id: 'other-branch-identity' }) },
    conversation: { findFirst: async () => null },
    case: { findFirst: async () => null },
  };
  const { ctx } = createMockTenantCtx(tx);
  await assert.rejects(
    () => getMergePreview(ctx, 'a', 'b', VISIBLE),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    },
  );
});

function mergeLogTx() {
  const log = {
    id: 'log-1',
    survivorId: 'a',
    mergedId: 'b',
    source: 'MANUAL',
    movedRecords: {
      channelIdentity: ['ident-visible', 'ident-hidden'],
      conversation: ['conv-hidden'],
      case: ['case-hidden'],
    },
  };
  const identityChannel: Record<string, string> = { 'ident-visible': 'ch-visible', 'ident-hidden': 'ch-hidden' };
  return {
    contactMergeLog: { findMany: async () => [log] },
    channelIdentity: {
      findMany: async ({ where }: { where: { id: { in: string[] }; channelId: { in: string[] } } }) =>
        where.id.in.filter((id) => where.channelId.in.includes(identityChannel[id])).map((id) => ({ id })),
    },
  };
}

test('合併紀錄：分店帳號只拿到可見渠道的身分 id，其他搬移紀錄的 id 不回傳', async () => {
  const { ctx } = createMockTenantCtx(mergeLogTx());
  const [log] = await listMergeLogs(ctx, 'a', VISIBLE);
  assert.deepEqual(log.movedRecords, { channelIdentity: ['ident-visible'] });
  assert.equal(log.mergedId, 'b', '對方的聯絡人 id 保留：連結與解除合併要用');
});

test('合併紀錄：總店拿到完整的搬移紀錄', async () => {
  const { ctx } = createMockTenantCtx(mergeLogTx());
  const [log] = await listMergeLogs(ctx, 'a', ALL_CHANNELS);
  assert.deepEqual((log.movedRecords as { conversation: string[] }).conversation, ['conv-hidden']);
});
