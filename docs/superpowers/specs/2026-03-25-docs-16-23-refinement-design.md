# Design Spec: CRM 核心機制補強 (16-23) — 小鈴鐺與 Copilot 模式

**日期**: 2026-03-25
**主題**: 細化 DB Schema, UI, Bot Router 與小鈴鐺通知系統
**目標**: 完善系統交互細節，確保 AI 責任歸屬明確化，並建立如社交平台般的即時通知中心。

---

## 1. 核心機制：小鈴鐺通知系統 (The Notification Bell)

建立一個持久化且即時的通知中心，讓客服人員（CRM User）能第一時間感知重要事件。

### 1.1 通知中心 UI (ASCII Dropdown)
```ascii
┌────────────────────────────────────────┐
│  🔔 通知中心 (5)              [全部標記已讀] │
├────────────────────────────────────────┤
│ 🔴 主管 [李大明] 將案件 #1087 指派給您      │
│    (1分鐘前)                      [前往] │
├────────────────────────────────────────┤
│ ⚠️ 案件 #1089 SLA 剩餘 15 分鐘到期        │
│    (5分鐘前)                      [處理] │
├────────────────────────────────────────┤
│ 😡 王小美 給予了 1 星評價 (案件 #1001)     │
│    (10分鐘前)                     [查看] │
├────────────────────────────────────────┤
│ 📝 李助理 在您的對話中留下了內部備註        │
│    (1小時前)                      [跳轉] │
└────────────────────────────────────────┘
```

---

## 2. 核心機制：AI 副駕駛責任制 (AI Copilot Accountability)

明確區分「自動化」與「建議」，確保企業對外發出的訊息經過人工審查。

### 2.1 路由分層
1.  **Level 1 (自動)**: 服務時間外、極簡關鍵字（地址、電話）。
2.  **Level 2 (輔助)**: 複雜問題 -> 觸發 KM 檢索 -> 生成建議 -> 客服「採用 (Adopt)」。

### 2.2 證據鏈存儲
在資料庫中記錄：`originalSuggestion` (AI 原文) vs `finalMessage` (人工修改後)。

---

## 3. 模組細化設計

### 3.1 16 — DB Schema (Prisma)
- **Message**: 增加 `isAiSuggested`, `isAdopted`, `originalSuggestion` (JSONB), `adoptedAt`。
- **Notification**: 增加 `Notification` 模型，包含 `type`, `targetUrl`, `priority`, `readAt`。
- **Team**: 增加 `licenseTeamId` 用於權限橋接。

### 3.2 17 — UI Wireframes
- **Inbox**: 頂部加入「AI 建議卡片」與「修正建議」按鈕。
- **Shell**: 右上角加入帶有數字的鈴鐺圖標。

### 3.3 18 — Bot Autorouter
- 移除「信心度高則自動回覆」的預設行為。
- 確立 Bot 在辦公時間僅作為「Copilot」提供建議。

### 3.4 20 — Notification System
- 定義 **WebSocket (Socket.io)** 實作。
- 分類事件優先級：
    - `URGENT`: SLA 違規、餘額不足 (紅色 Toast)。
    - `NORMAL`: 指派通知、訊息提醒 (小鈴鐺數字)。

### 3.5 21 — Analytics Dashboard
- 新增 **AI Adoption Rate** (採用率) 報表。
- 統計 Agent 修正 AI 建議的頻率與幅度。

### 3.6 22 & 23 — 外部擴充
- **Fan Portal**: 提交表單發送 `portal.activity.submitted` 事件至 Automation。
- **Short Link**: 點擊發送 `link.clicked` 事件，用於自動化貼標。

---

## 4. 實作任務 (Implementation Tasks)

1. [ ] 更新 `docs/16_DB_SCHEMA.md`: 補充通知與 AI 採用欄位。
2. [ ] 更新 `docs/17_UI_WIREFRAMES.md`: 加入小鈴鐺中心與 AI 面板設計。
3. [ ] 更新 `docs/18_BOT_AUTOROUTER.md`: 轉向輔助模式邏輯。
4. [ ] 更新 `docs/20_NOTIFICATION.md`: 細化小鈴鐺系統與事件定義。
5. [ ] 更新 `docs/21_ANALYTICS_DASHBOARD.md`: 加入 AI 績效指標。
6. [ ] 更新其餘文件 (19, 22, 23): 補強自動化事件整合。
