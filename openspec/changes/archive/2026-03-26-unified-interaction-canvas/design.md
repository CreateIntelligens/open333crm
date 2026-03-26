## Context

目前系統已具備基礎的訊息渲染 (TemplateRenderer) 與通路發送能力，但缺乏一個統一的編排層。現有的模板僅支援靜態變數替換，且各通路資料結構各自為政。本設計旨在建立一個全方位的互動層，將訊息、動作與邏輯串連。

## Goals / Non-Goals

**Goals:**
- 建立一套基於節點 (Node-based) 的畫布執行引擎，支援非同步動作（如延遲發送）。
- 統一 Email、LINE、FB、WhatsApp 的模板儲存與渲染邏輯。
- 實作跨通路的身分串接（Identity Stitching），整合 LINE UID 與 FB PSID。
- 支援 API 資料抓取與 AI 自動生成內容節點。

**Non-Goals:**
- 不涉及複雜的 UI 畫布前端實作（本文件僅定義資料結構與後端引擎）。
- 不包含廣告投放平台的廣告管理介面（僅處理廣告點擊後的 Webhook 進入點）。

## Decisions

### 1. 畫布執行引擎 (Flow Execution Engine)
- **決策**: 採用「狀態機 + 事件驅動」架構。每個聯繫人在流程中的狀態（Current Node, Context Variables）存於 `FlowExecution` 資料表。
- **理由**: 廣告問候流程通常包含長達數天的「延遲節點」，使用狀態機可確保伺服器重啟或長時間等待後能正確恢復執行。

### 2. Email 渲染方案
- **決策**: 使用 **MJML** 作為中介層，前端傳回 Block JSON，後端轉 MJML 後產出 HTML。
- **理由**: Email 在各平台的相容性極差，MJML 是目前的工業標準，可確保 Gmail/Outlook 顯示一致。

### 3. 時間延遲處理 (Scheduling)
- **決策**: 結合 **Redis (BullMQ)** 或資料庫輪詢來處理延遲任務。
- **理由**: 為了支援「智慧窗口 (Smart Window)」，任務需要具備動態調整執行時間的能力。

### 4. 身分串接 (Identity Stitching)
- **決策**: 以手機號碼與 Email 作為主要 Key，LINE UID 與 FB PSID 作為關聯 Key。
- **理由**: 台灣市場的 LINE UID 是專屬於官方帳號的，無法單靠 UID 跨通路，必須透過 LIFF 頁面獲取 Cookie 或手機號碼來達成「碰撞」與合併。

## Risks / Trade-offs

- **[Risk] 畫布無限循環 (Infinite Loop)** → **Mitigation**: 在執行引擎中加入「最大執行步數 (Max Step Limit)」限制。
- **[Risk] 身分誤併** → **Mitigation**: AI 建議合併時，必須由管理員手動確認，不進行 100% 自動合併，除非手機號碼完全一致且已通過 OTP 驗證。
- **[Trade-off] 儲存成本** → 畫布執行記錄 (Flow Execution Logs) 會隨著用戶量增加而快速膨脹，需實作定期清理或歸檔機制。
