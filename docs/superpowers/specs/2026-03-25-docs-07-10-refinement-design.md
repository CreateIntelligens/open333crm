# Design Spec: CRM 擴充模組 (07-10) 自動化深度整合

**日期**: 2026-03-25
**主題**: 細化 KM, Marketing, API Design, Tech Stack 與 Automation Engine 的深度接軌
**目標**: 確保所有模組皆遵循「Automation 為神經中樞」原則，實現邏輯統一、事件驅動的 CRM 系統。

---

## 1. 核心邏輯：方案 B (Automation-Centric)

所有擴充模組均不直接進行複雜的商務決策，而是透過「發送事件 (Produce Events)」供 Automation Engine 判斷，並透過「執行動作 (Consume Actions)」完成任務。

### 1.1 系統架構簡圖 (ASCII)
```ascii
[ 外部感測層 ]       [ 核心處理層 ]       [ 執行/觸達層 ]
Integration API ──▶                ──▶ Channels (LINE/FB)
KM / LLM        ──▶  Automation    ──▶ Marketing (Broadcast)
Marketing Event ──▶  Engine (Bus)  ──▶ Case Management
User Action     ──▶                ──▶ Notification
```

---

## 2. 模組細化設計

### 2.1 07 — LLM & 知識庫 (KM)
**整合點**: 將 KM 檢索結果轉化為 Automation 決策依據。

- **觸發事件 (Triggers)**:
    - `km.search.hit`: 語意搜尋信心度高於閾值。Payload 包含 `articleId`, `content`, `confidence`。
    - `km.search.miss`: 搜尋不到結果。Payload 包含 `originalQuery`。
- **執行動作 (Actions)**:
    - `ai.generate_reply`: 使用指定文章內容生成建議回覆。
    - `ai.auto_reply`: 直接發送 AI 生成的回覆（需符合特定條件）。
- **架構決策**:
    - **LanceDB** 負責儲存 Markdown 文章切片（Fast, Local-first）。
    - **Hybrid Search** 結合 BM25 與 Vector。

### 2.2 08 — 行銷模組 (Marketing)
**整合點**: 將行銷活動的客戶反應導回 CRM 流程。

- **觸發事件 (Triggers)**:
    - `marketing.link.clicked`: 客戶點擊帶有追蹤碼的連結。Payload 包含 `campaignId`, `url`, `contactId`。
    - `marketing.postback.received`: 客戶點擊 LINE Flex Message 按鈕。
- **執行動作 (Actions)**:
    - `marketing.send_template`: 針對單一對象發送訊息模板（如：行銷跟進）。
    - `marketing.update_segment`: 將聯繫人動態加入/移出受眾分群。

### 2.3 09 — 對外 API 設計 (API Design)
**整合點**: 外部系統透過 API 直接驅動 Automation。

- **整合事件 API (`/api/v1/integrations/events`)**:
    - 支援 `upsert_contact`: 根據 `phone` 或 `email` 自動建立或關聯聯繫人。
    - 統一 `eventType` 命名規範（如 `iot.alert`, `pos.purchase`）。
- **安全性**: 
    - 使用 API Key 搭配 Scopes 限制可觸發的事件類型。
- **冪等性**:
    - 記錄 `externalId`，24 小時內重複推播不重複執行 Automation。

### 2.4 10 — 技術選型與架構 (Tech Stack)
**整合點**: 確保高併發下的事件流穩定性。

- **Message Bus**: 使用 **Redis Streams**。所有內部事件皆丟入 Stream，由 Worker 非同步消費。
- **Worker 分配**:
    - `AutomationWorker`: 負責 Rule Engine 判斷。
    - `ActionWorker`: 負責執行具體動作（API 呼叫、資料庫寫入）。
- **Vector DB**:
    - **LanceDB**: 產品/知識庫（唯讀性強、搜尋頻率高）。
    - **pgvector**: 聯繫人長期記憶（與 Contact 資料高度 Join）。

---

## 3. 測試與驗證

- **整合測試**: 模擬一個 IoT 事件 -> 檢查 Automation 是否觸發 -> 檢查是否自動開案。
- **效能測試**: 模擬 1,000 個並行事件推播，驗證 Redis Stream 處理延遲。

---

## 4. 實作任務 (Implementation Tasks)

1. [ ] 更新 `docs/07_LLM_AND_KM.md`: 加入事件與動作定義。
2. [ ] 更新 `docs/08_MARKETING.md`: 加入追蹤與 Automation 連動機制。
3. [ ] 更新 `docs/09_API_DESIGN.md`: 細化 Integration API 與 Payload 範例。
4. [ ] 更新 `docs/10_TECH_STACK.md`: 補充 Redis Streams 與向量庫分工架構。
