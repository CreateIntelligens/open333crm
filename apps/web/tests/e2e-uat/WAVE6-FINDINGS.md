# Wave 6 欄位級測試 — Bug 彙總

> 更新中。各 agent 回報後彙整於此。

## 行銷 + LINE 素材（已完成：32 pass / 1 skip / 0 fail，33 案例）
Spec: `tests/e2e-uat/tenant-fields-marketing-line.spec.ts`

### 🔴 P1 — 關鍵字回覆後端 7 項驗證全面缺失
**根因**：`automation.routes.ts:39-41` 的 `trigger: z.object({type}).passthrough()` 只驗 type，
`keywords` / `match_mode` 完全不驗；`actions[].params` 是 `z.record(z.unknown())`。

**已由主 session 獨立複核確認**：
- `automation.worker.ts:285` 有 `if (keywords.length === 0) continue;` 防空陣列
- 但 `['']`（含一個空字串）長度為 1，通過該防護
- `automation.worker.ts:300` `lowerText.includes(kw.toLowerCase())` → `includes('')` 在 JS **恆為 true**
- 實測 `node -e "'任意訊息'.includes('')"` → `true`
- **結論：一條 `keywords:['']` 的規則會對租戶內每一則進來的訊息觸發自動回覆**

API 直呼全部回 201（應為 4xx）：空陣列、空字串、純空白、5000 字無上限、
`match_mode` 非法值、`materialId` 非 UUID、`materialId` 指向不存在的 UUID。

UI 端有前端擋控（擋空名稱/無關鍵字/未選素材，會去重與 trim），一般操作碰不到；API 直呼無防護。

**建議修法**：為 `keyword.matched` 補具名 zod schema —
`keywords: z.array(z.string().trim().min(1).max(100)).min(1)`、`match_mode: z.enum(['any','all'])`。

### 🟠 P2 — `z.string().min(1)` 不 trim，純空白可建出無名資料（3 處同根因）
- 行銷活動 `name`（純空白 + 全形空白皆 201）
- 受眾分群 `name`（純空白 201）
- **Rich Menu `chatBarText`（純空白 201）** — 最嚴重，這是 LINE 選單列真實可見的按鈕文字，會顯示成空白按鈕

前端 `!formData.name` 判定純空白為有值 → 按鈕可點；後端 `min(1)` 不 trim → 放行。
**對照組**：Quick Reply preset 的 name 在 service 層有 trim 檢查（回 INVALID_INPUT），證明可修。
**建議**：`z.string().trim().min(1)` 一次修掉三處。

### 🟠 P2 — 行銷活動結束日期可早於開始日期
`startDate`/`endDate` 是裸 `z.string().optional()`，無格式驗證、無跨欄位驗證；前端無日期檢查。
重現：開始 2026-12-31、結束 2026-01-01 → 201 成功存入。

### 🟠 P2 — 廣播可排程到過去時間
`scheduledAt` 無「須為未來」驗證。填 2020-01-01 → 201 且 status='scheduled'。
**實測後果**：被 scheduler 撿走後變 `failed`，使用者拿到莫名失敗的廣播。

### 🟠 P2 — Rich Menu uri action 接受危險 scheme
`actionSchema.uri` 只有 `z.string()`（無 `.url()`），service 層只檢查非空。
`javascript:alert(1)` 可存成草稿（201）。
LINE 官方（reference/messaging-api L20809）只允許 http/https/line/tel。
`publishRichMenu:450` 把 `areas` 原樣轉送 LINE → 使用者要到「按發布」才拿到 LINE 的 400。
（非可執行 XSS，前端預覽不當連結執行，已用 expectNoXssExecuted 驗證）

### 🟡 P3 — CM-170 既有單複驗確認
關鍵字回覆刪除是軟刪且列表未過濾。DELETE 回 200 → GET 該筆仍回 200 → 列表仍列出。
UAT 累積 63 筆 isActive=false 的 [E2E] 殘留規則全列在畫面上。

### 驗證品質良好（已鎖回歸保護）
- **Quick Reply preset 是全系統驗證最好的模組**：name min/max(100)+service 層 trim、
  items min(1)/max(13)、label max(20)、text max(300)，且 13/20 完全對齊 LINE 官方上限
- Rich Menu：chatBarText max(14) 對齊 LINE 官方、areas min(1)/max(20)、imageUrl `.url()`、
  bounds 超圖有擋、5 種 action 型別必填參數全擋、非法 action type 擋下
- 廣播：uuid 格式、targetType enum、materialId⊕templateId 互斥 refine、跨租戶回 404
- 活動/分群：name max(200)、description max(500) 三點邊界正確；狀態機非法轉換有擋
- **無 5xx**：`conditions[].value` 是 `z.unknown()` 完全不驗，餵垃圾值一路送到 Prisma，
  但全域 error handler 正確轉 4xx 而非 500
- XSS/HTML/SQL：存入後列表渲染為純文字，腳本未執行、HTML 未解析、SQL 樣本正常存入
- 往返完好：padded / emoji（含 ZWJ）/ newline / 關鍵字陣列 / match_mode 存讀一致
- 前端擋控：必填 disabled、Rich Menu 14 字計數器、QuickReply 13 顆上限、關鍵字去重 trim 全正確

