# Docs 16-23 Refinement Implementation Plan (Copilot & Notifications)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 更新 16-23 文件，確立 AI Copilot 責任制，並設計小鈴鐺通知中心與事件驅動整合。

**Architecture:** AI 轉為輔助模式，所有重要事件透過 WebSocket 推送至前端通知中心。

**Tech Stack:** Prisma, Markdown, Mermaid ASCII.

---

### Task 1: Update 16 — DB Schema

**Files:**
- Modify: `docs/16_DB_SCHEMA.md`

- [ ] **Step 1: 補充 Copilot 欄位**
  在 `Message` 模型中加入 `isAiSuggested`, `isAdopted`, `originalSuggestion`, `adoptedAt`。

- [ ] **Step 2: 建立 Notification 模型**
  新增 `Notification` 模型，包含 `agentId`, `type`, `priority`, `clickUrl`, `isRead`。

- [ ] **Step 3: Commit**
```bash
git add docs/16_DB_SCHEMA.md
git commit -m "docs: refine 16_DB_SCHEMA with notification and AI copilot fields"
```

---

### Task 2: Update 17 — UI Wireframes

**Files:**
- Modify: `docs/17_UI_WIREFRAMES.md`

- [ ] **Step 1: 繪製小鈴鐺介面**
  在「全局 Shell」中加入小鈴鐺圖標，並繪製其下拉選單的 ASCII Wireframe。

- [ ] **Step 2: 更新 Inbox 介面**
  在「收件匣」畫面中，於輸入框上方加入「AI 建議回覆」面板。

- [ ] **Step 3: Commit**
```bash
git add docs/17_UI_WIREFRAMES.md
git commit -m "docs: refine 17_UI_WIREFRAMES with notification bell and copilot panel"
```

---

### Task 3: Update 18 — Bot Autorouter

**Files:**
- Modify: `docs/18_BOT_AUTOROUTER.md`

- [ ] **Step 1: 調整路由邏輯**
  將「Bot 自動回覆」限制在「服務時間外」與「精確關鍵字」，其餘轉為 Copilot 輔助模式。

- [ ] **Step 2: Commit**
```bash
git add docs/18_BOT_AUTOROUTER.md
git commit -m "docs: refine 18_BOT_AUTOROUTER with copilot accountability model"
```

---

### Task 4: Update 20 — Notification System

**Files:**
- Modify: `docs/20_NOTIFICATION.md`

- [ ] **Step 1: 細化小鈴鐺系統**
  詳細定義通知事件類型 (SLA, CSAT, Assign)、優先級 (Urgent, Normal)，並說明 WebSocket 推送機制。

- [ ] **Step 2: Commit**
```bash
git add docs/20_NOTIFICATION.md
git commit -m "docs: refine 20_NOTIFICATION with detailed bell system spec"
```

---

### Task 5: Update 19, 21, 22, 23 — Event & Analytics Integration

**Files:**
- Modify: `docs/19_CSAT_FLOW.md`
- Modify: `docs/21_ANALYTICS_DASHBOARD.md`
- Modify: `docs/22_FAN_PORTAL.md`
- Modify: `docs/23_SHORT_URL_TRACKING.md`

- [ ] **Step 1: 整合事件驅動**
  在各文件中加入 `AutomationEngine` 事件觸發說明，例如低 CSAT 觸發通知、點擊短連結觸發貼標。

- [ ] **Step 2: 加入 AI 採用率報表**
  在 `21_ANALYTICS_DASHBOARD.md` 中新增「AI 採用率」與「客服修正率」指標。

- [ ] **Step 3: Commit**
```bash
git add docs/19_CSAT_FLOW.md docs/21_ANALYTICS_DASHBOARD.md docs/22_FAN_PORTAL.md docs/23_SHORT_URL_TRACKING.md
git commit -m "docs: refine 19-23 with event-driven integration and analytics"
```
