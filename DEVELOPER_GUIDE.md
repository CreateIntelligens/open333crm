# open333CRM Developer Guide

> Last updated: 2026-04-07

---

## 1. Architecture Overview

```
Monorepo (pnpm workspace + Turborepo)
├── apps/
│   ├── api/          # Fastify + TypeScript (Backend API + WebSocket)
│   ├── web/          # Next.js App Router + shadcn/ui (Frontend)
│   └── widget/       # Webchat 嵌入式元件 (Vite)
├── packages/
│   ├── db/           # Prisma ORM + PostgreSQL schema (主要)
│   ├── database/     # Thin alias → @open333crm/db
│   ├── shared/       # 共用 types, constants
│   ├── core/         # 核心業務邏輯 (automation, cases, contacts)
│   ├── types/        # TypeScript 型別定義
│   ├── automation/   # Automation engine
│   └── channel-plugins/  # LINE/FB/WebChat channel 實作
└── docker-compose.yml
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Fastify + TypeScript |
| Frontend | Next.js 14 App Router + shadcn/ui + Tailwind CSS |
| Database | PostgreSQL 16 (pgvector extension) + Prisma ORM |
| Cache | Redis 7 |
| WebSocket | Socket.io (掛在 Fastify HTTP server) |
| Object Storage | MinIO (S3-compatible) |
| LLM | Ollama (bge-m3 embedding, qwen2.5:3b chat) |
| Automation | json-rules-engine + react-querybuilder |
| Charts | Recharts |
| Build | Turborepo + pnpm workspaces |

---

## 2. Quick Start

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker + Docker Compose

### Setup

```bash
# 1. Clone
git clone https://github.com/CreateIntelligens/open333crm.git
cd open333crm

# 2. Start infrastructure
docker compose up -d

# 3. Install dependencies
pnpm install

# 4. Generate Prisma client
pnpm db:generate

# 5. Push schema to DB
pnpm --filter @open333crm/db exec prisma db push

# 6. Seed demo data
pnpm db:seed

# 7. Start dev servers
pnpm dev
```

### Ports

| Service | Port | Notes |
|---------|------|-------|
| API + WebSocket | 3001 | Fastify + Socket.io 共用 |
| Web (Next.js) | 3000 | |
| PostgreSQL | 5433 | (非預設 5432) |
| Redis | 6380 | (非預設 6379) |
| Ollama | 11434 | LLM 推理 |
| MinIO API | 9000 | S3-compatible |
| MinIO Console | 9001 | Web UI |

### Environment Variables (.env)

```bash
# Database
DATABASE_URL=postgresql://crm:crmpassword@localhost:5433/open333crm
REDIS_URL=redis://localhost:6380
JWT_SECRET=poc-dev-secret-change-in-production
JWT_EXPIRES_IN=7d
API_PORT=3001

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_WS_URL=http://localhost:3001

# Ollama / LLM
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=bge-m3
OLLAMA_CHAT_MODEL=qwen2.5:3b
KB_SIMILARITY_THRESHOLD=0.72
KB_AUTO_REPLY_ENABLED=true

# MinIO / S3
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=open333crm
S3_REGION=us-east-1
S3_PUBLIC_URL=http://localhost:9000

# LINE OAuth (optional)
LINE_LOGIN_CHANNEL_ID=
LINE_LOGIN_CHANNEL_SECRET=
LINE_LOGIN_CALLBACK_URL=

