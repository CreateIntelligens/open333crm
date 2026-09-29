/**
 * 統一合併引擎測試（change add-cross-channel-one-id，design D5 / D8）。
 *
 * 用記憶體內的假 Prisma 執行器：支援本引擎用到的 where 形狀（等值、in、OR、NOT），
 * 並模擬唯一鍵衝突（舊 approveMerge 的 tag updateMany 撞唯一鍵就是這類 bug）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mergeContacts, revertMerge, type MovedRecords } from '../modules/contact/contact-merge.service.js';

type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (matches(row, cond as Where)) return false;
      continue;
    }
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'in' in cond) {
      if (!(cond as { in: unknown[] }).in.includes(row[key])) return false;
      continue;
    }
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'gte' in cond) {
      if (!((row[key] as Date) >= (cond as { gte: Date }).gte)) return false;
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

function pick(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = row[k];
  return out;
}

/** 建立一張假表；unique 為唯一鍵欄位組，寫入後違反即丟錯（模擬 Postgres） */
function table(rows: Row[], unique: string[][] = []) {
  const assertUnique = () => {
    for (const cols of unique) {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = cols.map((c) => String(r[c])).join('|');
        if (seen.has(k)) throw new Error(`Unique constraint failed on (${cols.join(', ')})`);
        seen.add(k);
      }
    }
  };
  return {
    rows,
    async findMany(args: { where?: Where; select?: Record<string, boolean> } = {}) {
      return rows.filter((r) => matches(r, args.where)).map((r) => pick(r, args.select));
    },
    async findFirst(args: { where?: Where; select?: Record<string, boolean> } = {}) {
      const r = rows.find((row) => matches(row, args.where));
      return r ? pick(r, args.select) : null;
    },
    async updateMany(args: { where?: Where; data: Row }) {
      let count = 0;
      for (const r of rows) {
        if (!matches(r, args.where)) continue;
        Object.assign(r, args.data);
        count++;
      }
      assertUnique();
      return { count };
    },
    async update(args: { where?: Where; data: Row }) {
      const r = rows.find((row) => matches(row, args.where));
      if (!r) throw new Error('Record to update not found');
      Object.assign(r, args.data);
      assertUnique();
      return { ...r };
    },
    async deleteMany(args: { where?: Where }) {
      const keep = rows.filter((r) => !matches(r, args.where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
    async delete(args: { where?: Where }) {
      const i = rows.findIndex((r) => matches(r, args.where));
      if (i < 0) throw new Error('Record to delete not found');
      return rows.splice(i, 1)[0];
    },
    async create(args: { data: Row; select?: Record<string, boolean> }) {
      const r: Row = { id: randomUUID(), createdAt: new Date(), revertedAt: null, revertedBy: null, ...args.data };
      rows.push(r);
      assertUnique();
      return pick(r, args.select);
    },
  };
}

const T = 'tenant-a';
const OTHER_T = 'tenant-b';

function contact(id: string, extra: Row = {}): Row {
  return {
    id,
    tenantId: T,
    displayName: id,
    phone: null,
    email: null,
    avatarUrl: null,
    isArchived: false,
    mergedIntoId: null,
    ...extra,
  };
}

/** 建立 survivor(S) 與 merged(M) 兩個聯絡人，各表都有資料的完整場景 */
function makeDb() {
  const db = {
    contact: table([
      contact('S', { email: 's@example.com' }),
      contact('M', { phone: '0912345678', email: 'm@example.com', avatarUrl: 'https://img/m.png' }),
      contact('X'),
      contact('OLD', { isArchived: true, mergedIntoId: 'M' }),
      contact('B-1', { tenantId: OTHER_T }),
    ]),
    channelIdentity: table([
      { id: 'ci-s-line', contactId: 'S', channelId: 'ch-line' },
      { id: 'ci-m-fb', contactId: 'M', channelId: 'ch-fb' },
      { id: 'ci-m-ig', contactId: 'M', channelId: 'ch-ig' },
    ]),
    conversation: table([
      { id: 'conv-s', tenantId: T, contactId: 'S', channelId: 'ch-line', createdAt: new Date('2026-01-01') },
      { id: 'conv-m', tenantId: T, contactId: 'M', channelId: 'ch-fb', createdAt: new Date('2026-01-01') },
    ]),
    case: table([{ id: 'case-m', tenantId: T, contactId: 'M', channelId: 'ch-fb', createdAt: new Date('2026-01-01') }]),
    longTermMemory: table([{ id: 'ltm-m', contactId: 'M' }]),
    portalSubmission: table([{ id: 'ps-m', tenantId: T, contactId: 'M' }]),
    pointTransaction: table([{ id: 'pt-m', tenantId: T, contactId: 'M' }]),
    identityMap: table([{ id: 'im-m', tenantId: T, contactId: 'M' }]),
    clickLog: table([{ id: 'cl-m', contactId: 'M' }]),
    flowExecution: table([{ id: 'fe-m', tenantId: T, contactId: 'M' }]),
    kbArticleFeedback: table([{ id: 'kb-m', tenantId: T, contactId: 'M' }]),
    contactTag: table(
      [
        { id: 'tag-s-vip', contactId: 'S', tagId: 'vip', expiresAt: null },
        { id: 'tag-m-vip', contactId: 'M', tagId: 'vip', expiresAt: null },
        { id: 'tag-m-promo', contactId: 'M', tagId: 'promo', expiresAt: new Date('2026-12-31') },
      ],
      [['contactId', 'tagId']],
    ),
    contactAttribute: table(
      [
        { id: 'attr-s-level', contactId: 'S', key: 'level', value: 'gold' },
        { id: 'attr-m-level', contactId: 'M', key: 'level', value: 'silver' },
        { id: 'attr-m-city', contactId: 'M', key: 'city', value: '台北' },
      ],
      [['contactId', 'key']],
    ),
    broadcastRecipient: table(
      [
        { id: 'br-s-1', contactId: 'S', broadcastId: 'bc-1' },
        { id: 'br-m-1', contactId: 'M', broadcastId: 'bc-1' },
        { id: 'br-m-2', contactId: 'M', broadcastId: 'bc-2' },
      ],
      [['broadcastId', 'contactId']],
    ),
    contactRelation: table(
      [
        { id: 'rel-m-x', fromContactId: 'M', toContactId: 'X', relationType: 'family' },
        { id: 'rel-m-s', fromContactId: 'M', toContactId: 'S', relationType: 'friend' },
        { id: 'rel-x-s', fromContactId: 'X', toContactId: 'S', relationType: 'colleague' },
        { id: 'rel-x-m', fromContactId: 'X', toContactId: 'M', relationType: 'colleague' },
      ],
      [['fromContactId', 'toContactId', 'relationType']],
    ),
    mergeSuggestion: table([
      { id: 'sug-pending', tenantId: T, status: 'PENDING', primaryContactId: 'X', secondaryContactId: 'M' },
      { id: 'sug-other', tenantId: T, status: 'PENDING', primaryContactId: 'X', secondaryContactId: 'S' },
    ]),
    contactMergeLog: table([]),
  };
  return db;
}

type FakeDb = ReturnType<typeof makeDb>;
const asDb = (db: FakeDb) => db as never;
const owner = (db: FakeDb, t: keyof FakeDb, id: string) =>
  (db[t].rows as Row[]).find((r) => r.id === id)?.contactId;

test('合併：各表關聯資料全數搬到 survivor，merged 封存不刪除', async () => {
  const db = makeDb();
  const result = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  for (const [t, id] of [
    ['channelIdentity', 'ci-m-fb'],
    ['channelIdentity', 'ci-m-ig'],
    ['conversation', 'conv-m'],
    ['case', 'case-m'],
    ['longTermMemory', 'ltm-m'],
    ['portalSubmission', 'ps-m'],
    ['pointTransaction', 'pt-m'],
    ['identityMap', 'im-m'],
    ['clickLog', 'cl-m'],
    ['flowExecution', 'fe-m'],
    ['kbArticleFeedback', 'kb-m'],
  ] as const) {
    assert.equal(owner(db, t, id), 'S', `${t} ${id} 應搬到 survivor`);
  }

  const m = db.contact.rows.find((c) => c.id === 'M')!;
  assert.equal(m.isArchived, true);
  assert.equal(m.mergedIntoId, 'S');
  assert.ok(db.contact.rows.some((c) => c.id === 'M'), '被合併方只封存、不可刪除');

  assert.equal(db.contactMergeLog.rows.length, 1);
  const log = db.contactMergeLog.rows[0];
  assert.equal(log.id, result.mergeLogId);
  assert.equal(log.source, 'MANUAL');
  const moved = log.movedRecords as MovedRecords;
  assert.deepEqual(moved.channelIdentity.sort(), ['ci-m-fb', 'ci-m-ig']);
  assert.deepEqual(moved.pointTransaction, ['pt-m']);
});

test('合併：標籤去重且保留到期日，重複的不留在封存聯絡人上', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  const sTags = db.contactTag.rows.filter((r) => r.contactId === 'S').map((r) => r.tagId).sort();
  assert.deepEqual(sTags, ['promo', 'vip']);
  const promo = db.contactTag.rows.find((r) => r.tagId === 'promo')!;
  assert.deepEqual(promo.expiresAt, new Date('2026-12-31'), '搬移標籤須保留 expiresAt');
  assert.equal(db.contactTag.rows.filter((r) => r.contactId === 'M').length, 0);
});

test('合併：屬性衝突時 survivor 優先，其餘搬過去', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  const sAttrs = Object.fromEntries(
    db.contactAttribute.rows.filter((r) => r.contactId === 'S').map((r) => [r.key, r.value]),
  );
  assert.deepEqual(sAttrs, { level: 'gold', city: '台北' });
});

