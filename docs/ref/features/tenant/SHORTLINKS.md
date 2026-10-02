# 短連結

短連結把一個長網址包成 `/s/<代碼>`，在點擊時記錄是誰點的、從哪裡點的，再轉到目標網址。在 LINE 裡點擊時，系統能辨識出是哪個聯絡人，並依設定幫他貼標。群發素材裡的連結也會自動換成短連結，點擊因此能歸因到素材。

- **資料來源**：`apps/api/src/modules/shortlink/*`、`apps/api/src/modules/tag/tagging.service.ts`
- **核對日期**：2026-09-30

## 負責的程式

| 部分 | 路由檔 | 前綴 | 使用者 |
| --- | --- | --- | --- |
| 後台 | `shortlink.routes.ts` | `/api/v1/shortlinks` | 客服與管理員 |
| 轉址與記錄點擊 | `shortlink-redirect.routes.ts` | `/s` | 任何點擊連結的人，不需登入 |

| 程式 | 負責什麼 |
| --- | --- |
| `shortlink.service.ts` | 短連結的 CRUD、組出帶 UTM 的目標網址、記錄點擊、統計 |
| `source-detector.ts` | 依 User-Agent 判斷點擊來源：爬蟲、LINE 內建瀏覽器、Facebook 內建瀏覽器、一般瀏覽器 |
| `strategies/` | 依來源決定回應什麼頁面 |
| `og-scraper.ts` | 建立短連結時抓目標網頁的 OG 標題、描述與圖片。會擋下指向內網位址的網址 |
| `qrcode.service.ts` | 產生短連結的 QR code |

## 建立短連結

| 欄位 | 作用 |
| --- | --- |
| `slug` | 短連結的代碼。不填就自動產生；自訂時全系統唯一 |
| `targetUrl` | 目標網址 |
| `utmSource` 等五個 UTM 欄位 | 轉址時附加到目標網址 |
| `lineChannelId` | 綁定的 LINE 渠道。綁定後，在 LINE 內點擊才能辨識聯絡人 |
| `tagOnClick` | 辨識出聯絡人時要貼的標籤 |
| `expiresAt`、`isActive` | 過期或停用的連結回 410 |
| `materialId` | 這個短連結屬於哪個素材。群發時自動建立的短連結會填 |

**代碼的唯一性跨租戶。** 自訂代碼時，系統只在自己租戶內檢查是否重複（查詢受 RLS 限制）。代碼已被其他租戶使用時，檢查看不到，寫入時才撞到資料庫的唯一限制，回應是一般的伺服器錯誤，而不是「代碼已被使用」。

**素材的短連結會重複使用。** 群發時，`findOrCreateMaterialShortLink()` 對同一個素材、同一個目標網址重複使用同一個短連結，所有收件人拿到的是同一條。

## 點擊時發生什麼

轉址分成兩步：`GET /s/:slug` 只回應頁面，不記錄點擊；頁面上的程式再呼叫 `POST /s/track` 記錄點擊。`POST /s/track` 是唯一記錄點擊的地方。

`GET /s/:slug` 依點擊來源回應：

| 來源 | 回應 |
| --- | --- |
| 爬蟲 | OG 預覽頁，讓分享卡片顯示標題與圖片。不記錄點擊 |
| LINE 內建瀏覽器，且綁定的渠道設有 `liffId` | 導向 LIFF 頁面。LIFF 取得點擊者的 LINE uid 後呼叫 `/s/track` |
| LINE 內建瀏覽器，但沒有 `liffId` | 與一般瀏覽器相同 |
| Facebook 內建瀏覽器、一般瀏覽器 | 一個小頁面：載入 GA 與 Meta Pixel 追蹤碼、送出 `/s/track`，然後立刻轉到目標網址 |

GA 與 Meta Pixel 的 ID 在「設定 → 追蹤設定」填寫，見[其他設定](./SETTINGS.md)。

`trackClick()` 記錄點擊時：

1. 找出點擊者：有 LINE uid 而且連結綁了渠道時，以該渠道身分的聯絡人為準；否則用網址帶的 `cid`。
2. 寫入一筆 `ClickLog`，記下聯絡人、LINE uid、IP、User-Agent 與來源網址。
3. 總點擊數加一。不重複點擊數在有 LINE uid 時依 uid 去重；沒有 LINE uid 時，每次點擊都算一次不重複點擊。
4. 推送 `link.stats.updated` 讓後台即時更新數字。
5. 辨識出聯絡人、而且連結設了 `tagOnClick` 時，替他貼標。貼標失敗只記 warning。
6. 發布 `link.clicked`，自動化規則可以訂閱。

**`/s/track` 採信呼叫端提供的身分。** 這個端點不需要登入，也不驗證 LINE 的登入憑證；`cid` 與 LINE uid 都直接取自請求內容，而且沒有速率限制。知道某個聯絡人的 ID 或 LINE uid，就能替他記一筆點擊，觸發貼標與自動化；統計數字也能被任意灌高。貼標前會檢查聯絡人屬於連結的租戶，因此影響限於同一個租戶。見 `../../system/AUDIT.md` 的 SHORT-01。

## 統計

`GET /shortlinks/:id/stats` 回傳總點擊、不重複點擊、最近 30 天每日點擊與來源網址分布。`GET /shortlinks/:id/clicks` 列出點擊明細。素材的點擊成效由素材的 `materialId` 彙總，見[行銷](./MARKETING.md#素材)。

## 權限

後台路由讀取要 `shortlink.view`，建立、修改與刪除要 `shortlink.manage`。側欄的「短連結」也要求 `shortlink.view` 才顯示。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **記錄點擊的端點採信呼叫端的身分，沒有速率限制** | 詳見 `../../system/AUDIT.md` 的 SHORT-01 |
| 自訂代碼與其他租戶重複時回伺服器錯誤 | 同租戶內的檢查看不到其他租戶的代碼 |
| 沒有 LINE uid 的點擊都算不重複點擊 | 一般瀏覽器的不重複點擊數等於總點擊數 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
