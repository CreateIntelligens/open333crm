---
name: feature-shortlinks
description: >
  open333CRM「短連結」功能顧問：短連結建立/編輯/刪除、自訂代碼 slug、UTM 參數、到期時間、
  點擊自動貼標 tagOnClick、綁 LINE 渠道走 LIFF 認人、社群預覽 OG 快照、QR Code、
  公開轉址 /s/:slug（爬蟲 OG 預覽、一般瀏覽器零點擊轉址、LINE 內 LIFF）、點擊紀錄 POST /s/track 與 ClickLog、
  總點擊/唯一點擊、統計分析（每日趨勢、來源分布、識別率）、GA4 與 Meta Pixel 追蹤碼。
  當需求、bug 或新功能碰到 /dashboard/shortlinks、/s/、shortlink 模組、ShortLink、ClickLog、
  link.clicked、link.stats.updated 時使用；「短連結點了沒反應」「連結已失效」「點擊數不對」「點了沒貼標」
  「預覽圖不對」「QR 掃了打不開」也用它。改群發素材換短連結、LIFF 頁、追蹤設定前先看。
---

# 短連結

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/SHORTLINKS.md`
  - 注意：其中「過期或停用的連結回 410」只對 `POST /s/track` 成立；`GET /s/:slug` 回 404 的「連結已失效」頁。「自訂代碼與其他租戶重複時回伺服器錯誤」實際是 400，訊息是 Prisma 原始錯誤（健檢 HC-SHORTLINKS-03）。
- 健檢結果與已知問題：`docs/ref/features/health/SHORTLINKS.md`
- 規格：`openspec/specs/shortlink-routing/spec.md`、`openspec/specs/shortlink-ua-strategy/spec.md`、`openspec/specs/tracking-settings/spec.md`（後者的設定頁屬於設定領域，這裡只管中轉頁輸出）
- 手冊：`apps/web/public/manual/ch12-shortlinks.html`
- 已知問題：`docs/ref/system/AUDIT.md` 的 SHORT-01（`/s/track` 採信呼叫端身分、沒有速率限制）
- 影響分析：`node scripts/feature-impact.mjs --domain shortlinks`

路由：後台 `/api/v1/shortlinks`（`apps/api/src/modules/shortlink/shortlink.routes.ts`），公開 `/s`（`apps/api/src/modules/shortlink/shortlink-redirect.routes.ts`），都在 `apps/api/src/index.ts` 註冊。

## 前端操作流程

格式：入口 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 列表 | 側欄「短連結 > 連結管理」`/dashboard/shortlinks/links`（`[section]` 共用 `page.tsx`） | `GET /shortlinks?page&limit` 逐頁取回全部（`fetchAllPages`）→ `listShortLinks` | 監聽 socket `link.stats.updated` 重新載入 | `shortlink.view` / 側欄依 `shortlink.view` 隱藏；直接開網址時 403 顯示成「尚無短連結」，「建立連結」照樣顯示 |
| 2 | 建立 | 「建立連結」→ `LinkFormDialog` | `POST /shortlinks` → `shortlink.flow.ts` `createShortLinkFlow` → `createShortLink` | 沒填任何 OG 時 commit 後背景抓 OG（`og-snapshot.ts`）；回 200（不是 201） | `shortlink.manage` / **不隱藏**，按下才顯示「權限不足」 |
| 3 | 編輯 | 列表「編輯」（斜上箭頭圖示） | `PATCH /shortlinks/:id` → `updateShortLink`；空字串＝清除、`expiresAt:null`＝移除到期 | 目標網址改了且三個 OG 都空才重抓 OG；前端會把舊 OG 一起送回，所以**改網址不會重抓**（HC-SHORTLINKS-01）。代碼不能改（UI 隱藏，API 收了也忽略） | `shortlink.manage` / 不隱藏 |
| 4 | 刪除 | 列表紅色 ×，`confirm` | `DELETE /shortlinks/:id` | **硬刪**，`ClickLog` 一起刪（FK Cascade）；素材連結刪掉後已發出的訊息點了是失效頁 | `shortlink.manage` / 不隱藏 |
| 5 | 停用 | 沒有 UI | `PATCH {isActive:false}` | 手冊教用「到期時間設成過去」代替 | — |
| 6 | 複製網址 | 列表「複製 URL」 | 無 API；`window.location.origin + /s/<slug>`，本機 `localhost:3000` 換成 `http://localhost`（要有本機 edge proxy） | — | 不檢查 |
| 7 | QR Code | 列表「QR Code」→ `QrCodeDialog` | `GET /shortlinks/:id/qrcode` → `qrcode.service.ts`，網址用 `API_BASE_URL/s/<slug>` | 本機與複製的網址不同（`localhost:3001`）；UAT 是正式網域 | `shortlink.view` |
| 8 | 統計 | 側欄「統計分析」→ `ClickStatsView` | `GET /shortlinks/:id/stats` → `getClickStats` | 總點擊/唯一是累計欄位；識別率、每日趨勢、來源只算最近 30 天，日期以 UTC 切 | `shortlink.view` |
| 9 | 公開轉址 | 顧客點 `/s/<slug>`（可帶 `?cid=`） | `GET /s/:slug` → `getLinkForRedirect(app.prismaAdmin)` → `source-detector.ts` → `strategies/` | 只回頁面、不記點擊；回應標頭 `X-Shortlink-Source`；`?ua_simulator=` 只在非 production 生效 | 公開 |
| 10 | 記錄點擊 | 中轉頁 sendBeacon（text/plain）或 `/liff/redirect` 的 fetch | `POST /s/track {slug,cid?,lineUid?}` → `trackClickFlow`（背景、不等待） | 交易內：ClickLog、計數、點擊貼標（savepoint）、outbox `link.clicked`/`contact.tagged`；commit 後推 `link.stats.updated` | 公開，無速率限制（SHORT-01） |

