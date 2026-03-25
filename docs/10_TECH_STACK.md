# 10 — 技術選型與部署架構

## 技術選型理由

| 層級 | 選擇 | 理由 |
|------|------|------|
| **後端 API** | Node.js + Fastify | 高效能 I/O、豐富的 LINEOA/FB SDK 生態 |
| **前端** | Next.js (App Router) | React 生態、SSR/SSG、API Routes |
| **資料庫** | PostgreSQL | 穩定、強大 JSON 支援（JSONB） |
| **快取/佇列** | Redis | Session、Rate Limit、事件匯流排 (Streams) |
| **內部事件匯流排** | **Redis Streams** | **支援多消費者、持久化事件流，作為 Automation 的神經網路** |
| **向量搜尋 (KM)** | **LanceDB** | **Serverless/本地檔案型，適合大規模產品知識庫，搜尋極快** |
| **向量搜尋 (LTM)** | **pgvector** | **PostgreSQL 內嵌，方便與聯繫人資料 Join，適合長期記憶** |
| **任務佇列** | BullMQ | Redis-based，處理廣播與定時任務 (Delayed Jobs) |
| **WebSocket** | Socket.io | 客服室廣播、即時訊息通知 |
| **反向代理** | Caddy | 自動 HTTPS、設定簡單 |

---

## 系統架構圖 (Event-Driven Architecture)

```ascii
[ 外部事件 ] (Webhooks, Integration API)
      │
      ▼
[ Fastify API ] ──▶ [ Redis Streams ] ──▶ [ Automation Worker ]
                          │                       │
                          │                       ├─▶ [ Action: Send Message ]
                          │                       ├─▶ [ Action: Open Case ]
                          │                       └─▶ [ Action: Update DB ]
                          ▼
                  [ BullMQ Workers ] ──▶ [ Broadcast / SLA Jobs ]
```

---

## 向量資料庫策略 (Vector Strategy)

為了平衡效能與關聯性，系統採用雙軌向量存儲：

1. **LanceDB (KM 知識庫)**
   - **用途**: 儲存集團產品手冊、技術文件、Q&A。
   - **優點**: 支援 `Hybrid Search` (Vector + BM25)，且搜尋不佔用 PostgreSQL 連線資源。
   - **儲存**: 儲存於 `apps/api/workspace/vectors/km/`。

2. **pgvector (LTM 長期記憶)**
   - **用途**: 儲存聯繫人的歷史對話摘要與行為特徵。
   - **優點**: 可直接在 SQL 中進行 `JOIN contacts` 查詢，過濾特定租戶或聯繫人的記憶。
   - **儲存**: PostgreSQL `vector` 欄位。

---

## 後端目錄結構

```
apps/api/
├── src/
│   ├── main.ts                    # 入口
│   ├── config/                    # 環境設定
│   │   └── env.ts
│   ├── plugins/                   # Fastify 插件（auth, cors...）
│   ├── modules/
│   │   ├── auth/                  # 認證模組
│   │   ├── contact/               # 聯繫人服務
│   │   ├── conversation/          # 對話服務
│   │   ├── case/                  # 案件服務
│   │   ├── tag/                   # 標籤服務
│   │   ├── automation/            # 自動化引擎
│   │   ├── km/                    # 知識庫
│   │   ├── ai/                    # LLM 服務
│   │   └── marketing/             # 行銷模組
│   ├── channels/                  # 渠道插件
│   │   ├── base.plugin.ts         # 抽象介面
│   │   ├── line/
│   │   │   ├── line.plugin.ts
│   │   │   ├── line.webhook.ts
│   │   │   └── line.sender.ts
│   │   ├── fb/
│   │   │   ├── fb.plugin.ts
│   │   │   └── fb.webhook.ts
│   │   └── webchat/
│   │       └── webchat.plugin.ts
│   ├── events/                    # 內部事件定義
│   │   └── event-bus.ts           # Redis Streams
│   ├── workers/                   # BullMQ Workers
│   │   ├── automation.worker.ts
│   │   ├── broadcast.worker.ts
│   │   └── sla.worker.ts
│   └── shared/
│       ├── database/              # Prisma schema & client
│       ├── types/                 # 共用型別定義
│       └── utils/
├── prisma/
│   └── schema.prisma
└── package.json
```

