# 短連結 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（web 3000 production build、API 3001、workers；資料庫 open333crm_advisor，API 以 superuser `crm` 連線、不套 RLS）／UAT Demo 租戶（a0000000-0000-0000-0000-000000000001，只做唯讀：列表、統計、QR 網址、以 curl 取公開轉址頁）
- 測試角色：admin（seed）；本機另建兩個自訂角色：
  - hc-shortlinks-唯讀（`shortlink.view`、`tag.view`、`channel.view`、`inbox.view`），帳號 hc-shortlinks-ro@example.test
  - hc-shortlinks-無（`inbox.view`、`tag.view`），帳號 hc-shortlinks-none@example.test
  - seed 的 supervisor 與 agent 預設都有 `shortlink.view` 與 `shortlink.manage`（`packages/shared/src/rbac/default-roles.ts:43,64`），所以權限案例改用自訂角色

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 3 份規格、55 個 scenario（shortlink-routing 8、shortlink-ua-strategy 35、tracking-settings 12）：0 個缺實作；約 17 個缺自動測試（主要是來源判斷、爬蟲頁、失效頁、`ua_simulator`、LIFF 頁的行為測試）；0 個缺前端入口。tracking-settings 的設定頁 7 個 scenario 屬於設定領域，這裡只核對中轉頁輸出的 5 個。另有後端有、前端沒有的功能：點擊明細 `GET /:id/clicks`、停用開關 `isActive`、列表篩選 `q`/`isActive` |
| 自動測試 | unit：api 8 檔 31 案例、web 3 檔 9 案例，全部通過，0 skip。feature：`test:feature modules/shortlink` 2 檔 11 案例，全部通過，0 skip（只跑到本領域的檔案） |
| 實際操作 | 10 條流程：正常 6（1、6、7、8、9、10），異常 3（2、3、4），未提供 UI 1（5）；待真機驗 1 項（LINE 內 LIFF 取得 uid） |