**有後端、沒有前端入口**：`GET /shortlinks/:id/clicks`（點擊明細，含 IP 與 User-Agent）、列表的 `q` 與 `isActive` 篩選、`isActive` 停用開關。

## 前端實際送出的值
- 建立：選填欄位空白時送 `undefined`（不送）；`lineChannelId` 一律送（沒選是 `null`）；`slug` 只在建立且有填時送。
- 編輯：所有選填欄位都送，空的送 `""`；`expiresAt` 空的送 `null`；**OG 三欄會把現有值（包含自動抓到的）送回去**。
- 到期時間 `datetime-local` 由 `toIsoForApi`（`apps/web/src/lib/datetime-local.ts`）轉 ISO 送出，例如 `2026-12-31T23:59` → `2026-12-31T15:59:00.000Z`；後端 `z.coerce.date()` 接受。直接打 API 送不帶時區的字串時，依伺服器時區解讀。
- 「點擊時自動貼標」選單列出 `GET /tags` 的**全部**標籤，包含工單（CASE）範圍的標籤；選了工單標籤，點擊時貼標一定失敗（HC-SHORTLINKS-02）。
- 後端驗證（`shortlink.routes.ts`）：`targetUrl` 必須 http/https、≤2048 字；`slug` 1–64 字、只能英數字 `_` `-`；UTM 每欄 ≤100；`ogImage` 必須 http/https；`tagOnClick` 只檢查 ≤100 字（不檢查 UUID、存在、範圍）。
- 錯誤時對話框只顯示 `getApiErrorMessage` 的總訊息「輸入內容有誤，請檢查後重新送出」，不說是哪一欄。

