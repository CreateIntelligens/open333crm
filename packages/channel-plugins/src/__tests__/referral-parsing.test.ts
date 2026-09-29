/**
 * FB / IG referral 解析（change add-cross-channel-one-id，tasks 5.5）。
 * m.me / ig.me 的 ?ref= 依「是否已有對話」送達位置不同（見 design D4），三種位置都要解析。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FbPlugin } from '../facebook/index.js';
import { ThreadsPlugin } from '../threads.js';

const fb = new FbPlugin();
const ig = new ThreadsPlugin();
const body = (o: unknown) => Buffer.from(JSON.stringify(o));
const fbPayload = (event: Record<string, unknown>) =>
  body({ object: 'page', entry: [{ id: 'PAGE', time: 1, messaging: [{ sender: { id: 'PSID' }, recipient: { id: 'PAGE' }, timestamp: 1000, ...event }] }] });
const igPayload = (event: Record<string, unknown>) =>
  body({ object: 'instagram', entry: [{ id: 'IGBIZ', time: 1, messaging: [{ sender: { id: 'IGSID' }, recipient: { id: 'IGBIZ' }, timestamp: 1000, ...event }] }] });

test('FB 既有對話：獨立 referral 事件 → contentType referral 並帶 ref', async () => {
  const [m, ...rest] = await fb.parseWebhook(
    fbPayload({ referral: { ref: 'BIND-7K2M9QH4TX', source: 'SHORTLINK', type: 'OPEN_THREAD' } }),
    {},
  );
  assert.equal(rest.length, 0);
  assert.equal(m.contentType, 'referral');
  assert.equal(m.referralRef, 'BIND-7K2M9QH4TX');
  assert.equal(m.contactUid, 'PSID');
});

test('FB 新對話：ref 夾在「開始使用」postback 裡', async () => {
  const [m] = await fb.parseWebhook(
    fbPayload({ postback: { title: '開始使用', payload: 'GET_STARTED', referral: { ref: 'BIND-7K2M9QH4TX', source: 'SHORTLINK', type: 'OPEN_THREAD' } } }),
    {},
  );
  assert.equal(m.contentType, 'postback');
  assert.equal(m.referralRef, 'BIND-7K2M9QH4TX');
});

test('FB 訊息夾帶 referral 也取出 ref', async () => {
  const [m] = await fb.parseWebhook(fbPayload({ message: { mid: 'm1', text: 'hi', referral: { ref: 'BIND-7K2M9QH4TX' } } }), {});
  assert.equal(m.contentType, 'text');
  assert.equal(m.referralRef, 'BIND-7K2M9QH4TX');
});

test('FB 一般訊息與無 ref 的 referral 不受影響', async () => {
  const [m] = await fb.parseWebhook(fbPayload({ message: { mid: 'm1', text: 'hi' } }), {});
  assert.equal(m.referralRef, undefined);
  const none = await fb.parseWebhook(fbPayload({ referral: { source: 'ADS', type: 'OPEN_THREAD' } }), {});
  assert.equal(none.length, 0, '沒有 ref 的 referral 不產生事件');
});

test('IG 既有對話：messaging_referral → contentType referral 並帶 ref（不再因缺 mid 被跳過）', async () => {
  const [m] = await ig.parseWebhook(igPayload({ referral: { ref: 'BIND-7K2M9QH4TX', source: 'SHORTLINKS', type: 'OPEN_THREAD' } }), {});
  assert.equal(m.contentType, 'referral');
  assert.equal(m.referralRef, 'BIND-7K2M9QH4TX');
  assert.equal(m.contactUid, 'IGSID');
});

test('IG 新對話：ref 夾在第一則訊息裡', async () => {
  const [m] = await ig.parseWebhook(igPayload({ message: { mid: 'mid1', text: '你好', referral: { ref: 'BIND-7K2M9QH4TX' } } }), {});
  assert.equal(m.contentType, 'text');
  assert.equal(m.referralRef, 'BIND-7K2M9QH4TX');
});

test('IG 新對話：ref 夾在 Icebreaker postback 裡', async () => {
  const [m] = await ig.parseWebhook(igPayload({ postback: { title: '我想了解方案', payload: 'IB1', referral: { ref: 'BIND-7K2M9QH4TX' } } }), {});
  assert.equal(m.contentType, 'postback');
  assert.equal(m.referralRef, 'BIND-7K2M9QH4TX');
});

test('IG 沒有 ref 的 postback 維持原本行為（跳過）', async () => {
  const out = await ig.parseWebhook(igPayload({ postback: { title: 'x', payload: 'y' } }), {});
  assert.equal(out.length, 0);
});
