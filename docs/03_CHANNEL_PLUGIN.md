# 03 — 多渠道插件系統設計（Channel Plugin System）

## 設計目標

舊系統把 LINE 的邏輯直接硬寫在業務邏輯裡，導致加入新渠道等同重寫。
新系統透過「渠道插件介面」，讓核心系統對渠道一無所知，只操作統一抽象。

```
外部渠道               Plugin 層                  核心系統
─────────           ─────────────            ─────────
LINE OA    ──→   LinePlugin                 │
FB Msg     ──→   FbPlugin      ──→ UniversalMessage ──→  Inbox / Case / Auto
WebChat    ──→   WebChatPlugin              │
WhatsApp   ──→   WhatsAppPlugin (未來)      │ （核心不知道訊息來自哪裡）
```

---

## 1. 統一訊息模型（UniversalMessage）

所有渠道的訊息進出都會被轉換成這個統一格式。核心系統**只操作這個格式**。

```typescript
interface UniversalMessage {
  id: string;                      // 系統內部 UUID
  channelType: ChannelType;        // 'LINE' | 'FB' | 'WEBCHAT' | 'WHATSAPP' | 'TELEGRAM' | 'THREADS'
  channelId: string;               // 對應的 Channel 設定 UUID
  direction: 'inbound' | 'outbound';
  contactUid: string;              // 渠道內的用戶 ID（LINE userId / FB PSID / Telegram chat_id）
  timestamp: Date;
  messageType: MessageContentType;
  content: MessageContent;
  rawPayload?: unknown;            // 保留原始 payload 備查
}

type MessageContentType =
  | 'text' | 'image' | 'video' | 'audio' | 'file'
  | 'location' | 'sticker'
  | 'flex'         // LINE Flex Message
  | 'template'     // 結構化模板（LINE / FB 各有格式）
  | 'quick_reply'  // 快速回覆
  | 'postback'     // 按鈕回呼
  | 'unknown';

interface MessageContent {
  text?: string;
  mediaUrl?: string;
  templateData?: Record<string, unknown>;
  flexJson?: Record<string, unknown>;
  postbackData?: string;
  quickReplies?: QuickReply[];
}

interface QuickReply {
  label: string;
  text?: string;
  postbackData?: string;
  imageUrl?: string;
}
```

---

## 2. ChannelPlugin 介面

每個渠道 Plugin 必須實作此介面。注意：**只有 5 個必要方法**，保持精簡。

```typescript
interface ChannelPlugin {
  /** 渠道類型識別 */
  readonly channelType: ChannelType;

  /** 驗證 Webhook 來源（如 LINE HMAC-SHA256 Signature） */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string
  ): boolean;

  /** 解析原始 Webhook payload → UniversalMessage[] */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<UniversalMessage[]>;

  /** 從渠道 API 取得用戶 Profile */
  getProfile(
    uid: string,
    credentials: ChannelCredentials
  ): Promise<ContactProfile>;

  /** 發送訊息到渠道 */
  sendMessage(
    to: string,
    message: OutboundMessage,
    credentials: ChannelCredentials
  ): Promise<SendResult>;

  /** 可選：自動設定 Webhook URL（LINE / FB 支援） */
  setWebhook?(
    webhookUrl: string,
    credentials: ChannelCredentials
  ): Promise<void>;
}
```

---

## 3. Plugin Registry

啟動時載入所有 Plugin，路由時依 `channelType` 取出對應 Plugin 處理：

```typescript
const registry = new Map<ChannelType, ChannelPlugin>();

function registerPlugin(plugin: ChannelPlugin) {
  registry.set(plugin.channelType, plugin);
  console.log(`✅ Channel plugin registered: ${plugin.channelType}`);
}

function getPlugin(type: ChannelType): ChannelPlugin {
  const plugin = registry.get(type);
  if (!plugin) throw new Error(`No plugin for channel: ${type}`);
  return plugin;
}

// 啟動時
registerPlugin(new LinePlugin());
registerPlugin(new FbPlugin());
registerPlugin(new WebChatPlugin());
registerPlugin(new TelegramPlugin());   // v0.2.0 新增
registerPlugin(new ThreadsPlugin());    // v0.2.0 新增
// 未來：registerPlugin(new WhatsAppPlugin());
```