沒有發現 P0、P1。過去「公開轉址被 RLS 擋下、全部連結失效」的問題（Wave 6 記錄，`apps/web/tests/e2e-uat/WAVE6-FINDINGS.md:184-194`）已修好：兩條公開路由都用 `app.prismaAdmin`，UAT 實測 `GET /s/<slug>` 回 200。

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| SHORT-01 | P3（AUDIT 原級） | 仍未修：`/s/track` 採信 body 的 `cid` 與 `lineUid`，沒有速率限制 | 本機（實測）：`POST /s/track {"slug":"hc-shortlinks-full","cid":"<同租戶聯絡人 ID>"}`，沒有登入 → 200，該聯絡人被貼上 `tagOnClick` 標籤，outbox 多一筆 `contact.tagged` 與 `link.clicked`。連續 40 次 `POST` 全部 200，`totalClicks`、`uniqueClicks` 各加 40 | `apps/api/src/modules/shortlink/shortlink-redirect.routes.ts:52-96`、`shortlink.service.ts:359-370` | SHORT-01 |
| HC-SHORTLINKS-01 | P2 | 編輯短連結改目標網址後，社群預覽（OG）仍是舊網站：編輯對話框把現有的 OG 值（含自動抓到的）一起送回，後端判定「手動填了 OG」就不重抓 | 本機（實測）：建立 `https://github.com/`（不填 OG）→ 背景抓到 GitHub 的 og:title。以前端編輯會送的 payload（OG 三欄帶現值）把目標改成 `https://www.python.org/` → 等 6 秒，`ogTitle` 仍是「GitHub · Change is constant…」，`curl -A facebookexternalhit /s/hc-shortlinks-og` 回 GitHub 的預覽。前端送出的形狀以 Playwright 攔截 PATCH 確認（OG 三欄都會送） | `apps/web/src/components/shortlink/LinkFormDialog.tsx:65-67,105-107`、`apps/api/src/modules/shortlink/shortlink.flow.ts:70`、`shortlink.service.ts:32-34` | 新 |
| HC-SHORTLINKS-02 | P2 | 「點擊時自動貼標」不驗證標籤：選單列出全部標籤（含工單範圍），後端只檢查長度 ≤100，不存在或工單範圍的標籤照樣存入；點擊時貼標必定失敗，只寫 API log，後台看不到 | 本機（實測）：表單的標籤選單出現「hc-shortlinks-工單標籤」（CASE）與兩個「VIP」（同名不同範圍）。以工單標籤、以及一個不存在的 UUID 各建一條連結 → 皆 200；帶 `cid` 點擊 → 點擊有記錄、聯絡人沒有被貼標，API log 為 `auto-tag failed: Tag scope CASE cannot be assigned to CONTACT` 與 `找不到此標籤`。標籤被刪除後，已設定的連結同樣默默失效（`tagOnClick` 沒有 FK） | `apps/web/src/app/dashboard/shortlinks/page.tsx:27-31`、`apps/api/src/modules/shortlink/shortlink.routes.ts:65`、`shortlink.service.ts:411-421` | 新 |
| HC-SHORTLINKS-03 | P2 | 建立路由把所有例外包成 400 並回傳原始訊息：Prisma 錯誤原文（含伺服器檔案路徑與程式片段）顯示在建立視窗。跨租戶自訂代碼重複也走這條路徑 | 本機（實測）：`POST /shortlinks {"targetUrl":"https://example.com","tagOnClick":"not-a-uuid"}` → 400，`message` 是 `Invalid prisma.shortLink.create() invocation in /Users/…/shortlink.service.ts:134:27 …`。跨租戶重複（讀程式＋部分實測）：以 `app_tenant` 連線、`app.current_tenant` 設成另一個租戶時，`select … where slug='hc-shortlinks-full'` 回 0 筆，所以 `createShortLink` 的重複檢查看不到其他租戶的代碼，寫入時撞到 `slug` 唯一限制，同樣以原始訊息回 400。本機 superuser 不套 RLS，會顯示正常的「這個自訂代碼已經被使用了」，測不出來。Wave 6 已記錄過訊息外洩（`WAVE6-FINDINGS.md:307`），目前仍在 | `apps/api/src/modules/shortlink/shortlink.routes.ts:118-124`、`shortlink.service.ts:123-128` | 新 |
| HC-SHORTLINKS-04 | P3 | 建立、編輯、刪除按鈕不依 `shortlink.manage` 隱藏；沒有 `shortlink.view` 的人直接開網址時，403 顯示成「尚無短連結，點擊『建立連結』開始」 | 本機（實測）：hc-shortlinks-ro 看得到「建立連結」與每列的編輯、刪除，按下後才出現「權限不足」（建立在對話框內、刪除用 alert）。hc-shortlinks-none 側欄沒有短連結（正常），但直接開 `/dashboard/shortlinks/links` 顯示空列表與「建立連結」；統計頁下拉是空的 | `apps/web/src/app/dashboard/shortlinks/page.tsx:18,62-64,117-149,155-160`、`apps/web/src/hooks/useShortLinks.ts:55-59` | 新 |
| HC-SHORTLINKS-05 | P3 | 沒有停用開關：API 有 `isActive`，UI 沒有；手冊教用「到期時間設成過去」代替。`PATCH` 帶 `slug` 回 200 但不改（API 呼叫端會以為改成功） | 本機（實測）：編輯對話框沒有啟用/停用欄位；`PATCH {"slug":"newslug"}` → 200，`slug` 不變 | `apps/web/src/components/shortlink/LinkFormDialog.tsx`、`apps/api/src/modules/shortlink/shortlink.routes.ts:76`、`shortlink.service.ts:239-256` | 新 |
| HC-SHORTLINKS-06 | P3 | 編輯時帶不屬於本租戶的 `lineChannelId` 回 500（建立時同樣情況回 400） | 本機（實測）：`PATCH /shortlinks/:id {"lineChannelId":"00000000-0000-4000-8000-000000000000"}` → 500 `INTERNAL_ERROR`；`POST` 同值 → 400「lineChannelId 必須是本租戶的 LINE 渠道」。UI 只列本租戶渠道，影響 API 呼叫端 | `apps/api/src/modules/shortlink/shortlink.service.ts:28`（丟一般 `Error`）、`shortlink.routes.ts:134-140`（沒有 catch） | 新 |
| HC-SHORTLINKS-07 | P3 | 統計的每日趨勢以 UTC 切日，台灣 08:00 前的點擊算在前一天（手冊已註明） | 讀程式 | `apps/api/src/modules/shortlink/shortlink.service.ts:449` | 同 ANA-01 類型（ANA-01 只涵蓋 `analytics.service.ts`） |
| HC-SHORTLINKS-08 | P3 | 建立/編輯失敗時只顯示「輸入內容有誤，請檢查後重新送出」，不說是哪一欄 | 本機（實測）：自訂代碼填 `hc shortlinks`（含空白）、目標網址填 `example.com/no-scheme`，對話框都只顯示這句；後端的 `details.issues` 其實有「自訂代碼只能使用英數字、底線與連字號」「目標網址格式不正確」 | `apps/web/src/components/shortlink/LinkFormDialog.tsx:123` | 新 |
| HC-SHORTLINKS-09 | P3 | 群發換短連結時，任何以 `/s/<代碼>` 結尾的外部網址都被當成本站短連結而不包裝，這類網址沒有點擊歸因 | 讀程式：`isOwnShortLink` 的第二個條件 `/\/s\/[A-Za-z0-9_-]+$/` 不看網域，例如 `https://shop.example.com/s/abc` | `apps/api/src/modules/shortlink/shortlink.service.ts:164-167` | 新 |
| HC-SHORTLINKS-10 | P3 | 規格要求 `/s/track` 允許跨來源「不帶 credentials」，實際全域 CORS 反射任何 Origin 並帶 `access-control-allow-credentials: true` | 本機（實測）：`OPTIONS /s/track`，`Origin: https://evil.example` → 204，`access-control-allow-origin: https://evil.example`、`allow-credentials: true`。後台的 refreshToken cookie 是 `SameSite=strict`，跨站請求不會帶上，目前沒有實際風險；但這是全域設定，影響所有 API | `apps/api/src/plugins/cors.plugin.ts:6-8`；規格 `openspec/specs/shortlink-ua-strategy/spec.md` 的「Tracking endpoint records the single authoritative click」 | 新 |
| HC-SHORTLINKS-11 | P3 | 可以綁定已停用的 LINE 渠道；建立時可設過去的到期時間，連結一建立就失效，沒有提示 | 本機（實測）：以一個 `isActive=false`、有 liffId 的 LINE 渠道建連結 → 200，LINE 內點擊照樣導向該渠道的 LIFF；`expiresAt: "2020-01-01T00:00"` → 200，狀態直接是「已過期」 | `apps/api/src/modules/shortlink/shortlink.service.ts:23-29`、`shortlink.routes.ts:72` | 新 |
| HC-SHORTLINKS-12 | P3 | 同一位聯絡人重複點擊有設 `tagOnClick` 的連結，每次都再發一筆 `contact.tagged`，「被貼標」的自動化每點一次跑一次 | 本機（實測）：同一個 lineUid 點兩次 → outbox 有 2 筆 `contact.tagged`、2 筆 `link.clicked` | `apps/api/src/modules/shortlink/shortlink.service.ts:411-417`、`apps/api/src/modules/tag/tagging.service.ts:146-163` | 聯絡人健檢 HC-CONTACTS-09 |
| HC-SHORTLINKS-13 | P3 | 文件過時：`SHORTLINKS.md` 寫「過期或停用的連結回 410」，實際 `GET /s/:slug` 回 404 失效頁、只有 `/s/track` 回 410；寫「自訂代碼與其他租戶重複時回伺服器錯誤」，實際是 400 加 Prisma 原文（HC-03）；「點擊在背景寫入…寫入失敗只記 log」正確。手冊第 5 節「客戶掃 QR Code 跟點短連結一樣」在 UAT 成立，本機 QR 網址是 `localhost:3001`、複製網址是 `http://localhost`，兩者不同 | — | `docs/ref/features/tenant/SHORTLINKS.md:34,37,83`、`apps/web/public/manual/ch12-shortlinks.html` | 新 |

