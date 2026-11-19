---
name: feature-portal
description: >
  open333CRM「會員入口（Fan Portal）」功能顧問：粉絲活動（投票、表單、競猜）、提交與抽獎、會員積分、粉絲端 API、會員綁定。改到 portal、member-binding 模組、/dashboard/portal，或改顧客憑證、聯絡人合併、資料刪除之前使用。
---

# 會員入口（Fan Portal）

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。粉絲活動、積分與會員綁定的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

粉絲活動（投票 POLL、表單 FORM、競猜 QUIZ）的建立、編輯、發布、結束、封存與取消封存，提交紀錄與抽獎。
會員積分：手動調整、活動送點、餘額、交易紀錄。粉絲端 API `/api/v1/fan`（fanToken、活動、送出、結果、我的積分）。會員綁定 member-binding（外部會員系統的設定、顧客綁定會員編號）。
相關的程式與資料：`/dashboard/portal`、`/dashboard/portal/activities`、`/dashboard/portal/submissions`、`/dashboard/portal/points`、portal 模組、`points.service`、`portal-auth.service`（`signFanToken`、`signFanDeviceToken`）、member-binding 模組、`PortalActivity`、`PointTransaction`。
改優惠券票券夾（顧客憑證）、聯絡人合併（點數轉移）、資料刪除、`portal.activity.submitted` 自動化之前也使用。
口語觸發：「粉絲活動」「積分」「點數」「抽獎」「投票活動」「會員綁定」「顧客入口」「fan token」。

## 先讀

先讀功能文件 `docs/ref/features/tenant/PORTAL.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `PORTAL.md` 的章節 |
| --- | --- |
| 路由前綴、fanToken 誰簽發 | 負責的程式 |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 活動類型、狀態轉換、編輯、發布的檢查、輸入檢查 | 活動 |
| 粉絲端的身分與查詢範圍 | 粉絲怎麼參加 |
| 送出、重複參加、積分、事件、粉絲端狀態碼 | 提交 |
| 抽獎 | 抽獎 |
| 積分帳本、餘額、調整、合併轉移 | 積分 |
| 會員綁定的憑證、外呼、寫入 | 會員綁定 |
| 權限碼與預設角色 | 權限 |
| 前端頁面、送出的值、沒有畫面入口的功能 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/portal/`、`apps/api/tests/unit/modules/member-binding/`、`apps/api/tests/feature/modules/portal/`、`apps/api/tests/feature/modules/member-binding/`、`apps/web/tests/unit/components/portal/`，寫法可以照著參考。

`PORTAL.md` 裡標 `HC-PORTAL-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PORTAL.md`
- 規格：`openspec/specs/portal-activity/spec.md`（粉絲活動）、`openspec/specs/member-binding/spec.md`（會員綁定）
- 稽核：`docs/ref/system/AUDIT.md` 的 PORTAL-01、PORTAL-02、PORTAL-04、PLAN-04、AUTO-05、ERASE-01
- 手冊：`apps/web/public/manual/ch11-portal.html`
- 影響分析：`node scripts/feature-impact.mjs --domain portal`。依賴與被依賴的領域以這個指令的輸出為準。
- 優惠券的顧客端頁面（`/coupon/*`、`apps/web/src/components/fan-coupon/`）屬於行銷，見 `.claude/skills/feature-marketing/SKILL.md`。

## 不可破壞的規則

每條規則的細節在 `PORTAL.md` 括號內的章節。

