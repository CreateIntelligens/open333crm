---
name: feature-marketing
description: >
  open333CRM「行銷活動、素材與優惠券」功能顧問：行銷活動 campaign、群發 broadcast（排程、受眾、附券）、
  受眾分群 segment、素材庫 material（LINE/FB 各版型、Flex、imagemap、影片、點擊貼標、版本）、
  優惠券 coupon（建立/發布/暫停/結束、序號、領券連結 QR、批次發送、對話發券、關鍵字領券、加好友禮、
  顧客開票券 LIFF/email 驗證碼、券夾、核銷、門市核銷台 /redeem）。當需求、bug 或新功能碰到
  /dashboard/marketing、/coupon、/redeem、marketing、coupon、material、broadcast、segment 模組時使用。
  也在改標籤、短連結、渠道外掛、LINE LIFF、自動化動作 send_material/issue_coupon 前使用。
---

# 行銷活動、素材與優惠券

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/MARKETING.md`
  - 注意：其中「分群沒有任何條件時等於全部聯絡人」已過時，程式是 fail-closed、算 0 人（`apps/api/src/modules/marketing/segment.service.ts`）。
- 健檢結果與已知問題：`docs/ref/features/health/MARKETING.md`
- 規格：`openspec/specs/coupon-management/spec.md`、`openspec/specs/coupon-redemption/spec.md`、`openspec/specs/store-redemption/spec.md`、`openspec/specs/broadcast-audience/spec.md`、`openspec/specs/material-system/spec.md`、`openspec/specs/marketing-scheduling/spec.md`（完整清單見 `docs/ref/features/feature-map.json`）
- 手冊：`apps/web/public/manual/ch08-marketing.html`、`apps/web/public/manual/ch09-materials.html`、`apps/web/public/manual/ch18-coupons.html`
- 影響分析：`node scripts/feature-impact.mjs --domain marketing`

路由前綴：`/api/v1/marketing`（marketing + material）、`/api/v1/coupons`（coupon、instance、claim-link）、
`/api/v1/coupon-issue`、`/api/v1/coupon-claim`、`/api/v1/fan/coupons`、`/api/v1/store-console`（`apps/api/src/index.ts`）。

## 前端操作流程

### 後台：活動、分群、群發
| # | 流程 | 入口 | API → 後端 | 副作用 | 權限（後端 / 前端隱藏） |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 建立活動 | `/dashboard/marketing/campaigns`「新增活動」；日期 `type=date` 送 `YYYY-MM-DD` | `POST /marketing/campaigns` → `campaign.service.ts` `createCampaign` | 無、無稽核 | `marketing.manage` / **不隱藏** |
| 2 | 活動詳情與狀態 | 點卡片 → `campaigns/[campaignId]` | `PATCH /marketing/campaigns/:id {status}`；只允許 draft→active/cancelled、active→completed/cancelled | 讀取時彙總送達、回覆、開案數 | `marketing.manage` |
| 3 | 建立分群 | `/dashboard/marketing/segments`；條件 `channelType`(LINE/FB/WEBCHAT/WHATSAPP)、`tag`、`createdAfter/Before`(date)，AND/OR | `POST /marketing/segments/preview`、`POST /marketing/segments` | 刪除是硬刪，不檢查是否被排程群發引用 | `marketing.manage` / **不隱藏** |
| 4 | 建立群發 | `/dashboard/marketing/broadcasts`「建立廣播」：渠道、素材、活動、受眾(all/segment/tags；FB/IG 只有 all)、附券、排程 `datetime-local`→ISO | 即時預估 `POST /marketing/broadcasts/audience-preview`；建立 `POST /marketing/broadcasts` → `marketing.service.ts` `createBroadcast` | 有 `scheduledAt` 為 scheduled，排程器 `broadcast-scheduled` 每 60 秒取 10 筆。渠道選單列出所有啟用中渠道（含網站客服 WebChat，不套用成員可見範圍）；WebChat 沒有素材，只能附券建立，但 WebChat plugin 的 `sendMessage` 不推送也不寫訊息，結果顯示「已完成」顧客卻收不到 | `marketing.manage` / **不隱藏**；建立時不檢查 `marketing.broadcast`、`coupon.issue` 與渠道可見範圍，排程到期由排程器直接送出（健檢 HC-MARKETING-01、02） |
| 5 | 立即發送/重送/取消 | 群發列 ▶ ↻ ✕ | `POST /marketing/broadcasts/:id/send`、`/cancel` | 附券：202，寫 `coupon-broadcast` 佇列，`runCouponBroadcast` 逐人保留→送出→確認；一般：請求內同步 `executeBroadcast`，素材網址換短連結，LINE 無變數 multicast 每批 499 | `marketing.broadcast` / **不隱藏** |
| 6 | 附券結果 | 群發列 👁 | `GET /marketing/broadcasts/:id`、`/recipients?status=failed\|skipped` | — | `marketing.view` |

### 後台：素材
| # | 流程 | 入口 | API → 後端 | 備註 |
| - | ---- | ---- | ---------- | ---- |
| 7 | 列表、篩選、複製、刪除 | `/dashboard/marketing/materials` | `GET /marketing/materials`（limit 50，無分頁 UI）、`/duplicate`、`DELETE`（軟刪） | 前端完全不判斷權限；複製/刪除失敗沒有提示；LINE 素材建立/修改時，租戶最新啟用 LINE 渠道的憑證解不開會回 500（本機與從 UAT 同步的資料常見） |
| 8 | 分類管理 | 素材庫左側分類樹 | `POST/PATCH/DELETE /marketing/materials/categories` | 刪分類時素材 `categoryId` 設 null |
| 9 | 建立/編輯 | `/materials/new` 選版型 → `MaterialEditor`；`/materials/[id]` 編輯 | `POST /marketing/materials`、`PATCH /marketing/materials/:id` → `material.service.ts` | LINE 呼叫 validate/push 檢核；寫 MaterialVersion；註冊 MATERIAL 標籤；LINE 影片 200MB 直傳、FB 25MB |
| 10 | 點擊貼標 | 按鈕動作編輯器 | postback `data='tag:<uuid>'`；uri `action.tagOnClick` | 發送後才生效：postback 由 `inbound-postback-interceptors.ts`、uri 由短連結處理 |
| 11 | Flex AI / JSON 匯入 | Flex 編輯器 | `POST /marketing/materials/line-flex/ai-generate`、`/line-flex/validate` | 兩種 Flex 版型在選擇器是 `hidden`，UI 建不出新的 Flex 素材 |
| 12 | 成效、版本還原 | `/materials/[id]` | `GET /:id/stats`、`/versions`、`POST /versions/:versionNo/restore` | 還原產生新版本 |

可選版型：LINE `line_text|line_image|line_video|line_carousel|line_imagemap`；FB `fb_text|fb_image|fb_video|fb_generic|fb_button|fb_coupon|fb_receipt|fb_feedback`；隱藏 `line_flex_showcase|line_flex_template|fb_media`。

### 後台：優惠券
| # | 流程 | 入口 | API → 後端 | 權限 |
| - | ---- | ---- | ---------- | ---- |
| 13 | 列表與狀態操作 | `/dashboard/marketing/coupons`（`?q&status&page`，status `ACTIVE\|PAUSED\|DRAFT\|ENDED`）；「⋯」選單 | `POST /coupons/:id/{pause,resume,end,duplicate}`、`DELETE /coupons/:id`（只限草稿）→ `coupon-lifecycle.service.ts` `changeStatus` | `coupon.manage` / 停用並提示「需主管權限」 |
| 14 | 建立、存草稿、發布 | `/coupons/new`、`/coupons/[id]/edit` | `POST/PATCH /coupons`、`POST /coupons/:id/publish`；共用碼檢查 `GET /coupons/shared-code/check`；序號 `POST /coupons/:id/codes/preview`、`/codes` | `coupon.manage` |
| 15 | 詳情、序號明細、匯出 | `/coupons/[id]`（`?tab=codes\|settings\|claim-links`） | `GET /coupons/:id/stats`、`/instances`、`/instances/export`（大量時 202 背景產生＋通知；不帶畫面篩選，一律匯出全部；狀態與發放來源是英文代碼、時間是 UTC）。狀態篩選「已領取」= `CLAIMED`＋`OPENED`，所以沒有獨立的 OPENED 選項 | `coupon.view` |
| 16 | 批次發送 | 詳情頁「發送給…」，對象 contacts/tags/segment | `POST /coupons/:id/batch-issue/preview`、`/batch-issue`（202，`coupon-broadcast` 佇列）。UI 渠道只列 LINE/FB/THREADS（`COUPON_PUSH_CHANNEL_TYPES`），後端也接受 WEBCHAT | `coupon.issue` + 渠道 reply_only |
| 17 | 領券連結 | 「領券連結」分頁，渠道 LINE/FB/THREADS，期間 `datetime-local` | `POST /coupons/:id/claim-links`（回 QR data URI）、`/enable\|disable`、`/qrcode` | `coupon.manage` |
| 18 | 對話發券 | 收件匣 ChatWindow「發券」 | `POST /coupon-issue/conversations/:id {couponId, requestKey, expectedAssigneeId}` | `coupon.issue` |

券的欄位值：`couponType` `DISCOUNT_AMOUNT|DISCOUNT_PERCENT|GIFT|EXCHANGE`；`purpose` `MARKETING|SERVICE`；`validityMode` `FIXED|AFTER_CLAIM|AFTER_OPEN`（FIXED 的 `startAt/endAt` 是 `YYYY-MM-DD`）；`codeMode` `SHARED_CODE|UNIQUE_CODE|IMPORTED_CODES`；`redeemMode` `STAFF_CODE|STAFF_SCAN|SELF`（店員碼 4–6 位數字）。發布後只送 `EDITABLE_AFTER_PUBLISH` 內有改的欄位，改鎖定欄位回 409 `COUPON_LOCKED`。

### 顧客端（公開）
| # | 流程 | 入口 | API | 重點 |
| - | ---- | ---- | --- | ---- |
| 19 | 領券頁 → 傳訊領券 | `/coupon/claim/[code]` | `GET /coupon-claim/:code`；顧客在渠道送代碼 → `inbound-coupon-claim.ts` → `claimFromInbound` | 命中代碼的訊息不再觸發 AI 與關鍵字；失敗原因 `LINK_UNAVAILABLE\|ALREADY_CLAIMED\|SOLD_OUT\|WRONG_CHANNEL\|ISSUE_FAILED\|DELIVERY_FAILED` 都會回覆顧客 |
| 20 | 關鍵字領券、加好友禮 | 設定在 `/dashboard/line/keyword-replies`、`/dashboard/line/follow-gift` | 自動化動作 `issue_coupon` → workers `rule-coupon-issue.ts` | 卡在 pending 的券 5 分鐘後由 `coupon-stale-pending-issue` 作廢 |
| 21 | 開票券 | `/coupon/open/[token]`；LINE 走 `/liff/redirect` | `POST /fan/coupons/session`、`/liff-session`、`/session/code`、`/session/code/verify` | 可能導向 `/bind/email/{token}?next=/coupon/open/{token}`（聯絡人領域）；email 碼 10 分鐘最多 3 次 |
| 22 | 券夾、核銷 | `/coupon/wallet`、`/coupon/wallet/[id]` | `/fan/coupons/:id/{open,redeem,start,redeem-code,qrcode}` | 店員碼錯太多鎖 24 小時 |
| 23 | 門市核銷台 | `/redeem?store=` | `/store-console/{login,lookup,redeem,today}` | 門市帳號登入；只能核銷 `STAFF_SCAN` 券，`STAFF_CODE`/`SELF` 券查詢結果為 `WRONG_MODE`「需在顧客手機上核銷」；本機 http 無相機，用「改用手動核銷」輸入序號 |

**有後端、沒有前端入口**：分群編輯與詳情；活動改名稱與日期；取消 `sending` 中的群發；素材復原（`isActive:true`）、`line-flex/import`、`/:id/preview`；修改領券連結；移除序號；會員綁定（`/member-binding`、`/fan/member-binding`，web 完全沒有呼叫）；後台核銷 `POST /coupons/redeem`（因此 `coupon.redeem` 沒有 UI 入口）；`POST /coupons/:id/issue`（刻意只給 CLI 與整合）。

## 不可破壞的規則
- 附券群發與批次發券一律「保留 → 送出 → 確認或作廢」，在同一交易用 `enqueueJob` 寫佇列；不要改成先送再記帳，否則超發。
- 一般群發同步執行，用條件更新把狀態改成 `sending` 防重複，已在發送回 409 `BROADCAST_ALREADY_SENDING`。逐人送出的重送會重送給已送達的人（MKT-01）。
- 素材含 `{{coupon.url}}` 必須附券；素材渠道必須等於發送渠道；附券必須 ACTIVE、用途 MARKETING、固定效期未過期。前後端都有檢查，改一邊要改另一邊（`apps/web/src/lib/marketing/broadcast-form.ts`）。
- 排程時間：前端 `datetime-local` 轉 ISO 送出；後端日期一律 `z.coerce.date()`，不要用 `z.string().datetime()`（會擋掉 `2026-12-31T23:59`）。
- 分群無條件時是 0 人（fail-closed），不是全部聯絡人。
- 群發 FB/IG 只能送「24 小時內傳過訊息的人」；Meta 的 message tag 與 OTN 已停用，不要依賴。
- 多 LINE OA 要同一個 provider 才能跨 OA 認出同一個客人；關鍵字領券、加好友禮依 channel 分別設定。
- 一個 Contact 被合併時，BroadcastRecipient 與 CouponInstance 會搬到主聯絡人（聯絡人領域 `mergeContacts`）；新增掛在 Contact 上的行銷資料表要一起加進合併清單。
- UI 不放 emoji 與 ✓（使用者要求）；目前群發列的 ▶ ↻ ✕ 👁 是既有圖示按鈕，新增按鈕不要再加。
- 新增權限點後既有租戶的系統角色不會自動拿到，部署時要跑 `scripts/grant-new-role-permissions.mjs`。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain marketing` 看最新版本。重點：
- **依賴**：聯絡人（標籤分眾、`contact.tagged`、email 登記與歸戶）、渠道（外掛發訊、訊息視窗、可見範圍）、LINE（素材檢核、multicast、LIFF）、短連結（素材網址換短連結、點擊貼標）、設定（個資遮罩、門市帳號）、平台用量（Flex AI 額度）、通知（匯出完成）。
- **被依賴**：自動化（`send_material`、`issue_coupon`、關鍵字、加好友禮）、收件匣（快速回覆、對話發券、券卡訊息）、工單（群發歸因）、LINE（圖文選單放領券連結）、數據分析（優惠券報表）、平台佇列監控（`coupon-broadcast`）。

