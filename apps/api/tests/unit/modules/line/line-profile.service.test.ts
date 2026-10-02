import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { syncLineContactProfile } from '#src/modules/line/line-profile.service.js';
import { AppError } from '#src/shared/utils/response.js';

const getProfile = vi.fn();

vi.mock('@open333crm/channel-plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/channel-plugins')>()),
  getChannelPlugin: () => ({ getProfile }),
}));
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

/**
 * 模擬一個不受 RLS 約束的 executor（例如 prismaAdmin）。
 * 租戶隔離只剩查詢條件，用來確認 service 自己帶了 tenantId。
 */
function createPrismaMock() {
  const channel = { id: CHANNEL_B, tenantId: TENANT_B, isActive: true, channelType: 'LINE', credentialsEncrypted: 'x' };
  const identity = { id: 'identity-b', channelId: CHANNEL_B, uid: 'U-b', profileName: 'original', profilePic: null, channel };
  const updates: Row[] = [];
  return {
    updates,
    prisma: {
      channel: { findFirst: async ({ where }: { where: Row }) => (matches(channel, where) ? channel : null) },
      channelIdentity: {
        findFirst: async ({ where }: { where: Row }) => (matches(identity, where) ? { id: identity.id } : null),
        update: async (args: Row) => {
          updates.push(args);
          return { uid: identity.uid, profileName: 'Synced', profilePic: null };
        },
      },
    },
  };
}

beforeEach(() => {
  getProfile.mockReset();
  getProfile.mockResolvedValue({ uid: 'U-b', displayName: 'Synced' });
});

test('其他租戶的渠道：即使 executor 不受 RLS 約束，也回 404 且不呼叫 LINE、不寫入', async () => {
  const { prisma, updates } = createPrismaMock();

  await assert.rejects(
    syncLineContactProfile(prisma as never, TENANT_A, CHANNEL_B, 'U-b'),
    (err: unknown) => err instanceof AppError && err.statusCode === 404,
  );
  assert.equal(getProfile.mock.calls.length, 0);
  assert.deepEqual(updates, []);
});

test('自己租戶的渠道：呼叫 LINE 並寫入該筆 ChannelIdentity', async () => {
  const { prisma, updates } = createPrismaMock();

  const result = await syncLineContactProfile(prisma as never, TENANT_B, CHANNEL_B, 'U-b');

  assert.equal(result.profileName, 'Synced');
  assert.equal(getProfile.mock.calls.length, 1);
  assert.equal(updates.length, 1);
});