# Facebook OAuth (optional)
FB_LOGIN_APP_ID=
FB_LOGIN_APP_SECRET=
FB_LOGIN_CALLBACK_URL=
```

### Demo Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@demo.com | admin123 | ADMIN |
| supervisor@demo.com | admin123 | SUPERVISOR |
| agent1@demo.com | admin123 | AGENT |

---

## 3. Database Schema

### Enums (15)

| Enum | Values |
|------|--------|
| AgentRole | ADMIN, SUPERVISOR, AGENT |
| ChannelType | LINE, FB, WEBCHAT, WHATSAPP |
| ConversationStatus | ACTIVE, BOT_HANDLED, AGENT_HANDLED, CLOSED |
| Direction | INBOUND, OUTBOUND |
| SenderType | CONTACT, AGENT, BOT, SYSTEM |
| CaseStatus | OPEN, IN_PROGRESS, PENDING, RESOLVED, ESCALATED, CLOSED |
| Priority | LOW, MEDIUM, HIGH, URGENT |
| TagType | MANUAL, AUTO, SYSTEM, CHANNEL |
| TagScope | CONTACT, CONVERSATION, CASE |
| KmStatus | DRAFT, PUBLISHED, ARCHIVED |
| PortalActivityType | POLL, FORM, QUIZ |
| PortalActivityStatus | DRAFT, PUBLISHED, ENDED, ARCHIVED |
| ScopeType | TENANT, TEAM, CHANNEL |
| ExecutionStatus | SUCCESS, PARTIAL, FAILED |
| ActionResultStatus | SUCCESS, FAILED, ROLLED_BACK |

### Models (39 tables)

#### Core

| Model | Table | Description |
|-------|-------|-------------|
| Agent | agents | 客服人員 (id, tenantId, email, name, role, passwordHash, isActive) |
| Team | teams | 客服團隊 |
| AgentTeamMember | agent_team_members | 客服-團隊多對多 |
| Channel | channels | 頻道 (LINE/FB/WEBCHAT, credentials 加密存放) |
| Contact | contacts | 客戶聯絡人 (displayName, phone, email, language, isBlocked, mergedIntoId) |
| ChannelIdentity | channel_identities | 客戶在各頻道的身份 (uid, profileName) |
| ContactAttribute | contact_attributes | 自定義屬性 (key-value) |
| ContactRelation | contact_relations | 客戶間關係 |
| Tag | tags | 標籤定義 (name, color, type, scope) |
| ContactTag | contact_tags | 客戶-標籤關聯 (含 expiresAt) |

#### Messaging

| Model | Table | Description |
|-------|-------|-------------|
| Conversation | conversations | 對話 (status, assignedToId, botRepliesCount, handoffReason) |
| Message | messages | 訊息 (direction, senderType, contentType, content JSON, metadata JSON) |

#### Case Management

| Model | Table | Description |
|-------|-------|-------------|
| Case | cases | 案件 (status, priority, category, SLA fields, CSAT fields, mergedIntoId) |
| CaseEvent | case_events | 案件事件紀錄 (eventType, payload) |
| CaseNote | case_notes | 案件內部備註 |
| SlaPolicy | sla_policies | SLA 政策 (firstResponseMinutes, resolutionMinutes, warningBeforeMinutes) |

#### Automation

| Model | Table | Description |
|-------|-------|-------------|
| AutomationRule | automation_rules | 自動化規則 (trigger JSON, conditions JSON, actions JSON) |
| AutomationLog | automation_logs | 執行日誌 |
| AutomationExecution | automation_executions | 執行紀錄 (factSnapshot, matchedRuleIds, status) |
| AutomationActionResult | automation_action_results | 動作執行結果 (rollbackable, beforeSnapshot, afterSnapshot) |

#### Knowledge & AI

| Model | Table | Description |
|-------|-------|-------------|
| KmArticle | km_articles | 知識庫文章 (content, summary, embedding vector(1024)) |
| LongTermMemory | long_term_memories | 客戶長期記憶 (content, embedding vector(1024)) |

#### Marketing

| Model | Table | Description |
|-------|-------|-------------|
| MessageTemplate | message_templates | 訊息模板 (body JSON, variables JSON, contentType) |
| Segment | segments | 客群分眾 (rules JSON, contactCount) |
| Campaign | campaigns | 行銷活動 (status: draft/active/completed/cancelled) |
| Broadcast | broadcasts | 廣播 (targetType, scheduledAt, success/failedCount) |
| BroadcastRecipient | broadcast_recipients | 廣播接收者紀錄 |

#### System

| Model | Table | Description |
|-------|-------|-------------|
| Notification | notifications | 通知 (type, title, body, clickUrl, isRead) |
| DailyStat | daily_stats | 每日統計 (statType, dimensionId, data JSON) |
| TenantSettings | tenant_settings | 租戶設定 (timezone, officeHours JSON) |
| WebhookSubscription | webhook_subscriptions | Webhook 訂閱 (events[], secret) |
| WebhookDelivery | webhook_deliveries | Webhook 送達紀錄 |

#### Fan Portal

| Model | Table | Description |
|-------|-------|-------------|
| PortalActivity | portal_activities | 粉絲活動 (POLL/FORM/QUIZ) |
| PortalOption | portal_options | 活動選項 |
| PortalField | portal_fields | 活動欄位 |
| PortalSubmission | portal_submissions | 活動投稿 |
| PointTransaction | point_transactions | 點數交易 (append-only ledger) |

#### Short Links

| Model | Table | Description |
|-------|-------|-------------|
| ShortLink | short_links | 短連結 (slug, UTM params, tagOnClick) |
| ClickLog | click_logs | 點擊紀錄 (ip, userAgent, referer) |

### Key Relations

```
Tenant ─┬─ Agent ──── AgentTeamMember ──── Team
        ├─ Channel ── ChannelIdentity ──── Contact
        ├─ Contact ─┬─ ContactAttribute
        │           ├─ ContactTag ──── Tag
        │           ├─ Conversation ─── Message
        │           ├─ Case ─┬─ CaseEvent
        │           │        └─ CaseNote
        │           ├─ PortalSubmission
        │           └─ PointTransaction
        ├─ AutomationRule ─── AutomationLog
        │                 └── AutomationExecution ── AutomationActionResult
        ├─ Campaign ── Broadcast ── BroadcastRecipient
        ├─ Segment ── Broadcast
        └─ ShortLink ── ClickLog
