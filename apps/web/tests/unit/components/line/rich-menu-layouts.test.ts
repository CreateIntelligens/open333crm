/**
 * Rich Menu 版型的區域座標必須是整數（spec line-rich-menu「10 種固定版型」：
 * defaultAreas 座標已對齊像素）。M10：LARGE_W / 3、COMPACT_H / 2 算出小數，
 * 後端 boundsSchema 要求 int，有 5 種版型按「儲存草稿」一定回 400。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { RICH_MENU_LAYOUTS } from '#src/components/line/rich-menu/layouts.js';

for (const layout of RICH_MENU_LAYOUTS) {
  test(`${layout.id}（${layout.label}）：座標是整數，區域剛好鋪滿畫布`, () => {
    const { width: W, height: H } = layout.size;
    let area = 0;
    for (const { bounds: b } of layout.defaultAreas) {
      for (const v of [b.x, b.y, b.width, b.height]) {
        assert.ok(Number.isInteger(v), `${layout.id} 有非整數座標 ${JSON.stringify(b)}`);
      }
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= W && b.y + b.height <= H, `${layout.id} 超出畫布 ${JSON.stringify(b)}`);
      area += b.width * b.height;
    }
    assert.equal(area, W * H, `${layout.id} 區域總面積應等於畫布`);
  });
}
