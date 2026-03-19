# Jira 建立指南 / Jira Ticket Structure

> 對應 PROJECT_PLAN.md，直接照此建立。
> v2.0 — 改用功能導向 Epic（Feature-based），非里程碑導向。

---

## Jira 標準層次說明

```
Epic
  ├── 定義：一個用戶可感知的完整功能模組，跨多個 Sprint
  ├── 命名：從「業務/用戶角度」，例如「統一收件匣」「案件管理」
  └── 不是：里程碑（Milestone）、技術任務（DB 建置）

Story（使用者故事）
  ├── 定義：一個 Sprint 內可完成的功能需求
  ├── 格式：「作為 [角色]，我希望 [做什麼]，以便 [達到什麼目的]」
  └── 例：「作為客服人員，我希望看到統一收件匣，以便處理多渠道訊息」

Sub-task（子任務）
  ├── 定義：Story 的技術實作細節，有明確負責人和工時
  └── 例：「[BE-A] LINE Webhook 驗簽邏輯，4h」
```

---

## 專案設定 / Project Setup

```
專案類型：Scrum
專案名稱：open333CRM
Sprint 長度：2 週
Story Point：建議 1pt = 半天
```

### Label 建議

```
角色：be-a  be-b  fe-a  fe-b  ux  pm
優先：critical  high  medium  low
狀態：needs-design  needs-api-spec  blocker  bug
```

---

## Epic 清單（功能導向）

| Epic Key | Epic 名稱 | 類型 | 涉及 Sprint |
|----------|-----------|------|-------------|
| EP-INFRA | ⚙️ 基礎建設（技術）| Technical | S1 |
| EP-INBOX | 📥 統一收件匣 | Feature | S1–S2 |
| EP-CASE | 📋 案件管理 | Feature | S3 |
| EP-CONTACT | 👤 聯繫人管理 | Feature | S4 |
| EP-AUTO | ⚡ 自動化規則 | Feature | S4 |
| EP-MKT | 📣 行銷廣播 | Feature | S5 |
| EP-BOT | 🤖 Bot & 智慧助手 | Feature | S6 |
| EP-ANALYTICS | 📊 報表分析 | Feature | S6 |
| EP-CHANNEL | 🔌 渠道設定 | Feature | S1–S2 |
| EP-PORTAL | 🎉 Fan Portal | Feature | S7–S8 |
| EP-TRACKING | 🔗 短連結追蹤 | Feature | S7 |
| EP-UX | 🎨 UX 設計（技術前置）| Design | W0 |

---

## 📄 Epic ↔ 參考文件對照表

> 每個 Jira Story/Sub-task 的「Description」欄位請附上對應文件連結，
> 讓執行者直接查閱規格，不用開口問。