```

### Important Constraints

- `Agent`: unique `(tenantId, email)`
- `ChannelIdentity`: unique `(channelId, uid)`
- `ContactTag`: unique `(contactId, tagId)`
- `Tag`: unique `(tenantId, name, scope)`
- `Conversation.caseId`: unique (one-to-one)
- `ShortLink.slug`: globally unique
- `TenantSettings.tenantId`: unique
- `DailyStat`: unique `(tenantId, date, statType, dimensionId)`
- All UUIDs use `gen_random_uuid()` (PostgreSQL native)
- **UUID 只能用 hex [0-9a-f]**，不能用 g/h/i 等字母

---

## 4. API Endpoints (120+)

Base URL: `http://localhost:3001`

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | No | Health check |

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/login | No | Email + password 登入 |
| POST | /auth/refresh | Yes | 刷新 JWT |
| GET | /auth/me | Yes | 取得目前登入者 |

### LINE OAuth (`/api/v1/auth/line`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /auth/line/authorize | No | 取得 LINE OAuth URL |
| GET | /auth/line/callback | No | LINE OAuth callback |
| POST | /auth/line/request-email | Yes | 觸發 LINE email 請求 |

### Facebook OAuth (`/api/v1/auth/fb`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /auth/fb/authorize | No | 取得 FB OAuth URL |
| GET | /auth/fb/callback | No | FB OAuth callback |
| POST | /auth/fb/request-email | Yes | 觸發 FB email 請求 |

### Conversations (`/api/v1/conversations`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /conversations | Yes | 列出對話 (filters: status, channelType, assigneeId, unread) |
| GET | /conversations/:id | Yes | 取得對話詳情 |
| PATCH | /conversations/:id | Yes | 更新對話 (status, assignedToId) |
| GET | /conversations/:id/messages | Yes | 列出對話訊息 (paginated) |
| POST | /conversations/:id/messages | Yes | 發送訊息 |
| POST | /conversations/:id/handoff | Yes | Bot → 人工轉接 |
| POST | /conversations/:id/typing | Yes | 打字指示器 |
| POST | /conversations/:id/case | Yes | 從對話建立案件 |

### Contacts (`/api/v1/contacts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /contacts | Yes | 列出客戶 (filters: q, tag, channel) |
| GET | /contacts/merge-preview | Yes | 預覽合併 |
| POST | /contacts/merge | Yes | 合併客戶 |
| GET | /contacts/:id | Yes | 客戶詳情 |
| PATCH | /contacts/:id | Yes | 更新客戶 |
| GET | /contacts/:id/conversations | Yes | 客戶對話列表 |
| GET | /contacts/:id/cases | Yes | 客戶案件列表 |
| POST | /contacts/:id/tags | Yes | 新增標籤 |
| DELETE | /contacts/:id/tags/:tagId | Yes | 移除標籤 |
| GET | /contacts/:id/timeline | Yes | 客戶活動時間軸 |

