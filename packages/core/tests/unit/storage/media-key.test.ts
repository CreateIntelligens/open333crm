/**
 * 訊息媒體檔 key 的格式檢查（資料刪除與 #474 回收腳本共用）與 MinioStorageProvider.list（issue #474）。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test, vi } from 'vitest';

const listing = vi.hoisted(() => ({ items: [] as Array<{ name?: string }>, error: null as Error | null, calls: [] as unknown[][] }));
vi.mock('minio', () => ({
  Client: class {
    listObjectsV2(...args: unknown[]) {
      listing.calls.push(args);
      const stream = new EventEmitter();
      setTimeout(() => {
        for (const item of listing.items) stream.emit('data', item);
        if (listing.error) stream.emit('error', listing.error);
        else stream.emit('end');
      }, 0);
      return stream;
    }
  },
}));

const { isConversationMediaKey } = await import('#src/storage/media-key.js');
const { MinioStorageProvider } = await import('#src/storage/minio-provider.js');

const T = 'a0000000-0000-0000-0000-000000000001';
const CONV = 'c0000000-0000-0000-0000-00000000000c';
const FILE = '0a1b2c3d-0000-4000-8000-000000000001';
const convs = new Set([CONV]);

test('符合 {tenantId}/media/{對話}/{uuid}.ext 或沒有副檔名的 key', () => {
  assert.equal(isConversationMediaKey(`${T}/media/${CONV}/${FILE}.jpg`, T, convs), true);
  assert.equal(isConversationMediaKey(`${T}/media/${CONV}/${FILE}`, T, convs), true);
});

test('其他租戶、其他對話、其他目錄、非 uuid 檔名、多層路徑都不符合', () => {
  assert.equal(isConversationMediaKey(`b0000000-0000-0000-0000-00000000000b/media/${CONV}/${FILE}.jpg`, T, convs), false);
  assert.equal(isConversationMediaKey(`${T}/media/d0000000-0000-0000-0000-00000000000d/${FILE}.jpg`, T, convs), false);
  assert.equal(isConversationMediaKey(`${T}/avatars/${CONV}/${FILE}.jpg`, T, convs), false);
  assert.equal(isConversationMediaKey(`${T}/media/${CONV}/report.csv`, T, convs), false);
  assert.equal(isConversationMediaKey(`${T}/media/${CONV}/${FILE}.jpg/../x.jpg`, T, convs), false);
});

test('list 遞迴列出前綴底下所有物件的 key', async () => {
  listing.items = [{ name: 'a/1.jpg' }, { name: 'a/b/2.jpg' }, {}];
  listing.error = null;
  listing.calls.length = 0;
  const keys = await new MinioStorageProvider().list('bucket', 'a/');
  assert.deepEqual(keys, ['a/1.jpg', 'a/b/2.jpg']);
  assert.deepEqual(listing.calls, [['bucket', 'a/', true]]);
});

test('list 途中出錯時整個丟出，不回傳部分結果', async () => {
  listing.items = [{ name: 'a/1.jpg' }];
  listing.error = new Error('minio down');
  await assert.rejects(new MinioStorageProvider().list('bucket', 'a/'), /minio down/);
});
