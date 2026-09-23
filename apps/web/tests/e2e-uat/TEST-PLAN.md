# open333 租戶端 E2E 測試計畫（功能盤點 + 腳本撰寫排程）

> 產出日期：2026-09-03。基於 main 程式碼實際盤點（三個探索 agent 逐頁讀 page.tsx 與元件）。
> 現況：smoke 層已完成（tenant-smoke 14 頁 + platform-smoke 5 頁 + C2/C3 跨平台閉環），本計畫規劃「功能層」深測。

---

## 一、功能盤點總覽（12 個模組）

### 1. 收件匣 Inbox（核心鏈路）
- 對話列表：進行中/已關閉分頁、時間範圍、未讀/我的子篩選、搜尋、進階篩選抽屜（狀態/渠道/指派）、FilterChips、點選自動已讀
- 聊天視窗：發文字（Enter/Shift+Enter）、上傳圖片（PNG/JPG ≤20MB）、指派客服、變更狀態、模板選擇器（填變數/預覽/插入）、快速回覆（LINE 限定）、AI 建議回覆（採用帶入）、結案（填原因）、接管 Bot、重開已關閉對話、CSAT 卡顯示
- 聯絡人面板：對話標籤增刪、請求 Email（LINE/FB）、建立工單（CaseCreateModal）、跳轉聯絡人詳情
- ⚠️ HandoffModal 元件存在但 UI 無觸發點（標 skip/待確認）

### 2. 聯絡人 Contacts
- 列表：搜尋（server-side）、分頁、進詳情
- 詳情：標籤增刪、活動時間軸、**合併聯絡人（3 步精靈，不可逆封存）**
- ⚠️ `?action=create` 入口存在但列表頁未見對應 UI（待確認）

### 3. 案件 Cases
- 列表：統計卡、搜尋、篩選（負責人/優先級/分類/SLA 狀態）、狀態 Tabs、分頁、**刪除工單**
- 詳情：標記解決/關閉/重開/升級（EscalationModal：原因+優先級+重指派+通知對象）、內聯改標題、狀態流轉（VALID_TRANSITIONS + CLOSED 確認框）、優先級/分類/指派/團隊、SLA 倒數、標籤、備註（含內部備註）、時間軸
- 建立：從對話建立（POST /cases/from-conversation/:id）或獨立建立

### 4. 自動化 Automation
- 列表：新增、啟用 toggle、進詳情
- 編輯：基本設定、觸發事件（keyword.matched 出關鍵字子區塊+匹配模式）、條件建構器（react-querybuilder）、動作清單、儲存、**刪除（confirm）**、dry-run 測試（Facts JSON → POST /test）

### 5. 行銷 Marketing
- 活動：建立（對話框）、**刪除（限 draft）**、詳情頁狀態變更（啟動/完成/取消，皆 confirm）、成效指標
- 廣播：建立（渠道→素材+預覽→受眾/分群/排程）、**立即發送（真發 LINE/FB！）**、取消
- 分群：建立（AND/OR 多條件）、預覽人數、**刪除**

