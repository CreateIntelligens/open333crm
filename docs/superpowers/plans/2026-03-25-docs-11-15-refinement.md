# Docs 11-15 Refinement Implementation Plan (AI Copilot & Billing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 更新 11-15 文件，將 AI 功能定位修正為「副駕駛 (Copilot)」與「生圖助手」，並細化計費、授權與 UI 通知邏輯。

**Architecture:** 採用「AI 建議與人工採用」模式，確保商務責任歸屬與點數核算精確。

**Tech Stack:** Markdown, Mermaid ASCII.

---

### Task 1: Update 11 — Roadmap

**Files:**
- Modify: `docs/11_ROADMAP.md`

- [ ] **Step 1: 修正 AI 功能定位**
  將 v0.2 的 LLM 功能標題從「AI 回覆」改為「AI 副駕駛 (Copilot)」，強調「建議回覆」與「人工採用」。

- [ ] **Step 2: 加入行銷生圖里程碑**
  在 v0.3 加入「AI 廣播素材助手」，支援生成圖文選單與活動 Banner。

- [ ] **Step 3: Commit**
```bash
git add docs/11_ROADMAP.md
git commit -m "docs: refine 11_ROADMAP with AI Copilot and material assistant"
```

---

### Task 2: Update 12 — Template & Storage

**Files:**
- Modify: `docs/12_TEMPLATE_AND_STORAGE.md`

- [ ] **Step 1: 加入 AI 素材儲存策略**
  定義 `StorageService` 如何管理 AI 生成的圖片（目錄結構、publicUrl 存取）。

- [ ] **Step 2: 模板採用記錄說明**
  說明系統如何記錄哪些變數被「採用 (Adopt)」以及發送後的追蹤。

- [ ] **Step 3: Commit**
```bash
git add docs/12_TEMPLATE_AND_STORAGE.md
git commit -m "docs: refine 12_TEMPLATE_AND_STORAGE with AI material handling"
```

---

### Task 3: Update 13 — Channel Binding

**Files:**
- Modify: `docs/13_CHANNEL_BINDING.md`

- [ ] **Step 1: 補充 Team Access 授權流程**
  在綁定流程中加入「授權部門 (Authorized Teams)」勾選步驟。

- [ ] **Step 2: 安全校驗補強**
  加入 Webchat Origin Whitelist 設定與 Verify Token 的生命週期說明。

- [ ] **Step 3: Commit**
```bash
git add docs/13_CHANNEL_BINDING.md
git commit -m "docs: refine 13_CHANNEL_BINDING with team access control"
```

---

### Task 4: Update 14 & 15 — Billing & License Server

**Files:**
- Modify: `docs/14_BILLING_AND_LICENSE.md`
- Modify: `docs/15_LICENSE_SERVER.md`

- [ ] **Step 1: 定義「餘額不足」自動化通知鏈**
  在 14 文件中定義 `credits.depleted` 事件，以及觸發 `internal.push_ui_notification` 的邏輯。

- [ ] **Step 2: 細化點數扣除邏輯 (Deduction)**
  在 15 文件中明確 llmTokens 與 imageGen 的扣除時機（生成成功後扣點）。

- [ ] **Step 3: 介面回饋說明**
  說明前端如何禁用 AI 功能按鈕並彈出警告。

- [ ] **Step 4: Commit**
```bash
git add docs/14_BILLING_AND_LICENSE.md docs/15_LICENSE_SERVER.md
git commit -m "docs: refine 14-15 with credit depletion automation and UI feedback"
```