### 與原任務描述不符的事實（以讀碼+實測為準，需更正 TEST-PLAN）
1. LINE 素材頁在 `/dashboard/line/{rich-menus,keyword-replies,quick-replies}`，
   **不是** `/dashboard/marketing/line-*`
2. 行銷活動**沒有預算欄位**（後端 schema、前端元件、Prisma model 三處皆無）→ 唯一 skip
3. 廣播**不是多步驟精靈**，是單一 Dialog 單頁表單
4. 「關鍵字回覆」沒有獨立後端模組，是 automation rule 的薄包裝
   （`trigger.type='keyword.matched'` + `send_material`），故驗證走 `POST /automation/rules`

### 安全紅線遵守
- 廣播「立即發送」全程只 `dismissNextDialog`；案例 16 額外掛 request listener
  斷言取消後**確實無 send 請求發出**（雙重保險）
- Rich Menu 發布/取消發布**完全未點擊**，全走 API 建草稿
- 未動既有非 [E2E] 資料；未改 production 程式碼；未 push/PR/動 git

### 測試資料清理
分群、Rich Menu、Quick Reply 完全清乾淨。以下殘留為**系統設計限制非清理失敗**：
- 廣播無 DELETE 端點，只能 cancel，cancelled 記錄永久留存
- 關鍵字回覆 rules 軟刪（CM-170）
- 活動 deleteCampaign 只允許刪 draft，轉 cancelled/active 後永久無法刪
  （殘留 5 筆 cancelled 是 Wave 2/3 留下的，已無法清除）

---

## 素材庫 Materials（已完成：56/56 全綠，56 案例）
Spec: `tests/e2e-uat/tenant-fields-materials.spec.ts`（UAT 實跑 4.4 分鐘）
盤點 58+ 個輸入元素全數涵蓋。

### 🔴 P1 — 分頁 page=0 / page=-1 造成 500（**主 session 複核後確認影響面遠大於原報告**）
Agent 原只在素材庫發現。主 session 掃描 `(page - 1) * limit` 模式找到 **17 處**，
並於 UAT 逐一實測，確認 **5 個模組受害**：

| 端點 | page=0 | page=-1 | page=abc |
|---|---|---|---|
| `marketing/materials` | **500** | **500** | 400 ✔ |
| `marketing/campaigns` | **500** | **500** | 400 ✔ |
| `marketing/segments` | **500** | **500** | 400 ✔ |
| `shortlinks` | **500** | **500** | 400 ✔ |
| `portal/activities` | **500** | **500** | 400 ✔ |
| `knowledge/articles` | 400 ✔ | — | 400 ✔ |
| `contacts` | 400 ✔ | — | 400 ✔ |
| `conversations` | 400 ✔ | — | 400 ✔ |

**根因**：route 層無 zod 驗證（如 `material.routes.ts:249` 的 `Number(q.page)`）
+ service 層 `skip: (page-1)*limit` 無下限夾制 → page=0 得 skip=-50，Prisma 拒收負 skip。
**對照組（已正確實作）**：`contact.routes.ts:24`、`conversation.routes.ts:122`、
`canvas.routes.ts:58` 都有 `z.coerce.number().int().positive().default(1)`。
**修法**：把對照組的 zod 套到那 5 個模組的 route，或 service 內 `Math.max(1, page)` 兜底。
任何登入身分皆可觸發，非權限問題。

### 🔴 P1 — LINE 影片 endCard 的 action 欄位零驗證
`javascript:alert(1)` / 空 uri / `data:text/html,...` / label 60 字 / postback data 400 字 /
type 非法 → **6 種全部 201 寫入**。
根因：`buildLineVideoWithEndCard`（builders.ts:296）只回傳 video 物件，**整個 endCard 被丟棄**
→ LINE validate 從來看不到它；且 `material.routes.ts` 已定義的 `uriActionSchema`/
`postbackActionSchema` 從未被 create/update 使用（註解自承「不直接驗證 body 內 action」）。

### 🟠 P2 — LINE 影片「結束畫面」永遠不會送出（功能性缺陷）
UI 三欄（圖片/CTA文字/按鈕動作）可編輯、會存進 DB，但組 LINE 訊息時整段被丟掉。
builders.ts:293-294 註解說「包成 imagemap + video 兩個 message 一起送」，**與實作不符**。

### 🟠 P2 — previewImageUrl 接受 javascript: / data: / file: scheme
zod `.string().url()` 只做 `new URL()` 可解析性檢查，不限 protocol；該值會被前端當圖片網址渲染。
建議 `.url().refine(s => /^https?:/i.test(s))`，與 routes.ts 既有 `URI_SCHEME_RE` 一致。
（與行銷模組的 Rich Menu uri scheme 問題同族）

