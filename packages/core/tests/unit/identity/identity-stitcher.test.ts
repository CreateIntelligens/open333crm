/**
 * Identity Stitcher 不把已封存（被合併）的聯絡人當成比對對象（issue #253 測試缺口，原 add-cross-channel-one-id 9.6）。
 * 被合併的聯絡人保留原本的 email 與手機，比對時若沒排除，新身分會掛到已封存的聯絡人上。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { detectPhoneDuplicates, stitchByLiffCookie, stitchByPhone, type PrismaExecutor } from '#src/identity/identity-stitcher.js';

const T = 'a0000000-0000-0000-0000-000000000001';

interface Row {
  id: string;
  tenantId: string;
  email: string | null;
  phone: string | null;
  isArchived: boolean;
}

/** 依 where 的欄位比對記憶體裡的聯絡人；只實作 stitcher 用到的條件 */
function fakeDb(rows: Row[]) {
  const upserts: Array<{ create: { contactId: string } }> = [];
  const suggestions: Array<{ primaryContactId: string; secondaryContactId: string }> = [];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key as keyof Row];
      if (cond && typeof cond === 'object' && 'not' in cond) return value !== (cond as { not: unknown }).not;
      return value === cond;
    });
  const db = {
    contact: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)),
    },
    identityMap: { upsert: async (args: { create: { contactId: string } }) => void upserts.push(args) },
    mergeSuggestion: {
      findFirst: async () => null,
      create: async ({ data }: { data: { primaryContactId: string; secondaryContactId: string } }) => void suggestions.push(data),
    },
  };
  return { db: db as unknown as PrismaExecutor, upserts, suggestions };
}

// 手機以 normalizePhone() 去掉 + 與分隔符號之後的格式比對
const archived: Row = { id: 'archived', tenantId: T, email: 'a@example.test', phone: '886912345678', isArchived: true };
const active: Row = { id: 'active', tenantId: T, email: 'b@example.test', phone: '886987654321', isArchived: false };

test('LIFF cookie 比對：email 只屬於已封存的聯絡人時不掛上，回 null', async () => {
  const { db, upserts } = fakeDb([archived, active]);
  assert.equal(await stitchByLiffCookie(db, T, 'LINE', 'U1', 'a@example.test'), null);
  assert.equal(upserts.length, 0);
  assert.equal(await stitchByLiffCookie(db, T, 'LINE', 'U2', 'b@example.test'), 'active');
});

test('手機比對：手機只屬於已封存的聯絡人時不掛上，回 null', async () => {
  const { db, upserts } = fakeDb([archived, active]);
  assert.equal(await stitchByPhone(db, T, 'LINE', 'U1', '+886912345678'), null);
  assert.equal(upserts.length, 0);
  assert.equal(await stitchByPhone(db, T, 'LINE', 'U2', '+886987654321'), 'active');
});

test('重複手機偵測：已封存的聯絡人不算進重複', async () => {
  const sharedPhone = '886900000000';
  const { db, suggestions } = fakeDb([
    { ...archived, phone: sharedPhone },
    { ...active, phone: sharedPhone },
  ]);
  assert.equal(await detectPhoneDuplicates(db, T), 0);
  assert.equal(suggestions.length, 0);
});
