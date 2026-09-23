# Wave 6 修復計畫（2026-09-22）

## 分支策略
目前在 `fix/error-messages-i18n`（4 個未推送 commit，動過 shortlink/portal 的 routes 但
**未動 redirect/public 路由**，與本次修復無衝突）。
→ 從該分支**另開 `fix/wave6-field-validation`**，避免混雜兩個主題。

---

## 階段 1：P0 — 公開端點被 RLS 擋（最高優先，對外功能全掛）

### 1-A 短連結公開轉址（已實測：3 筆有效連結全 404、/s/track 410）
`apps/api/src/modules/shortlink/shortlink-redirect.routes.ts` 4 處改 `app.prismaAdmin`：
- L62（track 端點內）
- L94 `getLinkForRedirect(app.prisma, slug)`
- L116 `getChannelLiffId(app.prisma, ...)`
- L120 `app.prisma.tenantSettings.findUnique`

### 1-B 粉絲門戶公開端點（**主 session 本輪新發現，原報告未涵蓋**）
實測 `POST /api/v1/fan/auth` 回 404「Contact not found」，但同一 contactId 用
authed API 查得到 → 確認被 RLS 擋。**整個粉絲門戶對外功能全掛。**
`apps/api/src/modules/portal/portal-public.routes.ts:36` 的
`const prisma: PrismaClient = app.prisma` → 改 `app.prismaAdmin`。

**修法依據（專案既有慣例）**：`chatbox.routes.ts`、`webchat.routes.ts` 等公開端點
一律用 `prismaAdmin`；`index.ts:185` 註解明載「屬 RLS 白名單基礎設施，用 prismaAdmin
（BYPASSRLS）連線，避免 FORCE 後 fail-closed」。
⚠️ 這些端點自身已有租戶邊界（slug 唯一、fanToken 帶 tenantId、查詢皆帶 tenantId 條件），
改用 prismaAdmin 不會放寬實際可見範圍。

### 1-C ⚠️ 必須與 1-A 同批：targetUrl scheme 白名單
1-A 修好後，`javascript:` 的 targetUrl 會被
`window.location.replace(target)` 與 `<noscript><a href>` 執行 → **變成可利用的儲存型 XSS**。
**順序不可顛倒**：scheme 白名單必須與轉址修復同一個 commit。

---

## 階段 2：P1 — 驗證缺口

| # | 檔案 | 修法 |
|---|---|---|
| 2-1 | `automation.routes.ts:39-41` | `keyword.matched` 具名 schema：`keywords: z.array(z.string().trim().min(1).max(100)).min(1)`、`match_mode: z.enum(['any','all'])` |
| 2-2 | `conversation.routes.ts:131` | `contentType: z.enum([...])`、`content` 依型別做 discriminated union（至少 text 需 `text: z.string().trim().min(1)`） |
| 2-3 | 5 模組 routes | 分頁 `z.coerce.number().int().positive().default(1)`（抄 `contact.routes.ts:24`） |
| 2-4 | `settings` SLA / portal 積分 | 數值加 `.max(2147483647)` 防 Int4 溢位 |
| 2-5 | `shortlink.routes.ts` / `portal.routes.ts` | 補 zod schema（目前全裸轉型）；含 targetUrl `.url()`+scheme、slug 字元集/長度、活動標題 trim+max |
| 2-6 | `tracking` GA4/Pixel | 加 pattern 驗證（`^G-[A-Z0-9]+$` / `^\d+$`）+ max |

### 2-7 前端 P1（分開 commit）
- `GeneralSettings.tsx`：接上真實 API（`PATCH /agents/me/password`、個人資料），
  移除「POC：模擬儲存成功」；密碼門檻 6→8 對齊後端
- `builders.ts:296` LINE 影片 endCard：**先確認產品意圖**（要送還是要移除 UI），
  不自行決定 → 本階段只記錄，不改

---

## 階段 3：P2 — 一致性與體驗

- **3-1 `z.string().min(1)` → `.trim().min(1)`（9 處）**：活動/分群 name、chatBarText、
  素材 name、分類 name、tags、agents name、工單 title/備註/escalate reason、
  聯繫人 displayName、知識庫 title、規則 name
- **3-2 工單分類統一**：抽到 `@open333crm/shared` 單一常數 + 後端 enum
  （⚠️ 需先確認要用哪一套詞彙表 → **待使用者決定，本輪不動**）
