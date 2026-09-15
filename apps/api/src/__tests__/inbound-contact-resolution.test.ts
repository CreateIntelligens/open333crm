/**
 * 防迴歸測試 — CM-175
 *
 * 背景：`packages/core` 曾因缺少 `"type": "module"` 被編成 CJS，`require()` 純 ESM 的
 * `@open333crm/database` 取不到具名匯出，模組層級的 `prisma` 在執行期為 undefined。
 * 結果是「尚未建立 IdentityMap 的 UID」（＝新客的第一則訊息）一律炸在
 * `resolveUidToContact` 的 `prisma.identityMap`，訊息靜默掉失。
 *
 * 這組測試鎖住修復後的契約：
 *   1. UID 解析必須使用「呼叫端注入」的 executor，不得依賴模組層級單例。
 *   2. 新 UID 首次進站要能建立聯絡人與身分綁定。
 *   3. 已綁定身分的 UID 直接歸戶，不重複建檔，也不必再解析。
 *   4. 注入的 executor 必須是租戶綁定連線（RLS 下的跨租戶隔離，同 CM-171/172 病因）。
 */

import assert from 'node:assert/strict';

process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-inbound-contact-resolution-secret';

import { resolveUidToContact } from '@open333crm/core';
import { resolveInboundContact } from '../modules/webhook/inbound-contact-resolver.js';
import type { InboundMessageContext } from '../modules/webhook/inbound-message.types.js';

type AnyRecord = Record<string, any>;

/** 記錄每次查詢用的是哪個 executor 實例，用來證明注入確實生效。 */
interface DbCallLog {
  identityMapLookups: Array<{ where: AnyRecord; self: unknown }>;
  createdContacts: AnyRecord[];
  createdIdentities: AnyRecord[];
}

/**
 * 建立一個假的租戶綁定 Prisma executor。
 *
 * 關鍵：`identityMap.findUnique` 只存在於「這個實例」上。若受測程式改回使用模組層級
 * 的全域 prisma，就取不到這個 stub，測試會失敗 —— 正是 CM-175 的迴歸點。
 */
function createTenantDb(options: {
  log: DbCallLog;
  existingChannelIdentity?: AnyRecord | null;
  identityMapHit?: { contactId: string } | null;
  existingContact?: AnyRecord | null;
}) {
  const {
    log,
    existingChannelIdentity = null,
    identityMapHit = null,
    existingContact = null,
  } = options;

  let channelIdentityRow: AnyRecord | null = existingChannelIdentity;
  let contactSeq = 0;
  let identitySeq = 0;

  const db: AnyRecord = {
    channelIdentity: {
      async findUnique() {
        return channelIdentityRow;
      },
      async create({ data }: AnyRecord) {
        identitySeq += 1;
        log.createdIdentities.push(data);
        channelIdentityRow = { ...data, id: `identity-${identitySeq}`, contact: {} };
        return channelIdentityRow;
      },
    },
    identityMap: {
      async findUnique({ where }: AnyRecord) {
        // self 記錄呼叫時綁定的實例，用來斷言「注入的就是這個 db」
        log.identityMapLookups.push({ where, self: db });
        return identityMapHit ? { contactId: identityMapHit.contactId } : null;
      },
    },
    contact: {
      async findFirst() {
        return existingContact;
      },
      async create({ data }: AnyRecord) {
        contactSeq += 1;
        const row = { ...data, id: `contact-${contactSeq}` };
        log.createdContacts.push(row);
        return row;
      },
      async update({ data }: AnyRecord) {
        return data;
      },
    },
  };

  return db;
}

function createLog(): DbCallLog {
  return { identityMapLookups: [], createdContacts: [], createdIdentities: [] };
}

function createCtx(db: AnyRecord, overrides: Partial<InboundMessageContext> = {}) {
  return {
    prisma: db,
    tenantId: 'tenant-1',
    contactUid: 'U-new-user-0001',
    channel: { id: 'channel-1', channelType: 'LINE' },
    plugin: undefined,
    ...overrides,
  } as unknown as InboundMessageContext;
}

