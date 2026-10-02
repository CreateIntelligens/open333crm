## Why

`PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` 讓客服向 LINE 重抓聯絡人的名稱與頭像。這個端點來自 change `line-webhook-image-profile-sync`（2026-04-21），但主規格裡沒有它：

- 該 change 在 `980781d5` 直接放進 `archive/`，沒有經過 `openspec archive`，delta spec `line-contact-profile-sync` 因此從未套用到 `openspec/specs/`。
- 原規格只要求「已登入的客服」，沒有提到租戶。實作照字面只檢查登入，並以 `prismaAdmin` 查詢。結果成為 `docs/ref/system/AUDIT.md` 的 RLS-05：任一租戶的成員可以用其他租戶渠道的憑證呼叫 LINE，並改寫對方的 `ChannelIdentity`。

RLS-05 的修正（`f4c76b5`）已經實作三項檢查：查詢帶租戶條件、要求權限碼、檢查渠道可見範圍。這個 change 把原規格連同這三項檢查寫進主規格。

## What Changes

- 新增主規格 `line-contact-profile-sync`，內容取自原 delta spec，並補上：
  - 只能同步自己租戶、看得到、啟用中的 LINE 渠道；其他情況回 404。
  - 需要 `contact.update` 權限。
  - `channelId` 格式錯誤回 400。
- 原 delta spec 的需求與情境保留，用詞改為與實作一致：路徑前綴是 `/api/v1`，回傳的欄位是 `uid`、`profileName`、`profilePic`。

## Capabilities

### New Capabilities

- `line-contact-profile-sync`：客服重抓單一 LINE 聯絡人的名稱與頭像，寫入 `ChannelIdentity`。

## Impact

- 程式：無。行為已由 `f4c76b5` 實作。
- 測試：`apps/api/tests/feature/modules/line/line-profile-sync.test.ts` 的測試名稱對應本規格的情境。
- 同一個歷史 change 的另一份 delta spec `line-webhook-events`（LINE 圖片的 `contentProvider`）也沒有套用到主規格，不在本 change 的範圍，另案處理。
