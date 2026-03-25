# 16 — CRM 資料庫 Schema（Prisma）

> 使用 PostgreSQL + pgvector。Prisma 作為 ORM。
> 所有 Table 都有 `tenant_id` 作為行級隔離依據（Row-Level 邏輯隔離）。

---

## prisma/schema.prisma

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector"), pgcrypto]
}

// ─────────────────────────────────────────────
// 基礎：Agent（客服人員）
// ─────────────────────────────────────────────

model Agent {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String   @db.Uuid
  email        String
  name         String
  avatarUrl    String?
  role         AgentRole @default(AGENT)
  isActive     Boolean   @default(true)
  passwordHash String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  teams            AgentTeamMember[]
  assignedConvs    Conversation[]    @relation("AssignedAgent")
  assignedCases    Case[]            @relation("AssignedAgent")
  caseEvents       CaseEvent[]
  sentMessages     Message[]

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("agents")
}

enum AgentRole {
  ADMIN
  SUPERVISOR
  AGENT
}

model Team {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @db.Uuid
  name      String
  createdAt DateTime @default(now())

  members   AgentTeamMember[]
  cases     Case[]

  @@index([tenantId])
  @@map("teams")
}

model AgentTeamMember {
  agentId  String @db.Uuid
  teamId   String @db.Uuid
  agent    Agent  @relation(fields: [agentId], references: [id], onDelete: Cascade)
  team     Team   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@id([agentId, teamId])
  @@map("agent_team_members")
}

// ─────────────────────────────────────────────
// 渠道（Channel）
// ─────────────────────────────────────────────

model Channel {
  id                   String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId             String      @db.Uuid
  channelType          ChannelType
  displayName          String
  isActive             Boolean     @default(true)
  credentialsEncrypted String      // AES-256 加密後的 JSON
  settings             Json        @default("{}")
  webhookUrl           String?     // 系統自動填入
  lastVerifiedAt       DateTime?
  createdAt            DateTime    @default(now())
  updatedAt            DateTime    @updatedAt

  channelIdentities    ChannelIdentity[]
  conversations        Conversation[]

  @@index([tenantId])
  @@map("channels")
}

enum ChannelType {
  LINE
  FB
  WEBCHAT
  WHATSAPP
}

// ─────────────────────────────────────────────
// 聯繫人（Contact）
// ─────────────────────────────────────────────

model Contact {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String    @db.Uuid
  displayName String
  avatarUrl   String?
  phone       String?
  email       String?
  language    String    @default("zh-TW")
  isBlocked   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  channelIdentities  ChannelIdentity[]
  attributes         ContactAttribute[]
  tags               ContactTag[]
  relationsFrom      ContactRelation[]   @relation("FromContact")
  relationsTo        ContactRelation[]   @relation("ToContact")
  conversations      Conversation[]
  cases              Case[]

  @@index([tenantId])
  @@index([tenantId, phone])
  @@index([tenantId, email])
  @@map("contacts")
}

model ChannelIdentity {
  id          String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contactId   String      @db.Uuid
  channelId   String      @db.Uuid
  channelType ChannelType
  uid         String      // LINE userId / FB psid / etc.
  profileName String?
  profilePic  String?
  linkedAt    DateTime    @default(now())

  contact  Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  channel  Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@unique([channelId, uid])
  @@index([contactId])
  @@map("channel_identities")
}

model ContactAttribute {
  id        String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contactId String  @db.Uuid
  key       String  // e.g. 'appliance_brand'
  value     String
  dataType  String  @default("string")  // string | number | date | boolean

  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@unique([contactId, key])
  @@map("contact_attributes")
}

model ContactRelation {
  id             String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fromContactId  String  @db.Uuid
  toContactId    String  @db.Uuid
  relationType   String  // referrer / family / colleague
  notes          String?
  createdAt      DateTime @default(now())

  fromContact    Contact  @relation("FromContact", fields: [fromContactId], references: [id], onDelete: Cascade)
  toContact      Contact  @relation("ToContact", fields: [toContactId], references: [id], onDelete: Cascade)

  @@unique([fromContactId, toContactId, relationType])
  @@map("contact_relations")
}

