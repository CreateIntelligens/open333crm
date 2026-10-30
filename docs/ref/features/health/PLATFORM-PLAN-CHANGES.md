# 方案異動申請與審核 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（web 3000 production build、API 3001；資料庫 open333crm_advisor）／UAT Demo 租戶（a0000000-0000-0000-0000-000000000001，只讀）
- 測試帳號：
  - 本機用平台 API 自建兩個 light 租戶：`hc-platform-plan-changes-A`（e99193fa-…）、`hc-platform-plan-changes-B`（c164a236-…），各有一個 ADMIN（`hc-platform-plan-changes-a@example.test`／`-b@`）。所有申請、核准、駁回都只對這兩個租戶做，Demo 租戶的方案與既有方案內容沒有改動。
  - 平台：本機 `platform@open333crm.dev`（seed）。
  - 非 admin 角色：Demo 租戶的 seed agent（只讀與一次預期 403 的送出，確認沒有建立申請）、seed supervisor（只開頁面）。
- UAT：只用 Demo admin 讀 `GET /plan-change` 與開 `/dashboard/plan`。沒有登入平台後台（不確定 UAT 平台帳號的目前密碼），沒有送出申請、沒有審核。

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 主規格 `plan-change-request` 6 條需求、19 個 scenario：0 缺實作（但「同時只能一筆 pending」有競態，見 HC-02），0 缺測試，3 個缺前端入口（核准與駁回的「審核備註」UI 不送）。相關規格：`trial-lifecycle` 與本領域相關的 7 個 scenario、`usage-quota-alerts` 1 個，都有實作與測試 |
| 自動測試 | unit：`plan-change` 1 檔 20 案例通過；相關 `platform-audit-routes`、`platform-auth-guard` 2 檔 17 案例通過。feature：`modules/platform/plan-change` 1 檔 10 案例通過（過濾生效，只跑本領域）。0 失敗、0 skip。web 沒有本領域的 unit 測試 |
| 實際操作 | 7 條流程：正常 3（1、4、6），異常 4（2、3、5、7），待真機驗 0 |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-PLAN-CHANGES-01 | P2 | 核准與駁回不是原子操作：先讀狀態、再改租戶、最後無條件寫狀態。同一筆申請同時核准與駁回，兩個都回 200，平台稽核同時記下 `plan_change.approve` 與 `plan_change.reject`，額度照加；同時送 3 個核准，3 個都 200、記 3 筆 approve。時序再錯開一點時，可能出現「租戶已換方案，申請卻是 rejected」（推論，未實測到） | **實測**：本機 A 送加購 100,000 → 同時送 approve 與 reject（各一）重複 5 次，每次兩個都回 200，申請最後是 approved、額度 +100,000、稽核 2 筆（reject、approve）。另一筆加購 500,000 同時送 3 個 approve → 3 個 200、3 筆稽核，額度只加一次（3 個請求都讀到同一個舊值，屬 lost update） | `apps/api/src/modules/platform/plan-change.service.ts:88-90,99-102,123-127,135-138,149-155`；平台頁按鈕在請求期間也沒有停用 `apps/web/src/app/admin/plan-changes/page.tsx:29-36` | PLAN-16 |
| HC-PLATFORM-PLAN-CHANGES-02 | P2 | 「同一租戶同時只能一筆 pending」只靠 `findFirst` 後 `create`，沒有唯一索引，同時送出會建立多筆 pending，違反主規格 | **實測**：本機 B 同時送 5 筆 `POST /plan-change`（upgrade standard）→ 5 個都 200，資料庫 5 筆 pending。租戶頁的按鈕送出中會停用，正常操作不易觸發；API／CLI 呼叫端會 | `apps/api/src/modules/platform/plan-change.service.ts:21-25,36-44`；`packages/database/prisma/schema.prisma:2219-2240`（只有一般索引） | PLAN-16 |
| HC-PLATFORM-PLAN-CHANGES-03 | P2 | 平台審核頁核准／駁回失敗時畫面沒有任何提示：`act()` 沒有 `catch`，400 `TOPUP_UNLIMITED`、404 目標方案已刪、400 已處理都只變成未攔截的 promise rejection，列表不變，管理員以為按了沒反應 | **實測**：本機 B 升級為企業版（`monthlyTokens` 無上限）後在租戶頁送「加購 +20 萬」→ 平台 `/admin/plan-changes` 按「核准」並確認 → API 回 400，畫面沒有訊息、該列仍在，console 只有 `pageerror: Request failed with status code 400` | `apps/web/src/app/admin/plan-changes/page.tsx:29-36`（`load()` 第 26-27 行同樣沒有錯誤處理） | APP-11 |
| HC-PLATFORM-PLAN-CHANGES-04 | P2 | 審核結果傳不回租戶：平台頁沒有審核備註欄位（API 接受 `note`，UI 不送），租戶頁的型別與畫面都不含 `reviewNote`；核准與駁回也不發站內通知或 email。租戶只看到「已駁回」，不知道原因，也要自己回來看 | **實測**：UI 駁回 B 的加購後，`reviewNote` 為 null；租戶頁只顯示「已駁回」。`notifications` 表沒有 A、B 任何一筆；API log 沒有寄信紀錄 | `apps/web/src/app/admin/plan-changes/page.tsx:32`、`apps/web/src/app/dashboard/plan/page.tsx:7-15,126-136`、`apps/api/src/modules/platform/plan-change.service.ts:82-156`（沒有通知） | PLAN-17（功能文件已寫「核准之後租戶不會收到通知」） |
| HC-PLATFORM-PLAN-CHANGES-05 | P2 | `upgrade` 不檢查方向、不看目前方案：租戶頁的目標方案下拉寫死「標準版／專業版／企業版」，企業版租戶也能選「標準版」送出「升級」，核准後就是降級；後端也接受與目前相同的方案。平台頁不提示這是降級。降級後超額資源不回收（PLAN-03） | **實測**：B（企業版）開 `/dashboard/plan`，下拉仍是三個選項；A（輕量版）用 API 送 `targetPlanSlug=light` → 200 建立；A 在專業版時送 `light` → 平台核准 → 方案變 light，`GET /marketing/campaigns` 立刻 403 | `apps/web/src/app/dashboard/plan/page.tsx:17-21,90-92`、`apps/api/src/modules/platform/plan-change.service.ts:27-31,93-102` | PLAN-18（功能文件已寫「沒有任何比較貴的檢查」） |
| HC-PLATFORM-PLAN-CHANGES-06 | P2 | 待審申請沒有撤回與逾期：租戶送錯只能等平台處理，平台不處理就永遠擋住新申請。UAT Demo 有一筆 2026-09-16 起的加購 20 萬仍是 pending（44 天），Demo 租戶無法再送申請，E2E `cross-plan-request` 遇到 pending 也會中止。**備註**：這筆申請是 BD 在測試使用的，不是殘留資料，**不要處理**；它只用來說明這個限制的效果 | **實測（UAT 唯讀）**：Demo admin `GET /plan-change` 第一筆是 `21676e0e-…` `token_topup` `pending` `createdAt 2026-09-16T08:53:14Z`；`/dashboard/plan` 顯示「您有一筆處理中的申請」 | `apps/api/src/modules/platform/plan-change.routes.ts:26-35`（只有 GET、POST） | PLAN-19 |
| HC-PLATFORM-PLAN-CHANGES-07 | P3 | `topupTokens` 超過 `Int` 上限回 500 | **實測**：`POST /plan-change {"type":"token_topup","topupTokens":99999999999}` → 500 `INTERNAL_ERROR` | `apps/api/src/modules/platform/plan-change.routes.ts:17` | 新 |
| HC-PLATFORM-PLAN-CHANGES-08 | P3 | 目標方案只檢查「存在、不是試用」：同方案、停售方案（PLAN-01）、平台內部自訂方案都能申請並核准；平台頁用寫死的 `PLAN_LABEL` 對照，自訂方案顯示 slug | **實測**同方案（light→light）建立成功；停售與自訂方案為讀程式 | `apps/api/src/modules/platform/plan-change.service.ts:29-31,94-96`、`apps/web/src/app/admin/plan-changes/page.tsx:18-20` | PLAN-01（停售部分） |
| HC-PLATFORM-PLAN-CHANGES-09 | P3 | 加購量填 0 的錯誤訊息是「不可小於 0」，與實際規則（必須大於 0）矛盾 | **實測**：`topupTokens: 0` 與 `-1` 都回「不可小於 0」 | Zod `positive()` 的中文 errorMap；`plan-change.routes.ts:17` | 新 |
| HC-PLATFORM-PLAN-CHANGES-10 | P3 | 租戶頁體驗：錯誤訊息用綠色成功底（409 也是綠底）；讀取失敗顯示「尚無申請記錄。」而且仍顯示可送出的表單；記錄沒有申請日期、方案顯示英文 slug；備註沒有字數提示。手冊 ch14 已逐條註明這些現況 | **實測**：A 開著頁面時另有 pending，按送出 → `bg-green-50` 方塊顯示「已有處理中的申請，請等待審核」；seed agent 直接開 `/dashboard/plan`（側欄已隱藏）→ `GET /plan-change` 403、`pageerror`，畫面是完整表單＋「尚無申請記錄。」 | `apps/web/src/app/dashboard/plan/page.tsx:39-40,67,113,128-134` | 新 |
| HC-PLATFORM-PLAN-CHANGES-11 | P3 | 稽核資訊不足：平台稽核 `plan_change.approve` 的 payload 只有 `type` 與 `trialExited`，沒有租戶 id、前後方案、加購量；`plan_change.reject` 沒有 payload；租戶送出申請與核准結果都不寫租戶稽核（`tenant_audit_logs` 為 0 筆） | **實測**：查 `platform_audit_logs where targetType='plan_change_request'` 與 `tenant_audit_logs where tenantId=A` | `apps/api/src/modules/platform/platform.routes.ts:468-490` | PLAN-11（反查困難）、AUD-01（租戶稽核範圍） |
| HC-PLATFORM-PLAN-CHANGES-12 | P3 | 平台待審列表不顯示申請時間與試用狀態，審核者看不出申請放了多久、是不是試用轉正式（AUDIT-REVIEWS 2026-09 的 TRIAL-01 追查已提到「審核者看不到試用狀態」，沒有開項目） | 讀程式＋本機畫面：表頭只有租戶、類型、內容、備註、操作 | `apps/api/src/modules/platform/plan-change.service.ts:59-76`、`apps/web/src/app/admin/plan-changes/page.tsx:48-55` | 新 |
| HC-PLATFORM-PLAN-CHANGES-13 | P3 | `getTenantPlanId` 的 60 秒進程內快取只在處理核准請求的 API 進程失效；API 水平擴展成多個實例時，其他實例最長 60 秒仍用舊方案判斷權限天花板（讀程式，未實測；本機單一實例實測立即生效） | 讀 `invalidateTenantPlan` 只刪本進程 Map | `apps/api/src/services/tenant-plan.cache.ts:8-30`、`plan-change.service.ts:105,128` | 新 |
| HC-PLATFORM-PLAN-CHANGES-14 | P3 | E2E `cross-plan-request.spec.ts` 已過時：等待「✓ 申請已送出…」與「✓ 已駁回…」，UI 已拿掉 ✓，執行會在第一步逾時失敗 | 讀程式：頁面實際文字是「申請已送出，等待平台方核准」「已駁回「…」的申請」（本機實測畫面） | `apps/web/tests/e2e-uat/cross-plan-request.spec.ts:39,68` | 新 |