已確認修好的 AUDIT 項目：

- **RBAC-01 的短連結部分**：所有後台路由都有 `requirePermission`。實測 hc-shortlinks-ro 建立、編輯、刪除回 403 且 `details.requiredPermission` 是 `shortlink.manage`；hc-shortlinks-none 讀列表、統計、QR 回 403、`shortlink.view`。
- **SHORT-01 的部分修正仍有效**：不是 UUID 的 `cid` 當成匿名點擊（unit `track-click-contact-scope.test.ts` 通過）。
- **ARCH-01**：`shortlink-redirect.routes.ts:134` 在 route 直接查 `tenantSettings`，仍在 ARCH-01 的清單中，沒有改變。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 列表 | 本機 UI＋UAT UI/API | 正常：列表顯示標題、代碼、目標、點擊數、狀態、到期；統計頁背景點擊後 3 秒內徽章由 8 更新為 9（socket） | — | 異常：403 顯示成空列表（HC-04） | UAT Demo 5 條連結，與 API 一致；其中一條是 E2E 殘留的 `[E2E] <script>…`（React 以文字顯示，沒有執行） |
| 2 建立 | 本機 UI＋API | 正常：UI 填全部欄位（UTM 含中文與空白、自訂代碼、貼標、到期 `2026-12-31T23:59`、LINE 渠道）→ 送出 `expiresAt: 2026-12-31T15:59:00.000Z`；重新整理後編輯對話框逐欄讀回一致（到期 `2026-12-31T23:59`、標籤與渠道名稱正確）。API 另驗：兩字代碼 `ab`、中文網域網址、目標網址前後空白（trim）都接受 | 正常：只有空白時「建立」不可按；`javascript:` 400；重複代碼對話框顯示「這個自訂代碼已經被使用了，請換一個」；`a/b` 400；`expiresAt: abc` 400；異常：錯誤不指出欄位（HC-08）、`tagOnClick` 非 UUID 回 Prisma 原文（HC-03）、工單標籤與不存在的標籤被接受（HC-02） | 異常：ro 看得到按鈕（HC-04），按下 403 | 建立回 200 不是 201 |
| 3 編輯 | 本機 UI＋API | 正常：清空標題與 utm_source、移除到期、改「不貼標」→ PATCH 送 `""`/`null`，重新整理後標題顯示「-」、到期「-」，其餘 UTM 保留；`isActive:false` 與過去的 `expiresAt` 生效、`expiresAt:null` 恢復 | 正常：`javascript:` 400、`expiresAt: abc` 400、`tagOnClick:"bad"` 400 `DATABASE_ERROR`；異常：改目標網址不重抓 OG（HC-01）；外租戶 `lineChannelId` 500（HC-06） | ro 403 | 代碼欄位在編輯時隱藏 |
| 4 刪除 | 本機 UI | 正常：confirm「確定刪除此短連結？」→ 列消失 | `GET` 不存在的 ID 404；`DELETE` 非 UUID 400 | ro 看得到 ×，按下 alert「權限不足」 | 硬刪，點擊紀錄一起刪 |
| 5 停用 | — | 沒有 UI（HC-05） | — | — | API `isActive:false` 實測生效 |
| 6 複製網址 | 本機 UI | 正常：剪貼簿 `http://localhost/s/hc-shortlinks-ui`（符合規格） | — | — | 本機 80 port 是其他 docker 的 nginx，這個網址在本機打不開，屬環境問題 |
| 7 QR Code | 本機 UI＋UAT API | 正常：本機 `http://localhost:3001/s/<slug>`；UAT `https://uat.open333crm.create360.ai/s/Z2KOCv` | — | none 角色 403 | 下載未驗 |
| 8 統計 | 本機 UI＋UAT UI | 正常：本機「總點擊 8、唯一 3、識別率 100%」與資料庫一致，趨勢與來源圖顯示；UAT 0pQ6uA「總點擊 17、唯一 6、識別率 0%」 | `clicks?page=0` 400 | none 角色 403 | 日期以 UTC 切（HC-07）；點擊明細沒有 UI |
| 9 公開轉址 | 本機 curl/Playwright＋UAT curl | 正常：一般瀏覽器 UA 回 200 中轉頁，`var target` 帶 5 個 UTM（中文與 `&` 正確編碼，`#top` 保留在最後）；Playwright 實際轉到目標網址；`facebookexternalhit` 回 OG 頁；`Line/13.5.0` 在渠道沒有 liffId 時退回一般頁、有 liffId 時導向 `https://liff.line.me/1234567890-AbcdEfgh?s=…&cid=…&lid=…`；FB 內建瀏覽器判成 `FB_WEBVIEW`。UAT：兩條 Demo 連結回 200、`ua_simulator=line` 被忽略（production） | 正常：停用、過期、不存在 → 404「連結已失效」頁（爬蟲同樣 404）；SSRF：目標 `http://127.0.0.1:3001/health` 不抓 OG | 公開 | 本機以 superuser 連線，RLS 只能在 UAT 與 feature 測試驗 |
| 10 記錄點擊 | 本機 API＋Playwright | 正常：text/plain（sendBeacon 形狀）與 JSON 都記錄；ClickLog 記下 contactId、referer、IP；`tagOnClick` 貼上並寫 outbox `contact.tagged`、`link.clicked`；lineUid 對到 ChannelIdentity 時以該聯絡人為準；同一 lineUid 點兩次唯一只加 1；同一 lineUid 並行 5 次唯一只加 1；`/liff/redirect?s=<slug>`（沒有 lid）送出點擊並轉址 | 正常：不存在、停用的連結 410 不記錄；`/liff/redirect?s=不存在` 顯示「連結已失效」 | 公開，無速率限制（SHORT-01） | LINE 內 LIFF 登入與 `getProfile` 待真機驗 |

