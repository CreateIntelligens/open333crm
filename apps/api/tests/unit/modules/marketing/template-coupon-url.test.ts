/**
 * 附券廣播的 {{coupon.url}} 變數（add-coupon-system A15 15.22、design D29）：
 * 素材預覽要看得出連結的位置；變數清單列出它，讓行銷人員知道可以放。
 */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { sampleVariables } from '#src/modules/marketing/template-renderer.js';
import { STATIC_VARIABLE_METADATA } from '#src/modules/marketing/template-context.js';

it('素材預覽以範例網址代入票券連結變數', () => {
  assert.match(sampleVariables(['coupon.url'])['coupon.url'], /^https:\/\/\S+\/coupon\/open\//);
});

it('變數清單列出票券連結，並註明只在附券廣播代入', () => {
  const meta = STATIC_VARIABLE_METADATA.flatMap((c) => c.variables).find((v) => v.key === 'coupon.url');
  assert.ok(meta);
  assert.match(meta.label, /附券廣播/);
});