---

## 前端目錄結構

```
apps/web/
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (auth)/
│   │   │   └── login/
│   │   ├── dashboard/
│   │   │   ├── inbox/             # 統一收件匣
│   │   │   ├── contacts/          # 聯繫人
│   │   │   ├── cases/             # 案件列表
│   │   │   ├── automation/        # 自動化規則
│   │   │   ├── km/                # 知識庫
│   │   │   ├── marketing/         # 行銷
│   │   │   └── settings/          # 系統設定
│   │   └── layout.tsx
│   ├── components/
│   │   ├── inbox/                 # 收件匣組件
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── AISuggestPanel.tsx
│   │   ├── case/
│   │   ├── contact/
│   │   └── shared/
│   ├── hooks/                     # WebSocket hooks
│   │   └── useInbox.ts
│   └── lib/
│       ├── api.ts                 # API client
│       └── socket.ts              # Socket.io client
```

---

## 資料庫 Schema 設計重點

使用 **Prisma ORM**，主要 Table 關係：

```
tenants
  └── channels (1:N)
  └── contacts (1:N)
       └── channel_identities (1:N)
       └── contact_tags (N:M) ── tags
       └── contact_relations (1:N)
       └── contact_attributes (1:N)
  └── conversations (1:N)
       └── messages (1:N)
       └── cases (1:1 optional)
  └── cases (1:N)
       └── case_events (1:N)
  └── agents (1:N)
  └── automation_rules (1:N)
  └── km_articles (1:N)
  └── marketing_campaigns (1:N)
```

---

## 環境變數清單

```env
# 資料庫
DATABASE_URL=postgresql://user:pass@localhost:5432/open333crm
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d

# 物件儲存
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=crm-media

# LINE（每個 Channel 的 credentials 存在 DB，這是 Webhook 驗證 base URL）
LINE_WEBHOOK_BASE_URL=https://your-domain.com/webhooks/line

# FB
FB_APP_ID=your-fb-app-id
FB_APP_SECRET=your-fb-app-secret
FB_WEBHOOK_VERIFY_TOKEN=your-verify-token

# AI / LLM
LLM_PROVIDER=openai             # openai | ollama | azure_openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OLLAMA_ENDPOINT=http://localhost:11434

# Embedding
EMBEDDING_PROVIDER=openai       # openai | ollama
EMBEDDING_MODEL=text-embedding-3-small

# SMTP（可選，Email 通知用）
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
```

---

## Docker Compose 完整設定

```yaml
version: '3.9'

services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [api, web]

  web:
    build: ./apps/web
    environment:
      - NEXT_PUBLIC_API_URL=https://your-domain.com/api
      - NEXT_PUBLIC_WS_URL=wss://your-domain.com

  api:
    build: ./apps/api
    env_file: .env
    depends_on: [postgres, redis, minio]
    volumes:
      - ./logs:/app/logs

  worker:
    build: ./apps/api
    command: node dist/workers/index.js
    env_file: .env
    depends_on: [postgres, redis]

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: open333crm
      POSTGRES_USER: crm
      POSTGRES_PASSWORD: StrongPass!
    volumes:
      - pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass RedisPass!
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    ports: ["9001:9001"]

volumes:
  pg_data:
  redis_data:
  minio_data:
  caddy_data:
```

---

## 安全考量

| 威脅 | 對策 |
|------|------|
| 未授權 API 存取 | JWT + API Key 雙重認證 |
| Webhook 偽造 | HMAC-SHA256 簽名驗證（LINE / FB 原生機制）|
| SQL Injection | Prisma ORM（prepared statements）|
| XSS | Content Security Policy + React 預設 XSS 防護 |
| Rate Limit | Redis-based Rate Limiter（每 IP / 每 API Key）|
| 媒體檔案存取 | MinIO presigned URL（有效期 1 小時）|
| 密碼保護 | bcrypt hash（rounds: 12）|
| 敏感資料 | Channel credentials 加密存儲（AES-256）|