已在 AUDIT.md、本次實測再確認的項目：
- **PLAN-05**（加購過的租戶升級，額度停在舊值）：A 加購後 `monthlyTokens` 覆寫 2,800,000，升級到專業版（方案 8,000,000）後覆寫值不變。
- **PLAN-11**（平台只看得到待審）：核准、駁回後的申請在 `/admin/plan-changes` 消失，平台 API 沒有其他查詢途徑。
- **PLAN-02**（加購是永久提高每月上限）：核准後寫進 `limitOverrides.monthlyTokens`，與文件一致。
- **TRIAL-01**（核准試用租戶升級要脫離試用）：已修，feature 測試 10 案例通過。
- **PLAN-06**（核准加購清告警旗標）：已修，unit 測試「核准加購後再次跨越門檻」通過。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 租戶看申請記錄 | 本機 API＋UI、UAT 唯讀 | 正常：只回自己租戶，新到舊；B 看不到 A 的申請 | 讀取失敗顯示「尚無申請記錄。」（HC-10） | 正常：agent 403 `settings.manage`、側欄隱藏；supervisor 有 `settings.manage`，看得到 | UAT Demo 有一筆 44 天的 pending（HC-06；BD 測試使用，不要處理） |
| 2 申請升級 | 本機 UI＋API | 正常：送出後顯示「申請已送出，等待平台方核准」、記錄多一筆「處理中」，重新整理後表單換成提示 | 正常：缺 slug 400、slug 不存在 404、試用方案 400、`type=downgrade` 400、備註 501 字 400、已有 pending 409。異常：409 訊息是綠底（HC-10）；同方案可送（HC-08）；併發可建多筆（HC-02） | agent `POST` 403，Demo 沒有建立任何申請 | 下拉不看目前方案（HC-05） |
| 3 申請加購 | 本機 UI＋API | 正常：UI 選「+20 萬」送出，記錄顯示「加購 20 萬 token」 | 0、-1、1.5、字串 `"100"` 都 400；超大值 500（HC-07）；0 的訊息矛盾（HC-09） | 同上 | — |
| 4 平台看待審 | 本機 API＋UI | 正常：只列 pending、舊到新，附租戶名稱與目前方案名稱 | — | 租戶 token 打平台端點 401 | 沒有申請時間、試用狀態（HC-12） |
| 5 平台核准 | 本機 UI＋API | 正常：A 輕量版→專業版，核准後 `GET /marketing/campaigns` 立刻 403→200；降回輕量版立刻 200→403；加購 `monthlyTokens` = 1,500,000 + 500,000；UI 核准顯示「已核准「…」的申請」 | 已處理 400、不存在 404、非 UUID 400 `DATABASE_ERROR`；企業版加購 400 `TOPUP_UNLIMITED` 但 UI 無提示（HC-03）；併發不安全（HC-01） | 平台 superuser | 沒有審核備註欄位、不通知租戶（HC-04）；核准後 `reviewedBy`、`reviewedAt` 有寫入 |
| 6 平台駁回 | 本機 UI＋API | 正常：租戶方案與覆寫值不變；API 帶 `note` 寫入 `reviewNote` | 已處理 400 | — | 稽核 payload 空（HC-11） |
| 7 租戶看結果 | 本機 UI | 狀態正確顯示「已核准／已駁回」 | — | — | 看不到原因與日期（HC-04、HC-10） |

