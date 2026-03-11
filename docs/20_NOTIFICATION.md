# 20 — 通知系統設計（Notification System）

## 通知的兩個層面

| 層面 | 對象 | 說明 |
|------|------|------|
| **即時通知** | Agent（客服人員） | 新訊息、Case 指派、SLA 警告 |
| **告警通知** | Supervisor / Admin | SLA 違規、低 CSAT、渠道斷線 |

---

## 通知渠道（依緊急程度）

```
緊急程度  高 ──────────────────────────────── 低
          ⬇
          瀏覽器推播（Web Push）
          in-app 通知（右上角 🔔 鈴鐺）
          Email（SMTP）
          LINE 通知（給 Supervisor，Optional）
```

---

## 通知類型清單

### Agent 接收的通知

| 事件 | 通知方式 | 內容 |
|------|---------|------|
| 新對話指派給我 | Push + in-app | 「王小美 (LINE) 傳了新訊息」|
| 對話有新訊息（已指派給我）| in-app + 標題列未讀數 | 訊息預覽 |
| Case 被指派給我 | Push + in-app | 「案件 #1087 已指派給您（優先：高）」|
| SLA 即將到期（30分鐘）| Push + in-app | 「⚠️ 案件 #1087 SLA 剩 30 分鐘」|
| Case 被重新指派 | in-app | 「案件 #1087 已轉派給 李助理」|
| Case 有新備註 | in-app | 「王客服 在案件 #1087 新增備註」|

### Supervisor / Admin 接收的通知

| 事件 | 通知方式 | 說明 |
|------|---------|------|
| SLA 違規 | Push + Email | 案件 #XXXX 已超時 |
| 低 CSAT（≤2分）| Push + Email | 客戶對案件 #XXXX 評1分 |
| 未指派案件堆積 | in-app（每小時彙總）| 目前有 5 個未指派案件 |
| 客服全部離線 | Email | 目前無在線客服，客戶訊息無人接手 |
| 渠道連線異常 | Email + in-app | LINE OA Webhook 驗證失敗 |
| License Credits < 20% | in-app | Token 餘額低於 20% |

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