### 🟠 P2 — FB 版型 body 完全無後端驗證
前端 FbTextEditor maxLength=2000，但後端 `body: z.record(z.unknown())` +
`validateLineMaterialWithLineApi` 只處理 `line_*` → 10000 字、`text: 12345`（型別錯誤）、
收據 total_cost=-999 全可寫入。與 LINE 側（真打 LINE validate API）形成明顯不對稱，
問題延到發送時才爆。

### 🟠 P2 — Flex carousel 可匯入 13 個 bubble（LINE 上限 12）
`line-flex-template.ts:475` 宣告 `maxChildren:12` 但只用於 editableContainers 描述，
`validateLineFlexMessageBody` 未實際檢查；且 createMaterial 對 `line_flex_*` 會
return 跳過 LINE validate（service.ts:259）→ **兩道防線都沒守**。

### 🟠 P2 — 名稱/分類名稱未 trim（與行銷模組同根因）
前端按鈕 disabled 擋得住，但 zod 僅 `min(1)` 無 trim → 直打 API 可存入 `"   "`。
**跨模組合計已達 5 處**（行銷活動 name、分群 name、Rich Menu chatBarText、素材 name、分類 name）。

### 🟠 P2 — 精靈選「LINE 單張圖片」不改任何欄位直接存檔必失敗
`DEFAULT_BODY_FOR_TYPE` 帶相對路徑 `/material-samples/cafe.jpeg`，
LINE validate 要求 HTTPS 絕對網址（carousel 預設圖同樣問題）。

### 🟡 P3（4 項）
1. imagemap 缺 action 的錯誤訊息**外洩內部 TypeError**「Cannot read properties of undefined (reading 'type')」
2. `?categoryId=notauuid` **把 Prisma 查詢語句原文回給前端**，洩漏 ORM/表結構
3. 同名分類可無限重複建立，UI 無法分辨
4. 編輯頁名稱/分類/描述三欄未設 maxLength，超長內容要按存檔才被**英文 zod 文案**退回

### 已知地雷複查
- ✅ **`line_flex_template` 空 body 的 500 已修復** → 現回 400 `INVALID_LINE_FLEX_PAYLOAD`
  （`assertLineFlexMessageBody` 已用 `flexErrorToAppError` 包住）。案例 F1 保留為回歸防護
- ✅ `line_flex_showcase`/`line_flex_template` 精靈仍 `hidden:true`（LINE 實際可選 5 種、FB 9 種）
- ✅ imagemap 缺 action 回 400（與 Rich Menu defaultAreas 同行為）

### 重要環境知識（供後續 Wave 參考）
**LINE 版型的欄位約束不是本專案 zod 擋的，是 LINE 官方擋的**：
`validateLineMaterialWithLineApi` 存檔前真的打 `https://api.line.me/v2/bot/message/validate/push`，
錯誤碼一律 `LINE_MATERIAL_VALIDATE_FAILED`。這條路徑對 `line_flex_showcase`/`line_flex_template`
**直接 return 不驗** —— 是上述多個驗證缺口的共同根因。
另：此流程在 RLS 交易內呼叫外部 API，曾觀測到一次 5s 交易逾時（`Transaction already closed`，
重跑 3 次未重現，屬延遲尖峰下的潛在風險，未列正式 bug）。

### Skip 與清理
- Skip：圖片真上傳（MinIO，屬儲存層非欄位層）、AI 生成合法 prompt 實跑（依紅線只驗 zod 擋控）、bulk-embed
- 清理：全數 `[E2E]` 軟刪，另掃全庫清掉 3 筆早期殘留。**目前 UAT 零 [E2E] 殘留、分類表乾淨**

---

## 🚨 P0 — 短連結公開轉址全掛（主 session 已親自實測證實）

**Agent 回報 → 主 session 獨立驗證，全部屬實：**

UAT 上 3 筆真實有效短連結（isActive=true、未過期）實測：
```
GET /s/w3E7u1 → HTTP 404   X-Shortlink-Source: EXTERNAL_BROWSER
GET /s/UKw2QC → HTTP 404   X-Shortlink-Source: EXTERNAL_BROWSER
GET /s/0pQ6uA → HTTP 404   X-Shortlink-Source: EXTERNAL_BROWSER
```
目標分別是 udn.com / login.sanlih.com.tw / notes.boshkuo.com（真實對外連結）。
header 有值證明**路由有進入**，是查不到資料 → 一律走 renderExpiredPage()。
`POST /s/track` → 410，點擊數完全記不到。

**根因（主 session 讀碼確認）**：CM-171 只修一半。
- `shortlink.routes.ts`（後台，**已修**）：全部改用 `request.tenantPrisma` ✔
- `shortlink-redirect.routes.ts`（公開轉址，**未修**）：
  - L94 `getLinkForRedirect(app.prisma, slug)` ← 未綁租戶，被 RLS 擋下
  - L116 `getChannelLiffId(app.prisma, ...)`、L120 `app.prisma.tenantSettings.findUnique`
  同一檔案共 4 處。

**影響：所有已發給客戶的短連結目前全是死連結，行銷歸因數據全空。**

