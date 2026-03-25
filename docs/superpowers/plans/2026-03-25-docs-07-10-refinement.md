# Docs 07-10 Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 更新 07-10 文件，使其與 CRM Automation Engine 深度對接，確保邏輯統一與事件驅動架構。

**Architecture:** 採用「以 Automation 為神經中樞」的設計，定義各模組的 Triggers 與 Actions。

**Tech Stack:** Markdown, Mermaid ASCII.

---

### Task 1: Update 07 — LLM & KM

**Files:**
- Modify: `docs/07_LLM_AND_KM.md`

- [ ] **Step 1: 加入 Automation 整合章節**
  在文件中新增「KM 與 Automation Engine 的連動」章節，定義 `km.search.hit`, `km.search.miss` 等事件，以及 `ai.generate_reply` 等動作。

- [ ] **Step 2: 更新架構圖**
  使用 Mermaid 或 ASCII 更新流程圖，顯示 KM 如何發送事件給 Automation。

- [ ] **Step 3: Commit**
```bash
git add docs/07_LLM_AND_KM.md
git commit -m "docs: refine 07_LLM_AND_KM with automation triggers and actions"
```

---

### Task 2: Update 08 — Marketing Module

**Files:**
- Modify: `docs/08_MARKETING.md`

- [ ] **Step 1: 加入行銷閉環自動化**
  定義 `marketing.link.clicked` 與 `marketing.postback.received` 事件。
  新增「行銷與 Automation 連動範例」章節。

- [ ] **Step 2: 細化 Flex Message 動態變數**
  提供具體的範例說明如何將 CRM `Contact` 屬性映射到訊息模板中。

- [ ] **Step 3: Commit**
```bash
git add docs/08_MARKETING.md
git commit -m "docs: refine 08_MARKETING with closed-loop automation"
```

---

### Task 3: Update 09 — API Design

**Files:**
- Modify: `docs/09_API_DESIGN.md`

- [ ] **Step 1: 更新 Integration API 規範**
  細化 `POST /api/v1/integrations/events` 端點，加入 `upsert_contact` 邏輯說明與 Payload 範例。

- [ ] **Step 2: 補全 API Key Scopes**
  加入 `write:integration_events` 等新權限範圍。

- [ ] **Step 3: Commit**
```bash
git add docs/09_API_DESIGN.md
git commit -m "docs: refine 09_API_DESIGN with integration gateway specs"
```

---

### Task 4: Update 10 — Tech Stack

**Files:**
- Modify: `docs/10_TECH_STACK.md`

- [ ] **Step 1: 補充 Redis Streams 架構**
  在「技術選型」中明確說明 Redis Streams 作為 Internal Event Bus 的角色。

- [ ] **Step 2: 明確向量資料庫分工**
  區分 LanceDB (KM) 與 pgvector (LTM) 的職責與選型理由。

- [ ] **Step 3: Commit**
```bash
git add docs/10_TECH_STACK.md
git commit -m "docs: refine 10_TECH_STACK with event bus and vector strategy"
```
