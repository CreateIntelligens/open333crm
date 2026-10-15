/**
 * 追蹤設定的 ID 格式驗證（change fix-admin-settings-safeguards，tracking-settings「追蹤 ID 的格式驗證」）。
 * GA／Pixel ID 會被拼進短連結中轉頁的 <script>，格式不符一律拒收（G06 儲存型 XSS）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { trackingSettingsSchema } from '#src/modules/settings/settings.routes.js';

test('合格的 ID 可以儲存', () => {
  const data = trackingSettingsSchema.parse({ gaId: ' G-ABC123XYZ9 ', metaPixelId: '123456789012345' });
  assert.equal(data.gaId, 'G-ABC123XYZ9');
  assert.equal(data.metaPixelId, '123456789012345');
});

test('含程式碼的 GA ID 被拒', () => {
  assert.equal(trackingSettingsSchema.safeParse({ gaId: "G-1');alert(1);//" }).success, false);
  assert.equal(trackingSettingsSchema.safeParse({ gaId: 'UA-12345-1' }).success, false);
});

test('非數字的 Pixel ID 被拒', () => {
  assert.equal(
    trackingSettingsSchema.safeParse({ metaPixelId: '123</script><script>alert(1)</script>' }).success,
    false,
  );
  assert.equal(trackingSettingsSchema.safeParse({ metaPixelId: '12ab34' }).success, false);
});

test('空字串清除設定', () => {
  const data = trackingSettingsSchema.parse({ gaId: '', metaPixelId: null });
  assert.equal(data.gaId, null);
  assert.equal(data.metaPixelId, null);
});
