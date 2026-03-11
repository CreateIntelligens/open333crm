# 03 — 多渠道插件系統設計 (Channel Plugin System)

## 設計目標

舊系統把 LINE 的邏輯直接硬寫在業務邏輯裡，導致加入新渠道等同重寫。
新系統透過「渠道插件介面」，讓核心系統對渠道一無所知，只操作統一抽象。

---

## 統一訊息模型 (Universal Message)

所有渠道的訊息，都會被轉換成這個統一格式：

```typescript
interface UniversalMessage {
  id: string;                      // 系統內部 ID
  channelType: ChannelType;        // 'line' | 'fb' | 'webchat' | 'whatsapp'
  channelId: string;               // 對應的 Channel 設定 ID
  direction: 'inbound' | 'outbound';
  contactUid: string;              // 渠道內的用戶 ID（LINE userId / FB PSID）
  timestamp: Date;
  messageType: MessageContentType; // 見下方定義
  content: MessageContent;
  rawPayload?: any;                // 保留原始 payload 備查
}

type MessageContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'location'
  | 'sticker'
  | 'flex'       // LINE Flex Message
  | 'template'   // FB/LINE Template
  | 'quick_reply'
  | 'postback'   // 按鈕回呼
  | 'unknown';

interface MessageContent {
  text?: string;
  mediaUrl?: string;
  templateData?: Record<string, any>;
  flexJson?: Record<string, any>;   // LINE Flex 原始 JSON
  postbackData?: string;
  quickReplies?: QuickReply[];
}
```

---

## Channel Plugin 介面

每個渠道 Plugin 必須實作這個介面：

```typescript
interface ChannelPlugin {
  /** Plugin 識別子 */
  readonly type: ChannelType;
  readonly version: string;

  /** 驗證 Webhook 請求（如 LINE Signature）*/
  verifyWebhook(req: RawRequest): boolean;

  /** 解析原始 Webhook → UniversalMessage[] */
  parseWebhook(req: RawRequest): Promise<UniversalMessage[]>;

  /** 發送訊息到渠道 */
  sendMessage(channelConfig: ChannelConfig, message: OutboundMessage): Promise<SendResult>;

  /** 取得聯繫人 Profile（如 LINE displayName）*/
  getContactProfile(channelConfig: ChannelConfig, uid: string): Promise<ContactProfile>;

  /** 可選：渠道特有能力（如 LINE Rich Menu）*/
  extension?: Record<string, (...args: any[]) => Promise<any>>;
}
```

---

## 渠道設定（ChannelConfig）

每個渠道的憑證存在資料庫中，由 Plugin 使用：

```typescript
interface ChannelConfig {
  id: string;
  tenantId: string;
  channelType: ChannelType;
  displayName: string;
  isActive: boolean;
  credentials: {
    // LINE
    channelAccessToken?: string;
    channelSecret?: string;
    // FB
    pageAccessToken?: string;
    appSecret?: string;
    // WebChat
    widgetKey?: string;
    // WhatsApp (未來)
    phoneNumberId?: string;
    wabaToken?: string;
  };
  settings: {
    welcomeMessage?: string;
    offlineMessage?: string;
    botEnabled?: boolean;
  };
}
```

---

## Webhook 路由設計

```
POST /webhooks/line/:channelId       → LINE Plugin
POST /webhooks/fb/:channelId         → FB Plugin
GET  /webhooks/fb/:channelId         → FB Webhook 驗證
POST /webhooks/webchat/:channelId    → WebChat Plugin
```

所有 Webhook 進入後：
1. 驗證簽名
2. 解析為 `UniversalMessage[]`
3. 發布到 Event Bus：`channel.message.received`
4. Core Inbox Service 監聽並處理

---

## LINE Plugin 特有能力 (Extension)

LINE 有獨有功能，透過 Extension 暴露，不污染核心介面：

```typescript
linePlugin.extension = {
  // Flex Message 發送
  sendFlex: (channelConfig, altText, flexContents) => {...},

  // Rich Menu 管理
  setRichMenu: (channelConfig, userId, richMenuId) => {...},
  deleteRichMenu: (channelConfig, richMenuId) => {...},

  // 推送多段訊息
  sendMulticast: (channelConfig, userIds, messages) => {...},

  // LINE Login 連結
  getLinkToken: (channelConfig, userId) => {...},
};
```

---

## FB Plugin 特有能力 (Extension)

```typescript
fbPlugin.extension = {
  // Persistent Menu 設定
  setPersistentMenu: (channelConfig, menu) => {...},

  // 取得用戶標籤（若有 FB 自訂標籤）
  getLabels: (channelConfig, psid) => {...},

  // 訂閱 Webhook 欄位
  subscribeFields: (channelConfig, fields) => {...},
};
```

---

## Plugin 載入機制

```typescript
// Plugin Registry（啟動時載入）
const channelRegistry = new ChannelPluginRegistry();
channelRegistry.register(new LinePlugin());
channelRegistry.register(new FbPlugin());
channelRegistry.register(new WebChatPlugin());
// 未來加入：channelRegistry.register(new WhatsAppPlugin());

// 路由時使用
const plugin = channelRegistry.get(channelType);
```

---

## 渠道新增 Checklist

新增一個渠道（以 WhatsApp 為例）：
- [ ] 建立 `WhatsAppPlugin implements ChannelPlugin`
- [ ] 實作 `verifyWebhook`（驗證 WhatsApp Signature）
- [ ] 實作 `parseWebhook`（解析 WhatsApp Cloud API payload）
- [ ] 實作 `sendMessage`（呼叫 WhatsApp Cloud API 發送）
- [ ] 實作 `getContactProfile`
- [ ] 在 Registry 中註冊
- [ ] 新增 `/webhooks/whatsapp/:channelId` 路由
- [ ] 前端新增 WhatsApp Channel 設定頁

核心業務邏輯**無需修改**。