// ─────────────────────────────────────────────
// 標籤（Tag）
// ─────────────────────────────────────────────

model Tag {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String   @db.Uuid
  name        String
  color       String   @default("#6366f1")
  type        TagType  @default(MANUAL)
  scope       TagScope @default(CONTACT)
  description String?
  createdAt   DateTime @default(now())

  contactTags ContactTag[]

  @@unique([tenantId, name, scope])
  @@index([tenantId])
  @@map("tags")
}

enum TagType  { MANUAL AUTO SYSTEM CHANNEL }
enum TagScope { CONTACT CONVERSATION CASE }

model ContactTag {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contactId String   @db.Uuid
  tagId     String   @db.Uuid
  addedBy   String   @default("agent")  // agent | system | automation
  addedById String?  @db.Uuid
  addedAt   DateTime @default(now())
  expiresAt DateTime?

  contact  Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  tag      Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([contactId, tagId])
  @@map("contact_tags")
}

// ─────────────────────────────────────────────
// 對話與訊息（Conversation & Message）
// ─────────────────────────────────────────────

model Conversation {
  id            String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String             @db.Uuid
  contactId     String             @db.Uuid
  channelId     String             @db.Uuid
  channelType   ChannelType
  status        ConversationStatus @default(ACTIVE)
  assignedToId  String?            @db.Uuid
  caseId        String?            @db.Uuid @unique
  unreadCount   Int                @default(0)
  botRepliesCount Int              @default(0)   // 記錄 Bot 連續回覆次數
  handoffReason String?            // 升人工原因
  lastMessageAt DateTime?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  contact   Contact   @relation(fields: [contactId], references: [id])
  channel   Channel   @relation(fields: [channelId], references: [id])
  assignedTo Agent?   @relation("AssignedAgent", fields: [assignedToId], references: [id])
  case      Case?     @relation(fields: [caseId], references: [id])
  messages  Message[]

  @@index([tenantId, status])
  @@index([tenantId, contactId])
  @@index([tenantId, lastMessageAt(sort: Desc)])
  @@map("conversations")
}

enum ConversationStatus {
  ACTIVE
  BOT_HANDLED
  AGENT_HANDLED
  CLOSED
}

model Message {
  id             String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  conversationId String      @db.Uuid
  direction      Direction   @default(INBOUND)
  senderType     SenderType
  senderId       String?     @db.Uuid
  contentType    String      // text | image | file | flex | template | postback | ...
  content        Json
  channelMsgId   String?     // 渠道原始 message ID
  isRead         Boolean     @default(false)
  createdAt      DateTime    @default(now())

  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         Agent?       @relation(fields: [senderId], references: [id])

  @@index([conversationId, createdAt])
  @@map("messages")
}

enum Direction  { INBOUND OUTBOUND }
enum SenderType { CONTACT AGENT BOT SYSTEM }

// ─────────────────────────────────────────────
// 案件（Case）
// ─────────────────────────────────────────────

model Case {
  id             String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String       @db.Uuid
  contactId      String       @db.Uuid
  channelId      String       @db.Uuid
  conversationId String?      @db.Uuid
  title          String
  description    String?
  status         CaseStatus   @default(OPEN)
  priority       Priority     @default(MEDIUM)
  category       String?
  assigneeId     String?      @db.Uuid
  teamId         String?      @db.Uuid
  slaPolicy      String?      // SlaPolicy.id
  slaDueAt       DateTime?
  resolvedAt     DateTime?
  closedAt       DateTime?
  csatScore      Int?         // 1~5
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  contact        Contact      @relation(fields: [contactId], references: [id])
  assignee       Agent?       @relation("AssignedAgent", fields: [assigneeId], references: [id])
  team           Team?        @relation(fields: [teamId], references: [id])
  conversation   Conversation?
  events         CaseEvent[]
  notes          CaseNote[]

  @@index([tenantId, status])
  @@index([tenantId, assigneeId])
  @@index([tenantId, slaDueAt])
  @@map("cases")
}

enum CaseStatus {
  OPEN
  IN_PROGRESS
  PENDING
  RESOLVED
  ESCALATED
  CLOSED
}

