/**
 * 跨渠道綁定代碼：純邏輯單元測試（代碼格式、擷取、連結、設定、訊息文字）。
 * change add-cross-channel-one-id，spec cross-channel-binding-code。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { bumpCounter, extractBindingCode, generateBindingCode } from '#src/modules/identity-binding/binding-code.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import {
  buildBindingLink,
  channelPublicLabel,
  buildInviteText,
  matchesKeyword,
  parseIdentityBindingSettings,
  resolveBindingHandle,
} from '#src/modules/identity-binding/binding-links.js';

test('代碼格式：BIND- + 10 碼 Crockford base32，且 FB/IG ref 允許的字元', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateBindingCode();
    assert.match(code, /^BIND-[0-9A-HJKMNP-TV-Z]{10}$/);
    assert.match(code, /^[A-Za-z0-9_=-]+$/, 'Meta ref 只允許英數與 - _ =');
  }
});

test('代碼不重複（統計上）', () => {
  const set = new Set(Array.from({ length: 2000 }, generateBindingCode));
  assert.equal(set.size, 2000);
});

test('擷取：在整段文字中搜尋、不分大小寫、正規化為大寫', () => {
  assert.equal(extractBindingCode('我要綁定帳號，代碼 BIND-7K2M9QH4TX（請直接送出）'), 'BIND-7K2M9QH4TX');
  assert.equal(extractBindingCode('bind-7k2m9qh4tx 謝謝'), 'BIND-7K2M9QH4TX', '顧客改動預填文字仍可兌換');
  assert.equal(extractBindingCode('BIND-7K2M9QH4TX'), 'BIND-7K2M9QH4TX', 'FB/IG ref 就是代碼本身');
});

test('擷取：格式不符的不當成代碼', () => {
  assert.equal(extractBindingCode('BIND-7K2M9'), null, '太短');
  assert.equal(extractBindingCode('BIND-7K2M9QH4TXA'), null, '太長');
  assert.equal(extractBindingCode('BIND-7K2M9QH4TI'), null, 'I 不在 Crockford 字母表');
  assert.equal(extractBindingCode('spring_sale'), null, '一般廣告 ref');
  assert.equal(extractBindingCode(undefined), null);
  assert.equal(extractBindingCode(''), null);
});

test('LINE 連結：先加好友、再以 oaMessage 預填代碼，Basic ID 與文字皆 percent-encode', () => {
  const link = buildBindingLink({ channelType: 'LINE', displayName: '總店', handle: '@abc1234' }, 'BIND-7K2M9QH4TX');
  assert.equal(link.addFriendUrl, 'https://line.me/R/ti/p/%40abc1234');
  assert.ok(link.sendCodeUrl.startsWith('https://line.me/R/oaMessage/%40abc1234/?'));
  const prefill = decodeURIComponent(link.sendCodeUrl.split('/?')[1]);
  assert.equal(extractBindingCode(prefill), 'BIND-7K2M9QH4TX');
});

test('FB / IG 連結：ref 帶代碼', () => {
  assert.equal(
    buildBindingLink({ channelType: 'FB', displayName: '粉專', handle: '123456789' }, 'BIND-7K2M9QH4TX').sendCodeUrl,
    'https://m.me/123456789?ref=BIND-7K2M9QH4TX',
  );
  assert.equal(
    buildBindingLink({ channelType: 'THREADS', displayName: 'IG', handle: 'my.shop' }, 'BIND-7K2M9QH4TX').sendCodeUrl,
    'https://ig.me/m/my.shop?ref=BIND-7K2M9QH4TX',
  );
});

test('導流識別：手動填的優先，其次自動取得，都沒有回 null', () => {
  assert.equal(resolveBindingHandle({ bindingHandle: 'manual', bindingHandleAuto: 'auto' }), 'manual');
  assert.equal(resolveBindingHandle({ bindingHandle: '  ', bindingHandleAuto: 'auto' }), 'auto');
  assert.equal(resolveBindingHandle({}), null);
  assert.equal(resolveBindingHandle(null), null);
});

test('設定：未設定＝關閉並帶預設關鍵字；空陣列退回預設', () => {
  assert.deepEqual(parseIdentityBindingSettings({}), {
    enabled: false,
    bindKeywords: ['綁定帳號'],
    unbindKeywords: ['解除綁定'],
  });
  assert.equal(parseIdentityBindingSettings({ enabled: 'true' }).enabled, false, '只接受布林 true');
  assert.deepEqual(parseIdentityBindingSettings({ enabled: true, bindKeywords: [] }).bindKeywords, ['綁定帳號']);
});

test('關鍵字：整句相符才算，一般對話提到不攔截', () => {
  assert.equal(matchesKeyword(' 綁定帳號 ', ['綁定帳號']), true);
  assert.equal(matchesKeyword('請問怎麼綁定帳號？', ['綁定帳號']), false);
  assert.equal(matchesKeyword('', ['綁定帳號']), false);
});

test('邀請訊息：列出各渠道連結、純文字代碼退路、時效說明，且不含 emoji', () => {
  const code = 'BIND-7K2M9QH4TX';
  const text = buildInviteText(
    [
      buildBindingLink({ channelType: 'LINE', displayName: '總店', handle: '@abc1234' }, code),
      buildBindingLink({ channelType: 'THREADS', displayName: '官方 IG', handle: 'my.shop' }, code),
    ],
    code,
  );
  assert.ok(text.includes('https://line.me/R/ti/p/%40abc1234'));
  assert.ok(text.includes('https://ig.me/m/my.shop?ref=BIND-7K2M9QH4TX'));
  assert.ok(text.includes(`直接傳送這組代碼：${code}`));
  assert.ok(text.includes('30 分鐘'));
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), '訊息不放 emoji');
  // 標題用公開帳號，不出現後台渠道名稱
  assert.ok(text.includes('【LINE：@abc1234】'));
  assert.ok(text.includes('【Instagram：@my.shop】'));
  assert.ok(!text.includes('總店') && !text.includes('官方 IG'), '不可出現後台自取的渠道名稱');
});

test('邀請訊息：FB 沒有 username 時標題只寫類型', () => {
  const code = 'BIND-7K2M9QH4TX';
  const text = buildInviteText([buildBindingLink({ channelType: 'FB', displayName: '測試粉專', handle: '1132326913296788' }, code)], code);
  assert.ok(text.includes('【Facebook】'));
  assert.ok(!text.includes('測試粉專'));
});

test('頻率計數器：沒有效期的 key（例如 INCR 與設效期之間過期）會被補上效期，不會永久擋人', async () => {
  const clock = { now: 0 };
  const store = memBindingStore(clock);
  await store.incr('k'); // 模擬先前留下、沒有 TTL 的計數器
  assert.equal(await store.pttl('k'), -1);
  assert.equal(await bumpCounter(store, 'k', 1000), 2);
  assert.ok((await store.pttl('k')) > 0, '補上效期');
  clock.now += 1001;
  assert.equal(await bumpCounter(store, 'k', 1000), 1, '過期後重新計數');
});

test('渠道稱呼：用平台上的公開帳號（粉專 username、IG／LINE @帳號），不用後台自取的渠道名稱', () => {
  assert.equal(channelPublicLabel('FB', 'my.shop'), 'Facebook（my.shop）');
  assert.equal(channelPublicLabel('FB', '1132326913296788'), 'Facebook', '沒有 username 時退回的純數字粉專 ID 不給顧客看');
  assert.equal(channelPublicLabel('THREADS', ' my.shop '), 'Instagram（@my.shop）');
  assert.equal(channelPublicLabel('LINE', '@abc1234'), 'LINE（@abc1234）');
  assert.equal(channelPublicLabel('LINE', 'abc1234'), 'LINE（@abc1234）');
  assert.equal(channelPublicLabel('FB', ''), 'Facebook');
  assert.equal(channelPublicLabel('FB', null), 'Facebook');
});
