# open333CRM — 專案規劃 / Project Plan

> 版本：v1.1　更新日期：2026-03-12
> 團隊：2 PM、2 BE（後端）、2 FE（前端）、1 UX 設計師
> 目標：交付 MVP（v1.0）+ 粉絲模組（v1.1）

---

## 里程碑總覽 / Milestone Overview

| # | 里程碑 / Milestone | 完成條件 | 預計週期 | 累計週數 |
|---|-------------------|---------|---------|---------|
| M0 | 基礎建設 Infrastructure | Monorepo 可跑、DB 可連、CI 可跑 | 第 1 週 | W1 |
| M1 | 核心通訊管道 Core Messaging | LINE/FB Webhook 收發、統一收件匣可用 | 第 2–4 週 | W4 |
| M2 | Case 管理 + 客服指派 | Case 全流程、指派、SLA Worker | 第 4–6 週 | W6 |
| M3 | 聯繫人 + 自動化 Contacts + Automation | Contact 管理、貼標、Automation 規則 | 第 6–8 週 | W8 |
| M4 | 行銷廣播 Marketing | 群發、分群、Flex 模板 | 第 8–10 週 | W10 |
| M5 | MVP 收口 MVP Wrap-up | Bot/Handoff、CSAT、通知、分析 | 第 10–12 週 | W12 |
| M6 | Fan Portal + 短連結 | 投票/表單/LIFF、短連結追蹤 | 第 13–16 週 | W16 |

---

## 人員角色分配 / Team Role Assignment

| 角色 | 人員 | 主責範圍 |
|------|------|---------|
| PM-A | PM 1 | BE 需求窗口、API 規格確認、Sprint 計畫 |
| PM-B | PM 2 | FE/UX 驗收窗口、QA 協調 |
| **UX** | 設計師 1 | 設計稿（Figma）、元件規範、UX Review |
| BE-A | 後端 1 | 核心引擎（Webhook / Inbox / Case / Contact）|
| BE-B | 後端 2 | 周邊服務（Automation / Workers / Storage / API Keys）|
| FE-A | 前端 1 | Admin 後台主介面（Inbox / Case / Contact）|
| FE-B | 前端 2 | 設定頁、行銷模組、報表、Fan Portal |

---

## W0 — Pre-Sprint：UX 設計 + DB/API 契約（第 0 週）

> 這是**最關鍵的前置步驟**：W0 產出的三份東西，決定後面所有人能不能並行。

```
關鍵路徑（Critical Path）：

UX 設計稿（Figma） ──────────────────────────────→ FE 可開始切版
     ↓
DB Schema（Prisma 鎖定）→ BE migrate → BE 寫 API → FE 串接
     ↓
OpenAPI/Zod 草稿 ──────→ FE 用 MSW Mock → 不等 BE 完成也能開發 UI
```

| 任務 | 負責 | 預估工時 | 說明 |
|------|------|---------|------|
| 所有核心畫面設計稿（Figma）| UX | 3d | Inbox / Case / Contact / Settings 等 8 個主頁面 |
| 元件規範（Design Tokens、色票、字型）| UX | 1d | FE 據此設定 Tailwind / shadcn |
| Fan Portal 設計稿（投票/表單/會員中心）| UX | 2d | M6 用，可在 W3–W4 才交 |
| DB Schema 終版確認（Prisma）| BE-A + PM-A | 4h | 依 16_DB_SCHEMA.md，BE review 後鎖定 |
| OpenAPI 草稿（主要端點）| PM-A + BE-A | 4h | 至少覆蓋 Auth / Inbox / Case / Contact |
| MSW Mock 設定（FE 用）| FE-A | 2h | 根據 OpenAPI 建立假資料回傳 |

**W0 完成條件：** Figma 主頁面可看、Prisma schema 可 `migrate dev`、FE 有 MSW 可用。

---

## M0 — 基礎建設（第 1 週）

> **W0 完成後，所有人可同時啟動，無依賴關係。**