## 完備度對照

| Spec / Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| 送出升級申請 | `plan-change.service.ts:16-45` | unit | `/dashboard/plan` |
| 已有待審申請時不能再送出 | `plan-change.service.ts:21-25`（有競態，HC-02） | unit（只測循序） | 表單換成提示 |
| 升級申請沒有目標方案 | `:28` | unit | UI 一定帶值 |
| 目標方案不存在 | `:29-30` | unit | UI 寫死的三個 slug |
| 加購量不是正整數 | routes `:17`、service `:33` | unit | UI 只有三個固定值 |
| 沒有 settings.manage 權限 | routes `:24` | unit | 側欄隱藏，直接開網址不擋（HC-10） |
| 只回傳自己租戶的申請 | `:48-54` | unit | 有 |
| 最多回傳 50 筆 | `:52` | unit | 有 |
| 只列出待審的申請 | `:59-76` | unit | `/admin/plan-changes` |
| 核准升級後立即生效 | `:93-105` | unit（權限立即生效） | 有；「備註是已收款」沒有 UI 入口 |
| 目標方案已不存在 | `:94-95` | unit | 有，但失敗無提示（HC-03） |
| 沒有覆寫時加在方案的額度上 | `:107-127` | unit | 有 |
| 已有覆寫時加在覆寫值上 | 同上 | unit | 有 |
| 有效額度是無上限時不能加購 | `:120-122` | unit | 有，但失敗無提示（HC-03） |
| 核准加購後立即恢復 AI | `:128-132` | unit | — |
| 駁回不改變租戶 | `:143-156` | unit | 有；「備註是尚未收款」沒有 UI 入口 |
| 已處理的申請不能再核准 | `:90` | unit | 列表不顯示已處理的申請 |
| 已處理的申請不能駁回 | `:151` | unit | 同上 |
| 申請不存在 | `:89,150` | unit | — |
| trial-lifecycle：核准試用租戶的升級申請／非試用／試用加購／試用方案不能當目標（建立、核准） | `:31,96-102`、`trial-admin.service.ts` | feature `plan-change-trial-exit.test.ts` | 有 |
| usage-quota-alerts：核准加購後再次跨越門檻 | `:132` | unit | — |