| Epic | Story 主題 | 參考文件 |
|------|-----------|---------|
| EP-UX | 後台設計稿 | [17_UI_WIREFRAMES.md](./17_UI_WIREFRAMES.md)、[02_SYSTEM_ARCHITECTURE.md](./02_SYSTEM_ARCHITECTURE.md) |
| EP-UX | Design System | [17_UI_WIREFRAMES.md](./17_UI_WIREFRAMES.md) |
| EP-UX | Fan Portal 設計 | [22_FAN_PORTAL.md](./22_FAN_PORTAL.md) |
| EP-INFRA | DB Schema | [16_DB_SCHEMA.md](./16_DB_SCHEMA.md) |
| EP-INFRA | OpenAPI / MSW | [09_API_DESIGN.md](./09_API_DESIGN.md) |
| EP-INFRA | Docker / CI | [10_TECH_STACK.md](./10_TECH_STACK.md)、[02_SYSTEM_ARCHITECTURE.md](./02_SYSTEM_ARCHITECTURE.md) |
| EP-INBOX | LINE Plugin | [03_CHANNEL_PLUGIN.md](./03_CHANNEL_PLUGIN.md)、[13_CHANNEL_BINDING.md](./13_CHANNEL_BINDING.md) |
| EP-INBOX | FB Plugin | [03_CHANNEL_PLUGIN.md](./03_CHANNEL_PLUGIN.md)、[13_CHANNEL_BINDING.md](./13_CHANNEL_BINDING.md) |
| EP-INBOX | WebChat Plugin | [03_CHANNEL_PLUGIN.md](./03_CHANNEL_PLUGIN.md) |
| EP-INBOX | 收件匣 UI | [17_UI_WIREFRAMES.md](./17_UI_WIREFRAMES.md)、[09_API_DESIGN.md](./09_API_DESIGN.md) |
| EP-INBOX | Auth 登入 | [09_API_DESIGN.md](./09_API_DESIGN.md) |
| EP-CHANNEL | 渠道綁定 | [13_CHANNEL_BINDING.md](./13_CHANNEL_BINDING.md)、[03_CHANNEL_PLUGIN.md](./03_CHANNEL_PLUGIN.md) |
| EP-CASE | Case 狀態機 | [04_CASE_MANAGEMENT.md](./04_CASE_MANAGEMENT.md)、[09_API_DESIGN.md](./09_API_DESIGN.md) |
| EP-CASE | 指派系統 | [04_CASE_MANAGEMENT.md](./04_CASE_MANAGEMENT.md) |
| EP-CASE | SLA 監控 | [04_CASE_MANAGEMENT.md](./04_CASE_MANAGEMENT.md)、[20_NOTIFICATION.md](./20_NOTIFICATION.md) |
| EP-CASE | Case UI | [17_UI_WIREFRAMES.md](./17_UI_WIREFRAMES.md) |
| EP-CONTACT | Contact 管理 | [05_CONTACT_AND_TAG.md](./05_CONTACT_AND_TAG.md)、[16_DB_SCHEMA.md](./16_DB_SCHEMA.md) |
| EP-CONTACT | 標籤系統 | [05_CONTACT_AND_TAG.md](./05_CONTACT_AND_TAG.md) |
| EP-AUTO | Automation Engine | [06_AUTOMATION_AND_EVENT.md](./06_AUTOMATION_AND_EVENT.md) |
| EP-AUTO | Automation UI | [06_AUTOMATION_AND_EVENT.md](./06_AUTOMATION_AND_EVENT.md)、[17_UI_WIREFRAMES.md](./17_UI_WIREFRAMES.md) |
| EP-MKT | 受眾分群 | [08_MARKETING.md](./08_MARKETING.md) |
| EP-MKT | Flex 模板 | [12_TEMPLATE_AND_STORAGE.md](./12_TEMPLATE_AND_STORAGE.md) |
| EP-MKT | 廣播發送 | [08_MARKETING.md](./08_MARKETING.md)、[09_API_DESIGN.md](./09_API_DESIGN.md) |
| EP-BOT | Bot & 接管 | [18_BOT_AUTOROUTER.md](./18_BOT_AUTOROUTER.md) |
| EP-BOT | CSAT | [19_CSAT_FLOW.md](./19_CSAT_FLOW.md) |
| EP-ANALYTICS | 報表 | [21_ANALYTICS_DASHBOARD.md](./21_ANALYTICS_DASHBOARD.md) |
| EP-ANALYTICS | 通知系統 | [20_NOTIFICATION.md](./20_NOTIFICATION.md) |
| EP-ANALYTICS | License / Plan | [14_BILLING_AND_LICENSE.md](./14_BILLING_AND_LICENSE.md) |
| EP-PORTAL | Fan Portal 全部 | [22_FAN_PORTAL.md](./22_FAN_PORTAL.md) |
| EP-TRACKING | 短連結追蹤 | [23_SHORT_URL_TRACKING.md](./23_SHORT_URL_TRACKING.md) |

---

## EP-UX — UX 設計（W0，Pre-sprint）

