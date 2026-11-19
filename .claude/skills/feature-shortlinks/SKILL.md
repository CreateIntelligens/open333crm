---
name: feature-shortlinks
description: >
  open333CRM「短連結」功能顧問：短連結的建立與編輯、公開轉址 /s/:slug、點擊紀錄與統計、點擊貼標、LIFF 認人、OG 預覽。改到 shortlink 模組、/dashboard/shortlinks、ShortLink、ClickLog，或改群發素材的短連結、追蹤設定之前使用。
---

# 短連結

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。短連結的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

短連結的建立、編輯、刪除，自訂代碼 slug、UTM 參數、到期時間、點擊貼標 `tagOnClick`、綁 LINE 渠道走 LIFF 認人、OG 快照、QR Code。
公開轉址 `/s/:slug`（爬蟲預覽、一般瀏覽器、LINE 內 LIFF）、點擊紀錄 `POST /s/track` 與 `ClickLog`、總點擊與唯一點擊、統計分析、GA4 與 Meta Pixel 追蹤碼。
相關的程式與資料：`/dashboard/shortlinks`、`/s/`、shortlink 模組、`ShortLink`、`ClickLog`、`link.clicked`、`link.stats.updated`。
「短連結點了沒反應」「連結已失效」「點擊數不對」「點了沒貼標」「預覽圖不對」「QR 掃了打不開」也使用。改群發素材換短連結、LIFF 頁、追蹤設定之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/SHORTLINKS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `SHORTLINKS.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、公開路由用哪個 client | 程式的入口 |
| 建立的欄位、後端檢查、錯誤、代碼唯一性、OG 快照、素材短連結 | 建立短連結 |
| 編輯、清除欄位、停用、刪除 | 修改與刪除 |
| 轉址頁、來源判斷、LIFF、追蹤碼、記錄點擊、點擊貼標、事件 | 點擊時發生什麼 |
| 統計數字與日期 | 統計 |
| 權限碼 | 權限 |
| 前端頁面、表單送出的值、沒有畫面入口的 API | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的短連結測試在 `apps/api/tests/unit/modules/shortlink/`、`apps/api/tests/feature/modules/shortlink/`、`apps/web/tests/unit/components/shortlink/`、`apps/web/tests/unit/app/dashboard/shortlinks/`，寫法可以照著參考。

`SHORTLINKS.md` 裡標 `HC-SHORTLINKS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/SHORTLINKS.md`
- 規格：`openspec/specs/shortlink-routing/spec.md`、`openspec/specs/shortlink-ua-strategy/spec.md`、`openspec/specs/tracking-settings/spec.md`
  - `tracking-settings` 的設定頁屬於設定領域，本領域只管轉址頁輸出的追蹤碼。
- 已知問題：`docs/ref/system/AUDIT.md` 的 SHORT-01（`/s/track` 採信呼叫端身分、沒有速率限制）
- 手冊：`apps/web/public/manual/ch12-shortlinks.html`
- 影響分析：`node scripts/feature-impact.mjs --domain shortlinks`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `SHORTLINKS.md` 括號內的章節。

- 公開路由 `/s/:slug` 與 `/s/track` 必須用 `app.prismaAdmin`。用 `app.prisma` 時 RLS 擋下所有查詢，本機測不出來。（程式的入口）
- 點擊一律在 `trackClickFlow()` 以短連結的 `tenantId` 開交易寫入。事件走 outbox，不要改成 `eventBus` 直接發。（點擊時發生什麼）
- `GET /s/:slug` 不記點擊。爬蟲不記點擊。爬蟲（`BOT_UA_PATTERNS`）的判斷必須在 LINE 之前。（點擊時發生什麼）
- 同一個 LINE uid 的唯一點擊靠 `pg_advisory_xact_lock` 排隊。沒有 LINE uid 的點擊每次都算唯一。（點擊時發生什麼）
- 點擊貼標失敗只回滾貼標（savepoint），點擊照樣記錄。（點擊時發生什麼）
- 目標網址只允許 http 或 https。轉址頁嵌入的值一律經 `jsonForScript`／`escapeHtmlAttr`（`strategies/render-utils.ts`）。追蹤 ID 輸出前要再經 `tracking-snippet.ts` 檢查格式。（建立短連結、點擊時發生什麼）
- 日期欄位用 `z.coerce.date()`，不要用 `z.string().datetime()`。後者擋掉 `datetime-local` 的 `2026-12-31T23:59`。（建立短連結）
- slug 全系統唯一（`@unique`），但建立前的重複檢查只看得到自己租戶。（建立短連結）
- 素材短連結由 `findOrCreateMaterialShortLink` 依（素材, 目標網址）重複使用。改這段要同時看行銷領域。（建立短連結）
- 新增掛在 Contact 上的點擊資料，要加進聯絡人合併（`apps/api/src/modules/contact/contact-merge.service.ts` 已處理 `clickLog`）。
- 前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。
- UI 不放 emoji 與 ✓。

## 回歸清單

改到本領域時，至少重走：

1. 建立短連結，填全部欄位：UTM 含中文與 `&`、自訂代碼、貼標、到期時間（`datetime-local`）、LINE 渠道。重新整理後，編輯頁逐欄讀回一致。
2. 轉址頁：
   - `curl -A 'Mozilla/5.0 Chrome/120' http://localhost:3001/s/<slug>`：`var target` 帶 UTM。
   - `-A facebookexternalhit`：回 OG 頁。
   - `?ua_simulator=line`：走 LIFF（渠道要有 liffId）。
