/**
 * 客服修改 email 與他人重複時須確認（change add-email-identity-merge，spec email-identity-merge）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updateContact } from '#src/modules/contact/contact.service.js';
import { AppError } from '#src/shared/utils/response.js';

const TENANT = 'tenant-1';

function mockDb(contacts: Array<{ id: string; displayName: string; email: string | null; isArchived?: boolean }>) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const matches = (c: (typeof contacts)[number], where: Record<string, any>) => {
    if (where.id && typeof where.id === 'string' && c.id !== where.id) return false;
    if (where.id?.not && c.id === where.id.not) return false;
    if (where.isArchived === false && c.isArchived) return false;
    if (where.email?.equals) {
      const eq = where.email.mode === 'insensitive'
        ? (c.email ?? '').toLowerCase() === where.email.equals.toLowerCase()
        : c.email === where.email.equals;
      if (!eq) return false;
    }
    return true;
  };
  const db = {
    contact: {
      findFirst: async ({ where }: { where: Record<string, any> }) => contacts.find((c) => matches(c, where)) ?? null,
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return { id: 'a', ...args.data };
      },
    },
  };
  return { db: db as never, updates };
}

const people = () => [
  { id: 'a', displayName: '小明', email: null },
  { id: 'b', displayName: '王小美', email: 'Amy@example.com' },
];

test('改成他人的 email', async () => {
  const { db, updates } = mockDb(people());
  await assert.rejects(
    () => updateContact(db, 'a', TENANT, { email: 'amy@example.com' }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'EMAIL_IN_USE');
      assert.deepEqual(err.details, { contactId: 'b', displayName: '王小美' });
      return true;
    },
  );
  assert.equal(updates.length, 0, '不更改資料');
});

test('確認後仍要儲存', async () => {
  const { db, updates } = mockDb(people());
  await updateContact(db, 'a', TENANT, { email: 'amy@example.com', allowDuplicateEmail: true });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.email, 'amy@example.com');
  assert.ok(!('allowDuplicateEmail' in updates[0].data), '確認旗標不寫進資料庫');
});

test('沒有他人使用、清除 email、或只改其他欄位時不檢查', async () => {
  const { db, updates } = mockDb([...people(), { id: 'c', displayName: '封存', email: 'old@example.com', isArchived: true }]);
  await updateContact(db, 'a', TENANT, { email: 'new@example.com' });
  await updateContact(db, 'a', TENANT, { email: 'old@example.com' });
  await updateContact(db, 'a', TENANT, { email: null });
  await updateContact(db, 'a', TENANT, { displayName: '小明二號' });
  assert.equal(updates.length, 4);
});