enum Priority { LOW MEDIUM HIGH URGENT }

model CaseEvent {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  caseId     String   @db.Uuid
  actorType  String   // agent | system | contact
  actorId    String?  @db.Uuid
  eventType  String   // created | assigned | status_changed | escalated | closed | ...
  payload    Json     @default("{}")
  createdAt  DateTime @default(now())

  case   Case   @relation(fields: [caseId], references: [id], onDelete: Cascade)
  actor  Agent? @relation(fields: [actorId], references: [id])

  @@index([caseId])
  @@map("case_events")
}

model CaseNote {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  caseId    String   @db.Uuid
  agentId   String   @db.Uuid
  content   String
  isInternal Boolean @default(true)
  createdAt DateTime @default(now())

  case  Case  @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@index([caseId])
  @@map("case_notes")
}

model SlaPolicy {
  id                   String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId             String   @db.Uuid
  name                 String
  priority             Priority
  firstResponseMinutes Int
  resolutionMinutes    Int
  warningBeforeMinutes Int      @default(30)
  isDefault            Boolean  @default(false)
  createdAt            DateTime @default(now())

  @@index([tenantId])
  @@map("sla_policies")
}

// ─────────────────────────────────────────────
// 自動化規則（Automation）
// ─────────────────────────────────────────────

model AutomationRule {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  name       String
  isActive   Boolean  @default(true)
  trigger    Json     // { type, params }
  conditions Json     @default("[]")  // Condition[]
  actions    Json     // Action[]
  runCount   Int      @default(0)
  lastRunAt  DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  logs  AutomationLog[]

  @@index([tenantId, isActive])
  @@map("automation_rules")
}

model AutomationLog {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ruleId     String   @db.Uuid
  tenantId   String   @db.Uuid
  triggerRef String?  // 觸發此規則的事件 ID
  success    Boolean
  actionsRan Json     @default("[]")
  errorMsg   String?
  createdAt  DateTime @default(now())

  rule  AutomationRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@index([ruleId])
  @@index([tenantId, createdAt(sort: Desc)])
  @@map("automation_logs")
}

// ─────────────────────────────────────────────
// 知識庫（KM）
// ─────────────────────────────────────────────

model KmArticle {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String    @db.Uuid
  title          String
  content        String    // Markdown
  summary        String
  category       String
  tags           String[]
  status         KmStatus  @default(DRAFT)
  embedding      Unsupported("vector(1536)")?
  embeddingModel String?
  viewCount      Int       @default(0)
  helpfulCount   Int       @default(0)
  createdById    String    @db.Uuid
  updatedAt      DateTime  @updatedAt
  createdAt      DateTime  @default(now())

  @@index([tenantId, status])
  @@map("km_articles")
}

enum KmStatus { DRAFT PUBLISHED ARCHIVED }

// ─────────────────────────────────────────────
// 訊息模板（Message Template）
// ─────────────────────────────────────────────

model MessageTemplate {
  id          String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String?     @db.Uuid    // null = 系統預設
  name        String
  description String?
  category    String
  channelType String      @default("universal")  // line | fb | universal
  contentType String      // text | flex | quick_reply | fb_generic | fb_carousel
  body        Json        // TemplateBody（含 flexJson / text / quickReplies 等）
  variables   Json        @default("[]")  // TemplateVariable[]
  previewImageUrl String?
  isActive    Boolean     @default(true)
  isSystem    Boolean     @default(false)
  usageCount  Int         @default(0)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([tenantId])
  @@map("message_templates")
}

// ─────────────────────────────────────────────
// 行銷（Marketing）
// ─────────────────────────────────────────────

model MarketingCampaign {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String         @db.Uuid
  name        String
  description String?
  status      CampaignStatus @default(DRAFT)
  startDate   DateTime?
  endDate     DateTime?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  broadcasts  Broadcast[]

  @@index([tenantId])
  @@map("marketing_campaigns")
}

enum CampaignStatus { DRAFT ACTIVE COMPLETED CANCELLED }