### ⚠️ 版本落差警告（主 session 用 git 確認）
```
6b4305f (CM-171) 在 origin/main: 0   ← 只在 feat/platform-user-management
cec1ff3 (CM-172) 在 origin/main: 0   ← 同上
origin/main HEAD = 2102ed4
```
UAT 跑的版本**與 main 不同步**（UAT 已有後台修復，main 沒有）。
**若之後從 main 重新部署，CM-171/CM-172 會整包回歸。** 需確認這兩個 commit 併回 main。

### 🔴 P1 連鎖風險：P0 修好後會變成可利用的 XSS
`targetUrl` 零格式驗證且接受 `javascript:` scheme；轉址頁把它丟進
`window.location.replace(target)` 與 `<noscript><a href>` —— 兩個都是執行 sink。
目前因 P0 擋著無法觸發，**P0 一修好就立即成為可利用的儲存型 XSS**。
→ 修 P0 的同時必須一併補 targetUrl 的 scheme 白名單，順序不可顛倒。

---

## 設定 Settings（已完成：55 pass / 1 skip，56 案例）
Spec: `tests/e2e-uat/tenant-fields-settings.spec.ts`
盤點 85 個輸入元素（與預估相符）。roles 權限矩陣佔 57 個。

### 🔴 P1 — 一般設定頁是 POC 假 UI（**主 session 已讀碼證實**）
`GeneralSettings.tsx:73` 註解自承 `// POC：模擬儲存成功`，
`handleSavePassword` 只做 `setPasswordSaved(true)` + 清空欄位，**整個檔案 0 個 API 呼叫**
（主 session grep `api.|fetch(|axios|useSWR|mutate` 無任何命中）。
掛載於 `app/dashboard/settings/page.tsx:60`，**是使用者真的看得到的 general tab**。
UI 卻顯示「密碼已更新」（僅 2 秒）→ **使用者會以為改了密碼其實沒改**。
後端真實端點 `PATCH /agents/me/password` 存在（`agent.routes.ts:100`）但前端從未呼叫。
另：前端門檻 6 字 vs 後端 `min(8)` 不一致，7 字密碼會顯示「密碼已更新」。

### 🔴 P1 — SLA 數字欄位超大值造成 500
`POST /sla-policies` 帶 `firstResponseMinutes: 2147483648`（Int4 上限+1）→ **500**。
zod 只有 `.int().positive()` 無上限，Prisma 寫入溢位未攔截。2147483647 可正常存。三欄皆同。
（與素材庫分頁 500、門戶積分超大值 500 同族：**數值邊界未夾制**）

### 🔴 P1 — tracking GA4/Pixel ID 完全無格式驗證
schema 是 `z.string().nullable().optional()`，`<script>` 原樣落庫。
**風險加成**：元件自述「短連結 redirect 頁面會自動注入對應的追蹤腳本」，
若注入端未轉義即構成儲存型 XSS 面。前端亦無 pattern/maxLength。

### 🟠 P2（9 項）
- `.min(1)` 未 trim：tags/agents 的 name 純空白與全形空白皆可建（201）。
  roles 有 service 層補擋（422）故正常 → **跨模組累計 7 處**
- office-hours 時間只驗格式不驗語意：regex `^\d{2}:\d{2}$` 讓 **`25:99` 可存**；
  結束早於開始（18:00→09:00）也可存 → 營業時間判定失準
- timezone 無白名單（`Mars/Phobos` 可存）
- holidays 無日期格式驗證（`not-a-date`、`2026/13/45` 可存）
- 密碼無複雜度要求，僅 `.min(8)`，`12345678` 被接受
- tag name 無上限（500 字可存）；color 收 `javascript:alert(1)`（前端當 style 值有風險）
- SLA 無跨欄位邏輯驗證（首次回應 600 分、解決 5 分這種矛盾設定可存）
- SLA 前端 `parseInt(x)||預設值`：三個數字欄位全清空仍送出，**靜默存成 15/60/10** 而非提示必填
- CLI scopes 無白名單（`z.array(z.string())` 收任意字串含 `'*'`）
  （實際授權以 `requirePermission` 為準，未知 scope 不授予真權限 → 列資料衛生問題非權限繞過）

### 驗證正常
email 格式（6 種非法全擋）、email 全域唯一性（409）、密碼 min(8) 邊界、
role/type/scope/priority enum、roleId UUID 與跨租戶檢查、role name max(20) 三點（前端一致）、
SLA 負數/零/小數/字串型別、api-keys 與 cli name max(100) 三點、expiresInDays 擋控、
system role 不可刪、自我停用/刪除防護（422）、一次性金鑰不重複回傳、XSS 未執行、
passkey max(80) 前後端一致。

### Skip（1 項）
passkey 註冊需 WebAuthn virtual authenticator；且註冊成功會在 admin 帳號留下真實憑證
＝動到正式帳號安全設定（違反紅線）。**改以後端改名端點的欄位驗證補齊**
（空/純空白/81 字擋、80 字過，測完還原原名）。

### 安全紅線遵守（已實測驗證）
- **admin 密碼未被更動**：所有改密碼呼叫皆帶故意錯誤的 currentPassword（雙重保險）；
  測後用原密碼 `/auth/login` 回 **200** 確認。成功分支改用自建 [E2E] 帳號測後 purge
