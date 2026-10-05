## 1. LINE 解析語音與檔案

- [x] 1.1 測試 `packages/channel-plugins/tests/unit/line/line-media-parsing.test.ts`：Audio downloaded and stored、File downloaded and stored、External-provider audio used directly
- [x] 1.2 實作 `packages/channel-plugins/src/line/index.ts` 的 `audio`、`file` 解析

## 2. 下載後更新 mediaUrl

- [x] 2.1 測試 `apps/api/tests/unit/modules/webhook/inbound-media.test.ts`：Image downloaded on receive、Media URL never expires
- [x] 2.2 實作 `resolveInboundMediaAsync()` 同時寫入 `content.mediaUrl`

## 3. 收件匣顯示媒體

- [x] 3.1 測試 `apps/web/tests/unit/lib/inbox/message-media.test.ts`：Stored LINE message still holds the placeholder、Media not downloaded yet、File message 的大小格式
- [x] 3.2 實作 `apps/web/src/lib/inbox/message-media.ts`；`MessageBubble` 顯示語音播放器與檔案下載連結

## 4. Code review 修正

- [x] 4.1 測試 `line-media-parsing.test.ts`：File larger than 25 MB、Media download failed（內容 API 失敗）、MIME 白名單、副檔名；測試名稱對應 scenario
- [x] 4.2 實作外掛的大小上限、MIME 白名單、保留副檔名、失敗拋出中文原因；不再寫 `line-content:` 佔位值
- [x] 4.3 測試 `apps/api/tests/unit/modules/webhook/inbound-media.test.ts`：下載失敗寫入 `content.mediaError` 並推送
- [x] 4.4 實作 `resolveInboundMediaAsync()` 的失敗紀錄
- [x] 4.5 測試 `apps/web/tests/unit/lib/inbox/message-media.test.ts`：Audio message、File message、Media download failed；`apps/web/tests/unit/lib/trailing-throttle.test.ts`：Download finishes right after the message arrives
- [x] 4.6 實作 `describeMessageMedia()`、`createTrailingThrottle()`；`MessageBubble`、`useMessages` 改用它們
- [x] 4.7 修正沒有呼叫端的 `worker-media-download.ts` 的誤導註解

## 5. 完成檢查

- [x] 5.1 `pnpm test` 通過；`packages/channel-plugins`、`apps/api`、`apps/web` 的 `tsc` 通過
- [x] 5.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 5.3 `CHANGELOG.md` 新增條目；更新描述 LINE 進站媒體的功能文件
- [x] 5.4 `openspec validate fix-line-audio-file-messages --strict` 通過
