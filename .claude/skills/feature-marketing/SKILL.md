---
name: feature-marketing
description: >
  open333CRM「行銷活動、素材與優惠券」功能顧問：群發、受眾分群、素材庫、優惠券與核銷。改到 marketing／coupon／material／broadcast／segment 模組、/dashboard/marketing、/coupon、/redeem，或改標籤、短連結之前使用。
---

# 行銷活動、素材與優惠券

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。行銷與優惠券的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

行銷活動 campaign、群發 broadcast（排程、受眾、附券）、受眾分群 segment、
素材庫 material（LINE 與 FB 各版型、Flex、imagemap、影片、點擊貼標、版本）、
優惠券 coupon（建立、發布、暫停、結束、序號、領券連結 QR、批次發送、對話發券、關鍵字領券、加好友禮、
顧客開票券的 LIFF 與 email 驗證碼、券夾、核銷、門市核銷台 `/redeem`）。
相關的程式：`/dashboard/marketing`、`/coupon`、`/redeem`、marketing、coupon、material、broadcast、segment 模組。
改標籤、短連結、渠道外掛、LINE LIFF、自動化動作 `send_material`、`issue_coupon` 之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/MARKETING.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `MARKETING.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 素材的檢核、影片、示範圖、券連結 | 素材 |
| 分群條件 | 分群 |
| 建立群發、權限、排程、發送步驟、訊息視窗、背景執行、重送 | 群發 |
| 回覆與開工單的歸因、活動成效 | 成效與歸因 |
| 權限碼、渠道可見範圍 | 權限 |
| 券的欄位值與狀態、發券入口、序號匯出、顧客端、門市核銷台 | 優惠券 |
| 前端頁面與元件 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/marketing/`、`apps/api/tests/unit/modules/coupon/`、`apps/api/tests/unit/modules/store/`、`apps/api/tests/feature/modules/marketing/`、`apps/api/tests/feature/modules/coupon/`、`apps/web/tests/unit/components/marketing/`、`apps/web/tests/unit/components/coupons/`、`apps/web/tests/unit/components/materials/`、`apps/web/tests/unit/lib/marketing/`，寫法可以照著參考。

`MARKETING.md` 裡標 `HC-MARKETING-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/MARKETING.md`
- 規格：`openspec/specs/coupon-management/spec.md`、`openspec/specs/coupon-redemption/spec.md`、`openspec/specs/store-redemption/spec.md`、`openspec/specs/broadcast-audience/spec.md`、`openspec/specs/material-system/spec.md`、`openspec/specs/marketing-scheduling/spec.md`（完整清單見 `docs/ref/features/feature-map.json`）
- 手冊：`apps/web/public/manual/ch08-marketing.html`、`apps/web/public/manual/ch09-materials.html`、`apps/web/public/manual/ch18-coupons.html`
- 影響分析：`node scripts/feature-impact.mjs --domain marketing`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `MARKETING.md` 括號內的章節。

- 附券群發與批次發券一律「保留 → 送出 → 確認或作廢」，保留與 `enqueueJob` 在同一個交易。不要改成先送再記帳，否則超發。（群發、優惠券）
- 一般群發在背景執行（`coupon-broadcast` 佇列，排程器是後備）。佇列工作與排程器只搶 `scheduled` 且時間已到的群發，以條件更新改成 `sending`；已在發送回 409 `BROADCAST_ALREADY_SENDING`。（群發）
- 發送前查訊息額度只依外掛的能力（`extensions.analytics.getMessageQuota`），附券與一般群發共用 `broadcast-quota.ts`。不要加 `channelType === 'LINE'` 分支。（群發）
- 素材含 `{{coupon.url}}` 必須附券；素材渠道必須等於發送渠道；附券必須是進行中、用途 `MARKETING`、固定效期沒過期。前後端都檢查，改一邊要改另一邊（`apps/web/src/lib/marketing/broadcast-form.ts`）。（群發）
- 後端的日期一律用 `z.coerce.date()`，不要用 `z.string().datetime()`，否則會擋掉 `2026-12-31T23:59`。（群發）
- 分群沒有條件時是 0 人（fail-closed），不是全部聯絡人。（分群）
- FB 與 IG 群發只能送給 24 小時內傳過訊息的人。不要依賴 Meta 的 message tag 與 OTN。（群發）
- 多個 LINE 官方帳號要在同一個 provider，才能認出同一位客人。關鍵字領券、加好友禮依渠道分別設定。（優惠券；`LINE.md` 的 LIFF 與 LINE Login）
- 新增掛在 Contact 上的行銷資料表時，一起加進聯絡人合併的清單。（優惠券）
- 群發的發送權限：建立帶排程要 `marketing.broadcast`，帶券要 `coupon.issue`；排程器以 `scheduledById` 當下的權限重驗。新增送出入口時要寫 `scheduledById`。（群發）
- 新增權限碼之後，部署時要跑 `scripts/grant-new-role-permissions.mjs`。（權限）
- CSV 跳脫共用 `@open333crm/shared` 的 `csvRow()`，不要在模組內另寫。（優惠券）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。
- UI 不放 emoji 與 ✓（使用者要求）。