- **3-3 `.url()` scheme 白名單（4 處）**：Rich Menu uri、previewImageUrl、
  webhookBaseUrl、**Embedding baseUrl（SSRF 面，優先）**
- **3-4 `/knowledge/search` 冷啟動**：比照同檔 `/bulk-embed:323` 的背景執行處理
- **3-5 system prompt 4 欄位**加 `.max()`（防撐爆 LLM token 預算）
- **3-6 其他**：office-hours 時間語意驗證、SLA 跨欄位邏輯、日期先後檢查

---

## 修復測試計畫

### 原則
**既有 338 個 Wave 6 案例就是驗收標準**，其中 37 個 `test.fail()` 標記的 bug，
修好後 Playwright 會自動轉報 **unexpected pass** → 這就是「修對了」的訊號。

### 每階段驗收步驟
1. `pnpm --filter @open333crm/api exec tsc --noEmit` typecheck
2. 本機起 API 跑冒煙（避免直接動 UAT）
3. 對應 spec 跑 UAT：`npx playwright test --config playwright.uat.config.ts <spec> --project=tenant`
4. **把轉綠的 `test.fail()` 標記移除**（否則下次會報 unexpected pass 噪音）
5. 跑全套 338 案例確認無回歸

### 階段 1 專屬驗收（P0，最重要）
```bash
# 修前（現況）：全 404
for s in w3E7u1 UKw2QC 0pQ6uA; do curl -s -o /dev/null -w "%{http_code} $s\n" https://.../s/$s; done
# 修後預期：302 導向目標網址
# 另驗 /s/track 回 200（非 410）、/api/v1/fan/auth 回 200（非 404）
# XSS 防護：建一筆 targetUrl=javascript:... 的短連結 → 應被 4xx 擋下（不可存入）
```
⚠️ 階段 1 需部署到 UAT 才能端到端驗證；**部署與 push 需另外取得使用者同意**。

### 回歸風險控管
- `prismaAdmin` 改動：確認每個查詢**都仍帶 tenantId 條件**（逐行核對，不可只改 client）
- 分頁 zod：確認前端沒有送 `page=0` 的既有呼叫（先 grep 前端）
- `.trim()` 改動：確認沒有欄位**刻意**允許前後空白（往返測試已證實 padded 應保留值，
  但那是「不被 trim 掉內容」，與「純空白視為空」不衝突）

---

## 不在本輪範圍（需使用者決定）
- 工單分類要統一成哪一套詞彙表
- LINE 影片 endCard：補實作送出 vs 移除 UI
- 工單列表頁是否要加「建立工單」入口
- DB 清理（120 條軟刪規則、12 筆 ENDED 活動）—— 需直接操作 DB
- **push / 開 PR / 部署 UAT —— 一律需明確同意**

---

# 執行結果（2026-09-22 完成）

分支：`fix/wave6-field-validation`（從 `fix/error-messages-i18n` 分出）

## 已完成的 6 項修復

| commit | 修復 | 測試 |
|---|---|---|
| `207da85` | **P0** 短連結轉址 + 粉絲門戶被 RLS 擋（對外功能全掛） | typecheck；端到端待部署 |
| `4a3a0ef` | 分頁 page=0/-1 造成 500（5 模組） | pagination 16 案 |
| `8c52361` | 關鍵字 `['']` 對每則訊息亂回覆 | keyword-trigger 14 案 |
| `c81f590` | 一般設定頁假 UI（改密碼沒接 API） | UAT 端到端實測 |
| `0170eb5` | 必填名稱未 trim（9 模組 / 13 欄位） | trim-validation 17 案 |
| `54aa112` | 網址 scheme 白名單（SSRF + XSS 面） | url-scheme 15 案 |

**新增 4 個測試檔、62 個案例，全綠。**
既有測試（error-messages 17 / agent-automation-guards / a2a-status / llm-system-prompt）全過，無回歸。
apps/api 與 apps/web typecheck 皆 0 error。

## ⚠️ 過程中處理的意外狀況
執行中有外部程序把我的 P0 修復一併 commit 進主題無關的
「模組層 239 則錯誤訊息中文化」（54 檔）。已用 `reset --soft` 拆開：
P0 獨立成 `207da85`（4 檔），其餘以原訊息復原為 `9dd15dd`。
理由：安全修復混在 54 檔的中文化裡會在 review 時被埋沒。