test('合併：廣播收件紀錄衝突的保留原處，不衝突的搬過去', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  assert.equal(owner(db, 'broadcastRecipient', 'br-m-2'), 'S');
  assert.equal(owner(db, 'broadcastRecipient', 'br-m-1'), 'M', '雙方都收過的廣播不刪、不搬');
  assert.equal(db.broadcastRecipient.rows.length, 3);
});

test('合併：聯絡人關係改指 survivor，自我關聯與重複的刪除', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  const rels = db.contactRelation.rows.map((r) => `${r.fromContactId}->${r.toContactId}:${r.relationType}`).sort();
  assert.deepEqual(rels, ['S->X:family', 'X->S:colleague']);
});

test('合併：survivor 空欄由 merged 補，已有值不覆蓋', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  const s = db.contact.rows.find((c) => c.id === 'S')!;
  assert.equal(s.phone, '0912345678');
  assert.equal(s.avatarUrl, 'https://img/m.png');
  assert.equal(s.email, 's@example.com');
});

test('合併：待審建議改為 SUPERSEDED，先前併入 merged 的聯絡人改指 survivor', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });

  assert.equal(db.mergeSuggestion.rows.find((r) => r.id === 'sug-pending')!.status, 'SUPERSEDED');
  assert.equal(db.mergeSuggestion.rows.find((r) => r.id === 'sug-other')!.status, 'PENDING');
  assert.equal(db.contact.rows.find((c) => c.id === 'OLD')!.mergedIntoId, 'S');
});

