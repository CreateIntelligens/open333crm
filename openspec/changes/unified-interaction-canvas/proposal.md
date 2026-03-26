## Why

目前 `open333CRM` 僅具備基礎的訊息發送與通路管理功能，缺乏高階的行銷自動化編排與跨通路互動能力。為了讓企業能更有效地從 FB/LINE 廣告中轉換客戶，我們需要一個「一站式互動畫布」，讓行銷人員能直觀地設計包含訊息、邏輯分支、延遲追蹤與 AI 客製化文案的完整用戶旅程。

## What Changes

- **新增一站式互動畫布 (Interaction Canvas)**：提供節點式編輯介面，支援觸發、訊息、邏輯、時間、資料（API/AI）與動作節點。
- **升級模板系統 (Advanced Template Library)**：
    - 新增 Email 拖拉式可視化編輯器（基於 Block JSON）。
    - 新增 IM 互動流設計，按鈕可直接內嵌動作邏輯。
    - 支援 WhatsApp HSM 模板自動提交 Meta 審核流程。
- **強化身分串接引擎 (Identity Stitching)**：整合 LINE UID、FB PSID 與手機/Email，利用 LIFF Cookie 與 AI 建議進行跨通路身分合併。
- **優化數據分析**：在畫布節點上即時呈現開啟、點擊與流失率，並提供跨通路歸因報表。

## Capabilities

### New Capabilities
- `interaction-canvas`: 提供視覺化節點編排、智慧排程與 A/B 測試功能的互動核心。
- `advanced-template-library`: 包含 Email 拖拉編輯器、IM 互動流與 WhatsApp 自動審核機制。
- `identity-stitching-engine`: 負責跨通路的 UID/PSID 與聯繫人資料自動合併與建議。

### Modified Capabilities
- `channel-management`: 修改通路綁定邏輯，將圖文選單 (Rich Menu) 與畫布動作對接，並自動化 Webhook 配置。

## Impact

- **API**: 新增 `/api/v1/canvas/*` 與 `/api/v1/templates/*` 相關端點。
- **Frontend**: 需要開發畫布編輯器、Email 拖拉編輯器與新的模板管理介面。
- **Core Logic**: 需要實作一套流式執行引擎 (Flow Execution Engine) 來處理延遲、條件分支與 API 呼叫。
- **Database**: 需新增 `InteractionFlow`、`FlowExecution`、`TemplateView` 等相關資料表。