3. `POST /s/track`，`text/plain` 與 JSON 各送一次：
   - `click_logs` 多一筆，`totalClicks`、`uniqueClicks` 正確。
   - 帶 `cid` 的聯絡人被貼標。
   - `outbox` 有 `link.clicked`、`contact.tagged`。
4. 編輯：清空標題與 UTM、移除到期、改成不貼標，重新整理確認清掉。改目標網址後檢查 OG 預覽。
5. 停用（`isActive:false`）與到期的連結：`GET` 回 404 失效頁，`/s/track` 回 410，不記點擊。
6. 用只有 `shortlink.view` 的自訂角色建立、編輯、刪除，都回 403。沒有 `shortlink.view` 的角色看不到側欄。
7. UAT：`curl https://uat.open333crm.create360.ai/s/<Demo 的 slug>` 回 200，確認公開轉址沒有被 RLS 擋掉。只用 curl：curl 不跑 JS，不會記點擊。

自動測試：

- `pnpm --filter @open333crm/api test -- shortlink`
- `pnpm --filter @open333crm/web test -- shortlink`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/shortlink`。
- E2E：`apps/web/tests/e2e-uat/tenant-misc.spec.ts`（`@shortlinks`）。

## 常見 bug 從哪裡查

- 「所有短連結都顯示連結已失效」：先看公開路由是不是改用了 `app.prisma`（RLS），再看 `isActive`、`expiresAt`。本機 superuser 測不出 RLS 問題。
- 「點擊數沒增加」：
  - `GET` 本來就不記點擊。
  - 看瀏覽器有沒有送出 sendBeacon。`/s/track` 是相對路徑，要和轉址頁同源。
  - `trackClickFlow` 失敗只寫 API log `[ShortLink] Click tracking error`。
- 「點了沒貼標」：
  - 連結沒綁 LINE 渠道、或渠道沒設 liffId 時，只能靠網址的 `cid`。
  - 貼標失敗只寫 warning `[ShortLink] auto-tag failed`。原因可能是標籤被刪、標籤是工單範圍、標籤 ID 不存在（HC-SHORTLINKS-02）。
- 「LINE 裡點擊認不出客人」：渠道的 `settings.liffConfig.liffId` 要設好，LIFF 要有 profile 權限。`getProfile` 失敗時照樣轉址，但不帶 lineUid。
- 「改了網址，貼到 LINE 的預覽還是舊網站」：編輯頁送回舊 OG，後端判定手動填了 OG 而不重抓（HC-SHORTLINKS-01）。清空 OG 三欄再存就會重抓。
- 「建立時出現一大段英文 Invalid prisma…」：`POST` 路由把所有例外包成 400 並回傳原始訊息（HC-SHORTLINKS-03）。常見原因是 `tagOnClick` 不是 UUID、自訂代碼與其他租戶重複。
- 「統計日期差一天」：`getClickStats` 以 UTC 日期分組，台灣時間 08:00 以前算前一天（HC-SHORTLINKS-07）。
- 「唯一點擊等於總點擊」：沒有 lineUid 的點擊每次都算唯一。這是設計。
