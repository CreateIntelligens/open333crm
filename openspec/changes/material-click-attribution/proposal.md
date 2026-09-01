## Why

差異化定位「別人幫你發訊息，open333CRM 幫你證明哪則訊息有效」的核心，是把成效歸因到「單則素材」——三家競品只做到按鈕級、沒人做素材級 ROI。現況盤點發現缺口比預期深：`ShortLink` 沒有 `materialId` 欄位，且**廣播發送目前完全不經短連結**（URL 直發原網址），所以根本沒有點擊資料可歸因，`getMaterialStats` 的點擊率永遠是 null。要打通「素材 → 短連結 → 點擊 → 歸因回素材」這條鏈路，才有素材級點擊率/CTR。

## What Changes

- **ShortLink 加 `materialId`**（nullable 外鍵）：讓短連結能標記「由哪則素材產生」，點擊即可歸因回素材。
- **發送時自動轉短連結**：廣播（executeBroadcast）發送素材前，把 body 裡的 action URI 自動換成帶 `materialId` 的短連結；每個收件人共用同一素材短連結（歸因到素材層，非個人）。
- **getMaterialStats 接點擊率**：由 `ClickLog`（經 ShortLink.materialId）聚合該素材的總點擊 / 不重複點擊，算出點擊率（點擊數 ÷ 送出數）；仍無資料時回 null（不假造 0）。
- **素材詳情頁顯示點擊成效**：既有 stats 面板補「點擊數 / 點擊率」。

不在本 change 範圍：per-recipient 個人化短連結（每人一條連結追個人點擊——本 change 是素材層歸因，共用一條）；A/B 測試（另塊）；非廣播路徑（自動回覆/關鍵字）的素材點擊歸因（先做廣播）。

## Capabilities

### New Capabilities
（無全新 capability；為既有能力延伸）

### Modified Capabilities
- `material-system`: `getMaterialStats` 新增素材級點擊歸因（點擊數 / 點擊率），來源為經 ShortLink.materialId 的 ClickLog。
- `shortlink-routing`: ShortLink 新增 `materialId` 關聯，點擊追蹤沿用既有 ClickLog（經 shortLink 可回推 material）。

## Impact

- **DB (`packages/database/prisma/schema.prisma`)**：
  - `ShortLink` 加 `materialId String? @db.Uuid` + 關聯 `Material`（onDelete SetNull）+ index。
  - `Material` 加反向關聯 `shortLinks ShortLink[]`。
  - 需產正式 migration（RLS：short_links 已在 RLS 管轄，新欄不影響 policy）。
- **廣播 (`apps/api/src/modules/marketing/marketing.service.ts` executeBroadcast)**：
  - 取得 material body 後、發送前，走訪 action URI，對每個外部 URL 建（或複用）帶 materialId 的 ShortLink，替換 body 中的 uri。
  - 複用同素材+同 targetUrl 的既有短連結（避免每次廣播都建新的）。
- **短連結 (`apps/api/src/modules/shortlink/shortlink.service.ts`)**：createShortLink 支援帶 materialId；trackClick 不變（ClickLog 經 shortLinkId 已能回推 material）。
- **素材 stats (`material.service.ts` getMaterialStats)**：加點擊聚合（count ClickLog where shortLink.materialId = 該素材）。
- **前端**：素材詳情 stats 面板顯示點擊數/率。
- **相容性**：materialId nullable，既有短連結不受影響；發送自動轉短連結對「沒有 URL 的素材」（純文字無連結）無影響。
- **RLS**：ShortLink/ClickLog 走既有租戶隔離；getMaterialStats 的點擊聚合走 tenantPrisma。