### Cases (`/api/v1/cases`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /cases/categories | Yes | 案件分類清單 |
| GET | /cases/stats | Yes | 案件統計 |
| GET | /cases | Yes | 列出案件 (filters: status, priority, assignee, SLA) |
| POST | /cases | Yes | 建立案件 |
| GET | /cases/:id | Yes | 案件詳情 |
| PATCH | /cases/:id | Yes | 更新案件 |
| GET | /cases/:id/events | Yes | 案件事件紀錄 |
| POST | /cases/:id/notes | Yes | 新增備註 |
| POST | /cases/:id/assign | Yes | 指派案件 |
| POST | /cases/:id/resolve | Yes | 標記已解決 |
| POST | /cases/:id/close | Yes | 關閉案件 |
| POST | /cases/:id/reopen | Yes | 重新開啟 |
| POST | /cases/:id/escalate | Yes | 升級案件 |
| POST | /cases/:id/csat | Yes | 記錄 CSAT 分數 |
| POST | /cases/from-conversation/:conversationId | Yes | 從對話建案 |

### Tags (`/api/v1/tags`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /tags | Yes | 列出標籤 |
| POST | /tags | Yes | 建立標籤 |
| PATCH | /tags/:id | Yes | 更新標籤 |
| DELETE | /tags/:id | Yes | 刪除標籤 |

### Agents (`/api/v1/agents`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /agents | Yes | 列出客服人員 |

### Channels (`/api/v1/channels`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /channels | Yes | 列出頻道 |
| POST | /channels | Yes | 建立頻道 |
| GET | /channels/:id | Yes | 頻道詳情 |
| PATCH | /channels/:id | Yes | 更新頻道 |
| DELETE | /channels/:id | Yes | 刪除頻道 |
| POST | /channels/:id/verify | Yes | 驗證頻道 credentials |
| POST | /channels/webhook-base-url | Yes | 批次更新 webhook URLs |
| POST | /channels/:id/setup-webhook | Yes | 自動設定 LINE webhook |
| GET | /channels/:id/status | Yes | 取得頻道狀態 (token 有效性) |
| GET | /channels/:id/embed-code | Yes | 取得 WebChat 嵌入碼 |

### Webhooks — Inbound (`/api/v1/webhooks`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /webhooks/line/:channelId | No | LINE Webhook 接收 |
| GET | /webhooks/fb/:channelId | No | FB Webhook 驗證 |
| POST | /webhooks/fb/:channelId | No | FB Webhook 接收 |

### Simulator (`/api/v1/simulator`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /simulator/send-message | Yes | 模擬 inbound 訊息 (測試用) |

### Automation (`/api/v1/automation`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /automation/rules | Yes | 列出自動化規則 |
| POST | /automation/rules | Yes | 建立規則 |
| GET | /automation/rules/:id | Yes | 規則詳情 |
| PATCH | /automation/rules/:id | Yes | 更新規則 |
| DELETE | /automation/rules/:id | Yes | 刪除規則 |
| POST | /automation/rules/:id/test | Yes | 測試規則 |
| GET | /automation/logs | Yes | 執行日誌 |

### Knowledge Base (`/api/v1/knowledge`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /knowledge | Yes | 列出文章 |
| GET | /knowledge/categories | Yes | 文章分類 |
| POST | /knowledge/search | Yes | 語意搜尋 (embedding) |
| POST | /knowledge/import | Yes | 批次匯入 |
| POST | /knowledge/upload | Yes | 上傳 PDF/DOCX |
| POST | /knowledge/bulk-embed | Yes | 重新嵌入所有文章 |
| GET | /knowledge/embedding-status | Yes | Ollama 健康檢查 |
| POST | /knowledge | Yes | 建立文章 |
| GET | /knowledge/:id | Yes | 文章詳情 |
| PATCH | /knowledge/:id | Yes | 更新文章 |
| DELETE | /knowledge/:id | Yes | 刪除文章 |
| POST | /knowledge/:id/publish | Yes | 發佈文章 |
| POST | /knowledge/:id/archive | Yes | 封存文章 |
| POST | /knowledge/:id/embed | Yes | 重新嵌入單篇 |

### Marketing (`/api/v1/marketing`)

#### Templates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /marketing/templates/categories | Yes | 模板分類 |
| GET | /marketing/templates | Yes | 列出模板 |
| POST | /marketing/templates | Yes | 建立模板 |
| GET | /marketing/templates/:id | Yes | 模板詳情 |
| PATCH | /marketing/templates/:id | Yes | 更新模板 |
| DELETE | /marketing/templates/:id | Yes | 刪除模板 |
| POST | /marketing/templates/:id/preview | Yes | 預覽渲染 |
| POST | /marketing/templates/:id/render | Yes | 渲染並發送 |

