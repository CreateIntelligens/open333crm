## Why

渠道外掛的 `getProfile()` 回傳平台的頭像網址，系統原樣存進渠道身分的 `profilePic` 與聯絡人的 `avatarUrl`，之後不再更新。FB 的頭像網址會失效：2026-10-19 取用 UAT 一位 FB 聯絡人的頭像網址，回 404「Profile Pic not found」，收件匣與聯絡人頁只顯示名稱縮寫（AUDIT IDENT-06）。

## What Changes

- 取得頭像後下載到物件儲存的 `avatars` 目錄，改存自己的網址。下載在背景執行，不延後訊息落地。
- 已存著平台網址的舊身分，在顧客下次進站時補存。原網址已失效時，重新呼叫 `getProfile()` 取得新網址。同一身分補存失敗後一小時內不再重試。
- 只下載 https、不指向內部網路的網址（沿用 `isBlockedUrl()`，每次轉址都檢查），只接受 5 MB 以下的 JPEG、PNG、WebP、GIF。
- 聯絡人的 `avatarUrl` 只在它和該身分原本的頭像網址相同時才更新，客服改過的頭像不覆蓋。
- 資料刪除的兩種模式都刪除聯絡人與渠道身分在物件儲存的頭像檔。只刪本租戶 `avatars` 目錄下的檔案。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `inbound-contact-resolution`：新增「渠道頭像存進物件儲存」。
- `tenant-data-erasure`：匿名化與硬刪除都刪除頭像檔。

## Impact

- `apps/api/src/modules/storage/avatar-mirror.service.ts`（新）：下載與上傳頭像。
- `apps/api/src/modules/webhook/inbound-avatar-refresh.ts`（新）、`inbound-contact-resolver.ts`：進站時排入補存。
- `apps/workers/src/handlers/data-erasure.handler.ts`：刪除頭像檔。
- 系統開始保存顧客的大頭照。資料刪除沒有涵蓋的其他媒體檔記在 AUDIT ERASE-01。
- `PATCH /channels/:channelId/contacts/:lineUid/sync-profile` 仍寫入 LINE 的原始網址，下次進站時補存。
