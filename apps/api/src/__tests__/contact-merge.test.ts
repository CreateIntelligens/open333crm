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

type OrderBy = Record<string, 'asc' | 'desc'>;

/** 支援單一欄位排序（點數帳本以 createdAt desc 取最新一筆餘額） */
function sorted(list: Row[], orderBy?: OrderBy): Row[] {
  const [key, dir] = Object.entries(orderBy ?? {})[0] ?? [];
  if (!key) return list;
  const val = (r: Row) => (r[key] instanceof Date ? (r[key] as Date).getTime() : (r[key] as number));
  return [...list].sort((a, b) => (dir === 'desc' ? val(b) - val(a) : val(a) - val(b)));
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
    async findMany(args: { where?: Where; select?: Record<string, boolean>; orderBy?: OrderBy } = {}) {
      return sorted(rows.filter((r) => matches(r, args.where)), args.orderBy).map((r) => pick(r, args.select));
    },
    async findFirst(args: { where?: Where; select?: Record<string, boolean>; orderBy?: OrderBy } = {}) {
      const r = sorted(rows.filter((row) => matches(row, args.where)), args.orderBy)[0];
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
    pointTransaction: table([
      { id: 'pt-s', tenantId: T, contactId: 'S', amount: 100, balance: 100, createdAt: new Date('2026-01-01') },
      // 被合併方的最新交易比 survivor 新：舊寫法直接搬交易會讓 survivor 餘額變成 50
      { id: 'pt-m', tenantId: T, contactId: 'M', amount: 50, balance: 50, createdAt: new Date('2026-02-01') },
    ]),
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
  assert.equal(moved.pointsTransferred, 50);
});

const balanceOf = (db: FakeDb, contactId: string) =>
  [...(db.pointTransaction.rows as Row[])]
    .filter((r) => r.contactId === contactId)
    .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0]?.balance ?? 0;

test('合併：點數以轉出／轉入兩筆交易合計，不直接搬交易（帳本 append-only）', async () => {
  const db = makeDb();
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  assert.equal(balanceOf(db, 'S'), 150, 'survivor 餘額＝雙方合計');
  assert.equal(balanceOf(db, 'M'), 0, '被合併方轉出後為 0');
  assert.equal(owner(db, 'pointTransaction', 'pt-m'), 'M', '原交易留在原主人的帳本上');
  const types = (db.pointTransaction.rows as Row[]).map((r) => r.type).filter(Boolean).sort();
  assert.deepEqual(types, ['merge_transfer_in', 'merge_transfer_out']);
});

test('解除：點數轉回；合併後已用掉部分時只轉回剩餘的', async () => {
  const db = makeDb();
  const full = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  await revertMerge(asDb(db), { tenantId: T, mergeLogId: full.mergeLogId, revertedBy: 'agent-1' });
  assert.equal(balanceOf(db, 'M'), 50);
  assert.equal(balanceOf(db, 'S'), 100);

  const db2 = makeDb();
  const r = await mergeContacts(asDb(db2), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  // 合併後 survivor 用掉 120 點，只剩 30
  db2.pointTransaction.rows.push({ id: 'pt-spend', tenantId: T, contactId: 'S', amount: -120, balance: 30, createdAt: new Date(Date.now() + 5000) });
  await revertMerge(asDb(db2), { tenantId: T, mergeLogId: r.mergeLogId, revertedBy: 'agent-1' });
  assert.equal(balanceOf(db2, 'M'), 30, '只轉回剩餘的 30 點');
  assert.equal(balanceOf(db2, 'S'), 0, 'survivor 不會變負數');
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
    ['portalSubmission', 'ps-m'],
    ['identityMap', 'im-m'],
  ] as const) {
    assert.equal(owner(db, t, id), 'M', `${t} ${id} 應搬回`);
  }
  assert.equal(owner(db, 'channelIdentity', 'ci-s-line'), 'S', 'survivor 原有的不可被搬走');
  const sAfter = db.contact.rows.find((c) => c.id === 'S')!;
  assert.equal(sAfter.phone, null, '合併時從對方補來的電話，解除後不可留在 survivor 身上');
  assert.equal(sAfter.avatarUrl, null);
  assert.equal(sAfter.email, 's@example.com', 'survivor 原本的 email 不動');
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

test('解除：雙方在同一渠道都有身分（手動合併不擋）時，不搬 survivor 自己的新對話', async () => {
  const db = makeDb();
  // M 也有一個 LINE（同渠道 ch-line）身分；手動合併不會擋
  db.channelIdentity.rows.push({ id: 'ci-m-line', contactId: 'M', channelId: 'ch-line' });
  const { mergeLogId } = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  // 合併後 S 自己的 LINE 帳號開了新對話
  db.conversation.rows.push({ id: 'conv-s-after', tenantId: T, contactId: 'S', channelId: 'ch-line', createdAt: new Date(Date.now() + 1000) });

  await revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'agent-1' });
  assert.equal(owner(db, 'conversation', 'conv-s-after'), 'S', '無法分辨屬於誰時寧可不搬');
});

test('解除：合併時被壓平改指 survivor 的聯絡人，解除後改回指向被恢復方', async () => {
  const db = makeDb();
  const { mergeLogId } = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' });
  assert.equal(db.contact.rows.find((c) => c.id === 'OLD')!.mergedIntoId, 'S');
  await revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'agent-1' });
  assert.equal(db.contact.rows.find((c) => c.id === 'OLD')!.mergedIntoId, 'M', '合併鏈還原，之後從 OLD 出發才找得到正確持有者');
});

test('解除：顧客與客服同時解除，只有一個成功，點數不會轉回兩次', async () => {
  const db = makeDb();
  const { mergeLogId } = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'BINDING_CODE' });
  const results = await Promise.allSettled([
    revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'customer' }),
    revertMerge(asDb(db), { tenantId: T, mergeLogId, revertedBy: 'agent-1' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as { statusCode?: number }).statusCode, 409);
  assert.equal(balanceOf(db, 'M'), 50, '只轉回一次');
  assert.equal(balanceOf(db, 'S'), 100);
});

test('合併：同一聯絡人同時被併入兩個對象，只有一個成功', async () => {
  const db = makeDb();
  const results = await Promise.allSettled([
    mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'MANUAL' }),
    mergeContacts(asDb(db), { tenantId: T, survivorId: 'X', mergedId: 'M', source: 'MANUAL' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as { statusCode?: number }).statusCode, 409, '由佔用檢查擋下，而不是中途撞錯');
  assert.equal(db.contactMergeLog.rows.length, 1);
});

test('解除：survivor 之後又被併入別人，從對方補來的電話也要從後續持有者身上清掉', async () => {
  const db = makeDb();
  // M(有電話) 併入 S(沒電話) → S 補上電話；S 再併入 X(沒電話) → X 也補上
  const first = await mergeContacts(asDb(db), { tenantId: T, survivorId: 'S', mergedId: 'M', source: 'BINDING_CODE' });
  await mergeContacts(asDb(db), { tenantId: T, survivorId: 'X', mergedId: 'S', source: 'MANUAL' });
  assert.equal(db.contact.rows.find((c) => c.id === 'X')!.phone, '0912345678');

  await revertMerge(asDb(db), { tenantId: T, mergeLogId: first.mergeLogId, revertedBy: 'customer' });
  assert.equal(db.contact.rows.find((c) => c.id === 'X')!.phone, null, '個資不可留在後續持有者身上');
  assert.equal(db.contact.rows.find((c) => c.id === 'M')!.phone, '0912345678', '被恢復方保有自己的電話');
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