| 任務 | 負責 | 預估工時 | 說明 |
|------|------|---------|------|
| Monorepo 結構確認、pnpm/Turbo 跑通 | BE-A | 4h | 已有骨架，confirm CI |
| Prisma schema 初版（核心 8 張表）| BE-A | 8h | 依 16_DB_SCHEMA.md |
| Docker Compose 本地環境跑通 | BE-B | 4h | PG + Redis + MinIO |
| CI Pipeline（GitHub Actions：lint + build）| BE-B | 4h | |
| Next.js Admin 骨架（App Router + 路由）| FE-A | 6h | |
| 設計系統 + Tailwind/shadcn 初始化 | FE-B | 6h | 全域色票、共用元件 |
| PM 完成所有 Figma 線框圖 → 轉設計稿 | PM-B | 2d | 依 17_UI_WIREFRAMES.md |
| PM 確認 API 規格（09_API_DESIGN.md 終版）| PM-A | 1d | |

**M0 完成條件：** `docker compose up` 可啟動、`prisma migrate dev` 可跑、FE 可看到空白頁。

---

## M1 — 核心通訊管道（第 2–4 週）

### 並行執行軌道 / Parallel Tracks

```
週次    BE-A（引擎核心）              BE-B（基礎服務）
──────  ──────────────────────        ────────────────────────────
W2      LINE Plugin + Webhook 驗簽    Auth 系統（JWT + 登入 API）
        parseWebhook → UniversalMsg   儲存層（MinIO SDK 封裝）

W3      Contact 自動建立              WebChat Plugin + Widget 基礎
        Conversation 建立邏輯         Channel 設定 CRUD API

W4      Inbox Event Bus               FB Plugin + Webhook 驗證
        Message 存表 + 即時推送(WS)   Channel 綁定 self-service API

週次    FE-A（後台介面）              FE-B（設定 + 基礎元件）
──────  ──────────────────────        ────────────────────────────
W2      全域 Shell + 側欄導覽          登入頁面 + JWT 串接
        WebSocket 連線管理             API client 封裝（SWR hooks）

W3      收件匣主介面（訊息列表）        Channel 設定頁（LINE/FB 綁定）
        對話視窗（送/收訊息）          圖片/檔案上傳元件

W4      聯繫人側欄 + 基本資訊          WebChat Widget 雛型
        Channel Badge 顯示            通知列（未讀計數）
```

| 任務 | 負責 | 工時 |
|------|------|------|
| LINE Webhook 接收 + HMAC 驗簽 | BE-A | 8h |
| UniversalMessage 解析（文字/圖片/Postback）| BE-A | 12h |
| Contact + Conversation 自動建立 | BE-A | 10h |
| Message 存表 + WebSocket push | BE-A | 8h |
| FB Plugin 接收/驗證/發送 | BE-B | 12h |
| WebChat Plugin + Widget JS SDK | BE-B | 16h |
| Channel 設定 CRUD（含加密存憑證）| BE-B | 8h |
| Auth（JWT login/refresh/me）| BE-B | 8h |
| 收件匣 UI（對話列表 + 對話視窗）| FE-A | 24h |
| 即時訊息收發（WebSocket）| FE-A | 12h |
| LINE/FB Channel 設定頁 | FE-B | 16h |
| WebChat Widget 嵌入腳本 | FE-B | 12h |

**M1 完成條件：** LINE OA / FB Messenger 訊息可在後台收件匣看到並回覆。

---

## M2 — Case 管理 + 客服指派（第 4–6 週）

```
週次    BE-A                          BE-B
──────  ──────────────────────        ────────────────────────────
W5      Case CRUD + 狀態機             SLA Worker（BullMQ）
        Case 開/處/關/重開流程          SLA 升級通知 Logic

W6      指派 API（手動 + 輪詢）        Case 搜尋 + 篩選 API
        Case 內 Agent 聊天記錄         Email 通知（supervisor）

週次    FE-A                          FE-B
──────  ──────────────────────        ────────────────────────────
W5      Case 列表頁                    Agent 指派元件
        Case 詳情頁（完整對話）         SLA 倒數 Timer

W6      Case 狀態操作（開/關/轉）       Case 篩選 + 搜尋 UI
        Inbox ↔ Case 連結              快速回覆（Canned Response）
```

| 任務 | 負責 | 工時 |
|------|------|------|
| Case 狀態機 + CRUD | BE-A | 12h |
| 指派邏輯（manual + round-robin）| BE-A | 10h |
| SLA Worker + 升級通知 | BE-B | 12h |
| Case 全文搜尋 | BE-B | 8h |
| Case 列表 + 詳情 UI | FE-A | 20h |
| Case 操作（指派/關閉/備注）| FE-A | 12h |
| SLA 倒數 Badge | FE-B | 6h |
| 快速回覆模板選擇器 | FE-B | 8h |

