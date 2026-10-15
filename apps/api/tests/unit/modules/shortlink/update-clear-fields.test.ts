/**
 * 編輯短連結時可以清空選填欄位（M02，2026-10-15 手冊盤點發現）。
 *
 * 修正前：清空標題、UTM、社群預覽、點擊貼標時前端送 undefined，後端當成「這欄不動」，
 * 只有到期時間與 LINE 渠道能清掉。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { updateShortLink } from '#src/modules/shortlink/shortlink.service.js';
import { updateShortlinkSchema } from '#src/modules/shortlink/shortlink.routes.js';

const CLEARABLE = [
  'title',
  'ogTitle',
  'ogDescription',
  'ogImage',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'tagOnClick',
] as const;

function fakeDb() {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    shortLink: {
      findFirst: async () => ({ id: 'l-1', tenantId: 't-1', targetUrl: 'https://example.com' }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: 'l-1', targetUrl: 'https://example.com', ...data };
      },
    },
  };
  return { db: db as never, updates };
}

test('空字串代表清除：選填欄位存成 null', async () => {
  const { db, updates } = fakeDb();
  const body = Object.fromEntries(CLEARABLE.map((k) => [k, '']));
  await updateShortLink(db, 'l-1', 't-1', body);
  for (const k of CLEARABLE) assert.equal(updates[0][k], null, `${k} 應清成 null`);
});

test('沒帶的欄位維持不動', async () => {
  const { db, updates } = fakeDb();
  await updateShortLink(db, 'l-1', 't-1', { title: '新標題' });
  assert.equal(updates[0].title, '新標題');
  assert.equal(updates[0].utmSource, undefined);
});

test('更新的驗證規則接受清空的社群預覽圖片', () => {
  const parsed = updateShortlinkSchema.parse({ ogImage: '', title: '', utmSource: '' });
  assert.equal(parsed.ogImage, '');
});
