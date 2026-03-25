# 16 — CRM 資料庫 Schema（Prisma）

> 使用 PostgreSQL + pgvector。Prisma 作為 ORM。
> 所有 Table 都有 `tenant_id` 作為行級隔離依據（Row-Level 邏輯隔離）。

---

## prisma/schema.prisma

```prisma
// ... (provider & datasource)

model Agent {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  // ...
  sentMessages     Message[]
  notifications    Notification[]   // 新增：客服人員的通知列表
  
  @@map("agents")
}

// ... (Team & Channel)

model Conversation {
  id               String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  // ...
  botRepliesCount  Int                @default(0) // 新增：Bot 回覆次數，用於判斷升人工
  handoffReason    String?            // 新增：升人工原因
  messages         Message[]

  @@map("conversations")
}

model Message {
  id                  String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  conversationId      String      @db.Uuid
  direction           Direction   @default(INBOUND)
  senderType          SenderType
  senderId            String?     @db.Uuid
  contentType         String
  content             Json
  
  isAiSuggested       Boolean     @default(false)  // 新增
  isAdopted           Boolean     @default(false)  // 新增
  originalSuggestion  Json?                       // 新增
  adoptedAt           DateTime?                   // 新增
  
  createdAt           DateTime    @default(now())

  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         Agent?       @relation(fields: [senderId], references: [id])

  @@index([conversationId, createdAt])
  @@map("messages")
}

// ... (Case, Automation, etc.)


// ─────────────────────────────────────────────
// 通知系統 (Notification Bell)
// ─────────────────────────────────────────────

model Notification {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String    @db.Uuid
  agentId    String    @db.Uuid
  type       String    // new_message | case_assigned | sla_warning | csat_low | note_added
  priority   String    @default("normal")  // normal | high | urgent
  title      String
  body       String
  clickUrl   String?
  isRead     Boolean   @default(false)
  readAt     DateTime?
  createdAt  DateTime  @default(now())

  agent      Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([agentId, isRead, createdAt(sort: Desc)])
  @@map("notifications")
}

// ... (其餘模型)

```

---

## v0.2.1 Schema 變更 (Copilot & Notification)

> 以下為 `openspec/changes/copilot-and-notification` 計畫中的 DB Schema 新增/修改。
> 實作前需執行 `prisma migrate dev --name copilot-and-notification`。

### 修改：`Message` 表

```diff
 model Message {
   id             String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
   // ...
   content        Json
   channelMsgId   String?
   isRead         Boolean     @default(false)
+  isAiSuggested  Boolean     @default(false)  // 是否為 AI 建議
+  isAdopted      Boolean     @default(false)  // 是否被人工採納
+  originalSuggestion Json?    // 原始 AI 建議內容
+  adoptedAt      DateTime?   // 採納時間
   createdAt      DateTime    @default(now())
   //...
 }
```

### 修改：`Conversation` 表

```diff
 model Conversation {
   id            String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
   // ...
   unreadCount   Int                @default(0)
+  botRepliesCount Int             @default(0)   // 用於判斷升人工
+  handoffReason   String?           // 升人工原因
   lastMessageAt DateTime?
   // ...
 }
```

### 新增：`Notification` 表

```prisma
model Notification {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String    @db.Uuid
  agentId    String    @db.Uuid
  type       String    // new_message | case_assigned | sla_warning | csat_low | note_added
  priority   String    @default("normal")  // normal | high | urgent
  title      String
  body       String
  clickUrl   String?
  isRead     Boolean   @default(false)
  readAt     DateTime?
  createdAt  DateTime  @default(now())

  agent      Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([agentId, isRead, createdAt(sort: Desc)])
  @@map("notifications")
}
```

### 修改：`Agent` 表

```diff
 model Agent {
   id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
   // ...
   assignedCases    Case[]            @relation("AssignedAgent")
   caseEvents       CaseEvent[]
   sentMessages     Message[]
+  notifications    Notification[]
 
   @@unique([tenantId, email])
   @@map("agents")
 }
```