---

## M3 — 聯繫人 + 自動化（第 6–8 週）

```
週次    BE-A                          BE-B
──────  ──────────────────────        ────────────────────────────
W7      Contact 屬性 CRUD              Automation Rule Engine
        Tag 管理 API                   Trigger 解析（訊息/事件）

W8      Contact 合併邏輯               Action 執行器（貼標/回覆/指派）
        ChannelIdentity 跨渠道關聯     Automation Worker（async）

週次    FE-A                          FE-B
──────  ──────────────────────        ────────────────────────────
W7      Contact 詳情頁（完整）          Tag 管理頁
        聯繫人列表 + 搜尋              Automation 列表頁

W8      Contact 活動記錄 Timeline      Automation 規則建立表單
        跨渠道 Channel 列表            Condition Builder UI
```

| 任務 | 負責 | 工時 |
|------|------|------|
| Contact 完整 CRUD + 自訂屬性 | BE-A | 12h |
| Tag CRUD + 批量操作 | BE-A | 8h |
| Automation Engine（Trigger + Condition）| BE-B | 20h |
| Action Executor（8種 Action）| BE-B | 16h |
| Contact 詳情 UI | FE-A | 16h |
| Contact 列表 + 進階搜尋 | FE-A | 12h |
| Automation 規則 CRUD UI | FE-B | 24h |
| Condition Builder（條件組合器）| FE-B | 16h |

---

## M4 — 行銷廣播（第 8–10 週）

```
週次    BE-A                          BE-B
──────  ──────────────────────        ────────────────────────────
W9      Segment 分群查詢引擎            Broadcast Worker（批量發送）
        Contact 篩選 API              Speed Limit（LINE 速率控制）

W10     Flex 模板 CRUD + 變數替換       排程發送（定時 Cron）
        模板預覽 API                   廣播統計（送/讀/回覆率）

週次    FE-A                          FE-B
──────  ──────────────────────        ────────────────────────────
W9      廣播建立 Wizard（3步驟）        Segment 分群建立 UI
        受眾預覽（人數預估）            篩選條件組合器

W10     Flex 模板編輯器                廣播歷史列表 + 詳情
        模板預覽（LINE/FB 差異呈現）    統計圖表（送出/開啟）
```

| 任務 | 負責 | 工時 |
|------|------|------|
| Segment 分群 SQL 引擎 | BE-A | 16h |
| Broadcast Worker（含速率限制）| BE-B | 16h |
| Flex 模板 CRUD | BE-A | 12h |
| 廣播統計聚合 | BE-B | 10h |
| 廣播 Wizard UI | FE-A | 20h |
| Flex 模板編輯器 | FE-B | 24h |
| 分群建立 UI | FE-B | 16h |

---

## M5 — MVP 收口（第 10–12 週）

> **最小 Bug Fix 週期 + 整合測試**

```
週次    BE-A                          BE-B
──────  ──────────────────────        ────────────────────────────
W11     Bot/Handoff 邏輯（關鍵字+LLM）  Web Push + 站內通知
        辦公時間設定                   CSAT 調查觸發 + 收集

W12     LLM 建議回覆（AI 整合）         Analytics 數據聚合 Worker
        整合測試 + Bug Fix             License 驗證整合

週次    FE-A                          FE-B
──────  ──────────────────────        ────────────────────────────
W11     Bot/人工切換 UI                通知中心（站內訊息）
        辦公時間設定頁                 CSAT 設定頁

W12     LLM 建議回覆匡                 Analytics 儀表板
        E2E 測試 + 修正               方案/用量頁（Plan & Usage）
```

**M5 完成 = MVP v1.0 可交付給第一個客戶。**

---

## M6 — Fan Portal + 短連結（第 13–16 週）