## 回歸清單
改到本領域時，至少重走：
1. 建立 LINE 文字素材 → 建立群發（受眾 tags）→ 立即發送 → 狀態變 completed，送達數正確。
2. 建立附券群發（素材含 `{{coupon.url}}`）→ 排程 2 分鐘後 → 排程器送出 → 附券結果頁看成功/略過。
3. 建立優惠券（每種 `validityMode` 至少一次）→ 發布 → 暫停 → 恢復 → 提前結束；已發布後改鎖定欄位要 409。
4. 建立領券連結 → 開 `/coupon/claim/[code]` → 顧客送代碼領券（本機用 WebChat）→ 開票券 → 核銷。
5. 用 supervisor 與 agent 重走 1、3，確認 403 與按鈕停用。
6. 真機（UAT）：LINE 關鍵字領券、FB/IG 關鍵字領券、圖文選單領券、封鎖再加入（本機收不到 LINE/FB webhook）。
- 自動測試：`pnpm --filter @open333crm/api test -- marketing`、`-- coupon`；`pnpm --filter @open333crm/web test -- marketing`、`-- coupon`、`-- materials`；`pnpm --filter @open333crm/workers test -- coupon`；feature 測試同名過濾。
- E2E：`apps/web/tests/e2e-uat/tenant-marketing.spec.ts`、`apps/web/tests/e2e-uat/tenant-materials-all-types.spec.ts`。

