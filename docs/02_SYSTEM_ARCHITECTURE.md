# 02 — 系統架構總覽

## 架構分層圖

```
┌─────────────────────────────────────────────────────────────┐
│                        前端層 (Frontend)                      │
│  React/Next.js Admin Console  +  Web Chat Widget             │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                      API Gateway Layer                        │
│   認證 (JWT/OAuth)  │  Rate Limit  │  Tenant Routing         │
└──┬────────┬──────────┬─────────────┬───────────────────────┘
   │        │          │             │
   ▼        ▼          ▼             ▼
┌──────┐ ┌──────┐ ┌────────┐ ┌────────────┐
│Core  │ │Case  │ │Contact │ │Automation  │
│Inbox │ │Svc   │ │Svc     │ │Engine      │
└──────┘ └──────┘ └────────┘ └────────────┘
   │        │          │             │
   └────────┴──────────┴─────────────┘
                    │
┌───────────────────▼────────────────────────────────────────┐
│                  Event Bus (内部事件匯流)                    │
│               Redis Streams / RabbitMQ                       │
└───────────────────┬────────────────────────────────────────┘
                    │ 發 / 收
┌───────────────────▼────────────────────────────────────────┐
│              Channel Plugin Layer（渠道插件層）              │
│   LINE Plugin │ FB Plugin │ WebChat Plugin │ [Future: WA]   │
└───────────────────┬────────────────────────────────────────┘
                    │ Webhook 接收 / 訊息發送
┌───────────────────▼────────────────────────────────────────┐
│              外部 IM 平台 (Third-Party)                      │
│   LINE Messaging API │ FB Graph API │ ...                    │
└────────────────────────────────────────────────────────────┘

                   支援服務
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐
│PostgreSQL│ │  Redis   │ │  MinIO/  │ │LLM Service │
│  (主庫)  │ │(快取/佇列)│ │  S3(檔案)│ │(OpenAI/本地)│
└──────────┘ └──────────┘ └──────────┘ └────────────┘
```

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
- 實作統一介面：`receive(rawWebhook) → UniversalMessage`、`send(message, channel) → void`
- 渠道特有功能（如 LINE Flex Message）透過 Plugin Extension 暴露

### 6. LLM Service（AI 輔助）
- 知識庫 Embedding + 向量搜尋
- 建議回覆生成
- 僅做「建議」，客服人員確認後才發送

### 7. Marketing Service
- 廣播任務管理
- 受眾分群（Tag / Attribute / 條件組合）
- 模板管理（含 LINE Flex / FB 模板）

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

- **PostgreSQL**：所有核心業務資料（Contact / Case / Conversation / Rule）
- **Redis**：Session、快取、Rate Limit、WebSocket 廣播
- **向量資料庫（pgvector 或 LanceDB）**：KM 文章 Embedding，供 LLM 語義搜尋
- **MinIO / S3**：媒體檔案（圖片、PDF、語音）

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
  api:       # Node.js/FastAPI 後端
  worker:    # Automation Engine worker
  frontend:  # Next.js Admin Console
  postgres:  # 主資料庫
  redis:     # 快取 + 事件佇列
  minio:     # 本地 S3 相容物件儲存
  nginx:     # 反向代理
```
