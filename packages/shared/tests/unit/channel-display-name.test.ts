/**
 * 渠道顯示名稱：畫面、匯出與錯誤訊息不顯示渠道系統代號（THREADS、FB、WEBCHAT）。
 * 程式與資料庫仍用代號，Instagram 私訊的代號維持 THREADS。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { channelDisplayName } from '#src/constants/channel-display-name.js';

test('系統代號轉成使用者看得懂的名稱', () => {
  assert.equal(channelDisplayName('LINE'), 'LINE');
  assert.equal(channelDisplayName('FB'), 'Facebook');
  assert.equal(channelDisplayName('THREADS'), 'Instagram');
  assert.equal(channelDisplayName('WEBCHAT'), '網站聊天室');
  assert.equal(channelDisplayName('WHATSAPP'), 'WhatsApp');
});

test('素材的小寫代號也能轉換', () => {
  assert.equal(channelDisplayName('fb'), 'Facebook');
  assert.equal(channelDisplayName('line'), 'LINE');
  assert.equal(channelDisplayName('threads'), 'Instagram');
});

test('不認得的代號原樣顯示，沒有代號回空字串', () => {
  assert.equal(channelDisplayName('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.equal(channelDisplayName(undefined), '');
  assert.equal(channelDisplayName(null), '');
  assert.equal(channelDisplayName(''), '');
});
