---
name: feature-portal
description: >
  open333CRM「會員入口（Fan Portal）」功能顧問：粉絲活動（投票 POLL、表單 FORM、競猜 QUIZ）的建立、編輯、
  發布、結束、封存與取消封存，提交紀錄與抽獎，會員積分（手動加點扣點、活動送點、餘額、交易紀錄），
  粉絲端 API /api/v1/fan（fanToken、活動列表、送出、結果、我的積分），以及會員綁定 member-binding
  （外部會員系統對接設定、顧客綁定會員編號）。當需求、bug 或新功能碰到 /dashboard/portal、
  /dashboard/portal/activities、/dashboard/portal/submissions、/dashboard/portal/points、portal 模組、
  points.service、portal-auth.service（signFanToken、signFanDeviceToken）、member-binding 模組、
  PortalActivity、PointTransaction 時使用。也在改優惠券票券夾（顧客憑證）、聯絡人合併（點數轉移）、
  資料刪除、portal.activity.submitted 自動化前使用。口語觸發：「粉絲活動」「積分」「點數」「抽獎」
  「投票活動」「會員綁定」「顧客入口」「fan token」。
---

# 會員入口（Fan Portal）

## 先讀
- 功能現況：`docs/ref/features/tenant/PORTAL.md`
  - 注意：其中「系統目前不簽發粉絲 token，粉絲端無法使用」已過時。優惠券票券夾開啟成功時會簽發 fanToken（`apps/api/src/modules/coupon/coupon-wallet.service.ts` 的 `grantWalletSession`），這顆 token 可以打 `/api/v1/fan/*` 的每一條路由，包括粉絲活動與會員綁定。見健檢 HC-PORTAL-02。
  - 「餘額是所有交易的總和」不精確：餘額取 `createdAt` 最新一筆的 `balance` 欄位（`apps/api/src/modules/portal/points.service.ts` 的 `getLatestPointEntry`）。
- 健檢結果與已知問題：`docs/ref/features/health/PORTAL.md`
- 規格：`openspec/specs/member-binding/spec.md`（會員綁定）。粉絲活動本身在 main 已有主規格 portal-activity（本 worktree 的版本還沒有）。
- 手冊：`apps/web/public/manual/ch11-portal.html`
- 稽核：`docs/ref/system/AUDIT.md` 的 PORTAL-01、PORTAL-02、PLAN-04、AUTO-05、ERASE-01
- 影響分析：`node scripts/feature-impact.mjs --domain portal`

路由前綴（`apps/api/src/index.ts`）：`/api/v1/portal`（後台，整個 plugin 要求 `portal.view`）、`/api/v1/fan`（粉絲端，fanToken）、
`/api/v1/member-binding`（後台，`settings.manage`；代顧客綁定要 `contact.update`）、`/api/v1/fan/member-binding`（粉絲端，fanToken，每 IP 每分鐘 10 次）。

**main 在 2026-10-30 大改了 portal 後台與粉絲端**（入口開交易、advisory lock、Zod 驗證每個輸入、活動設定驗證、調整積分先確認聯絡人）。改這個模組前先 `git log origin/main -- apps/api/src/modules/portal`，以 main 為準。

## 前端操作流程

格式：入口 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）。側欄「粉絲活動」依 `portal.view` 顯示（`apps/web/src/components/layout/Sidebar.tsx`）。

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 活動列表 | `/dashboard/portal/activities`（三個子路由共用 `apps/web/src/app/dashboard/portal/page.tsx`，依網址最後一段切分頁） | `GET /portal/activities`（`fetchAllPages` 逐頁取完）→ `listActivities`；預設排除 `ARCHIVED`，「查看已封存」帶 `status=ARCHIVED` | 無 | `portal.view` |
| 2 | 建立活動 | 「建立活動」→ `ActivityFormDialog` | `POST /portal/activities` → `createActivity`；日期 `datetime-local` 經 `toIsoForApi` 轉 ISO | 無事件、無稽核 | `portal.manage` / **不隱藏** |
| 3 | 編輯草稿 | 草稿卡「編輯」 | `PATCH /portal/activities/:id` → `updateActivity`（只有 DRAFT 可改；`options`/`fields` 有送就整批刪除重建） | **對話框拿清單項當資料，清單沒有 options/fields，存檔會清空選項與欄位（HC-PORTAL-01）** | `portal.manage` / **不隱藏** |
| 4 | 發布、結束 | 卡片「發布」（DRAFT）、「結束」（PUBLISHED），不再確認 | `POST /:id/publish`、`/:id/end` | 發布寫 `publishedAt` | `portal.manage` / **不隱藏** |
| 5 | 封存、取消封存 | ENDED 卡「封存」（有 confirm）；「查看已封存」→「取消封存」 | `POST /:id/archive`（DRAFT、ENDED 可封存）、`/:id/unarchive`（一律回到 ENDED） | 提交紀錄保留 | `portal.manage` / **不隱藏** |
| 6 | 刪除草稿 | 草稿卡「刪除」（confirm） | `DELETE /:id`；只有 DRAFT | 硬刪，選項、欄位 cascade | `portal.manage` / **不隱藏** |
| 7 | 提交紀錄 | `/dashboard/portal/submissions`，下拉選活動（不含已封存） | `GET /:id/submissions` → `listSubmissions` | 無；答案摘要只顯示數量 | `portal.view` |
| 8 | 抽獎 | 提交紀錄「抽獎」→ 填人數 | `POST /:id/draw {count}` → `drawWinners`（從 `isWinner=false` 的提交隨機抽，任何狀態都能抽） | 寫 `isWinner`，不能收回；再按一次是加抽 | `portal.manage` / **不隱藏** |
| 9 | 積分查詢 | `/dashboard/portal/points` 搜尋（名稱、電話、email） | `GET /contacts?q&limit=20`（要 `contact.view`）→ 只有一筆才自動選；`GET /portal/points?contactId`、`GET /portal/points/balance/:contactId` | 無 | `portal.view` + `contact.view` |
| 10 | 手動調整積分 | 積分頁「手動調整」 | `POST /portal/points/adjust {contactId, amount, note}` → `addPointTransaction`（`type: admin_adjust`） | 寫一筆帳本；可扣成負數 | `portal.manage` / **不隱藏**，送出後對話框紅字顯示 403 |