## 常見 bug 從哪裡查
- 「群發卡在發送中」：一般群發看 `executeBroadcast` 是否中途拋錯；附券群發看 `coupon-broadcast` 佇列與 `runCouponBroadcast`；UI 沒有取消 sending 的按鈕。
- 「影片/圖片素材送不出去」：LINE 拒收 Google Drive 分享連結等非直連網址；失敗原因在 `BroadcastDeliveryAttempt`，後台不一定看得到。
- 「領券沒反應」：先看訊息是否被 `inbound-coupon-claim.ts` 攔截（代碼格式、渠道是否相符），再看回覆顧客的失敗原因。
- 「素材選單少了素材」：前端要 200 筆、後端上限 100；分群下拉只拿第一頁 50 筆。
- 「排程群發失敗：選擇『受眾分群』時必須指定一個分群」：分群在排程後被刪了（FK `ON DELETE SET NULL`，刪除不檢查引用）。
- 「網站客服（WebChat）群發已完成，顧客卻沒收到」：WebChat plugin 的 `sendMessage` 不推送也不寫訊息（`packages/channel-plugins/src/webchat/index.ts`），附券群發與批次發券都會算成功。
- 「沒有權限的人看到空白列表」：行銷活動、分群、群發、素材頁的 SWR 錯誤不顯示，403 會顯示成「尚無…」。
- 「顧客開不了票券」：租戶要啟用 email 登記；看 `/fan/coupons/session` 回的 `status`。