- **office-hours / tracking 已還原**：每個寫入案例包 `withRestore`（finally 還原＋斷言），
  afterAll 再兜底。實測 `tracking={gaId:null,metaPixelId:null}`、office-hours
  tz=Asia/Taipei enabled=false mon=09:00-18:00 holidays=[] — 與測前完全一致
- 測試資料零殘留（api-keys 撤銷是軟刪屬預期）；passkeys 原有 2 筆完好未動

### 新增踩坑（建議補進共用清單）
1. **shadcn `<Input>` 不輸出 `type` 屬性** → `input[type="text"]` 選不到，要用 getByPlaceholder
2. **原生 `<dialog>` 同時存在多個** → `getByRole('dialog')` strict mode violation，
   要用 `page.locator('dialog[open], [role="dialog"]').last()`
3. CLI tab 按鈕是「產生 Token」不是「建立連線」，且開啟鈕與送出鈕同名，要取 dialog 內那顆
4. **general 的「儲存成功」只顯示 2 秒**（setTimeout 2000），等超過 2.5 秒就永遠看不到
5. office-hours 欄位在 `enabled=false` 時完全不渲染，要先開開關才掃得到
6. `inventoryFields` 掃 dialog 要用 `dialog[open]` 而非 `[role="dialog"]`

---

## 渠道/門戶/短連結/分析/通知（已完成：66/66 全綠，66 案例）
Spec: `tests/e2e-uat/tenant-fields-channels-portal.spec.ts`
18 個 `test.fail()` 標記已知 bug，並用 JSON reporter 驗證確實都在失敗（非靜默轉綠）。

**CM-171/CM-172 現況與原前提相反**：admin API 兩者在 UAT **都已修好**（見上方版本落差警告），
故兩模組完整測試無 skip。但公開轉址仍掛（上方 P0）。

### P1（4 項）
- 短連結 `targetUrl` **零格式驗證**：`notaurl`/`example.com`/空字串/純空白全存得進去
- 短連結 `targetUrl` 接受 `javascript:` scheme（見上方 P0 連鎖風險）
- 短連結自訂 slug 無字元集/長度驗證：`a/b/c`（含斜線→路由永遠配不到，**建出死連結**）、500 字照收
- 門戶活動標題空字串/純空白/全形空白皆可存 → 門戶出現無標題活動
- 門戶積分超大 amount（999999999999999）**回 500**（Int32 溢位未處理）

### P2（6 項）
- 門戶積分小數被**靜默無條件捨去**（1.5→1），使用者無感知（已實測並回沖歸零）
- 渠道 `webhookBaseUrl` 的 `z.string().url()` **不限 scheme**，`ftp:/x` 通過並串出死 webhook
  （`javascript:`/`mailto:` 同樣通過；下游 webhook 有 https refine，**此處漏掉**）
- 門戶標題無長度上限（10000 字可存）
- 門戶起訖時間無先後檢查
- 分析 `from > to` 不擋，回全 0 空報表，使用者誤以為沒資料
- 短連結錯誤訊息**洩漏 Prisma 內部細節**（整段 `Invalid prisma.shortLink.create() invocation`）
- 渠道 `settings` 是 `z.record(z.unknown())`，除 downstreamWebhook 外全不驗
  → botConfig 的 liffId/問候語可塞任意值任意長度

### P3（2 項）
- 短連結前端 `disabled={!targetUrl}` 只看非空，純空白解鎖按鈕並送出（後端又不擋→死連結）
- 門戶 ENDED 活動**永久無法刪除**（僅 DRAFT 可刪，無軟刪/封存/force）

### 根因共通點
`shortlink.routes.ts` 與 `portal.routes.ts` **完全沒有 zod schema**，
全是 `request.body as ...` 裸轉型直進 service。
相對地 `channel.routes.ts` 驗證相當紮實（除 scheme 與 settings 兩缺口）。
→ 建議優先補這兩個模組的 schema。

### 通過項目
渠道：displayName 三點邊界、channelType enum、LINE/FB/THREADS 憑證必填、
downstream webhook 五種非法值全擋、WEBCHAT 建立→改名(emoji)→刪除生命週期、
chatbox 主題 max(80)、chatbox domain URL 驗證
短連結：slug 重複擋控、lineChannelId 非 UUID 與 expiresAt 非法日期皆 4xx、
emoji/前後空白/換行原樣往返、QR data URI
門戶：三種 type、非法 enum 擋、選項/表單欄位正確存入與排序、
狀態機（DRAFT→PUBLISHED→ENDED、非 DRAFT 不可編輯/刪除/重複轉換）
積分：正負值加扣正確且餘額精準、amount=0 邊界、非數字擋、非 UUID 回 4xx
分析/通知：非法日期 400 且指出欄位、CSV 匯出下載成功、reportType enum、分頁四種非法值全 400
**XSS 整體**：`render-utils.ts` 的 HTML/JS 跳脫正確，`escapeHtmlAttr` + `jsonForScript`
含 U+2028/2029 處理，存入的 payload 在列表頁均未執行

