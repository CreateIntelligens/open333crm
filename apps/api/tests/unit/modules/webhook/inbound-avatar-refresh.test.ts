/**
 * 進站時把渠道頭像補存進物件儲存（spec inbound-contact-resolution「渠道頭像存進物件儲存」，AUDIT IDENT-06）。
 * 下載與上傳換成替身（avatar-mirror 自己的測試涵蓋），這裡驗證何時下載、寫回哪些欄位。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-inbound-avatar-refresh-secret';

const STORED = 'https://files.example.test/open333crm/';
const mirror = vi.hoisted(() => ({
  /** 可下載的來源網址 → 存好後的網址；不在表裡的網址視為下載失敗 */
  downloadable: {} as Record<string, string>,
  calls: [] as string[],
  deleted: [] as string[],
  /** 下載期間要執行的動作，模擬其他流程同時改資料 */
  during: null as null | (() => void),
}));
vi.mock('#src/modules/storage/avatar-mirror.service.js', () => ({
  isStoredAvatarUrl: (tenantId: string, url: string) =>
    url.startsWith(`https://files.example.test/open333crm/${tenantId}/avatars/`),
  mirrorAvatar: async (_tenantId: string, url: string) => {
    mirror.calls.push(url);
    mirror.during?.();
    return mirror.downloadable[url] ?? null;
  },
  deleteStoredAvatar: async (_tenantId: string, url: string) => {
    mirror.deleted.push(url);
  },
}));

import { resolveInboundContact } from '#src/modules/webhook/inbound-contact-resolver.js';
import {
  flushAvatarRefreshesForTests,
  resetAvatarRefreshThrottleForTests,
} from '#src/modules/webhook/inbound-avatar-refresh.js';
import type { InboundMessageContext } from '#src/modules/webhook/inbound-message.types.js';

type AnyRecord = Record<string, any>;
const TENANT = 'tenant-1';
const FRESH = 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=1&fresh';
const EXPIRED = 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=1&expired';

/** 假的 Prisma：只放 resolver 與補存會用到的 model 方法，記錄每次寫入 */
function createDb(options: { identity?: AnyRecord | null; contact?: AnyRecord }) {
  let identity: AnyRecord | null = options.identity ?? null;
  const contacts: AnyRecord[] = options.contact ? [{ ...options.contact }] : [];
  const identityUpdates: AnyRecord[] = [];
  const contactUpdates: AnyRecord[] = [];

  const db: AnyRecord = {
    channelIdentity: {
      async findUnique() {
        return identity ? { ...identity, contact: contacts.find((c) => c.id === identity!.contactId) } : null;
      },
      async create({ data }: AnyRecord) {
        identity = { ...data, id: 'identity-new' };
        return { ...identity, contact: contacts.find((c) => c.id === data.contactId) };
      },
      async updateMany({ where, data }: AnyRecord) {
        identityUpdates.push({ where, data });
        const hit = identity && identity.id === where.id && identity.profilePic === where.profilePic;
        if (hit) identity = { ...identity!, ...data };
        return { count: hit ? 1 : 0 };
      },
    },
    identityMap: { findUnique: async () => null },
    contact: {
      async findFirst() {
        return null;
      },
      async create({ data }: AnyRecord) {
        const row = { ...data, id: 'contact-new' };
        contacts.push(row);
        return row;
      },
      async updateMany({ where, data }: AnyRecord) {
        contactUpdates.push({ where, data });
        const row = contacts.find(
          (c) => c.id === where.id && c.tenantId === where.tenantId && c.avatarUrl === where.avatarUrl,
        );
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
  };
  return {
    db,
    identity: () => identity,
    setIdentity: (patch: AnyRecord) => {
      identity = { ...identity!, ...patch };
    },
    contact: (id: string) => contacts.find((c) => c.id === id),
    identityUpdates,
    contactUpdates,
  };
}

function createCtx(db: AnyRecord, avatarUrl: string | undefined) {
  const profileCalls: string[] = [];
  const ctx = {
    prisma: db,
    tenantId: TENANT,
    contactUid: 'PSID-1',
    channel: { id: 'channel-1', channelType: 'FB' },
    credentials: {},
    now: new Date(),
    plugin: {
      async getProfile(uid: string) {
        profileCalls.push(uid);
        return { uid, displayName: 'Yang Daniel', avatarUrl };
      },
    },
  } as unknown as InboundMessageContext;
  return { ctx, profileCalls };
}

function existingIdentity(profilePic: string | null) {
  return { id: 'identity-1', contactId: 'contact-1', channelId: 'channel-1', uid: 'PSID-1', profilePic };
}

beforeEach(() => {
  mirror.downloadable = {};
  mirror.calls = [];
  mirror.deleted = [];
  mirror.during = null;
  resetAvatarRefreshThrottleForTests();
});

test('新聯絡人的頭像存進物件儲存', async () => {
  mirror.downloadable[FRESH] = `${STORED}tenant-1/avatars/a.jpg`;
  const t = createDb({});
  const { ctx } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  assert.equal(ctx.contactId, 'contact-new', '訊息照常歸戶，不等下載');
  await flushAvatarRefreshesForTests();

  assert.equal(t.identity()!.profilePic, `${STORED}tenant-1/avatars/a.jpg`);
  assert.equal(t.contact('contact-new')!.avatarUrl, `${STORED}tenant-1/avatars/a.jpg`);
  assert.equal(t.contactUpdates[0].where.tenantId, TENANT, '更新聯絡人要帶租戶');
  assert.equal(t.identityUpdates[0].where.contact.tenantId, TENANT, '更新身分要帶租戶');
});

test('舊身分在下次進站時補存', async () => {
  mirror.downloadable[FRESH] = `${STORED}tenant-1/avatars/b.jpg`;
  const t = createDb({
    identity: existingIdentity(EXPIRED),
    contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: EXPIRED },
  });
  const { ctx, profileCalls } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  await flushAvatarRefreshesForTests();

  assert.deepEqual(mirror.calls, [EXPIRED, FRESH], '舊網址下載失敗後，重新取得新網址再下載');
  assert.deepEqual(profileCalls, ['PSID-1']);
  assert.equal(t.identity()!.profilePic, `${STORED}tenant-1/avatars/b.jpg`);
  assert.equal(t.contact('contact-1')!.avatarUrl, `${STORED}tenant-1/avatars/b.jpg`);
});

test('已存過的頭像不再下載', async () => {
  const stored = `${STORED}tenant-1/avatars/c.jpg`;
  const t = createDb({
    identity: existingIdentity(stored),
    contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: stored },
  });
  const { ctx, profileCalls } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  await flushAvatarRefreshesForTests();

  assert.equal(mirror.calls.length, 0);
  assert.equal(profileCalls.length, 0);
  assert.equal(t.identityUpdates.length, 0);
});

