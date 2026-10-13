/**
 * 建立與更新素材時會檢查 FB 版型內容（change validate-fb-material-content，spec material-system）。
 * 規則本身見 fb-material-validation.test.ts；這裡只確認 createMaterial()／updateMaterial() 有呼叫它。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createMaterial, restoreMaterialVersion, updateMaterial } from '#src/modules/marketing/material.service.js';

const T = 'tenant-a';

function fakeDb(existingBody: Record<string, unknown> = { title: '舊標題' }) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    material: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'm1', ...data };
      },
      findUnique: async () => ({ id: 'm1', tenantId: T, channelType: 'fb', contentType: 'fb_coupon', body: existingBody, template: null }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'm1', ...data };
      },
    },
    // 更新後寫版本紀錄（writeMaterialVersion）
    materialVersion: {
      findFirst: async () => null,
      create: async () => ({}),
      // 還原用的舊版內容：圖片網址是 javascript:（修正前存進去的）
      findUnique: async () => ({ name: '舊版', body: { title: '券', image_url: 'javascript:alert(1)' } }),
    },
  };
  return { db: db as never, writes };
}

const is400 = (e: { statusCode?: number }) => e.statusCode === 400;

test('createMaterial：FB 優惠券標題空白回 400，不建立', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(
    createMaterial(db, T, { name: '[E2E] 券', channelType: 'fb', contentType: 'fb_coupon', body: { title: '' } }),
    is400,
  );
  assert.equal(writes.length, 0);
});

test('updateMaterial：送出不合法的 FB 內容回 400，不更新', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(updateMaterial(db, 'm1', T, { body: { title: 'x', image_url: 'javascript:alert(1)' } }), is400);
  assert.equal(writes.length, 0);
});

test('updateMaterial：沒送 body（只改名稱）時不檢查既有內容', async () => {
  const { db, writes } = fakeDb({ title: '' });
  await updateMaterial(db, 'm1', T, { name: '改名' });
  assert.equal(writes.length, 1);
});

test('restoreMaterialVersion：還原成不合法的 FB 舊版內容回 400，不寫回', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(restoreMaterialVersion(db, 'm1', 1, T, null), is400);
  assert.equal(writes.length, 0);
});