```
Story: Admin 後台設計稿
  [UX] Inbox / 收件匣 + 對話視窗                         1d
  [UX] Case 列表 + 詳情頁                                 0.5d
  [UX] Contact 詳情頁                                     0.5d
  [UX] Automation 規則建立頁                              0.5d
  [UX] 行銷廣播 Wizard                                    0.5d
  [UX] Channel 設定頁                                     0.5d
  [UX] Analytics 儀表板                                   0.5d
  [UX] Plan & Usage 頁                                    0.5d

Story: Design System
  [UX] Design Tokens（色票 / 字型 / 間距）                1d
  [UX] 共用元件規範（Button / Badge / Table / Modal）      1d
  [UX] Figma → FE Handoff（Dev Mode）                     0.5d

Story: Fan Portal 設計（可延至 W3）
  [UX] 投票活動頁                                         1d
  [UX] 會員中心 + 商城                                    1d
```

---

## EP-INFRA — 基礎建設（S1, W1）

```
Story: 作為開發團隊，我們需要可運行的本地開發環境與 CI
  [BE-A] Monorepo + pnpm workspace + Turbo 確認           2h
  [BE-A] DB Schema 鎖定（依 16_DB_SCHEMA.md）             4h
  [BE-A] prisma migrate dev + seed data                   4h
  [BE-B] Docker Compose（PG + Redis + MinIO）             4h
  [BE-B] GitHub Actions（lint + build + test）            4h
  [PM-A] OpenAPI 草稿（Auth / Inbox / Case 端點）         4h
  [FE-A] MSW Mock 設定（根據 OpenAPI）                    2h
  [FE-A] Next.js App Router 骨架                          3h
  [FE-B] Tailwind + shadcn/ui + Design Tokens 初始化      3h
```

---

## EP-INBOX — 統一收件匣（S1–S2, W1–4）

```
Story: 作為客服人員，我希望在一個介面看到所有渠道的訊息
  [BE-A] LINE Plugin（驗簽 + 解析 + 發送）               14h
  [BE-B] FB Plugin（驗簽 + 解析 + 發送）                 14h
  [BE-B] WebChat Plugin + Widget Embed Script            16h
  [BE-A] Contact 自動建立（依 channelUid）                6h
  [BE-A] Conversation 建立 + Message 存表                 6h
  [BE-A] WebSocket broadcast（即時推送）                  6h
  [FE-A] 收件匣 UI（對話列表 + 對話視窗）                18h
  [FE-A] WebSocket 連線 + 即時更新                        8h
  [FE-A] 全域 Shell（側欄 / Header / Badge）              6h

Story: 作為客服人員，我希望能即時回覆訊息（含圖片/檔案）
  [BE-B] 儲存層（MinIO SDK）+ 上傳 API                    6h
  [FE-A] 圖片/檔案上傳元件                                4h
  [FE-B] 通知列（未讀計數 + 渠道 Badge）                   4h

Story: 作為管理員，我希望能登入後台並管理帳號
  [BE-B] Auth API（JWT login / refresh / me）             8h
  [FE-A] 登入頁 + JWT 管理（SWR + Zustand）               6h
```

---

## EP-CHANNEL — 渠道設定（S1–S2, W2–4）

```
Story: 作為管理員，我希望能自助綁定 LINE OA / FB Messenger
  [BE-B] Channel CRUD（含加密存憑證）                     6h
  [BE-B] Webhook URL 自動設定（LINE/FB API）               4h
  [FE-B] LINE Channel 設定頁（Token 輸入 + 驗證）         8h
  [FE-B] FB Channel OAuth 綁定流程                        8h
  [FE-B] WebChat Widget 嵌入設定頁 + 複製碼               4h
```

---

## EP-CASE — 案件管理（S3, W5–6）