test('其他租戶或不是 avatars 目錄的檔案要重新存', async () => {
  const foreign = `${STORED}tenant-2/avatars/x.jpg`;
  mirror.downloadable[foreign] = `${STORED}tenant-1/avatars/y.jpg`;
  const t = createDb({
    identity: existingIdentity(foreign),
    contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: foreign },
  });
  const { ctx } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  await flushAvatarRefreshesForTests();

  assert.equal(t.identity()!.profilePic, `${STORED}tenant-1/avatars/y.jpg`);
});

test('重試紀錄有上限，超過時淘汰最舊的', async () => {
  resetAvatarRefreshThrottleForTests(2);
  const run = async (id: string) => {
    const t = createDb({
      identity: { ...existingIdentity(EXPIRED), id },
      contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: EXPIRED },
    });
    const { ctx, profileCalls } = createCtx(t.db, FRESH); // 一律失敗
    await resolveInboundContact(ctx);
    await flushAvatarRefreshesForTests();
    return profileCalls.length;
  };
  assert.equal(await run('i-1'), 1);
  assert.equal(await run('i-2'), 1);
  assert.equal(await run('i-3'), 1, '第三筆擠掉最舊的 i-1');
  assert.equal(await run('i-2'), 0, 'i-2 還在紀錄裡，一小時內不重試');
  assert.equal(await run('i-1'), 1, 'i-1 已被淘汰，所以會再試');
});

test('客服改過的聯絡人頭像不覆蓋', async () => {
  mirror.downloadable[EXPIRED] = `${STORED}tenant-1/avatars/d.jpg`;
  const custom = 'https://files.example.test/open333crm/tenant-1/media/agent-picked.png';
  const t = createDb({
    identity: existingIdentity(EXPIRED),
    contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: custom },
  });
  const { ctx } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  await flushAvatarRefreshesForTests();

  assert.equal(t.identity()!.profilePic, `${STORED}tenant-1/avatars/d.jpg`);
  assert.equal(t.contact('contact-1')!.avatarUrl, custom);
});

test('下載期間被改過的網址不覆蓋', async () => {
  const stored = `${STORED}tenant-1/avatars/e.jpg`;
  mirror.downloadable[FRESH] = stored;
  const t = createDb({
    identity: existingIdentity(FRESH),
    contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: FRESH },
  });
  // 下載期間，另一個流程（例如客服同步個人資料）把身分的頭像改掉
  mirror.during = () => t.setIdentity({ profilePic: 'https://sprofile.line-scdn.net/synced' });
  const { ctx } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  await flushAvatarRefreshesForTests();

  assert.equal(t.identity()!.profilePic, 'https://sprofile.line-scdn.net/synced', '不覆蓋新值');
  assert.equal(t.contact('contact-1')!.avatarUrl, FRESH, '身分沒寫入時聯絡人也不改');
  assert.deepEqual(mirror.deleted, [stored], '刪除剛上傳的檔案');
});

test('寫回資料庫失敗時刪掉剛上傳的檔案', async () => {
  const stored = `${STORED}tenant-1/avatars/f.jpg`;
  mirror.downloadable[FRESH] = stored;
  const t = createDb({
    identity: existingIdentity(FRESH),
    contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: FRESH },
  });
  t.db.channelIdentity.updateMany = async () => {
    throw new Error('connection reset');
  };
  const { ctx } = createCtx(t.db, FRESH);

  await resolveInboundContact(ctx);
  await flushAvatarRefreshesForTests();

  assert.deepEqual(mirror.deleted, [stored]);
});

test('補存失敗後一小時內不重試', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-19T00:00:00Z'), toFake: ['Date'] });
  try {
    const t = createDb({
      identity: existingIdentity(EXPIRED),
      contact: { id: 'contact-1', tenantId: TENANT, avatarUrl: EXPIRED },
    });
    const { ctx, profileCalls } = createCtx(t.db, FRESH); // FRESH 也下載失敗

    await resolveInboundContact(ctx);
    await flushAvatarRefreshesForTests();
    assert.equal(profileCalls.length, 1);

    vi.setSystemTime(new Date('2026-10-19T00:59:00Z'));
    await resolveInboundContact(ctx);
    await flushAvatarRefreshesForTests();
    assert.equal(profileCalls.length, 1, '一小時內不再呼叫 getProfile');
    assert.equal(mirror.calls.length, 2, '一小時內不再下載');

    vi.setSystemTime(new Date('2026-10-19T01:01:00Z'));
    await resolveInboundContact(ctx);
    await flushAvatarRefreshesForTests();
    assert.equal(profileCalls.length, 2, '超過一小時後再試一次');
  } finally {
    vi.useRealTimers();
  }
});
