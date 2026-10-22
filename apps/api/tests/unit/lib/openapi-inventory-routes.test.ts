import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error 部署用的 .mjs 腳本沒有型別宣告
import { generateOpenApi } from '#src/lib/openapi-inventory.mjs';

// deploy.yml 在部署前執行同一個產生器，失敗就整個部署中止（2026-10-22 PR #347 合併後部署失敗）。
// 放進 pnpm test，讓非字面值路徑、同一路由檔掛兩個前綴等問題在合併前就被抓到。
describe('OpenAPI 產生器讀得懂所有已註冊的路由', () => {
  it('以目前原始碼產生文件不會失敗，且每個操作只出現一次', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openapi-'));
    try {
      const document = await generateOpenApi(join(dir, 'openapi.json'));
      assert.ok(Object.keys(document.paths).length > 0);
      assert.ok(document.paths['/api/v1/coupons/{id}/publish']?.post, '狀態流轉端點須出現在文件中');
      assert.ok(document.paths['/api/v1/fan/member-binding']?.post, '顧客端會員綁定須出現在文件中');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