async function run() {
  // ── 1. resolveUidToContact 必須使用注入的 executor ────────────────────────
  {
    const log = createLog();
    const db = createTenantDb({ log, identityMapHit: { contactId: 'contact-known' } });

    const contactId = await resolveUidToContact(db as any, 'tenant-1', 'LINE' as any, 'U-abc');

    assert.equal(contactId, 'contact-known', '應回傳 identityMap 命中的 contactId');
    assert.equal(log.identityMapLookups.length, 1, '應查詢 identityMap 一次');
    assert.equal(
      log.identityMapLookups[0].self,
      db,
      'identityMap 查詢必須落在注入的 executor 上（不得使用模組層級全域 prisma）',
    );
    assert.deepEqual(log.identityMapLookups[0].where, {
      tenantId_channelType_uid: { tenantId: 'tenant-1', channelType: 'LINE', uid: 'U-abc' },
    });
  }

  // ── 2. 查無 identityMap 時回 null，且不得拋錯（CM-175 的原始崩潰點）──────
  {
    const log = createLog();
    const db = createTenantDb({ log, identityMapHit: null });

    const contactId = await resolveUidToContact(
      db as any,
      'tenant-1',
      'LINE' as any,
      'U-brand-new',
    );

    assert.equal(contactId, null, '未綁定的 UID 應回 null 而非拋 TypeError');
  }

  // ── 3. 新 UID 首次進站 → 建立聯絡人 + 身分綁定 ────────────────────────────
  {
    const log = createLog();
    const db = createTenantDb({ log, existingChannelIdentity: null, identityMapHit: null });
    const ctx = createCtx(db);

    await resolveInboundContact(ctx);

    assert.equal(log.createdContacts.length, 1, '應建立一位新聯絡人');
    assert.equal(log.createdIdentities.length, 1, '應建立一筆渠道身分綁定');
    assert.equal(log.createdContacts[0].tenantId, 'tenant-1', '新聯絡人須落在正確租戶');
    assert.equal(log.createdIdentities[0].uid, 'U-new-user-0001');
    assert.ok(ctx.contactId, '解析後 ctx.contactId 必須有值');
    assert.equal(
      log.identityMapLookups[0].self,
      db,
      '解析流程必須透過 ctx.prisma（租戶綁定連線）查 identityMap',
    );
  }

  // ── 4. 已綁定身分的 UID → 直接歸戶，不重複建檔也不需解析 ─────────────────
  {
    const log = createLog();
    const db = createTenantDb({
      log,
      existingChannelIdentity: { contactId: 'contact-existing', contact: {} },
    });
    const ctx = createCtx(db, { contactUid: 'U-already-linked' });

    await resolveInboundContact(ctx);

    assert.equal(ctx.contactId, 'contact-existing', '應歸戶至既有聯絡人');
    assert.equal(log.createdContacts.length, 0, '不得重複建立聯絡人');
    assert.equal(log.createdIdentities.length, 0, '不得重複建立身分綁定');
    assert.equal(
      log.identityMapLookups.length,
      0,
      '已命中 channelIdentity 時走快路徑，不應再查 identityMap',
    );
  }

  // ── 5. 跨租戶：相同 UID 各自解析，互不污染 ───────────────────────────────
  {
    const logA = createLog();
    const dbA = createTenantDb({ log: logA, identityMapHit: { contactId: 'contact-tenant-a' } });
    const logB = createLog();
    const dbB = createTenantDb({ log: logB, identityMapHit: { contactId: 'contact-tenant-b' } });

    const sameUid = 'U-shared-literal';
    const a = await resolveUidToContact(dbA as any, 'tenant-a', 'LINE' as any, sameUid);
    const b = await resolveUidToContact(dbB as any, 'tenant-b', 'LINE' as any, sameUid);

    assert.equal(a, 'contact-tenant-a');
    assert.equal(b, 'contact-tenant-b');
    assert.equal(logA.identityMapLookups[0].self, dbA, '租戶 A 只能讀自己的連線');
    assert.equal(logB.identityMapLookups[0].self, dbB, '租戶 B 只能讀自己的連線');
    assert.equal(
      logA.identityMapLookups[0].where.tenantId_channelType_uid.tenantId,
      'tenant-a',
      '查詢條件必須帶上呼叫端指定的 tenantId',
    );
  }

  console.log('✔ inbound-contact-resolution：5 組情境全部通過（CM-175 防迴歸）');
}

run()
  .then(() => {
    // 與其他既有測試一致：明確退出，避免模組載入時建立的 Redis 連線讓程序掛住。
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