---

## 4. Webhook 路由與處理流程

### 路由設計

```
POST /webhooks/line/:channelId       → LinePlugin
POST /webhooks/fb/:channelId         → FbPlugin
GET  /webhooks/fb/:channelId         → FB Webhook 驗證（Challenge）
WS   /webhooks/webchat/:channelId    → WebChatPlugin（WebSocket）
POST /webhooks/telegram/:channelId   → TelegramPlugin
POST /webhooks/threads/:channelId    → ThreadsPlugin
GET  /webhooks/threads/:channelId    → Instagram Webhook Challenge
POST /webhooks/whatsapp/:channelId   → WhatsAppPlugin（未來）
```

### 統一處理流程

```
Webhook 請求進來
  │
  ├─ 1. 依 URL 前綴決定 channelType → 取出 Plugin
  ├─ 2. 依 :channelId 查 DB → 取出 ChannelConfig + 解密 Credentials
  ├─ 3. plugin.verifySignature(rawBody, headers, secret) → 失敗返回 403
  ├─ 4. plugin.parseWebhook(rawBody, headers) → UniversalMessage[]
  ├─ 5. 每個 UniversalMessage：
  │     ├─ 找或建立 Contact（依 contactUid + channelId）
  │     ├─ 找或建立 Conversation
  │     ├─ 存入 Message 表
  │     └─ 發布事件到 Event Bus：channel.message.received
  └─ 6. 回傳 200 OK（Webhook 必須快速回應）
```

---

## 5. 渠道新增 Checklist

新增一個渠道（以 **Telegram** 為例），只需做以下事項，**核心業務邏輯不用改**：

- [ ] 新增 `ChannelType.TELEGRAM` 到 `packages/types`
- [ ] 建立 `TelegramPlugin implements ChannelPlugin`
- [ ] `verifySignature`：驗證 `X-Telegram-Bot-Api-Secret-Token` header
- [ ] `parseWebhook`：解析 text / photo / sticker / location / callback_query
- [ ] `sendMessage`：呼叫 Telegram `sendMessage` / `sendPhoto` API
- [ ] `getProfile`：取得 Telegram user firstName / lastName
- [ ] `setWebhook`：自動設定 Bot Webhook URL
- [ ] 在 Plugin Registry `registerPlugin(new TelegramPlugin())`
- [ ] 新增 `/webhooks/telegram/:channelId` 路由
- [ ] 前端新增 Telegram Channel 設定頁（botToken + webhookSecret 輸入）

> **Threads 同理**，差別在使用 Instagram Graph API + HMAC-SHA256 App Secret 驗證。

---

## 6. 各渠道能力差異矩陣

| 能力 | LINE | FB | WebChat | WhatsApp | **Telegram** | **Threads** |
|------|------|----|---------|----------|------------|----------|
| 文字收發 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 圖片/影片 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅圖片 |
| Flex / 模板 | ✅ Flex | ✅ Generic | ✅ 自製 | ✅ Template | ❌ | ❌ |
| Quick Reply | ✅ | ✅ | ✅ | ✅ | ✅ Inline KB | ✅ |
| Postback | ✅ | ✅ | ✅ | ✅ | ✅ Callback | ❌ |
| Sticker | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Location | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Story Reply | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Rich Menu | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 語音 | 接收 | 接收 | ❌ | ✅ | ✅ | ❌ |
| 已讀回條 | ❌ | ✅ | 自製 | ✅ | ❌ | ❌ |
| Webhook自動設定 | ✅ | ✅ | N/A | ❌ | ✅ setWebhook | ✅ 手動＋review |
