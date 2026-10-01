/**
 * FB / IG webhook 解析帶出 accountId（= entry.id），入站管線依此分派渠道與租戶
 * （change fix-meta-webhook-page-routing，tasks 2.4）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FbPlugin } from '../facebook/index.js';
import { ThreadsPlugin } from '../threads.js';

const fb = new FbPlugin();
const ig = new ThreadsPlugin();
const body = (o: unknown) => Buffer.from(JSON.stringify(o));
const fbEvent = (psid: string, page: string, text: string) => ({
  sender: { id: psid }, recipient: { id: page }, timestamp: 1000, message: { mid: `m-${psid}`, text },
});
const igEvent = (igsid: string, biz: string, text: string) => ({
  sender: { id: igsid }, recipient: { id: biz }, timestamp: 1000, message: { mid: `m-${igsid}`, text },
});

test('FB：每則訊息帶所屬粉專 accountId', async () => {
  const [m] = await fb.parseWebhook(body({ object: 'page', entry: [{ id: 'PAGE1', messaging: [fbEvent('PSID1', 'PAGE1', 'hi')] }] }), {});
  assert.equal(m!.accountId, 'PAGE1');
});

test('FB：一包多個粉專，各自帶自己的 accountId', async () => {
  const msgs = await fb.parseWebhook(
    body({
      object: 'page',
      entry: [
        { id: 'PAGE1', messaging: [fbEvent('PSID1', 'PAGE1', 'a'), fbEvent('PSID2', 'PAGE1', 'b')] },
        { id: 'PAGE2', messaging: [fbEvent('PSID3', 'PAGE2', 'c')] },
      ],
    }),
    {},
  );
  assert.deepEqual(msgs.map((m) => [m.contactUid, m.accountId]), [
    ['PSID1', 'PAGE1'],
    ['PSID2', 'PAGE1'],
    ['PSID3', 'PAGE2'],
  ]);
});

test('FB：數字型 entry.id 轉成字串', async () => {
  const [m] = await fb.parseWebhook(body({ object: 'page', entry: [{ id: 1132326913296788, messaging: [fbEvent('P', '1132326913296788', 'x')] }] }), {});
  assert.equal(m!.accountId, '1132326913296788');
});

test('FB：referral 與 postback 事件也帶 accountId', async () => {
  const msgs = await fb.parseWebhook(
    body({
      object: 'page',
      entry: [{
        id: 'PAGE1',
        messaging: [
          { sender: { id: 'P' }, recipient: { id: 'PAGE1' }, timestamp: 1, referral: { ref: 'BIND-7K2M9QH4TX' } },
          { sender: { id: 'P' }, recipient: { id: 'PAGE1' }, timestamp: 2, postback: { mid: 'pb1', title: '開始使用' } },
        ],
      }],
    }),
    {},
  );
  assert.deepEqual(msgs.map((m) => [m.contentType, m.accountId]), [['referral', 'PAGE1'], ['postback', 'PAGE1']]);
});

test('IG：一包多個帳號，各自帶自己的 accountId', async () => {
  const msgs = await ig.parseWebhook(
    body({
      object: 'instagram',
      entry: [
        { id: 'IG1', messaging: [igEvent('S1', 'IG1', 'a')] },
        { id: 'IG2', messaging: [igEvent('S2', 'IG2', 'b')] },
      ],
    }),
    {},
  );
  assert.deepEqual(msgs.map((m) => [m.contactUid, m.accountId]), [['S1', 'IG1'], ['S2', 'IG2']]);
});

test('IG：非 instagram 物件的 payload 不解析', async () => {
  const msgs = await ig.parseWebhook(body({ object: 'page', entry: [{ id: 'IG1', messaging: [igEvent('S1', 'IG1', 'a')] }] }), {});
  assert.equal(msgs.length, 0);
});
