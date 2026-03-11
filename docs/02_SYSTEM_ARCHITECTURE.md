# 02 — 系統架構總覽

## 架構分層圖

```
┌─────────────────────────────────────────────────────────────────┐
│              👑  平台授權 & Billing 控制層 [太上皇]              │
│   license.open333crm.com 提供遠端 License JSON              │
│   功能開關 / AI Credits 額度 / LLM API Key  [ Tenant 看不到 ] │
└─────────────────────────────┬───────────────────────────────────┘
                             │  定時拉取（每 60 分鐘）快取至 Redis
┌────────────────────────────▼─────────────────────────────────────┐
│           LicenseService（內部全局 Singleton）                  │
│           isFeatureEnabled() / hasCredits() / deductCredits()  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Feature Guard 每個 API 呼叫前檢查

┌─────────────────────────────────────────────────────────────────┐
│                       前端層 (Frontend)                           │
│    React/Next.js Admin Console  +  Web Chat Widget (Embed JS)    │
└────────────────────────┬────────────────────────────────────────┘
                         │ REST API / WebSocket
┌────────────────────────▼────────────────────────────────────────┐
│                      API Gateway Layer                            │
│    認證 (JWT/API Key)  │  Rate Limit  │  Tenant Routing           │
└──┬───────┬──────────┬──────────┬──────────┬──────────┬──────────┘
   │       │          │          │          │          │
   ▼       ▼          ▼          ▼          ▼          ▼
┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│Core  │ │Case  │ │Contact │ │Auto-   │ │Template│ │Marketing │
│Inbox │ │Svc   │ │Svc     │ │mation  │ │Svc     │ │Svc       │
└──────┘ └──────┘ └────────┘ └────────┘ └────────┘ └──────────┘
   │       │          │          │          │          │
   └───────┴──────────┴──────────┴──────────┴──────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    Event Bus (內部事件匯流)                        │
│                   Redis Streams (BullMQ)                          │
└──────────┬────────────────────────────────┬───────────────────── ┘
           │ 發 / 收                         │ 定時任務
┌──────────▼──────────────────┐  ┌──────────▼────────────────────┐
│    Channel Plugin Layer      │  │         Workers                │
│  LINE │ FB │ WebChat │ [WA] │  │  automation / broadcast / sla  │
└──────────┬──────────────────┘  └───────────────────────────────┘
           │ Webhook 接收 / 訊息發送
┌──────────▼──────────────────────────────────────────────────────┐
│                   外部 IM 平台 (Third-Party)                       │
│        LINE Messaging API  │  FB Graph API  │  ...               │
└─────────────────────────────────────────────────────────────────┘

                          支援服務層
┌──────────┐ ┌──────────┐ ┌─────────────────┐ ┌────────────┐
│PostgreSQL│ │  Redis   │ │  Storage Layer  │ │LLM Service │
│+pgvector │ │(快取/佇列)│ │ MinIO/S3/GCS   │ │(OpenAI/本地)│
└──────────┘ └──────────┘ └─────────────────┘ └────────────┘
```

> **說明**：Storage Layer 是統一儲存抽象，MinIO 為本地預設，
> 可透過環境變數切換至 S3 或 GCS，詳見 [12_TEMPLATE_AND_STORAGE.md](./12_TEMPLATE_AND_STORAGE.md)。
> 渠道自助綁定流程詳見 [13_CHANNEL_BINDING.md](./13_CHANNEL_BINDING.md)。

---

## 模組邊界定義

### 1. Core Inbox Service
- 統一收件匣：接收所有渠道傳入的訊息，標準化為統一 Message 格式
- 管理 Conversation 生命週期（active / bot / agent / closed）
- WebSocket 推播給前端

### 2. Case Service
- Case CRUD + 狀態機
- 指派邏輯（round-robin / manual / skill-based）
- SLA 計時與升級
- Case Event 歷程記錄

### 3. Contact Service
- 聯繫人建立與更新
- 跨渠道身份合併（同一個人在 LINE 和 FB 的資料整合）
- 標籤管理
- 關係鏈維護

### 4. Automation Engine
- 規則存儲與解析
- 事件監聽 + 條件評估
- Action 執行（發訊息 / 貼標 / 開案 / Webhook）

### 5. Channel Plugin Layer
- 每個渠道是一個獨立的 Plugin/Adapter
- 統一介面：`receive(rawWebhook) → UniversalMessage`、`send(message, channel) → void`
- 渠道特有功能（如 LINE Flex Message）透過 Plugin Extension 暴露
- 企業管理員可在後台**自助綁定**渠道，系統自動設定 Webhook URL
- 詳見 [03_CHANNEL_PLUGIN.md](./03_CHANNEL_PLUGIN.md) 和 [13_CHANNEL_BINDING.md](./13_CHANNEL_BINDING.md)

