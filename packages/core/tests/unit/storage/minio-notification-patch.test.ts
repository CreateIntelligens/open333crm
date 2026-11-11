/**
 * patches/minio@8.0.7.patch 的回歸測試（issue #382 第 3 項）。
 *
 * 這個 patch 把 minio 的 NotificationPoller 從 stream-json 的 jsonl Parser 換成
 * stream-chain 的 jsonl parser。原本 CJS 版本（dist/main/notification.js）呼叫
 * `_Parser.asStream()`，但 `require('stream-chain/node/jsonl/parser.js')` 只在
 * `default` 匯出上有 `asStream`，所以 CJS 路徑一收到回應就丟 TypeError。
 *
 * 測試不連 MinIO：用假的 client 讓 makeRequestAsync 回傳一段 JSON Lines 串流，
 * 確認 poller 會把 Records 逐筆以 `notification` 事件送出。ESM 與 CJS 各測一次，
 * 這樣兩個 dist 版本的 patch 都有覆蓋。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { test } from 'vitest';

type PollerLike = {
  on(event: string, fn: (arg: unknown) => void): unknown;
  start(): void;
  stop(): void;
};
type PollerCtor = new (
  client: unknown,
  bucketName: string,
  prefix: string,
  suffix: string,
  events: string[],
) => PollerLike;

const RECORD = { eventName: 's3:ObjectCreated:Put', s3: { object: { key: 'a.png' } } };

/**
 * @description 用假的 client 跑一輪 NotificationPoller，回傳第一筆 notification 或 error
 * @param NotificationPoller 要測的 NotificationPoller 類別（ESM 或 CJS 載入）
 * @returns 第一個收到的事件
 */
function pollOnce(NotificationPoller: PollerCtor): Promise<{ type: 'notification' | 'error'; value: unknown }> {
  const fakeClient = {
    region: 'us-east-1',
    // 第一次回傳一行 JSON；之後的輪詢回傳空串流，避免測試結束前一直重跑
    calls: 0,
    makeRequestAsync() {
      this.calls += 1;
      const body = this.calls === 1 ? [`${JSON.stringify({ Records: [RECORD] })}\n`] : [];
      return Promise.resolve(Readable.from(body));
    },
  };
  const poller = new NotificationPoller(fakeClient, 'bucket', '', '', ['s3:ObjectCreated:*']);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      poller.stop();
      resolve({ type: 'error', value: new Error('timeout: poller 沒有送出任何事件') });
    }, 2000);
    const finish = (type: 'notification' | 'error') => (value: unknown) => {
      clearTimeout(timer);
      poller.stop();
      resolve({ type, value });
    };
    poller.on('notification', finish('notification'));
    poller.on('error', finish('error'));
    poller.start();
  });
}

test('ESM 載入 minio 後可以建立 NotificationPoller，並把 JSON Lines 的 Records 送成 notification 事件', async () => {
  const minio = (await import('minio')) as unknown as { NotificationPoller: PollerCtor };
  assert.equal(typeof minio.NotificationPoller, 'function');

  const result = await pollOnce(minio.NotificationPoller);

  assert.equal(result.type, 'notification', `預期 notification，實際收到：${String(result.value)}`);
  assert.deepEqual(result.value, RECORD);
});

test('CJS require("minio") 的 NotificationPoller 不會因 _Parser.asStream 丟 TypeError', async () => {
  const require = createRequire(import.meta.url);
  // 確認真的拿到 CJS 版本（dist/main），不是 ESM
  assert.match(require.resolve('minio'), /dist[\\/]main[\\/]/);
  const minio = require('minio') as { NotificationPoller: PollerCtor };

  const result = await pollOnce(minio.NotificationPoller);

  assert.equal(result.type, 'notification', `預期 notification，實際收到：${String(result.value)}`);
  assert.deepEqual(result.value, RECORD);
});
