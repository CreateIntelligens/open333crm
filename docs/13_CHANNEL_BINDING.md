# 13 — 企業自助綁定社交渠道 (Channel Self-Binding)

## 設計目標

企業管理員能在後台**自行**完成各渠道的綁定，不需要找工程師手動設定環境變數或操作資料庫。

綁定流程涉及：
1. 取得渠道的 API 憑證（Access Token / Secret）
2. 設定 Webhook URL 讓渠道能回呼本系統
3. 驗證連線正常
4. 啟用並管理

---

## 渠道綁定流程總覽

```
後台設定頁 → 選擇渠道類型 → 填入憑證 → 系統驗證 → 設定 Webhook → 啟用
```

---

## LINE OA 綁定流程

### 企業管理員需要準備什麼？

在 LINE Developers Console 要做的事（系統需給出清楚引導）：

```
步驟 1：建立 LINE Messaging API Channel
  → developers.line.biz → Providers → Create Channel → Messaging API

步驟 2：取得以下資料（貼入本系統後台）
  ├── Channel ID
  ├── Channel Secret
  └── Channel Access Token（Long-lived）

步驟 3：本系統後台 → 新增 LINE OA → 貼入上方資料 → 儲存

步驟 4：系統自動顯示 Webhook URL（如下）
  https://your-domain.com/webhooks/line/{channelId}

步驟 5：回到 LINE Developers Console
  → Messaging API → Webhook URL → 貼入步驟4的 URL → 啟用 Webhook

步驟 6：本系統後台 → 點「驗證連線」
  → 系統發送 LINE Verification Request → 確認成功 ✅
```

### 系統後端自動化完成的事

```typescript
async function activateLineChannel(channelConfig: CreateLineChannelDto) {
  // 1. 儲存憑證（加密存入 DB）
  const channel = await channelRepo.create({
    ...channelConfig,
    credentials: await encrypt(channelConfig.credentials),
  });

  // 2. 產生 Webhook URL（用 channel.id 當路由參數）
  const webhookUrl = `${process.env.BASE_URL}/webhooks/line/${channel.id}`;

  // 3. 呼叫 LINE API 設定 Webhook URL（自動化！免人工）
  await lineClient.setWebhook(channelConfig.credentials.channelAccessToken, webhookUrl);

  // 4. 呼叫 LINE API 驗證 Webhook
  const testResult = await lineClient.verifyWebhook(channelConfig.credentials.channelAccessToken);

  // 5. 關閉 LINE 預設的自動回覆（避免與本系統衝突）
  await lineClient.setLineOfficialAccountFeatures(token, {
    chat: false,           // 關閉官方聊天功能
    multipleResponse: false,
  });

  return { channel, webhookUrl, verified: testResult.success };
}
```

> 💡 **關鍵**：`setWebhook()` 用 LINE Messaging API 的 **Set webhook endpoint** 自動設定，
> 企業管理員不需要手動到 LINE Developers Console 貼 Webhook URL（步驟 5 可省略）。

---

## FB Messenger 綁定流程

FB 綁定比 LINE 複雜，因為涉及 **OAuth + App Review**。

### 兩種模式

| 模式 | 說明 | 適合情況 |
|------|------|---------|
| **自建 FB App 模式** | 企業自己在 FB 開發者平台建 App | 企業有技術能力、需完整權限 |
| **平台代理模式** | 用本系統的 FB App，企業走 OAuth 授權 | 快速接入，需要平台提供 FB App |

### 模式 A：自建 FB App（MVP 優先）

```
步驟 1：企業在 developers.facebook.com 建立 App
  → 類型選 Business → 新增產品 Messenger

步驟 2：取得並貼入本系統後台
  ├── App ID
  ├── App Secret
  └── Page Access Token（長效）

步驟 3：設定 FB Webhook Verify Token
  → 本系統後台填入自訂的 Verify Token（任意字串）

步驟 4：本系統後台 → 儲存 → 顯示 Webhook URL
  https://your-domain.com/webhooks/fb/{channelId}

步驟 5：企業到 FB Developers Console
  → Webhook → 訂閱 → 貼入 Webhook URL + Verify Token
  → 勾選訂閱欄位：messages, messaging_postbacks, messaging_optins

步驟 6：本系統後台 → 驗證連線 ✅
```

### 模式 B：平台 OAuth 授權（v1.1 規劃）

```
企業管理員 → 點「連結 FB 粉專」→
  系統引導至 Facebook Login OAuth →
  企業帳號授權 → 選擇要連結的粉絲專頁 →
  系統取得 Page Access Token →
  自動設定 Webhook → 完成

（類似 Manychat / Chatfuel 的連結方式）
```