### 6. LLM Service（AI 輔助）
- 知識庫 Embedding + 向量搜尋（pgvector）
- RAG 流程：語義搜尋知識庫 → 組裝 Prompt → 生成建議回覆
- 僅做「建議」，客服人員確認後才發送
- 詳見 [07_LLM_AND_KM.md](./07_LLM_AND_KM.md)

### 7. Marketing Service
- 廣播任務管理（立即 / 排程 / 觸發）
- 受眾分群（Tag / Attribute / 條件組合）
- 模板管理（含 LINE Flex 30+ 模板 / FB 模板）
- 詳見 [08_MARKETING.md](./08_MARKETING.md)

### 8. Template Service
- 統一管理 LINE Flex、FB、純文字等所有訊息模板
- 支援 `{{變數}}` 語法的動態替換
- 模板圖片 URL 透過 Storage Layer 產生，與儲存體解耦
- 提供 JSON 編輯器 + 即時預覽 API
- 詳見 [12_TEMPLATE_AND_STORAGE.md](./12_TEMPLATE_AND_STORAGE.md)

### 9. Storage Layer（統一儲存層）
- 抽象介面：`upload()` / `getPublicUrl()` / `delete()`
- 預設 MinIO（本地自架），可切換 AWS S3 或 GCS，改環境變數即可
- LINE 傳入的媒體（圖片/影片）在 Webhook 接收時**立即下載**存入此層，避免 LINE 臨時 URL 过期
- 模板圖片、KM 附件、對話媒體、Agent 頭像皆走此層
- 詳見 [12_TEMPLATE_AND_STORAGE.md](./12_TEMPLATE_AND_STORAGE.md)

### 10. LicenseService（平台授權層）
- 啟動時從遠端拉取 License JSON，定時刷新（預設 60 分鐘）
- HMAC-SHA256 簽名驗證，防止被竿改
- 提供 `isFeatureEnabled()` / `hasCredits()` / `deductCredits()` 給全系統
- 網路斷線時使用 Redis 快取，超過 24 小時進入降級模式
- LLM API Key **存在 License JSON 中**，Tenant 不知情，無法繞過額度機制
- Tenant 終端專有两個環境變數：`LICENSE_KEY` + `LICENSE_FETCH_URL`
- 詳見 [14_BILLING_AND_LICENSE.md](./14_BILLING_AND_LICENSE.md)

---

## 跨服務通訊規則

| 情境 | 方式 |
|------|------|
| 同步查詢（如獲取聯繫人資料） | REST API 呼叫 |
| 非同步事件（如訊息收到後觸發自動化） | Event Bus |
| 前端即時推播（新訊息、Case 狀態更新） | WebSocket (Socket.io) |
| 外部渠道回呼 | Webhook → Channel Plugin → Event Bus |

---

## 資料庫設計原則

- **PostgreSQL + pgvector**：所有核心業務資料（Contact / Case / Conversation / Rule）+ KM 向量搜尋
- **Redis**：Session、快取、Rate Limit、WebSocket 廣播、BullMQ 任務佇列
- **Storage Layer（MinIO / S3 / GCS）**：所有媒體檔案（圖片、PDF、語音）、模板圖片、KM 附件
  - Lite 版預設 MinIO（容器內自架）
  - 客戶要求時可切換至 S3 / GCS，零程式碼修改
  - Channel credentials 以 AES-256 加密後存入 PostgreSQL

---

## 部署架構（單企業 Lite 版）

```
                [Nginx / Caddy]
                   /        \
            [Frontend]   [API Server]
                              |
                    [PostgreSQL + Redis]

一台 VPS 或 Docker Compose 即可運行
建議最低規格：4 Core / 8GB RAM / 100GB SSD
```

### Docker Compose 服務清單（MVP）

```yaml
services:
  api:              # Node.js + Fastify 後端 API
  worker-auto:      # Automation Engine worker（規則觸發/執行）
  worker-broadcast: # 廣播 / 排程發送 worker
  worker-sla:       # SLA 監控 + 到期提醒 worker
  frontend:         # Next.js Admin Console
  widget:           # Web Chat Widget 靜態資源
  postgres:         # 主資料庫（pgvector extension）
  redis:            # 快取 + BullMQ 任務佇列
  minio:            # 本地 S3 相容物件儲存（Storage Layer 預設）
  caddy:            # 反向代理 + 自動 HTTPS
```

> **授權服務**（`license.open333crm.com`）是平台方獲作的外部服務，
> **不包含在客戶端 Docker Compose 中**。
> 客戶端統一透過 `LICENSE_KEY` 向遠端拉取 JSON。