model Broadcast {
  id             String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String          @db.Uuid
  campaignId     String?         @db.Uuid
  name           String
  channelId      String          @db.Uuid
  templateId     String?         @db.Uuid
  segmentId      String?         @db.Uuid
  status         BroadcastStatus @default(DRAFT)
  scheduledAt    DateTime?
  startedAt      DateTime?
  completedAt    DateTime?
  totalSent      Int             @default(0)
  totalDelivered Int             @default(0)
  totalReplied   Int             @default(0)
  createdAt      DateTime        @default(now())

  campaign   MarketingCampaign? @relation(fields: [campaignId], references: [id])

  @@index([tenantId, status])
  @@map("broadcasts")
}

enum BroadcastStatus { DRAFT SCHEDULED SENDING COMPLETED CANCELLED FAILED }

model Segment {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String   @db.Uuid
  name       String
  conditions Json     // SegmentCondition[]
  logic      String   @default("AND")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([tenantId])
  @@map("segments")
}

// ─────────────────────────────────────────────
// 外部 Webhook 訂閱
// ─────────────────────────────────────────────

model WebhookSubscription {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @db.Uuid
  url       String
  events    String[]
  secret    String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([tenantId])
  @@map("webhook_subscriptions")
}
```

---

## 索引策略說明

| 索引 | 原因 |
|------|------|
| `(tenantId)` 全局 | 所有 Query 必帶 tenantId，索引不可少 |
| `conversations(tenantId, status)` | 收件匣列表最常見的 filter |
| `conversations(tenantId, lastMessageAt DESC)` | 收件匣排序依最新訊息 |
| `cases(tenantId, assigneeId)` | Agent 個人 Case 看板 |
| `cases(tenantId, slaDueAt)` | SLA Worker 定時掃描到期案件 |
| `km_articles` embedding 向量 | 需額外建 pgvector HNSW index（見下） |

### pgvector HNSW Index（KM 文章向量搜尋）

```sql
CREATE INDEX km_articles_embedding_idx
  ON km_articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 重要設計決策

### 1. Conversation ↔ Case 1:1 關係

`Conversation.caseId` 加 `@unique`，保證一個對話只能開一個 Case。
若需要跨對話的 Case，透過 Case 本身可關聯多個 Conversation（未來擴展）。

### 2. AutomationRule 的 trigger / conditions / actions 存 JSONB

規則結構靈活多變，用 JSONB 比多張中間表更彈性。
查詢時 Automation Worker 撈出 JSON 在 application layer 評估，不在 DB 內計算。

### 3. ChannelIdentity 的唯一鍵

`@@unique([channelId, uid])` — 同一個渠道同一個 uid 只能對應一個 Contact。
支援 Contact 合併：合併時把舊 Contact 的 ChannelIdentities 移轉到新 Contact。

### 4. Message.content 存 JSONB

每種 contentType（text / flex / image）的 content 結構不同，
用 JSONB 統一欄位，由 application layer 根據 contentType 反序列化。

### 5. SLA Policy 鬆耦合

`Case.slaPolicy` 只存 Policy 的 id（字串），不做 FK。
允許 Policy 刪除後，歷史 Case 的 SLA 記錄不被連帶影響。
Conversation（未來擴展）。

### 2. AutomationRule 的 trigger / conditions / actions 存 JSONB

規則結構靈活多變，用 JSONB 比多張中間表更彈性。
查詢時 Automation Worker 撈出 JSON 在 application layer 評估，不在 DB 內計算。

### 3. ChannelIdentity 的唯一鍵

`@@unique([channelId, uid])` — 同一個渠道同一個 uid 只能對應一個 Contact。
支援 Contact 合併：合併時把舊 Contact 的 ChannelIdentities 移轉到新 Contact。

### 4. Message.content 存 JSONB

每種 contentType（text / flex / image）的 content 結構不同，
用 JSONB 統一欄位，由 application layer 根據 contentType 反序列化。

### 5. SLA Policy 鬆耦合

`Case.slaPolicy` 只存 Policy 的 id（字串），不做 FK。
允許 Policy 刪除後，歷史 Case 的 SLA 記錄不被連帶影響。