```
週次    BE-A                          BE-B
──────  ──────────────────────        ────────────────────────────
W13     Portal Auth（LIFF + OTP）      短連結 CRUD + QR API
        Portal Activity CRUD          點擊 Handler（多渠道識別）

W14     Portal 投票/競猜邏輯            WhatsApp per-recipient token
        Portal 表單提交 + 驗重複       點擊追蹤 + 自動貼標

W15     積分帳本（Point Ledger）        獎勵商城 API（第三方串接抽象層）
        訂票系統 CRUD + 庫存           Vendor Redeem API 串接

W16     Electric Ticket（QR 核銷）      Admin Portal 活動管理 API
        整合測試                       整合測試

週次    FE-A                          FE-B
──────  ──────────────────────        ────────────────────────────
W13     Fan Portal App 骨架（Next.js） CRM Admin：活動管理列表
        LIFF 初始化 + 自動登入         短連結管理頁

W14     投票/競猜/表單頁面             短連結報表（統計圖）
        會員中心（My Activities）      QR Code 下載

W15     積分 + 兌換 UI                 Admin：廣播串 LIFF 短連結
        獎勵商城（商品列表 + 兌換流程）  

W16     訂票購票頁 + 電子票 Flex        Admin 訂票管理 + 核銷 UI
        全站 UAT                      全站 UAT
```

---

## 工時總計 / Total Estimate

| 階段 | BE 總工時 | FE 總工時 | 週期 |
|------|----------|----------|------|
| M0 基礎建設 | 20h | 12h | W1 |
| M1 訊息管道 | 56h | 64h | W2–4 |
| M2 Case 管理 | 42h | 46h | W4–6 |
| M3 聯繫人+自動化 | 56h | 68h | W6–8 |
| M4 行銷廣播 | 54h | 60h | W8–10 |
| M5 MVP 收口 | 40h | 48h | W10–12 |
| **MVP v1.0 小計** | **268h** | **298h** | **12 週** |
| M6 Fan Portal | 96h | 96h | W13–16 |
| **v1.1 小計** | **96h** | **96h** | **4 週** |
| **全部合計** | **364h** | **394h** | **16 週** |

> BE 2 人合計每週約 50h → 12 週 = 600h 容量，有緩衝  
> FE 2 人合計每週約 50h → 12 週 = 600h 容量，有緩衝  
> 緩衝用於 code review、QA 溝通、突發 Bug

---

## 無阻塞並行規則 / Non-Blocking Parallel Rules

```
每個 Sprint（2週）開始前，PM-A 必須：
  1. API 合約先行（OpenAPI / Zod 定義）→ FE 可開始 Mock
  2. DB Schema 確認 → BE 可 migrate → FE 可整合

FE 與 BE 解耦方式：
  - FE 用 MSW（Mock Service Worker）對接 API，不等 BE 完成
  - BE 先交出 /health + 基本 CRUD → FE 立即切換
  - WebSocket 用 Mock Event 先跑 UI

BE-A / BE-B 解耦：
  - BE-A 負責「同步請求處理」路徑（Webhook → DB）
  - BE-B 負責「非同步」路徑（Worker / Queue / 通知）
  - 透過 Event Bus（in-process EventEmitter，未來可換 Redis PubSub）溝通
  - 不互相等待對方 API 完成
```

---

## Sprint 計畫建議 / Sprint Structure

| Sprint | 週次 | 目標 | Demo |
|--------|------|------|------|
| S1 | W1–W2 | 基礎建設 + LINE Webhook 通 | 訊息進 DB |
| S2 | W3–W4 | 收件匣可收/發 LINE + FB | Live Demo |
| S3 | W5–W6 | Case 開案到關閉 + 指派 | 客服流程 Demo |
| S4 | W7–W8 | Contact + Automation 基本規則 | 自動貼標 Demo |
| S5 | W9–W10 | 廣播 + Flex 模板 | 行銷 Demo |
| S6 | W11–W12 | Bot/CSAT/通知/Analytics + 整合 | **MVP v1.0 Final Demo** |
| S7 | W13–W14 | Fan Portal 核心 + 短連結 | LIFF 投票 Demo |
| S8 | W15–W16 | 積分/兌換/訂票 + UAT | **v1.1 Final Demo** |

---

## 風險與應對 / Risks

| 風險 | 機率 | 影響 | 應對 |
|------|------|------|------|
| LINE API 政策變更 | 低 | 高 | Plugin 介面隔離，影響範圍最小化 |
| Flex 模板編輯器複雜度超估 | 中 | 中 | M4 先交 JSON 直接輸入，編輯器降為 v1.1 |
| LLM 回應延遲影響 UX | 中 | 低 | Async 非阻塞，Agent 可選擇採用或不採用 |
| FB Messenger Extension 政策不穩 | 高 | 低 | 降級為匿名追蹤，不影響 LINE 主線 |
| Fan Portal LIFF 審核時間 | 中 | 中 | M6 開始時立即申請 LIFF ID，不等 M5 |