- 粉絲端只信 fanToken 裡的 `tenantId` 與 `contactId`，不接受呼叫端指定。`verifyFanToken` 只收 `sub: 'fan'`；裝置憑證與客服 JWT 都不能當 fanToken。fanToken 只能從驗證過的身分簽發，不可恢復舊的 `POST /fan/auth`。（負責的程式、粉絲怎麼參加）
- 粉絲端給的選項不可帶 `isCorrect`。目前只有結果端點例外（PORTAL-01，要修）。（提交）
- 積分帳本只新增，餘額 = 最新一筆的 `balance`。所有寫入都走 `addPointTransaction`，不可直接 `pointTransaction.create`。同一位聯絡人的寫入以 advisory lock 依序處理。（積分）
- 已有提交的活動用封存，不刪除：`PortalSubmission` 對活動是 `onDelete: Cascade`，刪除只開放給草稿。（活動）
- 新增掛在 Contact 上的 portal 資料表，要同時加進 `contact-merge.service.ts` 的搬移與搬回，以及資料刪除。（積分）
- `portal.view`、`portal.manage` 預設只有 admin 有。新增權限碼的步驟見 `docs/ref/features/tenant/MEMBERS.md`。（權限）
- 會員綁定：憑證只存加密值，回傳 `••` 開頭時沿用舊值；外呼必須經 `upstream-guard.ts`，不可直接 `fetch`；只有完整取得會員編號才寫入。（會員綁定）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。

## 回歸清單

改到本領域時，至少重走：

1. 建立投票：兩個選項、起訖時間、每次 3 點。重新整理後，選項、時間、積分一致。
2. 編輯該草稿，只改標題。`GET /portal/activities/:id` 的選項與正確答案仍在（feature 測試「只改標題時，選項、正確答案與表單欄位都保留」）。
3. 發布 → 結束 → 封存 → 已封存分頁 → 取消封存。每一步的按鈕與狀態正確。已發布的活動，PATCH 與 DELETE 被拒。
4. 發布的檢查：
   - 建立沒有選項的投票草稿（可以建立）→ 按「發布」→ alert「投票與競猜活動至少要有一個選項」，活動仍是草稿。補上選項後可以發布。表單沒有欄位時同理（feature 測試「發布沒有選項的投票或競猜回 400，活動仍是草稿」）。
   - 建立競猜草稿，選項都沒勾「正確」（可以建立與儲存）→ 按「發布」→ alert「競猜活動至少要有一個正確答案」，活動仍是草稿。勾一個正確答案後可以發布。投票不受影響（feature 測試「發布沒有正確答案的競猜回 400，活動仍是草稿」）。
5. 粉絲端（以票券夾取得的 fanToken，或在測試中以 `signFanToken` 簽發）：列表不含草稿、送出時加點、重複送出被拒、結果不含 `isCorrect`。
6. 積分：同一位聯絡人並行加點 10 次，餘額等於交易總和。合併兩位有點數的聯絡人，再解除合併，點數正確。
7. 用只有 `portal.view` 的自訂角色重走 1–3、抽獎、調整：後端回 403（`details.requiredPermission: portal.manage`），按鈕應隱藏。

自動測試：

- `pnpm --filter @open333crm/api test -- portal member-binding`
- `pnpm --filter @open333crm/web test -- portal points-tab fan-api-token fan-device`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/portal modules/member-binding`
- E2E：`apps/web/tests/e2e-uat/tenant-fields-channels-portal.spec.ts`

## 常見 bug 從哪裡查

- 「點數不對、少加」：先比 `sum(amount)` 與最新一筆的 `balance`。餘額讀 `points.service.ts` 的 `getLatestPointEntry`。合併轉移看 `contact-merge.service.ts` 的 `transferPoints`。
- 「交易類型顯示英文代碼」：`apps/web/src/components/portal/PointsTab.tsx` 的 `typeLabels` 沒有 `merge_transfer_*`、`revert_transfer_*`（HC-PORTAL-14）。
- 「粉絲端 401」：token 不是 `sub: 'fan'`（裝置憑證、客服 token），或已過 24 小時。顧客要回對話重新點票券連結。
- 「粉絲送出一直 400」：看 `error.message`。PORTAL-02 把 404、409 與 Prisma 原文都改成 400。
- 「抽獎沒反應」：所有提交都已中獎時回空陣列，視窗不提示（`apps/web/src/components/portal/SubmissionsView.tsx`，HC-PORTAL-10）。
- 「看不到粉絲活動選單」：角色沒有 `portal.view`（supervisor、agent 預設都沒有），或方案沒開 feature `portal`。
- 「會員綁定 502」：`error.code` 是 `UPSTREAM_*`。後台 `/member-binding/contacts/:id` 的 `detail` 寫出 `PRIVATE_ADDRESS` 等原因，顧客端不回 `detail`。