#### Segments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /marketing/segments | Yes | 列出分眾 |
| POST | /marketing/segments | Yes | 建立分眾 |
| GET | /marketing/segments/:id | Yes | 分眾詳情 |
| PATCH | /marketing/segments/:id | Yes | 更新分眾 |
| DELETE | /marketing/segments/:id | Yes | 刪除分眾 |
| POST | /marketing/segments/preview | Yes | 預覽分眾客戶 |

#### Campaigns

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /marketing/campaigns | Yes | 列出活動 |
| POST | /marketing/campaigns | Yes | 建立活動 |
| GET | /marketing/campaigns/:id | Yes | 活動詳情 |
| PATCH | /marketing/campaigns/:id | Yes | 更新活動 |
| DELETE | /marketing/campaigns/:id | Yes | 刪除活動 |

#### Broadcasts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /marketing/broadcasts | Yes | 列出廣播 |
| POST | /marketing/broadcasts | Yes | 建立廣播 |
| GET | /marketing/broadcasts/:id | Yes | 廣播詳情 |
| POST | /marketing/broadcasts/:id/send | Yes | 手動觸發 |
| POST | /marketing/broadcasts/:id/cancel | Yes | 取消廣播 |

### AI (`/api/v1/ai`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /ai/suggest-reply | Yes | LLM 回覆建議 |
| POST | /ai/summarize | Yes | 對話摘要 |
| POST | /ai/analyze-sentiment | Yes | 情感分析 |
| POST | /ai/classify | Yes | 問題分類 (9 類) |

### SLA Policies (`/api/v1/sla-policies`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /sla-policies | Yes | 列出 SLA 政策 |
| POST | /sla-policies | Yes | 建立 SLA 政策 |
| PATCH | /sla-policies/:id | Yes | 更新 SLA 政策 |
| DELETE | /sla-policies/:id | Yes | 刪除 SLA 政策 |

### Notifications (`/api/v1/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /notifications/unread-count | Yes | 未讀數量 |
| GET | /notifications | Yes | 列出通知 |
| PATCH | /notifications/:id/read | Yes | 標記已讀 |
| POST | /notifications/read-all | Yes | 全部已讀 |

### Analytics (`/api/v1/analytics`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /analytics/overview | Yes | 總覽統計 |
| GET | /analytics/message-trend | Yes | 訊息趨勢 |
| GET | /analytics/cases | Yes | 案件統計 |
| GET | /analytics/agents | Yes | 客服績效 |
| GET | /analytics/channels | Yes | 頻道分析 |
| GET | /analytics/contacts | Yes | 客戶分析 |
| GET | /analytics/my | Yes | 個人績效 |
| GET | /analytics/csat | Yes | CSAT 統計 |
| POST | /analytics/export | Yes | CSV 匯出 |

### Settings (`/api/v1/settings`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /settings/office-hours | Yes | 取得營業時間 |
| PUT | /settings/office-hours | Yes | 更新營業時間 |