這需要系統持有 FB App，且 App 通過 FB 的 Business Use Case 審核。

---

## Web Chat Widget 綁定流程

Web Chat 沒有第三方 OAuth，是本系統自建的，最簡單：

```
步驟 1：後台 → 新增 Web Chat → 填入
  ├── 名稱（如：官網客服）
  ├── 允許嵌入的網域（whitelist）
  └── 外觀設定（顏色、問候語、客服名稱）

步驟 2：系統產生嵌入碼
  <script src="https://your-domain.com/widget.js"
          data-key="wc_{channelId}_{token}"></script>

步驟 3：企業工程師將嵌入碼貼到官網 </body> 前

→ 完成，即時可用
```

---

## Channel 綁定後台 UI 流程

```
設定 → 渠道管理
  │
  ├── 已綁定渠道清單
  │   ├── LINE OA：XX品牌官方帳號 ✅ 正常
  │   ├── FB：XX品牌粉絲專頁 ✅ 正常
  │   └── Web Chat：官網客服 ✅ 正常
  │
  └── [+ 新增渠道]
       ├── LINE OA
       ├── Facebook Messenger
       ├── Web Chat Widget
       └── WhatsApp（即將推出）
```

### 渠道狀態監控

每個渠道顯示即時狀態，系統定期 Heartbeat 檢查：

| 狀態 | 說明 |
|------|------|
| ✅ 正常 | Webhook 可接收，發送 API 正常 |
| ⚠️ 警告 | Access Token 即將過期（30天內）|
| ❌ 錯誤 | Webhook 失敗 / Token 已失效 |
| ⏸ 暫停 | 管理員手動停用 |

---

## 憑證安全管理

```typescript
// 憑證不以明文存入資料庫
// 使用 AES-256-GCM 加密，金鑰來自環境變數

interface ChannelCredentialStore {
  encrypt(credentials: RawCredentials): Promise<string>;
  decrypt(encrypted: string): Promise<RawCredentials>;
}

// 金鑰設定
CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-bytes-key

// 資料庫欄位
Channel.credentials_encrypted: TEXT  // AES 加密後的 JSON 字串
```

---

## Access Token 自動更新

| 渠道 | Token 特性 | 策略 |
|------|-----------|------|
| LINE | Long-lived Token（永不過期，除非手動撤銷）| 定期檢查是否被撤銷 |
| FB Page | 短效 Token（60天）→ 需換成 Long-lived | 綁定時立即換 Long-lived；設定 30 天到期提醒 |
| FB App | App Token（靜態）| 不需更新，App Secret + App ID 組合生成 |

```typescript
// FB Token 自動續期（每次使用前檢查）
async function getFbPageToken(channelId: string): Promise<string> {
  const channel = await getChannel(channelId);
  const credentials = await credentialStore.decrypt(channel.credentialsEncrypted);

  // 若 token 將在 30 天內過期，嘗試換新
  if (isExpiringWithin30Days(credentials.tokenExpiresAt)) {
    const newToken = await fbApi.extendToken(credentials.pageAccessToken, credentials.appId, credentials.appSecret);
    await saveRefreshedToken(channelId, newToken);
    return newToken.accessToken;
  }

  return credentials.pageAccessToken;
}
```

---

## 多渠道綁定場景（家電業者範例）

```
企業設定完成後的渠道清單範例：

渠道名稱              類型        狀態    主要用途
─────────────────────────────────────────────────────
XX家電官方帳號        LINE OA     ✅      主要客服渠道
XX家電限定活動帳號    LINE OA     ✅      節慶行銷專用
XX家電粉絲專頁        FB          ✅      FB 用戶客服
官網即時客服          Web Chat    ✅      網站訪客諮詢

一個企業 → 多個 LINE OA（不同定位）+ FB + WebChat
全部訊息統一進同一個收件匣
```

---

## 渠道管理 API

```
GET    /api/v1/channels                    # 列出所有已綁定渠道
POST   /api/v1/channels/line               # 新增 LINE OA 渠道
POST   /api/v1/channels/fb                 # 新增 FB Messenger 渠道
POST   /api/v1/channels/webchat            # 新增 Web Chat
PATCH  /api/v1/channels/:id                # 更新渠道設定（名稱/外觀）
DELETE /api/v1/channels/:id                # 解綁渠道（確認 UI）
POST   /api/v1/channels/:id/verify         # 手動重新驗證連線
GET    /api/v1/channels/:id/status         # 取得渠道即時狀態
GET    /api/v1/channels/:id/webhook-url    # 取得 Webhook URL（給管理員複製）
GET    /api/v1/channels/:id/embed-code     # Web Chat 嵌入碼
```