## 完備度對照

| Spec / Requirement | Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- | --- |
| shortlink-routing：Public shortlinks resolve on the public origin | 2 | 有（`shortlink-redirect.routes.ts`、`shortlink.routes.ts:169-178`）。UAT 實測經 Caddy 轉到 API | 缺（沒有測試斷言 200 而非 301、QR 用 `API_BASE_URL`） | QR 對話框 |
| shortlink-routing：Admin UI copies the public shortlink URL | 2 | 有（`page.tsx:33-42`） | 缺 | 有 |
| shortlink-routing：Short Link Material Association | 3 | 有（schema `onDelete: SetNull`、`findOrCreateMaterialShortLink`） | 部分（`material-short-link-placeholder.test.ts`、行銷 `broadcast-coupon.test.ts`；刪素材設 null 沒有測試） | 群發自動建立 |
| shortlink-routing：Short Link Form Rejects Blank Target URL | 1 | 有 | 有（`link-form-dialog.test.tsx`） | 有 |
| ua-strategy：Source detection by User-Agent | 2 | 有（`source-detector.ts`） | 缺（沒有 `detectSource` 單元測試；tracking-injection 只間接用到 UA） | 公開 |
| ua-strategy：Bot match list is configurable | 1 | 有（常數陣列，非設定檔） | 缺 | — |
| ua-strategy：Dev-only source override | 1 | 有 | 缺（UAT 實測 production 會忽略） | — |
| ua-strategy：Short link response names the chosen source | 1 | 有 | 缺 | — |
| ua-strategy：Bot requests receive an OG preview without tracking | 2 | 有 | 缺（實測：爬蟲頁不記點擊、失效時 404） | — |
| ua-strategy：External browser zero-click page | 2 | 有 | 部分（tracking-injection 驗頁面內容；失效頁沒有測試） | — |
| ua-strategy：LINE webview routes through LIFF | 2 | 有 | 部分（LIFF 中轉頁有；沒有 liffId 退回一般頁沒有） | 表單的 LINE 渠道選單 |
| ua-strategy：LIFF endpoint runs the login and tracking flow | 3 | 有（`apps/web/src/app/liff/redirect/page.tsx`） | 缺（短連結這條路徑沒有 web 單元測試） | 公開；待真機驗 |
| ua-strategy：LIFF endpoint restores its URL params | 1 | 有（`resolveLiffParams`） | 缺 | 待真機驗 |
| ua-strategy：Tracking endpoint records the single authoritative click | 1 | 有；CORS 實際帶 credentials（HC-10） | 有（`shortlink-flow.test.ts` 410） | — |
| ua-strategy：Tracking endpoint counts unique clicks by lineUid | 3 | 有 | 有（unit＋feature 並行） | — |
| ua-strategy：lineUid resolves to a contact via channel identity | 2 | 有 | 部分（沒有對到身分時 contactId 為 null 沒有斷言；實測正確） | — |
| ua-strategy：OG snapshot captured on create and update | 3 | 有；但前端編輯會送回舊 OG（HC-01） | 有（feature 兩條、unit `shortlink.flow.test.ts`、`og-snapshot-stale.test.ts`） | 表單 OG 區塊 |
| ua-strategy：OG fetcher is restricted | 1 | 有（`og-scraper.ts`） | 有（`outbound-ssrf-coverage.test.ts`、`og-scraper-parse.test.ts`） | — |
| ua-strategy：Short links bind an optional LINE channel | 2 | 有；不檢查渠道啟用（HC-11） | 缺 | 有 |
| ua-strategy：LIFF ID Format Is Validated On Save | 2 | 有（渠道領域） | 有（`channel-liff-id.test.ts`） | 渠道 Bot 設定 |
| ua-strategy：中轉頁放入租戶的追蹤碼 | 4 | 有（`tracking-snippet.ts`） | 有（`shortlink-tracking-injection.test.ts`） | 設定 > 追蹤設定 |
| ua-strategy：Click recording commits as one transaction | 2 | 有 | 有（unit＋feature） | — |
| tracking-settings：追蹤 script 只輸出合格的 ID | 2 | 有 | 有（`tracking-snippet.test.ts`） | — |
| tracking-settings：格式驗證、讀取、更新（設定領域） | 10 | 未逐條核對（設定領域） | 有（`tracking-settings.test.ts`、`tracking-settings-route.test.ts`） | 設定頁 |

