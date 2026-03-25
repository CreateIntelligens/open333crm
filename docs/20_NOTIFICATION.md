# 20 — 通知系統設計（Notification System）

## 通知的兩個層面

| 層面 | 對象 | 說明 |
|------|------|------|
| **即時通知** | Agent（客服人員） | 新訊息、Case 指派、SLA 警告 |
| **告警通知** | Supervisor / Admin | SLA 違規、低 CSAT、渠道斷線 |

---

## 通知中心 (Notification Bell) 設計

### 1. UI 互動
- **右上角鈴鐺**: 顯示未讀數字。
- **下拉列表**: 
    - 顯示最新 10 筆通知。
    - 點擊通知跳轉到對應頁面。
- **即時彈窗 (Toast)**: URGENT 級別通知會在螢幕右上角彈出。

### 2. 事件類型與優先級

| 事件 | 優先級 | 通知對象 | 內容範例 |
|------|--------|----------|----------|
| `case.assigned_to_me` | NORMAL | Agent | 「案件 #1087 已指派給您」|
| `sla.warning` | HIGH | Agent | 「⚠️ 案件 #1089 SLA 剩 15 分鐘」 |
| `sla.breach` | URGENT | Agent, Supervisor | 「🔴 案件 #1087 已超時」 |
| `csat.low_score` | HIGH | Agent, Supervisor | 「😡 客戶給了 1 星評價」 |
| `note.mentioned` | NORMAL | Agent | 「李助理在案件 #1087 @了你」 |
| `credits.low` | URGENT | Admin | 「⚠️ AI 點數低於 10%」 |

### 3. 技術實作
- **後端**: `NotificationService` 接收內部事件，建立 `Notification` 記錄。
- **即時推送**: 使用 **WebSocket (Socket.io)** `notification.new` 事件推送到前端。
- **前端**: 監聽 WebSocket，更新鈴鐺數字與列表。

---

## 瀏覽器推播（Web Push）

### 技術實作

```typescript
// 前端：使用 Service Worker + Web Push API
// 使用者首次登入後請求通知權限

// service-worker.js
self.addEventListener('push', (event) => {
  const data = event.data.json();
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/logo-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag,           // 相同 tag 的通知會覆蓋（避免洗版）
    data: { url: data.clickUrl },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  clients.openWindow(event.notification.data.url);
});
```

```typescript
// 後端：儲存 Push Subscription，發送推播
interface PushSubscription {
  agentId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// 發送推播（使用 web-push 套件）
await webpush.sendNotification(subscription, JSON.stringify({
  title: '新訊息 - 王小美',
  body: '冰箱不製冷，很急...',
  tag: `conversation:${conversationId}`,
  clickUrl: `/inbox/${conversationId}`,
}));
```

### VAPID Key 設定（環境變數）

```env
VAPID_PUBLIC_KEY=BExamplePublicKey...
VAPID_PRIVATE_KEY=ExamplePrivateKey...
VAPID_SUBJECT=mailto:admin@open333crm.com
```

---

## In-App 通知（🔔 鈴鐺）

### 通知 Feed 設計

```
┌──────────────────────────────────────────┐
│  通知  [全部] [未讀]            [全部已讀] │
├──────────────────────────────────────────┤
│ 🔴 ● 案件 #1089 SLA 剩 15 分鐘          │
│      緊急・2分鐘前              [前往] →  │
├──────────────────────────────────────────┤
│ 🟡 ● 新訊息：王小美              3分鐘前 │
│      LINE・冰箱不製冷...         [前往] → │
├──────────────────────────────────────────┤
│   ✓ 案件 #1085 已指派給您        1小時前 │
└──────────────────────────────────────────┘
```

### DB Schema

```prisma
model Notification {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId   String    @db.Uuid
  agentId    String    @db.Uuid
  type       String    // new_message | case_assigned | sla_warning | sla_breach | csat_low | channel_error
  priority   String    @default("normal")  // normal | high | urgent
  title      String
  body       String
  clickUrl   String?
  isRead     Boolean   @default(false)
  readAt     DateTime?
  createdAt  DateTime  @default(now())

  @@index([agentId, isRead])
  @@index([agentId, createdAt(sort: Desc)])
  @@map("notifications")
}
```

### Notification API

```
GET  /api/v1/notifications              # 通知列表（預設未讀優先）
  ?unreadOnly=true&page=1&limit=20

PATCH /api/v1/notifications/:id/read    # 標記已讀
PATCH /api/v1/notifications/read-all   # 全部已讀

GET  /api/v1/notifications/unread-count # 回傳 { count: 5 }（用於🔔數字）

POST /api/v1/notifications/push-subscribe    # 儲存 Web Push Subscription
DELETE /api/v1/notifications/push-subscribe  # 取消推播訂閱

WebSocket 事件（即時推播到前端）：
socket.on('notification.new', (notification) => { ... })
```

---

## Email 通知設計

Email 使用 SMTP 發送，適用於：不在線的 Supervisor 接收重要告警。

```typescript
interface EmailNotificationConfig {
  smtp: {
    host: string; port: number; secure: boolean;
    user: string; pass: string;
  };
  senderName: string;        // 'open333CRM 系統通知'
  senderEmail: string;       // 'noreply@your-crm.com'
  supervisorEmails: string[]; // 接收告警的 Email 清單
}
```

### Email 模板（HTML）

```
主旨：⚠️ SLA 違規通知 - 案件 #1087

──────────────────────────────────
XX家電 客服系統 - 自動通知
──────────────────────────────────
案件 #1087 已超過 SLA 時限

聯繫人：王小美（LINE）
問題描述：冰箱不製冷問題
指派客服：王客服
開案時間：2026-03-11 14:22
SLA 期限：2026-03-11 18:22（已超時 1 小時 15 分）

[立即處理此案件] → https://your-crm.com/cases/1087

──────────────────────────────────
XX家電 客服系統 | 如需取消此通知請至設定頁面
```

---

## 通知靜音設定

避免深夜被轟炸：

```typescript
interface NotificationQuietHours {
  enabled: boolean;
  startTime: string;    // '22:00'
  endTime: string;      // '08:00'
  timezone: string;     // 'Asia/Taipei'
  // 靜音期間：緊急告警（SLA違規）仍發送，普通通知延後到靜音結束後發送
  urgentOverride: boolean;  // true = 緊急仍打擾
}
```

---

## 通知分發流程（後端）

```
事件發生（如 Case 指派）
  │
  ▼
NotificationService.dispatch(event)
  │
  ├─ 建立 Notification 記錄到 DB
  │
  ├─ 透過 WebSocket 推播在線 Agent（即時）
  │
  ├─ 若 Agent 不在線 or 推播設定允許 → 發 Web Push
  │
  └─ 若是告警等級 → 發 Email（依 supervisorEmails 設定）

所有推播動作進 BullMQ 非同步佇列，不阻塞主流程
```