粉絲端與會員綁定沒有任何前端頁面，只能用 API：

| # | 流程 | API → 後端 | 備註 |
| - | ---- | ---------- | ---- |
| 11 | 粉絲瀏覽與送出活動 | `GET /fan/activities`、`GET /fan/activities/:id`、`POST /fan/activities/:id/submit {optionIds?, fields?}` → `submitActivity` | 送積分（`pointsPerSubmit`）、發 `portal.activity.submitted`。錯誤一律 400（PORTAL-02） |
| 12 | 粉絲看結果與自己的紀錄 | `GET /fan/activities/:id/result`、`/fan/me/activities`、`/fan/me/points` | 結果端點回傳 `isCorrect`、草稿也讀得到（PORTAL-01） |
| 13 | 會員綁定設定 | `GET/PUT /member-binding`、`POST /member-binding/test` | 憑證加密入庫、讀回遮蔽成 `••••••••`；外呼經 `apps/api/src/modules/member-binding/upstream-guard.ts` 擋私有位址 |
| 14 | 顧客綁定會員 | `GET /fan/member-binding/fields`、`GET /fan/member-binding`、`POST /fan/member-binding`；後台代綁 `POST/DELETE /member-binding/contacts/:contactId` | 綁定寫 `ContactAttribute`，可依 `bindTagId` 貼標 |

**有後端、沒有前端入口**：粉絲端整組 `/fan/*`（活動、結果、我的積分）；會員綁定設定頁與顧客綁定頁（行銷健檢 HC-MARKETING-13 已記錄）；活動的 `coverImage`、選項 `imageUrl`、`settings.allowMultiple`、表單「選單」型態的 `options`；提交的實際答案內容（只顯示數量）；`portal.activity.submitted` 不在自動化規則編輯器（AUTO-05）。

**前端實際送出的值**：`type` 為 `POLL|FORM|QUIZ`；`fieldType` 為 `text|textarea|email|phone|date|select`（後端接受任意 50 字內字串）；`settings` 只送 `{ pointsPerSubmit }`（`parseInt || 0`）；`options` 送 `{label, imageUrl, isCorrect, sortOrder}`，空白列在前端先濾掉；編輯時清空日期送 `null`；抽獎 `count` 為 `parseInt || 1`；調整積分 `amount` 為 `parseInt || 0`（輸入 1.7 變 1，0 時按鈕停用）。

