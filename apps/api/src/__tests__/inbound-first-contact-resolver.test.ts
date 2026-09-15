/**
 * 首次進站判定與 contact.created 事件 — CM-176
 *
 * 招呼語「一輩子只送一次」的保證不是靠快取，而是靠 ChannelIdentity 的
 * @@unique([channelId, uid])：只有成功建立身分的那次請求會被標記
 * isFirstContact，併發／平台重複投遞的另一方會撞 P2002 而不標記。
 *
 * 刻意不用記憶體 Map（如 outsideHoursReplyCache）：本專案多實例部署，
 * 記憶體快取會讓每個實例各送一次。
 *
 * 覆蓋：
 *   1. 全新聯絡人 → isFirstContact = true，且發布 contact.created
 *   2. 既有身分命中 → isFirstContact 不為 true，不發布事件
 *   3. 併發撞 P2002 → isFirstContact 不為 true（對方才是首次）
 *   4. stitched 聯絡人首次在此渠道出現 → 視為首次
 */

import assert from 'node:assert/strict';

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-inbound-first-contact-secret';

import { eventBus, type AppEvent } from '../events/event-bus.js';
import { resolveInboundContact } from '../modules/webhook/inbound-contact-resolver.js';

type AnyRecord = Record<string, any>;

class P2002Error extends Error {
  code = 'P2002';
}

/**
 * 假的租戶綁定 Prisma executor。
 *
 * @param existingIdentity  既有的 channelIdentity（null = 此 uid 尚未綁定）
 * @param identityMapHit    resolveUidToContact 的結果（模擬跨渠道 stitch）
 * @param createThrowsP2002 模擬併發：建立 identity 時撞唯一約束
 */
function createDb(options: {
  existingIdentity?: AnyRecord | null;
  identityMapHit?: string | null;
  createThrowsP2002?: boolean;
}) {
  const { existingIdentity = null, identityMapHit = null, createThrowsP2002 = false } = options;
  let identityRow: AnyRecord | null = existingIdentity;

  return {
    channelIdentity: {
      async findUnique() {
        // 撞 P2002 後會再查一次，此時回傳「對方已建立」的那筆
        return createThrowsP2002
          ? { contactId: 'contact-winner', contact: { displayName: '別人先建的' } }
          : identityRow;
      },
      async create({ data }: AnyRecord) {
        if (createThrowsP2002) throw new P2002Error('unique constraint');
        identityRow = { ...data, id: 'identity-1', contact: { displayName: data.profileName } };
        return identityRow;
      },
    },
    identityMap: {
      async findUnique() {
        return identityMapHit ? { contactId: identityMapHit } : null;
      },
    },
    contact: {
      async findFirst() {
        return identityMapHit
          ? { id: identityMapHit, displayName: '跨渠道既有聯絡人', avatarUrl: null }
          : null;
      },
      async create({ data }: AnyRecord) {
        return { ...data, id: 'contact-new' };
      },
      async update({ data }: AnyRecord) {
        return data;
      },
    },
  } as AnyRecord;
}

function createCtx(db: AnyRecord): AnyRecord {
  return {
    prisma: db,
    tenantId: 'tenant-1',
    contactUid: 'U-test-0001',
    channel: { id: 'channel-1', channelType: 'LINE' },
    plugin: undefined,
    now: new Date('2026-09-15T10:00:00Z'),
  };
}

/** 收集本段期間發布的 contact.created 事件。 */
function captureContactCreated(): { events: AppEvent[]; stop: () => void } {
  const events: AppEvent[] = [];
  const handler = (e: AppEvent) => events.push(e);
  eventBus.subscribe('contact.created', handler as never);
  return {
    events,
    stop: () => {
      (eventBus as unknown as { off: (n: string, h: unknown) => void }).off?.(
        'contact.created',
        handler,
      );
    },
  };
}

async function run() {
  // ── 1. 全新聯絡人 → 首次，且發布 contact.created ──────────────────────
  {
    const cap = captureContactCreated();
    const db = createDb({ existingIdentity: null, identityMapHit: null });
    const ctx = createCtx(db);

    await resolveInboundContact(ctx as never);

    assert.equal(ctx.isFirstContact, true, '全新聯絡人應標記為首次進站');
    assert.ok(ctx.contactId, '應解析出 contactId');
    assert.equal(cap.events.length, 1, '應發布一次 contact.created');
    assert.equal(cap.events[0].tenantId, 'tenant-1');
    assert.equal(
      (cap.events[0].payload as AnyRecord).uid,
      'U-test-0001',
      '事件 payload 應帶渠道 uid',
    );
    cap.stop();
  }

  // ── 2. 既有身分命中 → 非首次，不發事件 ────────────────────────────────
  {
    const cap = captureContactCreated();
    const db = createDb({
      existingIdentity: { contactId: 'contact-existing', contact: { displayName: '老客人' } },
    });
    const ctx = createCtx(db);

    await resolveInboundContact(ctx as never);

    assert.notEqual(ctx.isFirstContact, true, '既有身分不得標記為首次');
    assert.equal(ctx.contactId, 'contact-existing', '應歸戶至既有聯絡人');
    assert.equal(cap.events.length, 0, '既有聯絡人不得發布 contact.created');
    cap.stop();
  }

  // ── 3. 併發撞 P2002 → 非首次（對方才是首次，招呼語只送一次）───────────
  {
    const cap = captureContactCreated();
    const db = createDb({ existingIdentity: null, identityMapHit: null, createThrowsP2002: true });
    const ctx = createCtx(db);

    await resolveInboundContact(ctx as never);

    assert.notEqual(
      ctx.isFirstContact,
      true,
      '撞 P2002 表示另一請求先建立身分，本次不得標記為首次 —— 這是招呼語只送一次的關鍵',
    );
    assert.equal(cap.events.length, 0, '非首次不得發布 contact.created');
    cap.stop();
  }

  // ── 4. 跨渠道 stitched 聯絡人 → 該 uid 在此渠道確實是首次 ──────────────
  {
    const cap = captureContactCreated();
    const db = createDb({ existingIdentity: null, identityMapHit: 'contact-from-other-channel' });
    const ctx = createCtx(db);

    await resolveInboundContact(ctx as never);

    assert.equal(
      ctx.isFirstContact,
      true,
      '聯絡人雖已存在於其他渠道，但此 uid 在本渠道是第一次出現，應視為首次',
    );
    assert.equal(ctx.contactId, 'contact-from-other-channel', '應歸戶至既有聯絡人');
    cap.stop();
  }

  console.log('✔ inbound-first-contact-resolver：4 組情境全部通過（CM-176）');
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
