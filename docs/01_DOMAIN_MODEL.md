# 01 — 核心領域模型 (Domain Model)

## 整體 Entity 關係圖

```
Tenant (企業客戶)
  │
  ├─ Channel (渠道，多個)
  │    ├─ LINE OA Channel
  │    ├─ FB Page
  │    └─ Web Chat Widget
  │
  ├─ Contact (聯繫人，統一身份)
  │    ├─ ChannelIdentity[] (每個渠道的身份 uid)
  │    ├─ Tag[]
  │    ├─ Attribute{} (自訂欄位)
  │    └─ Relation[] (關係鏈：推薦人、家庭成員等)
  │
  ├─ Conversation (對話，綁定 Channel + Contact)
  │    ├─ Message[]
  │    └─ Case (可選，從對話開案)
  │
  ├─ Case (案件)
  │    ├─ Status: open / in_progress / pending / resolved / closed
  │    ├─ Priority: low / medium / high / urgent
  │    ├─ Assignee (Agent)
  │    ├─ SLA Deadline
  │    ├─ CaseEvent[] (狀態變更歷程)
  │    └─ KnowledgeRef[] (參考到的 KM 文章)
  │
  ├─ Agent (客服人員)
  │    ├─ Role: admin / supervisor / agent
  │    └─ Team[]
  │
  ├─ Tag (標籤)
  │    ├─ 系統標籤 (自動貼)
  │    └─ 手動標籤
  │
  ├─ AutomationRule (自動化規則)
  │    ├─ Trigger (事件觸發)
  │    ├─ Condition[] (條件過濾)
  │    └─ Action[] (執行動作)
  │
  ├─ KnowledgeArticle (知識庫文章)
  │
  └─ MarketingCampaign (行銷活動)
       ├─ Audience (受眾分群)
       └─ BroadcastSchedule
```

---

## 各 Entity 詳細定義

### Contact（聯繫人）

```
Contact
  id              UUID
  tenant_id       UUID
  display_name    string
  avatar_url      string?
  phone           string?
  email           string?
  language        string          # zh-TW / en / ...
  attributes      JSONB           # 自訂欄位，如：家電品牌偏好、購買日期
  tags            Tag[]
  relations       ContactRelation[]
  channel_ids     ChannelIdentity[]
  created_at      timestamp
  updated_at      timestamp
```

**ContactRelation（關係鏈）**
```
ContactRelation
  from_contact_id   UUID
  to_contact_id     UUID
  relation_type     string   # referrer / family / colleague / ...
  notes             string?
```

**ChannelIdentity（跨渠道身份）**
```
ChannelIdentity
  contact_id    UUID
  channel_id    UUID
  channel_type  enum  # line / fb / webchat / whatsapp
  uid           string  # LINE userId / FB psid / etc.
  profile_name  string
  linked_at     timestamp
```

---

### Case（案件）

```
Case
  id              UUID
  tenant_id       UUID
  contact_id      UUID
  channel_id      UUID           # 首次來源渠道
  conversation_id UUID
  title           string
  description     string?
  status          CaseStatus     # open / in_progress / pending / resolved / closed
  priority        Priority       # low / medium / high / urgent
  category        string?        # 分類：維修 / 查詢 / 投訴 ...
  assignee_id     UUID?          # Agent
  team_id         UUID?
  sla_due_at      timestamp?
  resolved_at     timestamp?
  closed_at       timestamp?
  tags            Tag[]
  events          CaseEvent[]
  created_at      timestamp
  updated_at      timestamp
```

**CaseEvent（案件歷程）**
```
CaseEvent
  id            UUID
  case_id       UUID
  actor_type    enum   # agent / system / contact
  actor_id      UUID?
  event_type    string # created / assigned / status_changed / escalated / note_added / closed
  payload       JSONB  # 相關資料
  created_at    timestamp
```

**Case 升級（Escalation）規則範例**
```
若 Case 建立後 2 小時無人處理 → 升級 Priority 為 high + 通知 Supervisor
若 Case 建立後 4 小時無人處理 → 主動 Push 通知給客服主管
```

---

### Conversation（對話）

```
Conversation
  id              UUID
  tenant_id       UUID
  contact_id      UUID
  channel_id      UUID
  channel_type    enum
  status          enum   # active / bot_handled / agent_handled / closed
  assigned_to     UUID?  # Agent
  case_id         UUID?  # 若已開案
  messages        Message[]
  created_at      timestamp
  last_message_at timestamp
```

**Message**
```
Message
  id            UUID
  conversation_id UUID
  direction     enum   # inbound / outbound
  sender_type   enum   # contact / agent / bot / system
  sender_id     UUID?
  content_type  enum   # text / image / file / flex / template / ...
  content       JSONB
  channel_msg_id string  # 渠道原始 message id（用於追蹤已讀/未讀）
  created_at    timestamp
```

---

### AutomationRule（自動化規則）

```
AutomationRule
  id          UUID
  tenant_id   UUID
  name        string
  is_active   boolean
  trigger     Trigger
  conditions  Condition[]
  actions     Action[]
  created_at  timestamp
```

**Trigger Types**
- `contact.followed`           — 用戶追蹤渠道
- `contact.unfollowed`         — 用戶取消追蹤
- `message.received`           — 收到訊息
- `keyword.matched`            — 關鍵字命中
- `case.created`               — 案件建立
- `case.sla_warning`           — SLA 快到期
- `case.escalated`             — 案件升級
- `tag.added`                  — 貼標事件
- `schedule.cron`              — 定時觸發

**Action Types**
- `add_tag`                    — 貼標
- `remove_tag`                 — 移除標籤
- `send_message`               — 主動發送訊息
- `create_case`                — 建立案件
- `assign_case`                — 指派案件
- `set_contact_attribute`      — 更新聯繫人欄位
- `notify_agent`               — 通知客服
- `call_webhook`               — 呼叫外部 API