## 🔍 過程中新發現（原報告未涵蓋）
1. **粉絲門戶公開端點同樣被 RLS 擋**（原報告只提短連結）。
   實測 `POST /api/v1/fan/auth` 對存在的 contact 回 404，
   同一 contactId 用 authed API 查得到 → 確認 RLS 阻擋，整個對外門戶失效。
2. **`getActivityResult()` 完全沒有租戶條件**。改走 prismaAdmin 後，
   任何粉絲都能拿活動 id 讀到其他租戶的投票／問卷結果。
   已改為 tenantId 必填參數（這是修 P0 時若沒注意就會引入的新漏洞）。
3. **分頁 500 的第 6 處**：shortlinks 的 `getClickLogs`
   （原本只改列表端點，是新寫的測試抓出來的）。
4. **行銷模組 name 有 3 處而非 2 處**（廣播名稱也是），
   python 的 count 斷言擋下後才發現。

## 全部修復完成（2026-09-23）

### 已完成（12 項）
| 項目 | commit | 測試 |
|---|---|---|
| P0 短連結轉址 + 粉絲門戶被 RLS 擋 | `207da85` | typecheck |
| 分頁 page=0/-1 造成 500（5 模組） | `4a3a0ef` | 16 案 |
| 關鍵字 `['']` 對每則訊息亂回覆 | `8c52361` | 14 案 |
| 一般設定頁假 UI（改密碼沒接 API） | `c81f590` | UAT 實測 |
| 必填名稱未 trim（9 模組 13 欄位） | `0170eb5` | 17 案 |
| 網址 scheme 白名單（SSRF + XSS） | `54aa112` | 21 案 |
| 數值 int4 溢位 500（SLA／積分） | `1c06ec5` | 14 案 |
| 語義搜尋冷啟動連吃 504 | `71f072d` | 8 案 |
| 工單分類四處不一致 | `5d07902` | 10 案 |
| LINE 影片結束畫面（移除 UI） | `d14eb43` | — |
| 工單列表頁加建立入口 | `112cde5` | UAT 實測 |
| 送出訊息零驗證 + LINE 送圖變空白文字 | `f370fb1` | 16 案 |
| 自動化規則刪除／停用分離（CM-170） | `043cd78` | 8 案 |

### 使用者回報（2026-09-23）
| 項目 | commit | 測試 |
|---|---|---|
| Rich Menu 圖片「無法上傳」+ 影片 YouTube 網址播不動 | `d575ed1` | 18 案 |
| 內容有誤時禁用存檔鈕 | `0104d00` | +2 案 |
| 影片可直接上傳 mp4（補上缺的入口） | `95433af` | +3 案 |

### 修復過程中額外發現（原報告未涵蓋）
1. **粉絲門戶公開端點同樣被 RLS 擋**——整個對外門戶失效
2. **`getActivityResult()` 完全沒有租戶條件**——改走 prismaAdmin 後任何粉絲
   都能讀到其他租戶的投票結果（修 P0 時若沒注意就會引入的新漏洞）
3. **分頁 500 的第 6 處**：shortlinks 的 `getClickLogs`（新寫的測試抓出來的）
4. **行銷模組 name 有 3 處而非 2 處**（廣播名稱也是）
5. **工單分類其實有 4 套清單**（後端 `GET /cases/categories` 回傳舊的四項）
6. **LINE 外掛沒有 image / video 分支**——客服傳圖片，客戶收到空白文字訊息
7. **嵌入逾時參數算錯**：第一版 25s × 3 次 = 77s 仍超過 gateway 60s，
   是測試的預算斷言擋下來的，改成 × 2 次 = 51s
8. **broadcast 0 受眾測試紅燈**：非本輪造成，是中文化那輪改了行為沒更新測試

### 尚待處理
- DB 殘留：119 筆 [E2E] 規則可用 `scripts/cleanup-e2e-automation-rules.mjs` 清
  （預設 dry-run，需帶 --apply）；門戶 12 筆 ENDED 活動仍無刪除途徑
- `canvas-flow.test.ts` import vitest 但專案未安裝（既有狀況）
- CM-171/CM-172 兩個 commit 仍只在 `feat/platform-user-management`，未併回 main