### 安全紅線遵守
- ✅ **5 個既有渠道（LINE OA / test333 / Demo Facebook / IG333 / tatung）完全未動**，
  測後逐一比對 webhookUrl 與 isActive 皆與測前一致
- ✅ 只建 [E2E] WEBCHAT 渠道，全數刪除（殘留 0）；金鑰全填假值
- ✅ 未改 Webhook base URL（`ftp:/x` 建在自建 [E2E] WEBCHAT 上，已刪）
- ✅ 未執行抽獎；積分測試全部回沖，餘額維持原值；短連結殘留 0

### 已知殘留（需 DBA）
門戶 12 筆 [E2E] ENDED 活動刪不掉（P3：僅 DRAFT 可刪），其中 3 筆是前波測試留下。
已改寫狀態機案例為**重用既有 DRAFT 並預埋下一筆**，讓殘留固定不再累積。

### 已查證排除的誤判
- 渠道對話框選 WEBCHAT 顯示「Channel Secret/Access Token」→ 是 WEBCHAT 刻意沿用該組 label
  當自訂金鑰，非 LINE 欄位殘留，**不是 bug**
- UAT 跑的是單頁 `ChannelFormDialog`，非本機原始碼的多步驟 `ChannelWizard`（測試已對齊 UAT 實況）

---

## 工單 / 聯繫人 / 收件匣（已完成：61 pass / 2 skip，63 案例）
Spec: `tests/e2e-uat/tenant-fields-cases-contacts-inbox.spec.ts`（UAT 實跑 5.0 分鐘）
11 個 `test.fail()` 標記 bug 仍在；修好後 Playwright 會轉報 unexpected pass 主動提醒。

### 🔴 P1 — 送出訊息 content 幾乎零驗證（本模組最嚴重）
`conversation.routes.ts:131` — `sendMessageSchema = { contentType: z.string().default('text'),
content: z.record(z.unknown()) }`。
實測 `POST /conversations/:id/messages` 送以下 5 種 → **全部 201 並以 OUTBOUND 落庫**：
`{content:{}}`、`{content:{text:""}}`、`{content:{text:"   "}}`、`{content:{foo:"bar"}}`、
`{contentType:"wut", content:{text:"x"}}`。
影響：客服端可產生空泡泡訊息；contentType 非列舉 → MessageBubble 無對應渲染分支；
**若走真實 LINE/FB 渠道會送出無效 payload**。
前端 MessageInput 有 trim() 擋控（UI 測試證實空/純空白/全形空白送不出去）→ 純屬前端單邊防守。

### 🟠 P2 — 工單分類選項三處不一致（**主 session 已讀碼逐項比對證實**）
| 位置 | 選項 |
|---|---|
| `CaseCreateModal.tsx:60-65`（建立時）+ 列表篩選 | 維修 / 查詢 / 投訴 / 其他 |
| `CaseDetail.tsx:49-60`（詳情頁） | (未分類) / 產品諮詢 / 訂單問題 / 退換貨 / 帳號問題 / 技術支援 / 投訴建議 / 付款問題 / 物流配送 / 其他 |

**兩套清單只有「其他」重疊。**
後果：用建立 Modal 選「維修」「查詢」「投訴」的工單，進詳情頁分類下拉**顯示空值**
（該 option 不存在）→ 使用者一存檔就把分類洗掉。
**主 session 實測 UAT 現況**：目前僅 1 筆工單且分類為「其他」（恰好相容），
故**尚未造成實害**，但程式碼缺陷確實存在，資料一多就會發生。
無共用常數來源 → 建議抽到 `@open333crm/shared` 並加後端 enum。

### 🔴 P1 — 其他驗證缺口（5 項）
- **工單 title 純空白/全形空白可寫入**（`case.routes.ts:46` min(1) 未 trim）→ 201。
  本輪在 UAT 實際產生 4 筆空白標題工單，已刪除
- **工單備註 content 無長度上限**（`case.routes.ts:78` 僅 min(1)）→ 50000 字寫入，時間軸整段渲染
- **工單備註 content 純空白可寫入** → 時間軸出現空白備註列
- **escalate reason 無上限且接受純空白**（`case.routes.ts:70`）→ `"   "` 成功升級，
  事件 metadata 存 `reason:"   "`；10000 字亦可
- **聯繫人 displayName 無上限且接受純空白**（`contact.routes.ts:29`）→ `"   "` 與 10000 字皆 200
- **聯繫人 phone 完全無驗證**（`contact.routes.ts:30` 裸 nullable optional）
  → 5000 字與 `<script>alert(1)</script>` 皆成功寫入

### 🟠 P2 — 其他（4 項）
- **工單 category 後端是 `z.string()` 全開**：前端只給 4 選項，後端接受任意字串且無 max。
  實測 500 字亂碼、`<script>` 皆 201 → 分類篩選被汙染、報表版面可被撐爆
- **escalate notifyTargets 非列舉**（`z.array(z.string())`），送 `['不存在的通知對象']` 回 200，
  靠下游默默忽略