合計：shortlink-routing 8、ua-strategy 35、tracking-settings 中屬本領域 2（另 10 個屬設定領域）。缺實作 0；缺或只有部分測試約 17 個 scenario；缺前端入口 0。

前端送出值與後端 Zod：

- 到期 `datetime-local` 經 `toIsoForApi` 轉 ISO，後端 `z.coerce.date()` 接受（實測 23:59 → `15:59:00.000Z`，讀回 `23:59`）。直接打 API 送不帶時區的字串時依伺服器時區解讀（本機台北；與 HC-MARKETING-23 同類）。
- 選填欄位：建立時空白不送、編輯時送 `""`，後端存 null（實測）。
- `tagOnClick` 來自 `/tags` 的 UUID，後端接受；但選單含工單標籤（HC-02）。
- `lineChannelId` 一律送，沒選送 `null`，後端 `nullable()` 接受。
- 自訂代碼前端不檢查格式，後端擋；錯誤訊息不指出欄位（HC-08）。

## 待真機驗

- LINE 內建瀏覽器點擊 → `liff.line.me` → `/liff/redirect` 的 `liff.init`、`liff.login`、`getProfile` 取得 lineUid、sessionStorage 參數還原。本機與 UAT Demo 的 LINE 渠道都沒有設 liffId。
- 爬蟲實際抓預覽：把短連結貼到 LINE、Facebook，確認預覽卡顯示 OG。
- GA4 與 Meta Pixel 是否收到事件（中轉頁不等事件就轉址）。