test('合併：跨租戶、自己合併自己、已封存都拒絕且不動任何資料', async () => {
  const db = makeDb();
  const before = JSON.stringify(db);

  await assert.rejects(
    mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'B-1', source: 'MANUAL' }),
    (e: { statusCode?: number }) => e.statusCode === 404,
  );
  await assert.rejects(
    mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'S', source: 'MANUAL' }),
    (e: { statusCode?: number }) => e.statusCode === 400,
  );
  await assert.rejects(
    mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'OLD', source: 'MANUAL' }),
    (e: { statusCode?: number }) => e.statusCode === 400,
  );
  assert.equal(JSON.stringify(db), before);
});

test('解除：恢復被合併方與當次搬走的渠道身分／對話／點數，標籤屬性不回收', async () => {
  const db = makeDb();
  const { mergeLogId } = await mergeContacts(asDb(db), {
    tenantId: T,
    survivorId: 'S',
    mergedId: 'M',
    source: 'BINDING_CODE',
  });

  const result = await revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'customer' });
  assert.equal(result.restoredContactId, 'M');

  const m = db.contact.rows.find((c) => c.id === 'M')!;
  assert.equal(m.isArchived, false);
  assert.equal(m.mergedIntoId, null);
  for (const [t, id] of [
    ['channelIdentity', 'ci-m-fb'],
    ['conversation', 'conv-m'],
    ['case', 'case-m'],
    ['pointTransaction', 'pt-m'],
    ['portalSubmission', 'ps-m'],
    ['identityMap', 'im-m'],
  ] as const) {
    assert.equal(owner(db, t, id), 'M', `${t} ${id} 應搬回`);
  }
  assert.equal(owner(db, 'channelIdentity', 'ci-s-line'), 'S', 'survivor 原有的不可被搬走');
  assert.equal(db.contactTag.rows.find((r) => r.tagId === 'promo')!.contactId, 'S', '標籤不回收');

  const log = db.contactMergeLog.rows[0];
  assert.ok(log.revertedAt instanceof Date);
  assert.equal(log.revertedBy, 'customer');
});