## 回歸清單

改到本領域時，至少重走：

1. 建立 LINE 文字素材 → 建立群發（受眾 tags）→ 立即發送 → 狀態變 completed，送達數正確。
2. 建立附券群發（素材含 `{{coupon.url}}`）→ 排程 2 分鐘後 → 排程器送出 → 附券結果頁看成功與略過。
3. 建立優惠券（每種 `validityMode` 至少一次）→ 發布 → 暫停 → 恢復 → 提前結束。已發布後改鎖定欄位要回 409。
4. 建立領券連結 → 開 `/coupon/claim/[code]` → 顧客送代碼領券（本機用 WebChat）→ 開票券 → 核銷。
5. 用 supervisor 與 agent 重走 1、3，確認 403 與按鈕停用。
6. 匯出序號明細（持有者名稱含逗號，或以 `=` 開頭）：每列欄數一致，該欄以 `'` 開頭。
7. 真機（UAT）：LINE 關鍵字領券、FB 與 IG 關鍵字領券、圖文選單領券、封鎖再加入（本機收不到 LINE、FB 的 webhook）。

自動測試：

- `pnpm --filter @open333crm/api test -- marketing`、`pnpm --filter @open333crm/api test -- coupon`
- `pnpm --filter @open333crm/web test -- marketing`、`-- coupon`、`-- materials`
- `pnpm --filter @open333crm/workers test -- coupon`
- feature 測試用同名過濾，**不要加 `--`**。
- E2E：`apps/web/tests/e2e-uat/tenant-marketing.spec.ts`、`apps/web/tests/e2e-uat/tenant-materials-all-types.spec.ts`

## 常見 bug 從哪裡查

- 「群發卡在發送中」：
  - 一般群發看 `coupon-broadcast` 佇列，以及 `executeBroadcast` 是否中途拋錯。附券群發看 `coupon-broadcast` 佇列與 `runCouponBroadcast`。
  - 畫面沒有取消 `sending` 的按鈕（HC-MARKETING-08），用 API 的 `/cancel`。
- 「影片、圖片素材送不出去」：LINE 拒收 Google Drive 分享連結等不是直連的網址。失敗原因在 `BroadcastDeliveryAttempt`，後台不一定看得到。
- 「領券沒反應」：先看訊息有沒有被 `inbound-coupon-claim.ts` 攔截（代碼格式、渠道是否相符），再看回覆顧客的失敗原因。
- 「素材選單少了素材」：前端要 200 筆、後端上限 100；分群下拉只拿第一頁 50 筆（HC-MARKETING-10）。
- 「排程群發失敗：選擇『受眾分群』時必須指定一個分群」：分群在排程後被刪了（外鍵 `ON DELETE SET NULL`，刪除不檢查引用，HC-MARKETING-11）。
- 「網站客服（WebChat）不能群發」：WebChat plugin 的 `sendMessage` 不推送也不寫訊息（`packages/channel-plugins/src/webchat/index.ts`）。清單在 `@open333crm/shared` 的 `PROACTIVE_PUSH_CHANNEL_TYPES`，檢查在 `assertChannelSupportsPush()`、`claimCouponBroadcast()`。
- 「沒有權限的人看到空白列表」：行銷活動、分群、群發、素材頁的讀取錯誤不顯示，403 會顯示成「尚無…」（HC-MARKETING-06）。
- 「顧客開不了票券」：租戶要啟用 email 登記；看 `/fan/coupons/session` 回的 `status`。
