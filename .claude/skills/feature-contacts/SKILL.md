---
name: feature-contacts
description: >
  open333CRM「聯絡人與標籤」功能顧問：聯絡人、標籤、合併與解除合併、跨渠道綁定。改到 contact／tag／identity-binding 模組、/dashboard/contacts，或改群發分眾、自動化貼標、短連結貼標之前使用。
---

# 聯絡人與標籤

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。聯絡人與標籤的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

聯絡人的列表、搜尋、詳情、email 編輯與 `EMAIL_IN_USE`、貼標與標籤管理、聯絡人合併與解除合併（One ID、歸戶、跨渠道綁定代碼、
email 與手機登記 `/bind/email`、`/bind/phone`）、合併建議、收訊建立聯絡人、LINE 頭像重抓。
相關的程式與資料：contact、tag、identity-binding 模組、`ChannelIdentity`、`IdentityMap`、`/dashboard/contacts`、`/dashboard/settings/tags`。
改群發分眾、優惠券登記、自動化貼標、短連結點擊貼標之前也使用，確認不破壞聯絡人。

## 先讀

先讀功能文件 `docs/ref/features/tenant/CONTACTS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `CONTACTS.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 收訊建立聯絡人、`IdentityMap`、頭像 | 聯絡人與渠道身分 |
| 列表篩選、修改聯絡人、email 衝突、時間軸、跨渠道訊息 | 清單與編輯 |
| 合併、解除合併、合併預覽、合併建議 | 合併 |
| email 與手機登記、代發連結、綁定代碼 | Email 登記；手機登記 |
| 標籤的 scope、貼標來源、`contact.tagged`、刪除標籤 | 標籤 |
| 權限碼、渠道可見範圍 | 誰能做什麼 |
| 聯絡人頁、標籤管理頁、登記頁 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/contact/`、`apps/api/tests/unit/modules/tag/`、`apps/api/tests/unit/modules/identity-binding/`、`apps/api/tests/feature/modules/contact/`、`apps/api/tests/feature/modules/tag/`、`apps/api/tests/feature/modules/identity-binding/`、`apps/web/tests/unit/components/contact/`，寫法可以照著參考。

`CONTACTS.md` 裡標 `HC-CONTACTS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/CONTACTS.md`
- 規格：`openspec/specs/contact-management/spec.md`、`openspec/specs/email-identity-merge/spec.md`、`openspec/specs/phone-identity-merge/spec.md`、`openspec/specs/cross-channel-binding-code/spec.md`、`openspec/specs/tag-management/spec.md`。完整清單見 `docs/ref/features/feature-map.json`。
- 影響分析：`node scripts/feature-impact.mjs --domain contacts`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `CONTACTS.md` 括號內的章節。

- `ChannelIdentity` 以 `(channelId, uid)` 唯一。同一個人跨渠道一開始一定是兩個聯絡人，只能經合併變成一個。（聯絡人與渠道身分）
- 合併是封存次要聯絡人，不是刪除，可以解除。新增任何掛在 `Contact` 上的資料表，都要加進 `mergeContacts` 的搬移清單與 `revertMerge` 的搬回清單。（合併）
- email 衝突只比對同租戶、未封存的聯絡人，不分大小寫。對方在成員看不到的渠道時，不能在 `details` 洩漏對方的資料。（清單與編輯）
- 聯絡人、渠道身分、對話、時間軸都依渠道可見範圍過濾。改查詢時不要拿掉已有的過濾。（誰能做什麼）
- 登記與合併以 `pg_advisory_xact_lock` 讓同一個值依序處理。改登記流程時不要拿掉。（Email 登記）
- 刪除標籤會 cascade。自動化會依名稱重建被刪的標籤（AUTO-03）。（標籤）
- `isBlocked` 沒有任何程式讀取（DB-04）。不要以為設了就會擋訊息。（清單與編輯）
- `contact.updated` 沒有發布端（AUTO-05）。新增「聯絡人更新」相關的自動化之前，先補發布端。（清單與編輯）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`），不要讀 `response.data.message`。

## 回歸清單

改到本領域時，至少重走：

1. 列表搜尋 → 進詳情 → 改 email 成功；改成重複的 email，出現三選一的對話框。
2. 貼標、移除標籤。確認以標籤觸發的自動化規則有執行（`contact.tagged`）。
3. 手動合併兩位聯絡人：
   - 檢查對話、工單、標籤、優惠券、點數都到了主要聯絡人。
   - 解除合併，資料回來（標籤與屬性不搬回）。
4. 用 supervisor 與 agent 角色重走 1–3，確認 403 與按鈕的顯示。
5. 用只能看部分渠道的成員，確認看不到只在其他渠道有身分的聯絡人。
6. 公開登記頁的 email 流程：
   - 正向：收到驗證碼、驗證成功、合併。
   - 錯誤：錯誤的驗證碼、過期、重寄上限。

自動測試：

- `pnpm --filter @open333crm/api test -- contact`、`-- tag`、`-- identity-binding`
- `pnpm --filter @open333crm/web test -- contact`、`-- bind`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/contact modules/tag modules/identity-binding`。加了 `--` 會原樣傳給 vitest，變成跑全套。
- E2E：`apps/web/tests/e2e-uat/tenant-contacts.spec.ts`。

## 常見 bug 從哪裡查

- 「客人在列表找不到」：列表送 `excludeChannelType=WEBCHAT`，只列出有非 WebChat 身分的聯絡人（`apps/web/src/app/dashboard/contacts/page.tsx`，規格要求的行為）。只有 WebChat 身分的客人要從收件匣或合併精靈的搜尋找。也檢查成員看不看得到這位聯絡人的渠道。
- 「合併後某些資料不見」：查 `apps/api/src/modules/contact/contact-merge.service.ts` 的搬移清單有沒有該表。
- 「跨渠道認不出同一人」：先查 `IdentityMap`，再查兩個 LINE 官方帳號是否在同一個 provider。
- 「合併預覽成功，執行卻失敗」：預覽不檢查同渠道衝突與封存狀態（HC-CONTACTS-03、HC-CONTACTS-04）。
- 「合併完看不到解除合併」：合併紀錄卡只在進頁時讀取（HC-CONTACTS-05），重新整理頁面。
- 「登記頁一直失敗」：看回應的 code（`INVALID_VERIFICATION_CODE`、`VERIFICATION_CODE_LOCKED`、410 連結失效）。畫面處理在 `apps/web/src/components/bind/RegistrationForm.tsx`。
- 「自動化貼標沒反應」：outbox → `event-automation` 佇列 → `apps/api/src/modules/automation/automation.worker.ts` 的訂閱者。