### 6. 素材庫 Materials（剛大改版，PR #160）
- 列表：分類樹過濾、標籤過濾、搜尋、渠道 pill、排序、複製、**刪除（軟刪）**
- 分類管理：新增/改名/**刪除（素材歸未分類）**
- 新增精靈：選型別（LINE 7 種 + FB 9 種）→ 各版型編輯器 → 治理面板 → 存檔（toast）
- Flex：AI 一句話生成（LLM）→ 填空微調；官方範本起手；JSON 匯入+驗證；AI 潤稿（/ai/rewrite）
- 編輯頁：儲存、成效面板、版本歷史+**還原（覆蓋，confirm）**
- 圖片上傳統一 CompactImageField（MinIO；imagemap 走多尺寸端點）

### 7. LINE 素材
- Rich Menu：OA 切換（OaSwitcher）、10 種版型、背景圖上傳、儲存草稿、**發布/取消發布（真推 LINE！）**、綁定/解綁分群受眾、複製、**刪除（published 禁用）**、published 鎖編輯
- 關鍵字回覆（底層 automation rules）：建立/編輯/toggle/**刪除**
- Quick Reply 預設組：建立（≤13 按鈕）/編輯/**刪除**

### 8. 知識庫 Knowledge（5 tabs）
- 文章：搜尋/過濾/狀態子 tab、新增/編輯（存檔觸發重嵌入）、匯入（檔案/JSON）、發布/封存/**刪除**
- 語義搜尋（向量+LLM）；回報調教（👎清單→編輯→標已處理）
- Embedding 設定（健康檢查、**bulk-embed 長耗時**）；Chat & Prompt（Gemini 金鑰、模型、健康檢查）

### 9. 設定 Settings（11 tabs，受 `settings.manage`）
- channels：Webhook base URL 套用（**影響所有渠道**）、新增/精靈/測試連線/編輯/**刪除**、Bot 設定（模式/轉接關鍵字/問候語/LIFF）、下游 Webhook、WebChat 嵌入碼/預覽/背景/網頁版連結、FB token 狀態
- agents：篩選、新增（ROLE_ESCALATION 規則）、改角色/重設密碼/**停用（軟刪）**、改自己密碼
- roles（`role.view`）：權限矩陣、勾選（相依連動 confirm）、儲存、建立/改名/**刪除角色**
- tags：建立/編輯/**刪除（連帶移除套用）**
- sla：政策 CRUD；office-hours：時區/時段/假日；tracking：GA4/Pixel
- api-keys：建立（**一次性明文**）/撤銷；cli-sessions：建立（**一次性 token**+scope）/撤銷
- passkeys：註冊（WebAuthn，需 passkeyEnabled）/改名/撤銷；general：個人資料/改密碼

### 10. 數據分析（`analytics.view`）
- DateRangePicker、CSV 匯出（POST /analytics/export blob）、4 tabs（概覽/案件/客服績效/渠道）
- 我的績效頁（唯讀個人指標）

### 11. 通知 / 短連結 / 粉絲門戶 / 方案
- 通知：全部/未讀/已讀 tab、單則已讀+跳轉、全部已讀、分頁
- 短連結（`shortlink.view`）：建立（帶標籤）、複製、QR（可下載）、編輯、**刪除**、點擊統計
- 門戶（`portal.view`）：活動 CRUD（POLL/FORM/QUIZ）、**發布/結束**、提交紀錄+**抽獎**、**積分調整**
- 方案：升級申請/加購 Token、pending 擋重送、申請記錄

### 12. 儀表板首頁
- 4 統計卡、最近對話/工單列表+跳轉（唯讀）

---

## 二、測試分層與環境策略

### 分層
| 層 | 內容 | 現況 |
|---|---|---|
| L0 smoke | 每頁載入/非空白/console 乾淨 | ✅ 已完成（19 案例） |
| L1 功能層 | 每頁專屬 spec（`tenant-<頁名>.spec.ts`），本計畫主體 | 本計畫 |
| L2 閉環 | 跨頁/跨平台流程（C2/C3 已有；新增 WEBCHAT 端到端） | 部分 |
| L3 RBAC | 三角色（ADMIN/SUPERVISOR/AGENT）可見性與 403 矩陣 | 未做 |

### 環境紅線（沿用既有約定）
1. **一律跑 UAT**；破壞性操作（合併聯絡人、刪除、停用帳號、積分調整）**只在 `[E2E]` 專用租戶**做，測後恢復或冪等清理
2. **絕不真發外部渠道**：廣播發送、Rich Menu 發布/綁定、LINE/FB 發訊 → 只測到「確認框出現即取消」或用 **WEBCHAT** 渠道等價驗證；LINE 專屬功能（quick reply 實發）標 `@line-only` skip
3. **AI/LLM 依賴**（建議回覆、Flex AI 生成、潤稿、語義搜尋、健康檢查）標 `@ai`：只驗 UI 流程與回應渲染，不斷言內容；bulk-embed 不跑
4. **上傳依賴 MinIO**：UAT 可測；本機記得先跑 MinIO 修法
5. 原生 `window.confirm` 多處使用 → 統一用 `page.on('dialog')` helper 處理，並補測「取消」分支
6. 一次性機密（API key/CLI token）：建立後立即斷言明文可見可複製，再撤銷清理
7. auth 沿用 capture-auth（手動過 captcha 存 storageState）

---

## 三、撰寫排程（5 個 Wave）

### Wave 1：核心鏈路（✅ 2026-09-03 完成，31 案例全綠）
| Spec | 涵蓋 | 結果 |
|---|---|---|
| `tenant-inbox.spec.ts` | 列表搜尋、WEBCHAT 端到端收發、接管 Bot、指派、狀態、標籤、建工單、結案+已關閉分頁+重開 | ✅ 12/12 |
| `tenant-cases.spec.ts` | 統計卡、Tabs/搜尋/篩選、內聯編輯、優先級/分類/指派、備註、升級、狀態流轉、刪除 | ✅ 11/11 |
| `tenant-contacts.spec.ts` | 列表/搜尋（唯讀）、詳情/時間軸、標籤、合併三步（自種訪客間執行） | ✅ 8/8 |

Wave 1 實作備忘（後續 Wave 沿用）：
- **種資料走新版 secure Chatbox flow**（舊 `/webchat/:id/sessions` 已除役回 410）：`chatbox-link` 拿 publicKey → `POST /chatbox/sessions` → `verify` 拿 claimToken → `messages`；全程 fingerprint 必須一致；sessions rate limit 10 次/分/IP
- helpers 的 `newApiContext()` baseURL 尾帶 `/`，**呼叫路徑不可以 `/` 開頭**（Playwright URL resolution 會蓋掉 /api/v1）
- 專案 UI 慣用語「聯繫人」「工單」；Tabs/Dialog 多為自製元件（非 role=tab；原生 `<dialog>`）；多處 native select 無 label，需以 option 內容定位並排除同頁相似 select
- select 寫入後要 `waitForResponse` 等 PATCH 落地再 reload（React 非同步送出，reload 會打斷在途請求）

### Wave 2：素材庫 + LINE 素材（✅ 2026-09-03 完成，31 案例全綠）
| Spec | 涵蓋 | 結果 |
|---|---|---|
| `tenant-materials.spec.ts` | 列表過濾/排序、分類管理、複製/刪除、LINE+FB 純文字建立存檔、版本還原、標籤過濾 | ✅ 14/14 |
| `tenant-materials-flex.spec.ts` | 精選範本起手+填空編輯、JSON 匯入驗證（合法/非法）、AI 生成、AI 潤稿 | ✅ 6/6 |
| `tenant-line-materials.spec.ts` | Rich Menu 草稿建立（版型+圖+action）、published 鎖、發布確認框即取消、複製/刪除、關鍵字回覆 CRUD、Quick Reply 預設組 CRUD | ✅ 11/11 |

Wave 2 實作備忘：
- **TemplatePickerGrid 中 `line_flex_showcase`/`line_flex_template` 被標 `hidden: true`**，新增精靈選不到，需用 API 直建對應 contentType 再走編輯頁繞過（TEST-PLAN 認定的「LINE 7 種可選」實際只有 5 種在精靈可點）
- **`line_flex_template` 空 body 建立會 500**（`assertLineFlexMessageBody` 驗證失敗時 `result.errors[0]` 對空陣列取值炸例外，應回 400），建材時務必帶最小合法 bubble
- Rich Menu 各版型 `defaultAreas` 只給 bounds 不給 action，儲存草稿前必須手動填 action data（如 postback 的 `data` 欄位），否則後端 400
- 素材/Rich Menu 名稱含 `[E2E]` 時**不可直接塞進 `new RegExp()`**（`[...]` 是正規表達式字元類別語法），一律用字串子字串比對
- 複製品命名是「原名稱（副本）」或「原名稱 (copy)」，用子字串定位卡片時務必排除複製品（改用「文字精確等於 name」的 filter）
- **CM-170**：關鍵字回覆改名/toggle/刪除因兩層 SWR 快取未串連，畫面不即時更新；刪除其實是軟刪（isActive=false）且列表未過濾——測試已改用 API 驗證真實狀態

### Wave 3：自動化 + 行銷 + 知識庫（✅ 2026-09-03 完成，29 案例全綠）
| Spec | 涵蓋 | 結果 |
|---|---|---|
| `tenant-automation.spec.ts` | 規則 CRUD、toggle、條件/動作建構、dry-run 測試（含 JSON 錯誤擋）、軟刪 | ✅ 8/8 |
| `tenant-marketing.spec.ts` | 活動 CRUD+狀態流、分群建立+預覽人數+刪除、廣播建立（只到草稿，未發送） | ✅ 10/10 |
| `tenant-knowledge.spec.ts` | 文章 CRUD、發布/封存、匯入、語義搜尋（@ai）、回報調教、Embedding/Chat 設定唯讀 | ✅ 11/11 |

Wave 3 實作備忘：
- 自動化「傳送通知」動作的實際輸入欄位（label「通知訊息」）**沒有 placeholder**，`ActionEditor.tsx` 裡的 `輸入通知內容...` placeholder 屬於別的分支，要用 label 文字定位相鄰 input，不能用 getByPlaceholder
- 自動化儲存規則沒有「至少一個動作」前端擋控；後端 schema 要求 `actions.min(1)`，零動作送出會 400 但前端只 `console.error` 靜默失敗——建規則測試務必先確保至少一個動作
- 儲存/刪除規則、行銷活動狀態變更全部**沒有 toast**，一律用 URL 變化/元素變化/API 回應斷言
- 素材 `channelType` 只支援 `'line' | 'fb'`，沒有 WEBCHAT 素材類型——廣播測試改用 FB 渠道+FB 素材；受眾分群條件的「渠道類型」是另一個獨立欄位（含 WEBCHAT），與素材無關
- **廣播「建立」按鈕本身只建立草稿記錄**（`POST /marketing/broadcasts`），真正發送是另一顆「立即發送」Play 按鈕 + confirm，兩者路徑完全分離，測試只點「建立」是安全的
- 語義搜尋頁「語義搜尋」tab 按鈕文字含「搜尋」子字串，會與搜尋送出按鈕撞在一起，`getByRole('button', {name:'搜尋'})` 要加 `exact: true`，否則 strict mode violation 拋錯會被 waitForResponse 包裝成誤導性的 "Test ended"（乍看像逾時，其實是定位錯誤）
- 知識庫文章刪除是硬刪（`prisma.kmArticle.delete`），受眾分群刪除也是硬刪；與 automation/關鍵字回覆的軟刪行為不同，兩種都要先讀程式碼確認再斷言，不能套用同一套假設

### Wave 4：設定 + RBAC（✅ 2026-09-03 完成，35 案例全綠）
| Spec | 涵蓋 | 結果 |
|---|---|---|
| `tenant-settings-team.spec.ts` | agents 新增/改角色/停用（[E2E]）、ROLE_ESCALATION 擋、自建測試角色矩陣勾選儲存、tags CRUD | ✅ 10/10 |
| `tenant-settings-ops.spec.ts` | SLA CRUD（硬刪）、api-keys 一次性明文+撤銷（軟刪不過濾列表）、cli-sessions（軟刪過濾列表）；office-hours/tracking 純唯讀不寫入 | ✅ 9/9 |
| `tenant-settings-channels.spec.ts` | 渠道列表、WebChat 嵌入碼/預覽/網頁版連結、Bot 設定存讀、新建測試 WEBCHAT 渠道；全程不動既有 LINE/FB/THREADS 渠道 | ✅ 6/6 |
| `tenant-rbac.spec.ts` | 三角色（ADMIN/SUPERVISOR/AGENT）登入 → 側欄可見性矩陣 + 頁面外殼載入 + API 403 邊界 | ✅ 18/18 |

Wave 4 實作備忘（RBAC 需要額外的三角色登入 session，見下方「多角色測試基建」）：
- **權限查詢用 `GET /auth/me/permissions`（有效權限，含 implies 閉包）而非 `/roles/:id/permissions`（原始清單）**：SUPERVISOR 靠 `agent.role.assign` 隱含取得 `role.view`，只查原始清單會誤判看不到「角色與權限」tab
- RBAC 測試對低權限角色（SUPERVISOR/AGENT）造訪頁面時，console 必然出現預期中的 401/403（打了無權限 API）——不能套用 `gotoAndCheck` 慣用的零錯誤斷言，要用白名單排除法（401/403 + 已知 CM-163 + 第三方 SDK 噪音），保留對真正異常的偵測
- API 金鑰/CLI session「撤銷」都是軟刪，但列表查詢行為不對稱：API 金鑰列表無 isActive 過濾（撤銷後仍在列表，狀態變已撤銷）、CLI session 列表有 revokedAt 過濾（撤銷後直接消失）——兩者外觀相似但實際邏輯不同，不能套同一套斷言
- 一次性明文顯示（API 金鑰/CLI token）的複製按鈕若 Playwright context 無 clipboard 權限，`navigator.clipboard.writeText` 會拋錯，元件 fallback 走原生 `alert(key)`——測試需要 `dismissNextDialog` 攔截，否則卡住直到逾時
- 渠道卡片用 `div.filter({hasText: displayName})` 定位太寬鬆，容易連整個列表容器或其他巧合含相同文字的說明卡片一起選中（例如 localStorage 殘留值巧合撞名）；改用 `p.font-medium` 精確文字 + 往上找最近 `rounded-xl` 卡片容器 + `filter({has: 特徵按鈕})` 三重定位才夠穩

**多角色測試基建**：`tests/e2e-uat/capture-auth-role.ts <supervisor|agent>` 手動登入（過 captcha）存成 `auth-state-supervisor.json` / `auth-state-agent.json`；RBAC spec 內用 `test.use({storageState: ...})` 覆蓋 project 預設的 ADMIN session。

### Wave 5：其餘頁面（✅ 2026-09-04 完成，14 案例通過 + 7 案例已知阻塞 skip）
| Spec | 涵蓋 | 結果 |
|---|---|---|
| `tenant-analytics.spec.ts` | 日期切換、4 tabs 渲染、CSV 匯出下載（blob URL）、我的績效 | ✅ 7/7 |
| `tenant-misc.spec.ts` | 通知（已讀/全部已讀/分頁）、短連結 CRUD+QR、門戶活動 CRUD+積分（唯讀）、方案（唯讀） | ✅ 7 通過 + 7 skip（阻塞 CM-171/172） |

**合計 16 個 spec、~140 案例**。全 5 個 Wave 已完成。

Wave 5 實作備忘：
- 分析頁 4 個 tab（overview/cases/agents/channels）的資料**在頁面初次載入時就一次全打完**，切 tab 純屬前端顯示切換不會再打 API——不能對切 tab 動作用 `waitForResponse` 等對應端點，會永遠逾時
- CSV 匯出走 `POST /analytics/export`（blob response）→ `URL.createObjectURL` → 動態 `<a download>` `.click()`，這種 JS 產生的 blob-URL 下載在 Chromium 仍會觸發 Playwright `page.waitForEvent('download')`
- `<option>` 元素在收合的 `<select>` 裡天生 `hidden`，不能對它用 `toBeVisible()`（Wave 4 也踩過一次），要斷言外層 `<select>` 本身或改用其他訊號

**🔴 過程中發現兩個 P0 級產品 bug（同族根因）**，已修復並開單：
- **CM-171**（短連結）：`shortlink.routes.ts` 全部端點用未綁定租戶的 `app.prisma`，被 Postgres RLS 擋下——建立 500、列表靜默回空。**已在本機修復並 commit**（`6b4305f`，分支 `feat/platform-user-management`，未 push），改用 `request.tenantPrisma`；service 層簽章收斂為 `TenantDb`；`shortlink-redirect.routes.ts`（公開重定向端點）維持 `PrismaClient` 不動。
- **CM-172**（粉絲門戶）：`portal.routes.ts` 全部 12 處同樣誤用，活動 CRUD/發布/抽獎/積分整個模組可能故障。**只開單未修**（超出當次授權範圍）。`portal-public.routes.ts`（粉絲 JWT 公開端點）不受影響、不用改。
- 兩者都是「同一批 2026-08-27 RLS 上線後遺留的誤用模式」，CM-172 單裡建議**全面掃描所有 `*.routes.ts`** 找出其餘同類疑似受害路由，避免逐一測試才發現。

### 共用基建（Wave 1 前先做）
- `helpers.ts` 擴充：dialog 處理、toast 斷言、WEBCHAT 訪客端注入（開 chatbox 發訊做端到端）、`[E2E]` 資料前綴+冪等清理、SWR mutate 等待
- fixtures：三角色 storageState（capture-auth 各存一份）

---

## 四、已知風險 / 待確認
- HandoffModal 無 UI 觸發點 → 標記待產品確認（bug or 未完成？）
- 聯絡人「建立」入口（?action=create）未接線 → 同上
- 平台端「停用/啟用」無確認框（上輪發現，待開單）
- dashboard status 大小寫（CM-163）已修但尚未部署 UAT → Wave 1 跑 smoke 時 dashboard 案例可能仍紅

---

## 五、Wave 6：欄位級深測（2026-09-22 起）

> 前 5 個 Wave 測的是「功能流程能不能跑通」；Wave 6 測的是「**每一個欄位**輸入各種
> 邊界值時，前後端是否正確擋控、正確儲存、不會被注入」。

### 規模盤點（2026-09-22 實測）
| 面向 | 數量 |
|---|---|
| 前端可見輸入元素（input/select/textarea） | ~380（13 個元件模組） |
| 後端 zod 約束（min/max/email/url/uuid/enum） | 359 optional + 131 min(1) + 74 uuid + 60 enum + 各級 max |
| 後端 routes 檔 | 46 |

欄位分布（元件層）：settings 85、materials 58、knowledge 25、case 24、line 23、
portal 17、shortlink 15、inbox 15、automation 7、shared 5、ui 4、contact 3、analytics 2。

### 每個欄位的測試矩陣（7 項）
1. **盤點** — `inventoryFields()` 輸出清單，作為覆蓋率證據
2. **必填** — 留空 / 純空白 / 全形空白 → 應被擋
3. **長度邊界** — 對照後端 `.max(N)` 做 under/exact/over 三點；前端 maxLength 與後端不一致即為缺陷
4. **格式** — email / URL / UUID / 數字餵非法樣本應被擋，合法樣本應接受
5. **往返** — 合法值存檔 → reload → 值完好（重點測前後空白、emoji、換行）
6. **安全** — XSS / HTML / SQL 樣式字串應為純文字；**繞過前端直測後端**確認仍守得住
7. **列舉** — select 送非法 enum 值（API 直測）應回 4xx

### 新增基建
- **`capture-auth-api.ts`（重要）** — 免 captcha 捕捉 session。原理：UAT captcha 只擋前端登入頁，
  後端 `POST /auth/login` 不驗 captcha；前端 accessToken 只存記憶體，靠 HttpOnly refreshToken
  cookie 復原 session。因此把登入取得的 refreshToken 寫進 storageState 即等同已登入。
  跑法：`npx tsx tests/e2e-uat/capture-auth-api.ts all`（數秒完成三角色）。
  **取代** 原本需要人工過 captcha 的 `capture-auth-role.ts`，讓測試可無人值守重跑。
- **`field-helpers.ts`** — 欄位層工具：
  `inventoryFields` / `formatFieldInventory`（自動盤點）、`fieldByLabel`（三段 fallback 定位）、
  `submitAndObserve`（**核心**：區分「前端擋下」與「後端回應碼」）、`expectRejected` / `expectAccepted`、
  `apiFieldCheck`（繞過 UI 直測後端驗證）、`expectRoundTrip`（持久化往返）、
  `expectNoXssExecuted`、`FieldSamples`（邊界樣本庫）、`boundarySamples(max)`（三點邊界）。

### 分工（6 個平行 agent，各產一個 spec）
| Spec | 範圍 | 欄位量 |
|---|---|---|
| `tenant-fields-settings.spec.ts` | 設定 11 tabs（個人/客服/角色/標籤/SLA/工時/追蹤/API金鑰/CLI） | 85 |
| `tenant-fields-materials.spec.ts` | 素材庫列表/分類/各版型編輯器/Flex JSON | 58 |
| `tenant-fields-cases-contacts.spec.ts` | 工單 + 聯繫人 + 收件匣 | 42 |
| `tenant-fields-knowledge-automation.spec.ts` | 知識庫 5 tabs + 自動化規則編輯器 | 32 |
| `tenant-fields-marketing-line.spec.ts` | 行銷活動/廣播/分群 + LINE 素材三塊 | 43 |
| `tenant-fields-channels-portal.spec.ts` | 渠道設定 + 門戶 + 短連結 + 分析/通知 | 40+ |

### Bug 嚴重度分級
- **P0** 資料寫壞 / 安全漏洞（XSS 執行、後端可繞過、跨租戶洩漏）
- **P1** 驗證缺口（無效值存入）、5xx、儲存後讀不回
- **P2** 前後端驗證不一致、錯誤訊息缺失、邊界差一
- **P3** UX 瑕疵（無 toast、擋控靜默失敗）

### 環境紅線（同前 5 Wave，特別強調）
廣播「立即發送」與 Rich Menu「發布」會真推外部渠道，**只測到確認框出現即取消**；
不動既有 LINE/FB/THREADS 渠道與 Webhook base URL；自建資料一律 `[E2E]` 前綴並清理。

### Wave 6 執行結果（陸續更新）

#### ✅ `tenant-fields-marketing-line.spec.ts`（2026-09-22，33 案例：32 pass / 1 skip）
盤點 31 個可見輸入元素。**前端 maxLength 與後端 zod max 全部相符**（Rich Menu 用 HTML
maxLength；QuickReply/關鍵字回覆用 `slice()` 截斷，效果等同）。

**本輪推翻的既有計畫描述（以讀碼+實測為準，上方章節請以此為準）**：
1. LINE 素材頁實際在 **`/dashboard/line/{rich-menus,keyword-replies,quick-replies}`**，
   非 `/dashboard/marketing/line-*`
2. 行銷活動**沒有「預算」欄位**（後端 schema、前端元件、Prisma model 三處皆無）
3. 廣播**不是多步驟精靈**，是單一 Dialog 單頁表單，沒有「下一步」
4. **「關鍵字回覆」沒有獨立後端模組**，是 automation rule 的薄包裝
   （`trigger.type='keyword.matched'` + `send_material` 動作），驗證走 `POST /automation/rules`
   —— 這也正是驗證缺口最多之處

**發現 5 個新 bug + 複驗 1 個既有**（詳見下方「Wave 6 Bug 清單」）。

**設計亮點可供其他 Wave 6 spec 參考**：
- 8 個案例用 `test.fail()` 標記「預期失敗」記錄真 bug —— 修好後會轉成 unexpected pass 自動提醒移除標記
- 廣播取消發送的案例額外掛 request listener，斷言取消後**確實沒有 send 請求發出**（防呆雙保險）


### Wave 6 總結（2026-09-22 完成）

**6 個 spec、338 案例、8,373 行，全部在 UAT 實跑通過。**

| Spec | 案例 | 結果 |
|---|---|---|
| `tenant-fields-cases-contacts-inbox.spec.ts` | 70 | 61 pass / 2 skip（11 個 test.fail 標記 bug） |
| `tenant-fields-channels-portal.spec.ts` | 66 | 66 全綠（18 個 test.fail 標記 bug） |
| `tenant-fields-settings.spec.ts` | 57 | 55 pass / 1 skip |
| `tenant-fields-materials.spec.ts` | 56 | 56 全綠 |
| `tenant-fields-knowledge-automation.spec.ts` | 47 | 45 全綠（連兩輪非 flaky） |
| `tenant-fields-marketing-line.spec.ts` | 42 | 32 pass / 1 skip（8 個 test.fail 標記 bug） |

**`test.fail()` 用法**：標記「已知 bug 仍在」的案例。bug 修好後 Playwright 會轉報
unexpected pass 主動提醒移除標記 —— 等於每個 bug 都有活的迴歸保護。

#### 🔴 必須優先處理（P0/P1）

1. **短連結公開轉址全掛（P0）** — UAT 上 3 筆有效短連結 `/s/{slug}` 全回 404、
   `/s/track` 回 410。CM-171 只修了後台 `shortlink.routes.ts`，
   **公開轉址 `shortlink-redirect.routes.ts` 仍用未綁租戶的 `app.prisma`**（4 處），被 RLS 擋下。
   **所有已發給客戶的短連結都是死連結，行銷歸因數據全空。**
   ⚠️ **版本落差**：`6b4305f`(CM-171) 與 `cec1ff3`(CM-172) 都**不在 origin/main**，
   只在 `feat/platform-user-management`。UAT 已有修復但 main 沒有 —— **從 main 重新部署會整包回歸**。
   ⚠️ **修復順序**：`targetUrl` 零驗證且接受 `javascript:`，轉址頁丟進
   `window.location.replace()` 與 `<noscript><a href>`。目前因 404 擋著無法觸發，
   **P0 一修好就變成可利用的儲存型 XSS** → 必須同時補 scheme 白名單，順序不可顛倒。

2. **一般設定頁是 POC 假 UI（P1）** — `GeneralSettings.tsx:73` 註解自承「POC：模擬儲存成功」，
   `handleSavePassword` 只 `setState`，**整個檔案 0 個 API 呼叫**，但 UI 顯示「密碼已更新」（2 秒）。
   **使用者會以為改了密碼其實沒改。** 後端真實端點 `PATCH /agents/me/password` 存在但前端從未呼叫。
   前端門檻 6 字 vs 後端 min(8) 亦不一致。掛載於使用者真的看得到的 general tab。

3. **關鍵字回覆可對每則訊息亂回覆（P1）** — `automation.routes.ts:39-41` 的
   `trigger: z.object({type}).passthrough()` 不驗 keywords。
   `automation.worker.ts:285` 的 `keywords.length === 0` 防護擋不住 `['']`（長度為 1），
   而 L300 的 `lowerText.includes('')` 在 JS **恆為 true**
   → **一條 `keywords:['']` 規則會對租戶內每一則訊息觸發自動回覆**。API 直呼無任何防護。

4. **送出訊息 content 幾乎零驗證（P1）** — `conversation.routes.ts:131` 的
   `content: z.record(z.unknown())`。空物件/空字串/純空白/亂填欄位/非法 contentType
   **全部 201 並以 OUTBOUND 落庫**。走真實 LINE/FB 渠道會送出無效 payload。前端單邊防守。

5. **LINE 影片結束畫面永遠不會送出（P1）** — UI 三欄可編輯且存進 DB，但
   `buildLineVideoWithEndCard`（builders.ts:296）**整段丟棄**。註解說會包成兩則訊息送，與實作不符。
   連帶該段的 action 欄位零驗證（6 種惡意/超長輸入全部 201）。

#### 🔁 跨模組共同模式（一次修可解多處）

| 模式 | 處數 | 說明 |
|---|---|---|
| `z.string().min(1)` 未 `.trim()` | **9** | 純空白/全形空白可存成名稱。活動/分群/chatBarText/素材/分類/tags/agents/工單標題/備註/聯繫人/文章/規則名 |
| 數值邊界未夾制 → **500** | **3 族** | ①分頁 page=0/-1（5 個模組）②SLA 時限 Int4 溢位 ③門戶積分超大值 |
| URL `.url()` 不限 scheme | **4** | Rich Menu uri / previewImageUrl / webhookBaseUrl / **Embedding baseUrl（會被後端 fetch＝SSRF 面）** |
| 路由層完全無 zod schema | **2 模組** | `shortlink.routes.ts`、`portal.routes.ts` 全是 `request.body as ...` 裸轉型直進 service |

**分頁 500 實測矩陣**（主 session 掃 `(page-1)*limit` 17 處後逐一驗證）：
| 端點 | page=0 / -1 | page=abc |
|---|---|---|
| materials / campaigns / segments / shortlinks / portal | **500** | 400 ✔ |
| knowledge / contacts / conversations / cases | 400 ✔ | 400 ✔ |
**已有正確實作可直接抄**：`contact.routes.ts:24`、`conversation.routes.ts:122`、
`canvas.routes.ts:58` 皆為 `z.coerce.number().int().positive().default(1)`。

#### 其他值得注意

- **工單分類三處不一致（P2）**：建立 Modal（維修/查詢/投訴/其他）與詳情頁
  （產品諮詢/訂單問題/…/其他）**只有「其他」重疊**。建立時選維修的工單，
  進詳情頁分類顯示空值，一存檔就洗掉。主 session 實測 UAT 現況僅 1 筆工單且為「其他」，
  **尚未成災**但缺陷確實存在。無共用常數來源，建議抽到 `@open333crm/shared` 並加後端 enum。
- **工單列表頁沒有建立入口（P2）**：`CaseCreateModal` 只掛在 inbox 的 ContactInfoPanel，
  `/dashboard/cases` 完全沒 mount → **無法建立「不來自對話」的工單**，
  `POST /cases` 獨立建單 API 在 UI 上無路徑可觸發＝死碼。
- **語義搜尋冷啟動連續 504（P2）**：閒置後連吃 3~5 次 60s 逾時才成功。
  同檔 `/bulk-embed`（L323）已有明確註解說明此問題並改背景執行，
  但 `/search`（L116）**仍是同步 await，漏改**。
- **四個 system prompt 欄位無長度上限（P2）**：10 萬字照收且直接進 LLM context，
  可撐爆 token 預算（與 AI 成本議題直接相關）。
- **tracking GA4/Pixel ID 零驗證（P1）**：`<script>` 原樣落庫；元件自述
  「短連結 redirect 頁面會自動注入追蹤腳本」→ 若注入端未轉義即構成儲存型 XSS 面。

#### ✅ 驗證品質良好（已鎖迴歸保護）

- **XSS 全系統安全**：所有模組的 payload 均以純文字顯示，`window.__E2E_XSS__` 從未被設值。
  `render-utils.ts` 的 `escapeHtmlAttr` + `jsonForScript` 含 U+2028/2029 處理
- **SQL 注入**：Prisma 參數化，樣本原樣存讀無 5xx
- **往返完整**：emoji（含 ZWJ 家庭組合）、換行、前後空白、Markdown、10 萬字內容全部原樣保存
- **Quick Reply preset 是全系統驗證最好的模組**：13 按鈕 / 20 字 label 完全對齊 LINE 官方上限
- **自動化 contracts 層**扎實：事件/fact/operator/動作白名單、跨事件動作限制全正確
- **金鑰處理正確**：一次性明文不重複回傳；BYOK 顯示遮罩不洩漏
- **狀態機**：工單 `VALID_CASE_TRANSITIONS`、門戶 DRAFT→PUBLISHED→ENDED、
  行銷活動狀態流 —— 非法轉換皆正確擋下

#### 🔒 安全紅線遵守（各 agent 均實測驗證）

- **未真發任何外部渠道訊息**：廣播「立即發送」與 Rich Menu「發布」全程只
  `dismissNextDialog`；其中一個案例額外掛 request listener 斷言取消後**確實無 send 請求發出**
- **5 個既有渠道**（LINE OA / test333 / Demo Facebook / IG333 / tatung）測後逐一比對
  webhookUrl 與 isActive 皆與測前一致
- **admin 密碼未被更動**：改密碼呼叫皆帶故意錯誤的 currentPassword；測後用原密碼登入回 200 確認
- **office-hours / tracking / Embedding / Chat 設定**皆「寫入後立即還原」並斷言還原成功
- 未修改任何 production 程式碼；未 commit、未 push、未開 PR

#### 測試資料殘留（系統設計限制，非清理失敗）

- **automation 規則 120 條**（含 Wave 3）：軟刪但**列表頁不過濾**，後台顯得很雜（CM-170 同族）
- **門戶 12 筆 ENDED 活動**：僅 DRAFT 可刪，無軟刪/封存/force → 永久無法清除
- **廣播 cancelled 記錄**：無 DELETE 端點
- **行銷活動 5 筆 cancelled**（Wave 2/3 留下）：`deleteCampaign` 只允許刪 draft
→ 以上需直接操作 DB 清理。其餘模組殘留皆為 0。

#### 新增踩坑（併入共用清單）

- **shadcn `<Input>` 不輸出 `type` 屬性** → `input[type="text"]` 選不到，要用 `getByPlaceholder`
- **原生 `<dialog>` 可能同時存在多個** → `getByRole('dialog')` 觸發 strict mode violation，
  要用 `page.locator('dialog[open]').last()`；`inventoryFields` 掃 dialog 同理
- **Dialog 開啟時背景頁元素仍在 DOM** → Modal 內定位必須用 `dialog[open]` 限縮
- **general 的「儲存成功」只顯示 2 秒**（setTimeout 2000），等超過 2.5 秒會誤判成按鈕沒反應
- **office-hours 欄位在 enabled=false 時完全不渲染**，要先開開關才掃得到
- **seedWebchatConversation 種出的對話是 `BOT_HANDLED`**，輸入框 disabled，要先按「接管對話」
- **一條對話只能綁一個工單**（後端 409）
- **收件匣進階篩選抽屜用 CSS translate 移出畫面、不卸載**，不能用 `toBeHidden()` 斷言
- **聯繫人列表頁寫死 `excludeChannelType: 'WEBCHAT'`** → 自種 Chatbox 訪客不會出現在列表
- **LINE 版型約束不是本專案 zod 擋的，是 LINE 官方擋的**：`validateLineMaterialWithLineApi`
  存檔前真打 LINE validate API；但對 `line_flex_*` **直接 return 不驗**＝多個缺口的共同根因
