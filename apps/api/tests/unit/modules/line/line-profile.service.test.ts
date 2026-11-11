/**
 * 重抓 LINE 個人資料的 service（spec line-contact-profile-sync，AUDIT RLS-05）。
 *
 * 以不受 RLS 約束的 executor 模擬（例如 prismaAdmin），租戶隔離只剩查詢條件，
 * 用來確認 service 自己帶了 tenantId。呼叫 LINE 由 flow 在交易外執行，見 feature 測試 line-profile-sync。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { findLineProfileTarget, LINE_CHANNEL_NOT_FOUND, saveLineProfile } from '#src/modules/line/line-profile.service.js';
import { AppError } from '#src/shared/utils/response.js';
import type { TenantCtx } from '#src/lib/tenant-ctx.js';

vi.mock('#src/modules/channel/channel.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/channel/channel.service.js')>()),
  decryptCredentials: () => ({ channelAccessToken: 'test-token' }),
}));

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = 'b0000000-0000-0000-0000-000000000002';
const CHANNEL_B = 'cb000000-0000-4000-8000-000000000001';

type Row = Record<string, unknown>;

/** where 只比對有寫出的欄位：條件沒帶 tenantId，就會查到其他租戶的列 */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === 'object' ? matches(row[key] as Row, value as Row) : row[key] === value,
  );
}

function ctxOf(tenantId: string) {
  const channel = { id: CHANNEL_B, tenantId: TENANT_B, isActive: true, channelType: 'LINE', credentialsEncrypted: 'x' };
  const identity = { id: 'identity-b', channelId: CHANNEL_B, uid: 'U-b', profileName: 'original', profilePic: null, channel };
  const updates: Row[] = [];
  const tx = {
    channel: { findFirst: async ({ where }: { where: Row }) => (matches(channel, where) ? channel : null) },
    channelIdentity: {
      findFirst: async ({ where }: { where: Row }) => (matches(identity, where) ? { id: identity.id } : null),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(identity, where)) return { count: 0 };
        updates.push(data);
        Object.assign(identity, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ uid: identity.uid, profileName: identity.profileName, profilePic: identity.profilePic }),
    },
  };
  return { ctx: { tx, tenantId } as unknown as TenantCtx, updates };
}

test('其他租戶的渠道（executor 不受 RLS 約束時）：讀取回 404，擋在渠道這一步', async () => {
  const { ctx } = ctxOf(TENANT_A);
  // 身分的查詢也帶 tenantId，同樣回 404；比對訊息，確認是渠道的條件擋下
  await assert.rejects(
    findLineProfileTarget(ctx, CHANNEL_B, 'U-b'),
    (err: unknown) => err instanceof AppError && err.statusCode === 404 && err.message === LINE_CHANNEL_NOT_FOUND,
  );
});

test('其他租戶的身分（executor 不受 RLS 約束時）：寫入回 404，不改資料', async () => {
  const { ctx, updates } = ctxOf(TENANT_A);
  await assert.rejects(
    saveLineProfile(ctx, 'identity-b', CHANNEL_B, { displayName: 'Synced' }),
    (err: unknown) => err instanceof AppError && err.statusCode === 404,
  );
  assert.deepEqual(updates, []);
});

test('同步成功：讀到身分與憑證，寫入名稱與頭像', async () => {
  const { ctx, updates } = ctxOf(TENANT_B);
  const target = await findLineProfileTarget(ctx, CHANNEL_B, 'U-b');
  assert.equal(target.identityId, 'identity-b');
  assert.deepEqual(target.credentials, { channelAccessToken: 'test-token' });

  const result = await saveLineProfile(ctx, target.identityId, CHANNEL_B, { displayName: 'Synced' });
  assert.equal(result.profileName, 'Synced');
  assert.deepEqual(updates, [{ profileName: 'Synced', profilePic: null }]);
});