## 不可破壞的規則
- **公開路由必須用 `app.prismaAdmin`**：`/s/:slug` 與 `/s/track` 沒有登入、沒有租戶，用 `app.prisma` 會被 RLS fail-closed，全部連結都變「連結已失效」、點擊記不到（2026-09 UAT 曾全掛，見 `apps/web/tests/e2e-uat/WAVE6-FINDINGS.md`）。本機 API 以 superuser 連線、不套 RLS，**本機測不出來**，要跑 feature 測試或在 UAT 驗。
- 寫入點擊一律在 `trackClickFlow` 以短連結的 `tenantId` 開交易；事件走 outbox，不要改成 `eventBus` 直接發。
- `GET /s/:slug` 不可記點擊；爬蟲（`BOT_UA_PATTERNS`）不可記點擊。BOT 判斷必須在 LINE 之前（LINE 爬蟲與 LINE 內建瀏覽器都帶 LINE 字樣）。
- 同一個 lineUid 的唯一點擊靠 `pg_advisory_xact_lock` 排隊；沒有 lineUid 的點擊每次都算唯一。
- 點擊貼標失敗只能回滾貼標（savepoint），點擊照樣記錄。
- 目標網址只允許 http/https，轉址頁把它放進 `window.location.replace()` 與 `<noscript><a>`，嵌入值一律經 `jsonForScript`／`escapeHtmlAttr`（`strategies/render-utils.ts`）。追蹤 ID 輸出前要再過 `tracking-snippet.ts` 的格式檢查。
- 日期欄位用 `z.coerce.date()`，不要用 `z.string().datetime()`（會擋掉 `datetime-local` 的 `2026-12-31T23:59`）。
- slug 是全系統唯一（`@unique`），但建立前的重複檢查受 RLS 限制只看得到自己租戶。
- 素材短連結由 `findOrCreateMaterialShortLink` 依（素材, 目標網址）重複使用；改這段要同時看行銷領域。
- 新增掛在 Contact 上的點擊資料要加進聯絡人合併清單（`apps/api/src/modules/contact/contact-merge.service.ts` 已處理 `clickLog`）。
- UI 不放 emoji 與 ✓（使用者要求）。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain shortlinks` 看最新版本。重點：
- **依賴**：聯絡人（`apps/api/src/modules/tag/tagging.service.ts` 的 `addTagToTarget`、ChannelIdentity 認人）、渠道（`settings.liffConfig.liffId`）、LINE（`apps/web/src/app/liff/redirect/page.tsx` 取得 LINE uid）、設定（GA4/Meta Pixel ID）、行銷（素材刪除時 `materialId` 設 null）。
- **被依賴**：行銷（群發把素材網址換成短連結、素材點擊成效）、自動化（`link.clicked`「短連結被點擊」；點擊貼標的 `contact.tagged`。規則沒有「哪一條連結」的條件，見 `docs/ref/features/health/AUTOMATION.md` 的 HC-AUTOMATION-08）、聯絡人（合併搬 ClickLog）。

## 回歸清單
改到本領域時，至少重走：
1. 建立短連結：填全部欄位（UTM 含中文與 `&`、自訂代碼、貼標、到期 `datetime-local`、LINE 渠道）→ 重新整理 → 編輯對話框逐欄讀回一致。
2. `curl -A 'Mozilla/5.0 Chrome/120' http://localhost:3001/s/<slug>` 看 `var target` 帶 UTM；`-A facebookexternalhit` 回 OG 頁；`?ua_simulator=line` 走 LIFF（渠道要有 liffId）。
3. `POST /s/track`（text/plain 與 JSON 各一次）→ `click_logs` 多一筆、`totalClicks`/`uniqueClicks` 正確、帶 `cid` 的聯絡人被貼標、`outbox` 有 `link.clicked`/`contact.tagged`。
4. 編輯：清空標題/UTM、移除到期、改不貼標 → 重新整理確認清掉；改目標網址後檢查 OG 預覽。
5. 停用（`isActive:false`）與到期 → `GET` 404 失效頁、`/s/track` 410、不記點擊。
6. 用只有 `shortlink.view` 的自訂角色建立/編輯/刪除 → 403；沒有 `shortlink.view` 的角色看不到側欄。
7. UAT：`curl https://uat.open333crm.create360.ai/s/<Demo 的 slug>` 回 200（只用 curl，不跑 JS，不會記點擊），確認公開轉址沒有被 RLS 擋掉。
- 自動測試：`pnpm --filter @open333crm/api test -- shortlink`、`pnpm --filter @open333crm/web test -- shortlink`；feature `pnpm --filter @open333crm/api test:feature modules/shortlink`（先搶鎖，不要加 `--`）。
- E2E：`apps/web/tests/e2e-uat/tenant-misc.spec.ts`（`@shortlinks`）。

## 常見 bug 從哪裡查
- 「所有短連結都顯示連結已失效」：先看公開路由是不是改用了 `app.prisma`（RLS），再看 `isActive`、`expiresAt`。本機 superuser 測不出 RLS 問題。
- 「點擊數沒增加」：`GET` 本來就不記；看瀏覽器有沒有送出 sendBeacon（`/s/track` 是相對路徑，要和中轉頁同源）；`trackClickFlow` 失敗只寫 API log `[ShortLink] Click tracking error`。
- 「點了沒貼標」：連結沒綁 LINE 渠道或渠道沒設 liffId 時只能靠網址的 `cid`；貼標失敗只寫 warning `[ShortLink] auto-tag failed`（標籤被刪、工單標籤、標籤 ID 不存在）。
- 「LINE 裡點擊認不出客人」：渠道 `settings.liffConfig.liffId` 要設好、LIFF 要有 profile 權限；`getProfile` 失敗會照樣轉址但不帶 lineUid。
- 「改了網址，貼到 LINE 的預覽還是舊網站」：前端編輯會送回舊 OG，後端判定「手動填了 OG」不重抓（HC-SHORTLINKS-01）；清空 OG 三欄再存就會重抓。
- 「建立時出現一大段英文 Invalid prisma…」：`POST` 路由把所有例外包成 400 並回傳原始訊息（`tagOnClick` 不是 UUID、跨租戶代碼重複）。
- 「統計日期差一天」：`getClickStats` 以 UTC 日期分組（台灣 08:00 前算前一天）。
- 「唯一點擊等於總點擊」：沒有 lineUid 的點擊每次都算唯一，屬設計。