test('解除：AI 長期記憶與合併後才新開的該渠道對話／案件也搬回', async () => {
  const db = makeDb();
  const { mergeLogId } = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'BINDING_CODE' });
  // 合併後顧客從 FB 再進線，對話與案件開在 survivor 身上
  db.conversation.rows.push({ id: 'conv-after', tenantId: T, contactId: 'S', channelId: 'ch-fb', createdAt: new Date(Date.now() + 1000) });
  db.case.rows.push({ id: 'case-after', tenantId: T, contactId: 'S', channelId: 'ch-fb', createdAt: new Date(Date.now() + 1000) });

  await revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'customer' });
  assert.equal(owner(db, 'longTermMemory', 'ltm-m'), 'M', 'AI 記憶不可留在對方身上');
  assert.equal(owner(db, 'clickLog', 'cl-m'), 'M');
  assert.equal(owner(db, 'conversation', 'conv-after'), 'M', '合併後新開的 FB 對話跟著 FB 身分回去');
  assert.equal(owner(db, 'case', 'case-after'), 'M');
  assert.equal(owner(db, 'conversation', 'conv-s'), 'S', 'survivor 原有 LINE 對話不動');
});

test('解除：重複解除回 409', async () => {
  const db = makeDb();
  const { mergeLogId } = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  await revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'agent-1' });
  await assert.rejects(
    revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'agent-1' }),
    (e: { statusCode?: number }) => e.statusCode === 409,
  );
});

test('解除：他租戶的合併紀錄回 404', async () => {
  const db = makeDb();
  const { mergeLogId } = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  await assert.rejects(
    revertMerge(asDb(db), { tenantId: OTHER_T, mergeLogId, revertedBy: 'agent-1' }),
    (e: { statusCode?: number }) => e.statusCode === 404,
  );
});

test('解除：survivor 之後又被併入別人，資料從最終持有者身上搬回', async () => {
  const db = makeDb();
  const first = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'BINDING_CODE' });
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'X', mergedId: 'S', source: 'MANUAL' });
  assert.equal(owner(db, 'conversation', 'conv-m'), 'X');

  const result = await revertMerge(asDb(db), { tenantId: T, mergeLogId: first.mergeLogId, revertedBy: 'agent-1' });
  assert.equal(result.holderId, 'X');
  assert.equal(owner(db, 'conversation', 'conv-m'), 'M');
  assert.equal(owner(db, 'channelIdentity', 'ci-m-ig'), 'M');
  assert.equal(owner(db, 'conversation', 'conv-s'), 'X', '不屬於該次合併的資料不動');
});
