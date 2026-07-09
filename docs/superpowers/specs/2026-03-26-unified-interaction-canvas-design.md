# 2026-03-26 — 一站式互動畫布與全通路模板系統 (Unified Interaction Canvas & Multi-Channel Template System)

## 1. 願景與核心價值 (Vision & Core Value)

本系統旨在將 `open333CRM` 從「訊息發送工具」升級為「**高階行銷自動化中樞**」。透過視覺化畫布，行銷人員能輕鬆編排從廣告點擊 (FB/LINE Ads) 到成交轉換的完整用戶旅程 (Customer Journey)，並在過程中自動進行身分識別與跨通路追蹤。

---

## 2. 核心組件規格 (Core Components)

### 2.1 一站式互動畫布 (Interaction Canvas)
採用節點式 (Node-based) 編輯介面，定義用戶互動路徑。

*   **節點類型 (Node Types)**:
    *   **觸發節點 (Trigger)**: FB 廣告進入、LINE 加入好友、Webhook 呼叫、標籤變動。
    *   **訊息節點 (Message)**: 發送指定模板（Email, LINE Flex, FB Generic, WhatsApp HSM）。
    *   **邏輯節點 (Logic)**: 條件判斷（是否有標籤、是否已領券）、A/B 測試分流。
    *   **時間節點 (Time)**: 
        *   相對延遲（等待 1 小時）。
        *   絕對時間（週一 10:00）。
        *   智慧窗口 (Smart Window)：避開 22:00~08:00，選在用戶活躍時段發送。
    *   **資料節點 (Data)**: 
        *   **API Fetch**: 從外部 API 抓取資料（如：領券碼、庫存）。
        *   **AI Generation**: 根據聯繫人屬性即時生成客製化訊息。
    *   **動作節點 (Action)**: 打標籤、轉接真人、建立 Case、身分合併。

*   **畫布監控 (Analytics Overlay)**:
    *   節點上即時顯示開啟率 (Open Rate)、點擊率 (CTR) 與流失率 (Drop-off)。
    *   熱點分析：標示出轉換瓶頸路徑。

### 2.2 高階模板庫 (Advanced Template Library)
支援多種視圖與互動邏輯。

*   **Email 編輯器**: 
    *   **Block-based JSON**: 存儲區塊化結構（Image, Text, Button, Spacer）。
    *   **拖拉式 UI**: 行銷人員免程式碼設計排版。
    *   **渲染引擎**: 自動將 JSON 轉為 MJML 並輸出相容於各平台的 HTML。
*   **IM 互動流 (Interactive Flow)**:
    *   **按鈕動作定義**: 每個按鈕可設定 `Send Msg`, `Open URL`, `Trigger Action` (打標籤/API)。
    *   **WhatsApp HSM 自動代辦**: 系統自動檢核內容並透過 API 提交給 Meta 審核，同步審核狀態。
*   **身分識別 (Identity Stitching)**:
    *   **LIFF Cookie 偵測**: 針對台灣 LINE 環境，利用 LIFF 頁面自動抓取 UID 並與瀏覽器 Cookie/FB PSID 碰撞。
    *   **AI 合併建議**: 當身分欄位部分重複時，AI 提示管理員進行聯繫人合併。

### 2.3 跨通路集成邏輯 (Cross-Channel Integration)
*   **流式集成 (Flow Integration)**: 支援「FB 點按鈕 -> 觸發寄送 Email」或「Email 點連結 -> 觸發 LINE 追蹤」。
*   **統一變數系統**: `{{contact.name}}`, `{{ext.coupon_code}}` 等變數在所有通路 View 中共用。

---

## 3. 技術架構 (Technical Architecture)

### 3.1 資料模型 (Data Model)
*   `Template`: 容器層，包含多個 `TemplateView` (Email, Line, FB)。
*   `InteractionFlow`: 畫布定義，儲存節點與連線 JSON。
*   `FlowExecution`: 記錄每個聯繫人在畫布中的當前位置與狀態。

### 3.2 關鍵 API
*   `POST /api/v1/canvas/validate`: 檢查畫布邏輯與變數完整性。
*   `POST /api/v1/templates/whatsapp/submit-audit`: 提交 HSM 給 Meta 審核。
*   `GET /api/v1/analytics/canvas/:id`: 取得畫布成效統計。

---

## 4. 通路綁定更新 (Channel Binding Update)

*   **圖文選單 (Rich Menu) 管理**: 移至通路設定頁面，但其選單按鈕支援「觸發畫布」或「發送模板」。
*   **自動化配置**: 綁定 LINE/FB 時，系統自動設定 Webhook 並完成 Initial Handshake。

---

## 5. 成功指標 (Success Criteria)

1.  行銷人員能在 10 分鐘內建立一個包含「LINE/FB/Email」三通路、且具備「延遲追蹤」功能的轉換流。
2.  身分串接引擎能正確將用戶在不同通路的 UID/PSID 歸併至同一個聯繫人。
3.  畫布能清楚呈現每個互動環節的流失率，供快速優化。