```
Story: 作為客服人員，我希望能建立和追蹤客戶案件
  [BE-A] Case CRUD（open / in_progress / resolved / closed）  10h
  [BE-A] Case ↔ Conversation 關聯                            2h
  [FE-A] Case 列表頁（篩選 / 排序 / 搜尋）                  10h
  [FE-A] Case 詳情頁（完整對話 + 備注欄）                    8h

Story: 作為客服主管，我希望能指派案件給對應成員
  [BE-A] 手動指派 API                                        4h
  [BE-A] Round-robin 自動輪詢                                6h
  [FE-A] 指派元件（下拉選取 Agent）                          4h
  [FE-A] 開案 / 關閉 / 轉派 操作                             4h

Story: 作為客服主管，我希望案件有 SLA 時限提醒
  [BE-B] SLA Worker（BullMQ）                               10h
  [BE-B] Email 升級通知（supervisor）                         4h
  [FE-B] SLA 倒數 Badge + 顏色警示（紅/黃/綠）               4h
  [FE-B] 快速回覆（Canned Response）選擇器                    6h
```

---

## EP-CONTACT — 聯繫人管理（S4, W7–8）

```
Story: 作為客服人員，我希望能查看和更新聯繫人完整資料
  [BE-A] Contact CRUD + 自訂屬性（CustomAttribute）         10h
  [BE-A] Contact 合併（多渠道同一人）                         6h
  [FE-A] Contact 列表 + 進階搜尋                            10h
  [FE-A] Contact 詳情頁（屬性 / 活動 Timeline）             12h

Story: 作為客服人員，我希望能用標籤分類聯繫人
  [BE-A] Tag CRUD + 批量操作                                 6h
  [FE-A] 標籤管理頁 + Contact 貼標 / 移標 UI                 6h
```

---

## EP-AUTO — 自動化規則（S4, W7–8）

```
Story: 作為管理員，我希望設定自動化規則節省人工操作
  [BE-B] Trigger 解析（訊息收到 / Case 建立 / 時間觸發）    10h
  [BE-B] Condition Evaluator（AND / OR 多條件）               8h
  [BE-B] Action Executor（貼標 / 自動回覆 / 指派 / 開案）    12h
  [BE-B] Automation Worker（BullMQ async）                    6h
  [FE-B] Automation 列表 + 規則啟用/停用                      6h
  [FE-B] 規則建立表單 + Condition Builder（條件組合器）       20h
```

---

## EP-MKT — 行銷廣播（S5, W9–10）

```
Story: 作為行銷人員，我希望能對特定受眾發送廣播
  [BE-A] Segment 分群 SQL 引擎（多條件）                    12h
  [BE-B] Broadcast Worker（批量發送 + LINE 速率控制）        16h
  [BE-B] 排程發送（Cron Job）                                 4h
  [FE-A] 廣播 Wizard（選受眾 → 選模板 → 排程）              16h
  [FE-B] 分群建立 UI + 條件組合器                            14h
  [FE-A] 廣播歷史 + 統計圖表（送出 / 已讀）                  8h

Story: 作為行銷人員，我希望能建立和管理 Flex 訊息模板
  [BE-A] 模板 CRUD + 變數替換 {name} {date}                  10h
  [BE-A] 模板預覽 API                                         4h
  [FE-B] Flex 模板編輯器（可視化 + JSON 切換）               20h
```

---

## EP-BOT — Bot & 智慧助手（S6, W11–12）

```
Story: 作為管理員，我希望設定 Bot 自動回覆並在需要時移交人工
  [BE-A] 關鍵字 Bot 回覆                                     6h
  [BE-A] 辦公時間設定 + 下班自動回覆                          4h
  [BE-A] LLM 建議回覆（async，Agent 自行採用）               8h
  [FE-A] Bot 開/關切換 + 人工接管按鈕                         4h
  [FE-B] 辦公時間設定頁                                       4h

Story: 作為客服主管，我希望能收集客戶滿意度評分
  [BE-B] CSAT 觸發（Case 關閉後 N 分鐘）                      4h
  [BE-B] 收集評分 + 低分觸發挽救訊息                          6h
  [FE-B] CSAT 設定頁（問卷文字 / 延遲）                       4h
```

---

## EP-ANALYTICS — 報表分析（S6, W11–12）