## 不可破壞的規則
- 粉絲端只信 fanToken 裡的 `tenantId` 與 `contactId`，不接受呼叫端指定。`verifyFanToken` 只收 `sub: 'fan'`；裝置憑證（`typ: 'fan-device'`）與客服 JWT 都不能當 fanToken（實測 401）。fanToken 只能從驗證過的身分簽發（票券夾 email 驗證碼、LIFF ID token），不可恢復舊的 `POST /fan/auth`。
- 粉絲端給的選項不可帶 `isCorrect`。目前只有結果端點例外（PORTAL-01，要修）。
- 積分帳本 append-only，餘額 = 最新一筆的 `balance`。所有寫入都走 `addPointTransaction`（合併轉移也是），不可直接 `pointTransaction.create`；同一位聯絡人的寫入要依序（main 以 advisory lock 處理）。
- 封存而非刪除已有提交的活動：`PortalSubmission` 對活動是 `onDelete: Cascade`，刪除只開放給草稿。
- 新增掛在 Contact 上的 portal 資料表，要同時加進 `apps/api/src/modules/contact/contact-merge.service.ts` 的搬移與搬回，以及 `apps/workers/src/handlers/data-erasure.handler.ts`。
- `portal.view`、`portal.manage` 預設只有 admin 有（`packages/shared/src/rbac/default-roles.ts`）。新增權限碼要跑 reconcile。
- 會員綁定：設定憑證只存加密值，前端回傳 `••` 開頭時沿用舊值（`apps/api/src/modules/member-binding/member-binding.flow.ts`）；外呼必須經 `upstream-guard.ts`，不可直接 `fetch`；只有完整取得會員編號才寫入。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain portal` 看最新版本。重點：
- **依賴**：聯絡人（積分掛在聯絡人、積分頁搜尋）、行銷（fanToken 目前只由優惠券票券夾簽發）、LINE（LIFF ID token 驗身分、LIFF 與 LINE Login 設定在渠道 Bot 設定 `apps/web/src/components/settings/BotConfigForm.tsx`）、設定（會員綁定設定存 `TenantSettings.memberBinding`）、人員與角色（權限只給 admin）、方案（feature `portal` 天花板）。
- **被依賴**：聯絡人（合併搬 PortalSubmission、PointTransaction 並轉移點數；登記成功發裝置憑證）、行銷（票券夾用 `signFanToken`、`signFanDeviceToken`；web 的 `apps/web/src/lib/fan-api.ts`、`apps/web/src/lib/fan-device.ts`）、自動化（`portal.activity.submitted`）、治理（資料刪除）。
- 優惠券顧客端頁面（`/coupon/*`、`apps/web/src/components/fan-coupon/`）屬於行銷，見 `.claude/skills/feature-marketing/SKILL.md`。改 `apps/api/src/modules/portal/portal-auth.service.ts` 會同時影響票券夾、登記頁與粉絲活動。

## 回歸清單
改到本領域時，至少重走：
1. 建立投票（兩個選項、起訖時間、每次 3 點）→ 重新整理後選項、時間、積分一致。
2. 編輯該草稿只改標題 → `GET /portal/activities/:id` 選項仍在（目前會被清空，HC-PORTAL-01）。
3. 發布 → 結束 → 封存 → 查看已封存 → 取消封存，每一步按鈕與狀態正確；已發布的活動 PATCH、DELETE 被拒。
4. 粉絲端（以票券夾取得的 fanToken，或測試中以 `signFanToken` 簽發）：列表不含草稿、送出加點、重複送出被拒、結果不含 `isCorrect`。
5. 積分：同一位聯絡人並行加點 10 次，餘額等於交易總和；合併兩位有點數的聯絡人後再解除，點數正確。
6. 用只有 `portal.view` 的自訂角色重走 1–3、抽獎、調整：後端 403（`details.requiredPermission: portal.manage`），按鈕應隱藏。
- 自動測試：`pnpm --filter @open333crm/api test -- portal member-binding`；`pnpm --filter @open333crm/web test -- portal points-tab fan-api-token fan-device`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/member-binding`（main 另有 `modules/portal`）。
- E2E：`apps/web/tests/e2e-uat/tenant-fields-channels-portal.spec.ts`。

## 常見 bug 從哪裡查
- 「編輯活動後選項不見」：`apps/web/src/app/dashboard/portal/page.tsx` 把清單項（沒有 options/fields）傳給 `apps/web/src/components/portal/ActivityFormDialog.tsx`；後端 `updateActivity` 收到空陣列就整批刪除。
- 「點數不對、少加」：先比 `sum(amount)` 與最新一筆 `balance`。差異來自並行寫入或同一毫秒的多筆紀錄（`points.service.ts` 的 `getLatestPointEntry`）。合併轉移看 `contact-merge.service.ts` 的 `transferPoints`。
- 「交易類型顯示英文代碼」：`apps/web/src/components/portal/PointsTab.tsx` 的 `typeLabels` 沒有 `merge_transfer_*`、`revert_transfer_*`。
- 「粉絲端 401」：token 不是 `sub: 'fan'`（裝置憑證、客服 token），或已過 24 小時；顧客要回對話重新點票券連結。
- 「粉絲送出一直 400」：看 `error.message`，PORTAL-02 會把 404/409 與 Prisma 原文都改成 400；活動 `settings.pointsPerSubmit` 不是整數時每次送出都失敗（本 worktree 版本）。
- 「抽獎沒反應」：所有提交都已中獎時回空陣列，視窗不提示（`apps/web/src/components/portal/SubmissionsView.tsx`）。
- 「看不到粉絲活動選單」：角色沒有 `portal.view`（supervisor、agent 預設都沒有），或方案沒開 feature `portal`。
- 「會員綁定 502」：`error.code` 為 `UPSTREAM_*`；後台 `/member-binding/contacts/:id` 的 `detail` 會寫 `PRIVATE_ADDRESS` 等原因，顧客端不回 detail。
