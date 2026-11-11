## 1. API

- [x] 1.1 先寫失敗的測試：`apps/api/tests/unit/modules/chatbox/chatbox-public-limits.test.ts`「Image message input」— 訪客送出 `image`、`video`、`file` 訊息時回 400，不交給進站處理
- [x] 1.2 `handleChatboxMessage()` 在驗證工作階段之前拒絕訪客的媒體訊息
- [x] 1.3 先寫失敗的測試：`apps/api/tests/unit/modules/chatbox/chatbox.service.test.ts`「Claimed page uploads media」，以及 `apps/api/tests/unit/modules/webchat/webchat-public-routes.test.ts`「Visitor uploads a file to the chatbox route」「Visitor uploads a file to the legacy route」— `POST /chatbox/media`、`POST /webchat/:channelId/media` 回 410 `WEBCHAT_VISITOR_MEDIA_DISABLED`，不驗證工作階段
- [x] 1.4 兩個上傳路由改回 410；移除 `uploadChatboxMedia`、`uploadVisitorMedia` 與只測它們的測試

## 2. 前端

- [x] 2.1 先寫失敗的測試：`apps/web/tests/unit/app/chatbox/chatbox-page.test.tsx`「Visitor sends an image」— `/chatbox` 頁面沒有附加檔案按鈕與選檔欄位
- [x] 2.2 `/chatbox` 頁面移除迴紋針按鈕、選檔與 `sendMedia`
- [x] 2.3 先寫失敗的測試：`apps/widget/tests/unit/widget.test.ts`「Visitor sends an image」— widget 沒有附加檔案按鈕與選檔欄位；移除上傳相關的測試
- [x] 2.4 widget 移除附加檔案按鈕、選檔與 `sendMedia`

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過
- [x] 3.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 沒有新增違規
- [x] 3.3 `CHANGELOG.md` 新增條目
- [x] 3.4 `node scripts/validate-openspec.mjs remove-webchat-visitor-attachments` 通過