## 環境與測試資料

- 本機留下的資料都以 `hc-shortlinks-` 開頭：短連結 `hc-shortlinks-full`、`HC-shortlinks-FULL`、`hc-shortlinks-ui`、`hc-shortlinks-og`、`hc-shortlinks-ssrf`、`hc-shortlinks-casetag`、`hc-shortlinks-ghosttag`；聯絡人「hc-shortlinks-客人A／B」與一筆 LINE 身分（渠道「健檢 LINE-A」，uid `Uhcshortlinks…0002`）；標籤「hc-shortlinks-點擊」（CONTACT）、「hc-shortlinks-工單標籤」（CASE）；自訂角色「hc-shortlinks-唯讀」「hc-shortlinks-無」與兩個成員。
- 測 LIFF 用的停用渠道「hc-shortlinks-LIFF 渠道」與連結 `hc-shortlinks-liff` 已刪除；沒有前綴的測試連結（`ab`、`track` 與兩條自動代碼）已刪除。
- 沒有改租戶設定、渠道設定與 seed 帳號。
- UAT：只讀，沒有建立、修改、刪除任何資料（0 筆）。公開轉址只用 curl 取頁面，不執行 JS，不會記點擊。

## 建議新增到 AUDIT.md 的項目

- HC-SHORTLINKS-01：編輯改目標網址時，前端應只在使用者改過 OG 欄位時才送 OG，或後端在目標網址改變且 OG 與舊值相同時重抓。
- HC-SHORTLINKS-02：`tagOnClick` 應驗證為本租戶、CONTACT 範圍的標籤；表單選單只列 CONTACT 標籤；點擊貼標失敗應有後台看得到的紀錄。
- HC-SHORTLINKS-03：`POST /shortlinks` 不要把例外原文回給前端；跨租戶代碼重複應以 P2002 轉成「這個自訂代碼已經被使用了」（正式環境 RLS 下才會發生，本機測不出）。
- HC-SHORTLINKS-10：全域 CORS `origin: true` 加 `credentials: true`，與規格不符；目前靠 cookie 的 `SameSite=strict` 擋住。

## 文件過時之處

- `docs/ref/features/tenant/SHORTLINKS.md`：「過期或停用的連結回 410」應改為「`GET /s/:slug` 回 404 失效頁，`/s/track` 回 410」；「自訂代碼與其他租戶重複時回伺服器錯誤」應改為「回 400，訊息是資料庫錯誤原文」（目前的限制表也要改）；核對日期 2026-09-30。
- `packages/automation/src/contracts/events.ts:144-149` 的「可以依是哪一條連結決定要做什麼」：規則沒有連結條件（自動化健檢 HC-AUTOMATION-08 已記錄）。
- `apps/web/tests/e2e-uat/WAVE6-FINDINGS.md:184-194` 記錄的公開轉址 404 已修好，該檔仍寫「未修」。