### Storage (`/api/v1/files`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /files/upload | Yes | 上傳檔案 (multipart, max 20MB) |
| POST | /files/presign-upload | Yes | 取得 presigned URL |
| DELETE | /files/* | Yes | 刪除檔案 |

### Webhook Subscriptions (`/api/v1/webhook-subscriptions`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /webhook-subscriptions | Yes | 列出訂閱 |
| GET | /webhook-subscriptions/:id | Yes | 訂閱詳情 |
| POST | /webhook-subscriptions | Yes | 建立訂閱 |
| PATCH | /webhook-subscriptions/:id | Yes | 更新訂閱 |
| DELETE | /webhook-subscriptions/:id | Yes | 刪除訂閱 |
| GET | /webhook-subscriptions/:id/deliveries | Yes | 送達紀錄 |
| POST | /webhook-subscriptions/:id/test | Yes | 測試送達 |

### Fan Portal — Admin (`/api/v1/portal`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /portal/activities | Yes | 列出活動 |
| POST | /portal/activities | Yes | 建立活動 |
| GET | /portal/activities/:id | Yes | 活動詳情 |
| PATCH | /portal/activities/:id | Yes | 更新活動 |
| DELETE | /portal/activities/:id | Yes | 刪除活動 |
| POST | /portal/activities/:id/publish | Yes | 發佈活動 |
| POST | /portal/activities/:id/end | Yes | 結束活動 |
| GET | /portal/activities/:id/submissions | Yes | 投稿列表 |
| POST | /portal/activities/:id/draw | Yes | 抽獎 |
| GET | /portal/points | Yes | 點數交易列表 |
| POST | /portal/points/adjust | Yes | 調整點數 |
| GET | /portal/points/balance/:contactId | Yes | 查詢餘額 |

### Fan Portal — Public (`/api/v1/fan`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /fan/auth | No | 粉絲認證 (取得 fan JWT) |
| GET | /fan/activities | Fan JWT | 列出已發佈活動 |
| GET | /fan/activities/:id | Fan JWT | 活動詳情 + 投稿狀態 |
| POST | /fan/activities/:id/submit | Fan JWT | 提交活動回應 |
| GET | /fan/activities/:id/result | Fan JWT | 活動結果/統計 |
| GET | /fan/me/activities | Fan JWT | 我的投稿 |
| GET | /fan/me/points | Fan JWT | 我的點數 |

### Short Links — Admin (`/api/v1/shortlinks`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /shortlinks | Yes | 列出短連結 |
| POST | /shortlinks | Yes | 建立短連結 |
| GET | /shortlinks/:id | Yes | 短連結詳情 |
| PATCH | /shortlinks/:id | Yes | 更新短連結 |
| DELETE | /shortlinks/:id | Yes | 刪除短連結 |
| GET | /shortlinks/:id/stats | Yes | 點擊統計 |
| GET | /shortlinks/:id/clicks | Yes | 點擊紀錄 |
| GET | /shortlinks/:id/qrcode | Yes | 產生 QR Code |

### Short Links — Public (`/s`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /s/:slug | No | 302 redirect + 記錄點擊 |

---

## 5. WebSocket Events (Socket.io)

### Connection

```typescript
// Frontend 連線
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  auth: { token: 'JWT_TOKEN' },
  transports: ['websocket', 'polling'],
});
```

### Rooms

| Room Pattern | Description |
|-------------|-------------|
| `tenant:{tenantId}` | 自動加入，全租戶廣播 |
| `agent:{agentId}` | 自動加入，個人通知 |
| `conversation:{id}` | 手動訂閱，對話訊息 |

### Events (Server → Client)

| Event | Room | Payload |
|-------|------|---------|
| `message.new` | conversation + tenant | `{ conversationId, message: { id, direction, senderType, contentType, content, createdAt, sender? } }` |
| `conversation.updated` | conversation + tenant | `{ id, status, assignedToId, unreadCount, lastMessageAt, handoffReason? }` |
| `case.created` | tenant | `{ id, title, status, priority, source? }` |
| `case.updated` | tenant | `{ id, status, priority, assigneeId, source? }` |
| `contact.merged` | tenant | `{ primaryContactId, secondaryContactId }` |
| `notification.new` | agent | Full Notification object |
| `typing.start` | conversation | `{ conversationId, agentId }` |
| `typing.stop` | conversation | `{ conversationId }` |

### Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `room: string` | 加入房間 (e.g. `conversation:uuid`) |
| `unsubscribe` | `room: string` | 離開房間 |

---

## 6. EventBus Events (Backend Internal)

Backend 內部事件匯流排，用於觸發自動化、通知、分析等。

| Event | Published By | Payload |
|-------|-------------|---------|
| `message.received` | webhook.service | `{ contactId, conversationId, messageId, messageContent, contentType }` |
| `message.sent` | conversation.service | `{ conversationId, messageId, agentId }` |
| `conversation.created` | webhook.service | `{ contactId, conversationId }` |
| `conversation.handoff` | automation.worker | `{ conversationId, reason, summary, previousStatus }` |
| `case.created` | case.service | `{ caseId, contactId, channelId, title, priority }` |
| `case.assigned` | case.service | `{ caseId, assigneeId, title }` |
| `case.escalated` | case.service | `{ caseId, contactId, previousPriority, newPriority, reason }` |
| `case.resolved` | case.service | `{ caseId, contactId, channelId, conversationId }` |
| `case.closed` | case.service | `{ caseId, contactId, channelId, conversationId }` |
| `contact.tagged` | contact.service | `{ contactId, tagId, tagName }` |
| `keyword.matched` | automation.worker | `{ contactId, conversationId, matchedKeywords, ruleId }` |
| `sentiment.negative` | automation.worker | `{ conversationId, messageId, contactId, sentiment }` |
| `sla.warning` | sla.worker | `{ caseId, assigneeId, title, slaDueAt }` |
| `sla.breached` | sla.worker | `{ caseId, assigneeId, title, type: 'resolution'/'first_response' }` |
| `portal.activity.submitted` | portal.service | `{ activityId, submissionId, contactId }` |
| `link.clicked` | shortlink.service | `{ linkId, slug, contactId }` |

---

## 7. Automation Engine

### Trigger Types

| Trigger | Description |
|---------|-------------|
| `message.received` | 收到客戶訊息 |
| `keyword.matched` | 訊息符合關鍵字 |
| `case.created` | 建立案件 |
| `case.escalated` | 案件升級 |
| `conversation.created` | 新對話建立 |
| `contact.tagged` | 客戶被加標籤 |
| `portal.activity.submitted` | 粉絲活動投稿 |
| `link.clicked` | 短連結被點擊 |

### Action Types (14)

| Action | Description |
|--------|-------------|
| `send_message` | 發送訊息到對話 (+ deliverToChannel) |
| `llm_reply` | LLM 自動回覆 |
| `kb_auto_reply` | 知識庫自動回覆 |
| `create_case` | 建立案件 |
| `update_case_status` | 更新案件狀態 |
| `escalate_case` | 升級案件 |
| `add_tag` | 新增標籤 |
| `remove_tag` | 移除標籤 |
| `assign_agent` | 指派客服 |
| `assign_bot` | 指派 Bot |
| `auto_assign` | 自動輪派 (Round-Robin) |
| `notify` | 發送通知 |
| `notify_supervisor` | 通知主管 |

### Protection

- Opt-out tag check: `do_not_disturb`, `opt_out`, `勿擾`, `退訂`
- Rate limit: 3 次/小時/規則+客戶

### Rule JSON Format

```json
{
  "trigger": {
    "type": "message.received",
    "keywords": ["退貨", "退款"],
    "match_mode": "any"
  },
  "conditions": {},
  "actions": [
    { "type": "add_tag", "params": { "tagName": "退貨需求" } },
    { "type": "create_case", "params": { "title": "退貨案件", "priority": "HIGH" } }
  ]
}
```

---

## 8. Bot Router (Channel BotConfig)

每個 Channel 可獨立設定 Bot 行為，存在 `channels.settings.botConfig`：

```json
{
  "botMode": "keyword_then_llm",
  "maxBotReplies": 5,
  "handoffKeywords": ["真人", "人工", "客服", "轉接"],
  "handoffMessage": "稍等，正在為您轉接客服人員",
  "offlineGreeting": "您好，目前為非營業時間..."
}
```

| botMode | Description |
|---------|-------------|
| `off` | 不啟用 Bot，直接 AGENT_HANDLED |
| `keyword` | 只用關鍵字規則回覆 |
| `llm` | 只用 LLM 回覆 |
| `keyword_then_llm` | 先查關鍵字規則，無匹配則用 LLM |

### Auto-Handoff Conditions

1. Bot 回覆次數達 `maxBotReplies` 上限
2. 客戶訊息含 `handoffKeywords` 關鍵字
3. 客戶發送圖片/檔案/影片

---

## 9. Channel Plugins

### LINE

- **Webhook**: POST `/api/v1/webhooks/line/:channelId`
- **Credentials**: `{ channelAccessToken, channelSecret }`
- **Features**: Text, Image, Video, Audio, File, Location, Sticker, Postback, Flex Message
- **CSAT**: Flex Message with postback buttons `csat:{score}:{caseId}`
- **Media**: 自動下載 LINE Content API → MinIO

### Facebook Messenger

- **Webhook**: POST `/api/v1/webhooks/fb/:channelId`
- **Verification**: GET `/api/v1/webhooks/fb/:channelId` (hub.verify_token)
- **Credentials**: `{ pageAccessToken, appId, appSecret, verifyToken }`
- **Features**: Text, Image, Video, Audio, File, Location, Postback
- **Token Monitor**: `debug_token` API 檢查 token 過期

### WebChat

- **Embed Code**: `GET /api/v1/channels/:id/embed-code`
- **Credentials**: `{ widgetKey }`
- **Features**: Text, Image, File

---

## 10. Background Workers

API 啟動時自動註冊，運行在同一個 process。

| Worker | File | Description |
|--------|------|-------------|
| AutomationWorker | automation.worker.ts | 監聽 eventBus，觸發自動化規則 |
| NotificationWorker | notification.worker.ts | 監聽事件，建立通知 |
| AnalyticsScheduler | analytics.scheduler.ts | 每日 2AM 聚合統計 |
| BroadcastScheduler | broadcast.scheduler.ts | 每 60s 輪詢排程廣播 |
| CsatScheduler | csat.scheduler.ts | 每 60s 發送 CSAT 問卷 + 自動關閉 |
| SlaWorker | sla.worker.ts | 每 60s 檢查 SLA 警告/違約/首次回應 |
| WebhookDispatcher | webhook-dispatcher.ts | 監聽 eventBus，轉發到外部 webhook |

---

## 11. Frontend Structure

### Pages (15 routes)

| Route | Description |
|-------|-------------|
| `/login` | 登入頁 |
| `/dashboard` | 首頁/總覽 |
| `/dashboard/inbox` | 對話收件匣 |
| `/dashboard/contacts` | 客戶列表 |
| `/dashboard/contacts/[id]` | 客戶詳情 |
| `/dashboard/cases` | 案件列表 |
| `/dashboard/cases/[id]` | 案件詳情 |
| `/dashboard/knowledge` | 知識庫 |
| `/dashboard/automation` | 自動化規則 |
| `/dashboard/automation/[id]` | 規則編輯 |
| `/dashboard/marketing` | 行銷 (5 tabs: 模板/分眾/活動/廣播) |
| `/dashboard/marketing/campaigns/[id]` | 活動詳情 |
| `/dashboard/analytics` | 分析報表 (4 tabs) |
| `/dashboard/analytics/my` | 個人績效 |
| `/dashboard/notifications` | 通知列表 |
| `/dashboard/settings` | 設定 (頻道/客服/標籤/營業時間/SLA/Bot) |
| `/dashboard/portal` | 粉絲活動 (3 tabs) |
| `/dashboard/shortlinks` | 短連結 (2 tabs) |

### Hooks (13 SWR hooks)

| Hook | Description |
|------|-------------|
| useConversations | 對話列表 + WebSocket 即時更新 |
| useMessages | 對話訊息 |
| useContacts | 客戶列表 |
| useCases | 案件列表 |
| useChannels | 頻道列表 |
| useTemplates | 訊息模板 |
| useKnowledge | 知識庫文章 |
| useAutomation | 自動化規則 |
| useMarketing | 行銷活動/分眾 |
| useAnalytics | 分析數據 |
| useNotifications | 通知 |
| usePortal | 粉絲活動 |
| useShortLinks | 短連結 |

### Providers

| Provider | Description |
|----------|-------------|
| AuthProvider | JWT auth context, login/logout, token 驗證 |
| SocketProvider | Socket.io 連線管理, 自動加入 inbox room |

### Key Lib Files

| File | Description |
|------|-------------|
| lib/api.ts | Axios HTTP client, Bearer token interceptor |
| lib/socket.ts | Socket.io client singleton |
| lib/constants.ts | API_BASE_URL, WS_URL |

---

## 12. Docker Compose Services

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5433:5432"]
    env: POSTGRES_DB=open333crm, POSTGRES_USER=crm, POSTGRES_PASSWORD=crmpassword

  redis:
    image: redis:7-alpine
    ports: ["6380:6379"]

  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    env: MINIO_ROOT_USER=minioadmin, MINIO_ROOT_PASSWORD=minioadmin
```

> **Note**: API 和 Web 不在 docker-compose 裡，用 `pnpm dev` 運行。WebSocket (Socket.io) 內建在 API server，與 HTTP 共用 port 3001。

---

## 13. Common Development Gotchas

### ESM Import

- workspace packages 需要 `"type": "module"` + `"exports"` in package.json
- Import `PrismaClient` 直接從 `@prisma/client`，不要從 `@open333crm/db` re-export
- 必須先執行 `pnpm db:generate` 再啟動 API

### UUID

- UUID 只能用 hex [0-9a-f]，字母 g/h/i 是無效的
- Tenant ID (hardcoded POC): `a0000000-0000-0000-0000-000000000001`

### Automation Data Format

- Backend: `{ type, params }` / Frontend: `{ type, payload }`
- 載入時 normalize `params → payload`，儲存時 `payload → params`
- trigger format: `{ type: 'event.name', keywords?: [], match_mode?: 'any'|'all' }`

### Prisma JSON

- 必須用 `as unknown as TargetType[]`（不能只用 `as TargetType[]`）
- SentimentResult 等複雜物件存入 JSON 時用 `JSON.parse(JSON.stringify(...))`

### Recharts

- `tickFormatter` callback 接收 `string | number`，需先 `String(v)` 再操作