```
Story: 作為主管，我希望看到 Agent 績效和渠道使用報表
  [BE-B] 數據聚合 Worker（BullMQ，預計算 daily stats）        8h
  [BE-B] License 功能控管（Feature Guard）                    4h
  [FE-B] Analytics 儀表板（Recharts：績效 / 渠道 / 行銷）    12h
  [FE-B] Plan & Usage 頁（用量顯示）                          6h

Story: 作為客服人員，我希望收到即時通知
  [BE-B] Web Push（Service Worker + VAPID）                   8h
  [BE-B] 站內通知 Feed API                                    4h
  [FE-B] 通知中心（站內 + 已讀管理）                          8h
```

---

## EP-PORTAL — Fan Portal（S7–S8, W13–16）

```
Story: 作為粉絲，我希望透過 LINE 一鍵進入活動並參與
  [BE-A] LIFF Auth（LINE Login + OTP）                       12h
  [BE-A] 投票 / 競猜 / 表單 CRUD + 防重複邏輯               16h
  [FE-A] Fan Portal App 骨架（獨立 Next.js）                  6h
  [FE-A] LIFF 初始化 + 自動登入                               6h
  [FE-A] 投票 / 競猜 / 表單頁面                              16h
  [FE-A] 會員中心（活動記錄 / 積分 / 標籤）                   8h

Story: 作為管理員，我希望能在後台建立和管理粉絲活動
  [FE-B] CRM Admin 活動管理列表 + 詳情                       10h
  [BE-A] Admin 活動管理 API（發布 / 結束 / 抽獎）            10h

Story: 作為粉絲，我希望能用積分兌換商品
  [BE-A] Point Ledger（積分帳本）                              8h
  [BE-A] Vendor Redeem API 抽象層（7-11 / 麥當勞等）           8h
  [FE-A] 獎勵商城 UI + 兌換流程                              12h

Story: 作為企業，我希望能販售或贈送活動門票
  [BE-A] TicketEvent / Tier / Order CRUD + 庫存控制           10h
  [BE-A] QR 核銷邏輯                                          4h
  [FE-A] 訂票頁 + 電子票 LINE Flex 推播                      10h
  [FE-B] Admin 訂票管理 + 核銷 UI                              8h
```

---

## EP-TRACKING — 短連結追蹤（S7, W13–14）

```
Story: 作為行銷人員，我希望知道哪些人點了哪個連結
  [BE-B] 短連結 CRUD + QR Code 產生                           6h
  [BE-B] LIFF 點擊 Handler（userId → Contact → 貼標）          8h
  [BE-B] WA per-recipient token 追蹤                           6h
  [FE-B] 短連結管理頁 + 統計報表                              10h
```

---

## Jira 實際操作步驟

### Step 1：建 Epic（直接用 Board 介面）

Backlog → 建立 Issue → 選 Epic 類型 → 填入上表 Epic 名稱。

### Step 2：Story 用 CSV 批量匯入

Jira 支援 CSV，格式：

```csv
Summary,Issue Type,Epic Name,Labels,Story Points
"統一收件匣：LINE 訊息接收",Story,統一收件匣,"m1,be-a",7
"統一收件匣：FB 訊息接收",Story,統一收件匣,"m1,be-b",7
"統一收件匣：對話視窗 UI",Story,統一收件匣,"m1,fe-a",9
"案件管理：Case CRUD API",Story,案件管理,"m2,be-a",5
```

### Step 3：Sprint 規劃

依 PROJECT_PLAN.md，8 個 Sprint，每個 2 週，把 Story 拖入對應 Sprint。

### Step 4：Sub-task 建在 Story 下

把上面每個 Story 的「[BE-A] xxx 4h」建為 Sub-task，指派對應人員。

---

## Story Point 估算標準

| SP | 工時約 | 說明 |
|----|--------|------|
| 1 | 2–4h | 明確需求，標準 CRUD |
| 2 | 0.5d | 需要整合一個外部 API |
| 3 | 1d | 有一定複雜邏輯 |
| 5 | 2–3d | 複雜功能，有多個 edge cases |
| 8 | 4–5d | 很複雜，建議考慮拆分 |
| 13+ | >5d | **必須拆分，不可放進 Sprint** |
