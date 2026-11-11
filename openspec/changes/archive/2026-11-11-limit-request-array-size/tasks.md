## 1. 掃描函式

- [x] 1.1 測試 `apps/api/tests/unit/shared/utils/json-payload-limits.test.ts`：根層與巢狀陣列超過上限（含 `path`）、剛好等於上限、字串裡的括號與逗號不計數、物件欄位超過上限、總數超過上限、深度超過上限、1,000,000 層巢狀不堆疊溢位。先執行，確認失敗在斷言上
- [x] 1.2 實作 `apps/api/src/shared/utils/json-payload-limits.ts`（迭代掃描，失敗時才解碼 `path`）

## 2. 環境設定

- [x] 2.1 測試 `apps/api/tests/unit/config/env-json-payload-limits.test.ts`：「未設定時使用預設值」「設定錯誤的值」。先執行，確認失敗在斷言上
- [x] 2.2 `apps/api/src/config/env.ts` 加入 `REQUEST_JSON_MAX_*` 四個欄位

## 3. 全域 JSON 解析器

- [x] 3.1 測試 `apps/api/tests/unit/plugins/json-payload-guard.plugin.test.ts`（Fastify inject）：「根層陣列超過上限」（handler 沒有被呼叫）、「巢狀物件裡的陣列超過上限」、「陣列剛好等於上限」、「二十萬個不合格元素只得到一筆錯誤」（`z.array(z.string()).max(10)` 的 parse 沒有被呼叫）、「物件欄位超過上限」「多個未超過單一上限的陣列合計超過總數上限」「巢狀深度超過上限」「調高上限的路由接受大陣列」「調高上限的路由仍受其他上限限制」，並確認 `__proto__` 防護與格式錯誤的 JSON 行為不變。先執行，確認失敗在斷言上
- [x] 3.2 實作 `apps/api/src/plugins/json-payload-guard.plugin.ts`，在 `apps/api/src/index.ts` 於路由之前註冊；改正 `bodyLimit` 的註解（design D5）

## 4. 進站 webhook

- [x] 4.1 測試 `apps/api/tests/unit/modules/webhook/webhook-payload-limits.test.ts`：「LINE webhook 的 events 超過上限」「一般大小的 webhook 照常處理」。先執行，確認失敗在斷言上
- [x] 4.2 `webhook.routes.ts` 先移除繼承的 JSON 解析器，並在自己的解析器呼叫掃描

## 5. 知識庫匯入

- [x] 5.1 測試 `apps/api/tests/unit/modules/knowledge/knowledge-import-payload-limits.test.ts`：「知識庫匯入接受超過一萬篇文章」。先執行，確認失敗在斷言上
- [x] 5.2 `knowledge.routes.ts` 的 `/import` 加 route config `jsonPayloadLimits`

## 6. 完成檢查

- [x] 6.1 issue #382 的 200,000 元素實測：修正前後的回應與 heap 對比
- [x] 6.2 `pnpm test`、`pnpm test:feature`（獨立測試資料庫）、`pnpm build`
- [x] 6.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx`、`check-workspace-esm` 皆以 `--strict` 通過
- [x] 6.4 `node scripts/feature-impact.mjs --check`；`node scripts/validate-openspec.mjs limit-request-array-size` 與 `--specs`
- [x] 6.5 `CHANGELOG.md` 的 `## [2026-11-11]` 加入條目；`docs/ref/` 相關文件更新

## 附註：測試先失敗與突變驗證

- 1.1、2.1、3.1、4.1 在實作前執行，全部失敗在斷言上（掃描函式與外掛先放回傳 null、不做事的空殼，避免 import 錯誤）。
- 5.1「知識庫匯入接受超過一萬篇文章」在全域解析器存在之前會通過（沒有任何上限）。以突變驗證：拿掉 `/import` 的 route config 時失敗在 `PAYLOAD_ARRAY_TOO_LARGE`；只保留 `maxArrayLength`、拿掉 `maxTotalEntries` 時失敗在 `PAYLOAD_TOO_MANY_ENTRIES`。兩個覆寫值都是必要的。
- 6.1 實測（`z.object({ items: z.array(z.string()).max(10) })`，Fastify inject，bodyLimit 30MB）：

  | 元素數 | 修正前 | 修正後 |
  | --- | --- | --- |
  | 200,000 | 400 `VALIDATION_ERROR`，200,001 筆 issue，回應 13.7MB，396ms，heap +143MB | 400 `PAYLOAD_ARRAY_TOO_LARGE`，1 筆錯誤，回應 142 bytes，23ms，heap +0.9MB |
  | 3,000,000（22.9MB） | 3,000,001 筆 issue，回應 209MB，21.9 秒，heap +1,323MB | 1 筆錯誤，136ms，heap +0.9MB |
