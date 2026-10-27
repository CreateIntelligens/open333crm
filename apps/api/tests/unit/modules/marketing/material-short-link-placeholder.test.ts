/**
 * 素材連結換短連結時，含變數的連結（附券廣播的 {{coupon.url}}）不換，但內部欄位 tagOnClick 仍要移除
 * （add-coupon-system design D29；PR #364 審查第 6 項）。tagOnClick 留在 LINE payload 會被當成未知欄位拒收。
 */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { convertBodyUrlsToShortLinks } from '#src/modules/marketing/marketing.service.js';

/** 含變數的連結不建立短連結：任何資料庫呼叫都代表行為錯誤 */
const noDb = new Proxy({}, { get: () => { throw new Error('不應查詢資料庫'); } }) as unknown as PrismaClient;

it('含變數的連結不換短連結，tagOnClick 仍被移除', async () => {
  const body = {
    type: 'flex',
    contents: {
      footer: {
        contents: [
          { type: 'button', action: { type: 'uri', label: '領券', uri: '{{coupon.url}}', tagOnClick: 'tag-1' } },
          { type: 'image', linkUri: '{{coupon.url}}', tagOnClick: 'tag-2' },
        ],
      },
    },
  };
  const out = await convertBodyUrlsToShortLinks(noDb, 'tenant-1', 'agent-1', 'material-1', null, body) as typeof body;
  const [button, image] = out.contents.footer.contents as Array<Record<string, any>>;
  assert.equal(button.action.uri, '{{coupon.url}}', '變數保留到發送時代入');
  assert.equal('tagOnClick' in button.action, false, 'uri 動作的 tagOnClick 已移除');
  assert.equal(image.linkUri, '{{coupon.url}}');
  assert.equal('tagOnClick' in image, false, 'linkUri 的 tagOnClick 已移除');
  assert.equal((body.contents.footer.contents[0] as any).action.tagOnClick, 'tag-1', '不改原素材');
});