- **結案原因前端未設 maxLength**（後端 max=1000）→ 打超過 1000 字要按送出才知被拒
- **工單列表頁沒有任何「建立工單」入口**：`CaseCreateModal` 只掛在
  `inbox/ContactInfoPanel.tsx:341`，`/dashboard/cases` 完全沒 mount。
  後果：**無法建立「不來自對話」的工單**；`POST /cases` 獨立建單 API 在 UI 上無路徑可觸發＝死碼。
  連帶 CaseCreateModal 內的聯繫人搜尋 /「+ 建立新聯繫人」分支永遠走不到
  （inbox 模式聯繫人是 prefill+disabled）

### 驗證通過（重點）
- **XSS 全面安全**：工單標題/備註/訊息內容塞 payload 全部純文字顯示，
  `window.__E2E_XSS__` 未設值，`<b>` 未成元素（React 預設跳脫）
- **SQL 注入**：`'; DROP TABLE agents;--` 原樣存讀、無 5xx（Prisma 參數化）
- **往返完整**：emoji（含 ZWJ 家庭組合）、換行、前後空白存入後讀回一致；10000 字訊息無截斷
- **有效驗證**：title max(100)、description max(2000)、escalate note max(500)、
  close reason max(1000) 邊界三點全準；priority/status/slaStatus 列舉、所有 uuid、
  email 格式（6 種非法全擋）、isBlocked 型別、**分頁參數（limit>100 / page=0 / page=-1）
  全部正確回 4xx**（與素材庫/短連結/門戶的 500 形成對照，證明此處實作正確）
- **狀態機**：詳情頁狀態下拉恰為 `VALID_CASE_TRANSITIONS[OPEN]`，非法流轉 OPEN→RESOLVED 回 422
- **前端擋控**：建立 Modal 標題/分類必填（含全形空白）、訊息輸入空值擋、
  Shift+Enter 換行 vs Enter 送出、升級原因必填錯誤訊息全正確
- **合併防護**：主次同一 uuid、非法 uuid 皆回 4xx

### Skip（2 項）+ 主動限縮（1 項）
1. 模板選擇器變數填入 — 租戶沒有任何訊息模板（Dialog 開啟後掃到 0 欄位）。測試已寫好，建模板後自動生效
2. 對話標籤增刪 UI — 租戶 tags 表沒有 `scope=CONVERSATION` 標籤（只有 CONTACT 11、CASE 2）。
   API 層驗證（tagId 非法 uuid 被擋）仍有測到
3. **合併聯繫人只走到確認閘門，未按最終合併鍵**：合併不可逆，且依 rate limit
   只種得出一個可犧牲的訪客，無法湊出合法主/次配對。已測：未選對象時「下一步」disabled、
   搜尋框 <2 字不查詢、合併 API 的 uuid 與「主次同一人」擋控

### 環境與清理
- `seedWebchatConversation` 全 spec **只呼叫 1 次**（rate limit 10 次/分），整份重複利用同一條對話
- 未真發外部渠道訊息（全走 WEBCHAT）；未動渠道設定/Webhook URL/既有聯繫人
- **清理已完成並驗證**：自建 [E2E] 工單全刪、bug 產生的 4 筆空白標題工單全刪
  （逐筆確認是本輪產生、contact 為 Chatbox 訪客後才刪）、自種訪客的
  displayName/phone/language 已還原，最終掃描「殘留 E2E/空白標題工單: 0」

### 新增踩坑（建議補進共用清單）
- **Dialog 是原生 `<dialog>`，開啟時背景頁元素仍在 DOM** → Modal 內定位必須用 `dialog[open]` 限縮，
  否則 checkbox/textarea 會撈到背景頁的
- **seedWebchatConversation 種出來的對話是 `BOT_HANDLED`**，訊息 textarea 與模板/附件鈕全 disabled，
  要先按「接管對話」
- **一條對話只能綁一個工單**（後端 409 CONFLICT），重複跑的建單測試要先刪既有連結工單
- **收件匣進階篩選抽屜用 CSS translate 移出畫面、不卸載**，不能用 `toBeHidden()` 斷言關閉；
  按鈕文字是「套用篩選」「清除全部」
- **聯繫人列表頁寫死 `excludeChannelType: 'WEBCHAT'`**（`contacts/page.tsx:16`）
  → 自種 Chatbox 訪客永遠不會出現在該列表，列表斷言要改用非 WEBCHAT 聯繫人
- 升級測試的共用工單會被前面案例推到 ESCALATED，`ESCALATED→ESCALATED` 回 422，
  「升級成功」案例要自備全新 IN_PROGRESS 工單

---

## 知識庫 + 自動化（已完成：45/45 全綠，45 案例）
Spec: `tests/e2e-uat/tenant-fields-knowledge-automation.spec.ts`（UAT 實跑 8.0 分鐘，連續兩輪全綠非 flaky）