## 待真機驗

無。本領域不涉及 LINE／FB／IG。UAT 平台後台的審核畫面沒有驗（不登入 UAT 平台帳號、也不審核），與本機程式相同版本時行為應一致。

## 本機留下的測試資料

- 租戶 `hc-platform-plan-changes-A`（e99193fa-3df6-4064-b844-4c49a556b3c5，目前標準版、`monthlyTokens` 覆寫 2,800,000）、`hc-platform-plan-changes-B`（c164a236-bba3-435a-9357-1f9c21c9e0a7，目前企業版），以及兩者的 20 筆已處理申請。沒有留下 pending。
- 沒有改任何租戶設定、方案內容、seed 帳號。另一個代理（platform-plans）的租戶 `hc-platform-plans-T1` 有一筆 pending，本次沒有動。

## 建議新增到 AUDIT.md 的項目

1. 核准／駁回不是條件更新，併發時兩者都成功並各自寫稽核（HC-01，P2）。修法：`updateMany({ where: { id, status: 'pending' } })` 搶狀態，搶到才改租戶，整段放進交易。
2. 「一個租戶一筆 pending」沒有資料庫層保證（HC-02，P2）。修法：`plan_change_requests (tenantId) WHERE status = 'pending'` 部分唯一索引，`create` 撞到時回 409。
3. 平台審核頁吞掉錯誤（HC-03，P2），違反「失敗要讓使用者看得到」。
4. 審核結果沒有傳回租戶：沒有審核備註入口、租戶看不到原因、不通知（HC-04，P2）。
5. 沒有降級流程、升級不檢查方向（HC-05，P2）：決定要不要新增 `downgrade` 型別，或在 UI 只列比目前貴的方案並在平台頁標示降級。
6. 待審申請不能撤回、沒有逾期（HC-06，P2）。UAT Demo 那筆 2026-09-16 的 pending 是 BD 在測試使用的，不是殘留資料，不要處理。
7. 方案異動的稽核欄位不足（HC-11，P3），可併入 PLAN-11。
8. `getTenantPlanId` 進程內快取在多實例下的失效範圍（HC-13，P3），可併入水平擴展相關項目。

## 文件過時之處

- `docs/ref/features/platform/PLAN-CHANGES.md` 的核對日期是 2026-09-23，內容與程式一致；但沒有提到：平台頁沒有審核備註欄位、核准失敗沒有畫面提示、併發送出可建立多筆 pending、租戶不能撤回。
- `docs/ref/DATABASE-ERD.md:76` 把 `plan_change_requests` 寫成「方案升降級或加購 token 申請」，系統沒有降級型別，只有 `upgrade` 與 `token_topup`。
- `apps/web/tests/e2e-uat/cross-plan-request.spec.ts` 期待的成功訊息仍帶 ✓（HC-14）。
- 手冊 `apps/web/public/manual/ch14-plan.html` 與現況一致（已註明錯誤綠底、讀取失敗、無日期等），修好 HC-04、HC-10 後要同步改手冊。