### 🟠 P2 — 語義搜尋冷啟動連續 504（使用者可見，**主 session 已讀碼確認根因**）
Agent 實測樣態：閒置 ≳3 分鐘後 `POST /knowledge/search`
→ `#1 504(60s) → #2 504(60s) → #3 504(60s) → #4 200(36s) → #5+ 200(~0.5s)`（另一輪連吃 5 次 504）。
使用者要連按 3~5 次、每次等 60 秒才會成功。

**主 session 複核**：
- 當下實測（模型已熱）：3 次皆 200 / 0.85s → 符合「僅冷啟動時發生」的描述
- **讀碼確認根因屬實**：`knowledge.routes.ts:323-333` 的 `/bulk-embed` 有明確註解
  「Returns immediately with article count; embedding runs in the background to avoid
  Caddy gateway timeouts on cold-start Ollama (model loading + per-article inference
  can easily exceed 60s...)」並改用背景執行
- 但 `knowledge.routes.ts:116-123` 的 `/search` **仍是同步 await semanticSearch**，無任何對應處理
- **結論：同一份程式碼已記載此問題並修了 bulk-embed，卻漏掉 search**

### 🟠 P2 — Embedding baseUrl 接受非 http(s) scheme
`javascript:alert(1)` 與 `ftp:/x` 皆 200 落庫。`z.string().url()` 底層是 `new URL()`，不限 scheme。
**該值會被後端 fetch 使用 → SSRF / scheme 濫用面**（比前端的 scheme 問題更嚴重）。
修法：`.url().refine(v => /^https?:\/\//.test(v))`。
測試中寫入後立即還原，已驗證 UAT embedding 服務健康（health.ok=true）。

### 🟠 P2 — 標題/規則名稱可存純空白（跨模組同根因）
`createArticleSchema.title` 與 `createRuleSchema.name` 都是 `z.string().min(1)` 無 `.trim()`。
半形與全形空白皆 201 入庫 → 產生「看起來沒標題」的文章，**且會被 AI 檢索到**。
自動化前端有 `!form.name.trim()` 擋控，繞過 UI 直打 API 即可寫入。
→ **跨模組累計已達 9 處**

### 🟠 P2 — 四個 system prompt 欄位完全無長度上限
`chatSystemPrompt` / `summarizeSystemPrompt` / `clarifySystemPrompt` / `modelGuideSystemPrompt`
都是 `z.string().optional()`，10 萬字照收。
**這些值直接進 LLM context，無上限等於可撐爆 token 預算**（與既有 AI 成本議題直接相關，
見 [[project_ai_cost_analysis]]：思考 tokens 已佔成本 74-93%）。

### 🟡 P3（2 項）
- **零動作儲存靜默失敗**（Wave 3 已知，本次確認仍在）：前端只擋 `!form.name.trim()`，
  零動作可按儲存 → 後端 `actions.min(1)` 回 400 → `handleSave` catch 只 `console.error`，畫面無提示
- **前端全無 maxLength**：知識庫 0/5、自動化 0/7，超長輸入要按儲存才被後端 400

### 驗證良好
- **自動化 contracts 層驗證很扎實**：事件/fact/operator/動作類型白名單、動作必填參數、
  跨事件動作限制全部正確擋下
- 知識庫長度邊界（title 200 / summary 500 / category 100）三點全準
- 語義搜尋參數邊界（topK 1-20、threshold 0-1、整數檢查）全部正確
- 匯入格式驗證正確：外層非陣列前端擋下顯示 `JSON must be an array`；
  API 層 `{articles:[...]}` 結構與元素長度約束皆正確
- XSS/HTML/SQL 均純文字保存未執行；往返完整（padded 不被 trim、emoji/換行/Markdown/10 萬字原樣）
- **金鑰處理正確**：已設定時顯示遮罩 `AIza…kAcA` 不洩漏明文，未設定時 `type=password`
- 刪除語意確認：知識庫**硬刪**（DELETE 後 GET 404）、自動化**軟刪**（GET 200 且 isActive=false）

### Skip / 修正
- KB-21 有條件 skip（暖機 6 次仍冷才 skip），**最終兩輪均成功暖機實際未 skip**
- **任務書提到的「JSON 貼入框」不存在**：`ImportDialog.tsx` 只有 file input（實測 textarea 0 個）。
  已改以「上傳 .json 檔」＋「API 直測 import schema」涵蓋
- 未跑 bulk-embed（遵守紅線）；Embedding/Chat 設定破壞性測試皆寫入後立即還原

### 環境安全確認（測後實測）
```
EMB restored: true | health ok: true
CHAT restored: true（11 個欄位逐一比對原值）
BYOK: {"configured":true,"masked":"AIza…kAcA"}  ← 既有金鑰未被動到
殘留 [E2E] 文章: 0
測試規則仍 active: 0（17 條真實規則、3 條 active 未受影響）
```

### ⚠️ 遺留提醒
automation 規則是軟刪，DB 已累積 **120 條**測試規則（含 Wave 3 的），
全為 isActive=false 不會觸發，但**列表頁不過濾軟刪資料**，後台看起來很雜。
這正是既有的軟刪列表 bug（CM-170 同族），若要清理需直接操作 DB。
