# 09 — 對外 API 設計規範

## API 設計原則

- **RESTful**：資源導向設計，HTTP 動詞語義正確
- **版本化**：所有 API 以 `/api/v1/` 開頭
- **認證**：JWT Bearer Token（內部使用） + API Key（第三方整合）
- **多租戶**：API Key 或 JWT 攜帶 `tenantId`，所有查詢自動過濾
- **標準錯誤格式**：所有錯誤回傳一致的 JSON 結構

---

## 認證與授權

### JWT（管理後台）

```
POST /api/v1/auth/login
Body: { email, password }
Response: { accessToken, refreshToken, expiresIn }

POST /api/v1/auth/refresh
Body: { refreshToken }

DELETE /api/v1/auth/logout
```

### API Key（第三方整合）

```
Header: X-API-Key: {apiKey}
```

API Key 有以下權限維度：
- `read:conversations`
- `write:messages`
- `read:contacts`
- `write:contacts`
- `read:cases`
- `write:cases`

---

## 標準回應格式

```json
// 成功
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}

// 錯誤
{
  "success": false,
  "error": {
    "code": "CONTACT_NOT_FOUND",
    "message": "找不到指定聯繫人",
    "details": {}
  }
}
```

---

## 核心 API 端點

### 聯繫人 (Contacts)

```
GET    /api/v1/contacts                    # 列表（支援搜尋/過濾/分頁）
POST   /api/v1/contacts                    # 建立
GET    /api/v1/contacts/:id                # 詳情
PATCH  /api/v1/contacts/:id                # 更新
DELETE /api/v1/contacts/:id                # 刪除

GET    /api/v1/contacts/:id/conversations  # 該聯繫人的對話列表
GET    /api/v1/contacts/:id/cases          # 該聯繫人的案件
GET    /api/v1/contacts/:id/tags           # 標籤
POST   /api/v1/contacts/:id/tags           # 貼標
DELETE /api/v1/contacts/:id/tags/:tagId    # 移除標籤
GET    /api/v1/contacts/:id/timeline       # 完整時間軸
POST   /api/v1/contacts/merge              # 合併聯繫人
```

**GET /api/v1/contacts 查詢參數**
```
?q=搜尋關鍵字（名稱/電話/Email）
&tag=標籤名
&channel=line|fb|webchat
&page=1&limit=20
&sortBy=lastActiveAt&sortOrder=desc
```

---

### 對話 (Conversations)

```
GET    /api/v1/conversations               # 統一收件匣列表
GET    /api/v1/conversations/:id           # 對話詳情
PATCH  /api/v1/conversations/:id           # 更新（如 assignee, status）
GET    /api/v1/conversations/:id/messages  # 訊息列表

POST   /api/v1/conversations/:id/messages  # 發送訊息（客服發出）
POST   /api/v1/conversations/:id/case      # 從對話開案
```

**GET /api/v1/conversations 查詢參數**
```
?status=active|bot_handled|agent_handled|closed
&channelType=line|fb|webchat
&assigneeId=agentUUID
&hasCase=true|false
&unread=true
&page=1&limit=20
```

---

### 案件 (Cases)

```
GET    /api/v1/cases                      # 案件列表
POST   /api/v1/cases                      # 建立案件
GET    /api/v1/cases/:id                  # 案件詳情
PATCH  /api/v1/cases/:id                  # 更新（狀態/優先級/指派）
DELETE /api/v1/cases/:id                  # 刪除（慎用）

GET    /api/v1/cases/:id/events           # 案件歷程
POST   /api/v1/cases/:id/notes            # 新增內部備註
POST   /api/v1/cases/:id/assign           # 指派
POST   /api/v1/cases/:id/resolve          # 标记解決
POST   /api/v1/cases/:id/close            # 關閉
POST   /api/v1/cases/:id/reopen           # 重新開啟
POST   /api/v1/cases/:id/escalate         # 升級
```

---

### 標籤 (Tags)

```
GET    /api/v1/tags                       # 標籤列表
POST   /api/v1/tags                       # 建立標籤
PATCH  /api/v1/tags/:id                   # 更新
DELETE /api/v1/tags/:id                   # 刪除（需確認無使用中）
```

---

### 渠道 (Channels)

```
GET    /api/v1/channels                   # 渠道列表
POST   /api/v1/channels                   # 新增渠道
GET    /api/v1/channels/:id               # 渠道詳情
PATCH  /api/v1/channels/:id               # 更新渠道設定
DELETE /api/v1/channels/:id               # 移除渠道
POST   /api/v1/channels/:id/test          # 測試渠道連線
```

---

### 自動化規則 (Automation)

```
GET    /api/v1/automation/rules           # 規則列表
POST   /api/v1/automation/rules           # 建立規則
GET    /api/v1/automation/rules/:id       # 規則詳情
PATCH  /api/v1/automation/rules/:id       # 更新規則
DELETE /api/v1/automation/rules/:id       # 刪除規則
POST   /api/v1/automation/rules/:id/test  # 測試觸發（Dry Run）
GET    /api/v1/automation/logs            # 執行記錄
```

---

### 知識庫 (Knowledge)

```
GET    /api/v1/km/articles                # 文章列表
POST   /api/v1/km/articles                # 新增文章
GET    /api/v1/km/articles/:id            # 文章詳情
PATCH  /api/v1/km/articles/:id            # 更新文章
DELETE /api/v1/km/articles/:id            # 刪除文章
POST   /api/v1/km/articles/:id/publish    # 發布
POST   /api/v1/km/search                  # 語義搜尋（向量搜尋）
  Body: { "query": "冰箱不製冷怎麼辦", "topK": 5 }
```

---

### LLM 建議 (AI Suggest)

```
POST   /api/v1/ai/suggest-reply           # 取得建議回覆
  Body: { "conversationId": "...", "topK": 3 }
  Response: { "suggestions": [{ "text": "...", "confidence": 0.9, "kmRefs": [...] }] }

POST   /api/v1/ai/summarize               # 摘要對話
POST   /api/v1/ai/classify-issue          # 自動分類問題
```

---

## WebSocket API (即時通訊)

```
ws://your-domain/ws?token=JWT_TOKEN
```

### 訂閱頻道

```javascript
// 訂閱新訊息
socket.emit('subscribe', { room: 'conversation:uuid' });

// 訂閱 Case 更新
socket.emit('subscribe', { room: 'case:uuid' });

// 訂閱整個收件匣（收到任何對話的新訊息通知）
socket.emit('subscribe', { room: 'inbox' });
```

### 接收事件

```javascript
// 新增訊息
socket.on('message.new', (message) => { ... });

// 對話狀態更新
socket.on('conversation.updated', (conversation) => { ... });

// Case 狀態更新
socket.on('case.updated', (caseData) => { ... });

// 有人正在輸入（WebChat）
socket.on('typing.start', ({ conversationId, userId }) => { ... });
socket.on('typing.stop', ({ conversationId, userId }) => { ... });
```

---

## Webhook（對外通知）

系統可設定外部 Webhook，在特定事件發生時主動通知第三方：

```
POST /api/v1/webhooks/subscriptions
Body:
{
  "url": "https://your-system.com/crm-events",
  "events": ["case.created", "contact.tagged", "case.closed"],
  "secret": "your-hmac-secret"
}
```

所有事件 POST 到指定 URL，Header 包含 `X-CRM-Signature: hmac-sha256-...`

---

### 渠道綁定（Channels — 完整版）

> 相較前面的基礎版，加入綁定流程專屬端點

```
GET    /api/v1/channels                    # 渠道列表（含狀態）
POST   /api/v1/channels/line               # 新增 LINE OA（自動設定 Webhook）
POST   /api/v1/channels/fb                 # 新增 FB Messenger
POST   /api/v1/channels/webchat            # 新增 Web Chat Widget
GET    /api/v1/channels/:id                # 渠道詳情
PATCH  /api/v1/channels/:id                # 更新設定（名稱/外觀/訊息）
DELETE /api/v1/channels/:id                # 解除綁定

POST   /api/v1/channels/:id/verify         # 手動重新驗證連線
GET    /api/v1/channels/:id/status         # 即時連線狀態
GET    /api/v1/channels/:id/webhook-url    # 取得 Webhook URL（供管理員複製貼到渠道後台）
GET    /api/v1/channels/:id/embed-code     # Web Chat 嵌入碼（HTML snippet）
POST   /api/v1/channels/:id/refresh-token  # 手動更新 Token（FB Long-lived）
```

**POST /api/v1/channels/line Body**
```json
{
  "displayName": "XX家電官方帳號",
  "channelId": "1234567890",
  "channelSecret": "abcdef...",
  "channelAccessToken": "eyJ...",
  "settings": {
    "welcomeMessage": "您好！歡迎加入！",
    "botEnabled": false
  }
}
```

---

### 訊息模板（Templates）

```
GET    /api/v1/templates                   # 列表（可過濾 channelType / category）
POST   /api/v1/templates                   # 建立模板
GET    /api/v1/templates/:id               # 詳情
PATCH  /api/v1/templates/:id               # 更新
DELETE /api/v1/templates/:id               # 刪除（系統模板不可刪）

GET    /api/v1/templates/categories        # 分類清單
POST   /api/v1/templates/:id/preview       # 預覽（代入變數值，回傳渲染後 JSON）
  Body: { "variables": { "contact.name": "王小明", "attribute.brand": "Samsung" } }

POST   /api/v1/templates/:id/render-send   # 渲染並發送到指定對話
  Body: { "conversationId": "uuid", "variables": { ... } }

POST   /api/v1/templates/import            # 匯入 JSON（批量建立）
GET    /api/v1/templates/:id/export        # 匯出為 JSON
```

**GET /api/v1/templates 查詢參數**
```
?channelType=line|fb|universal
&category=服務類|行銷類|產品資訊類
&contentType=flex|text|quick_reply
&q=模板名稱關鍵字
&page=1&limit=20
```

---

### 儲存層（Storage）

```
POST   /api/v1/storage/upload              # 上傳檔案（multipart/form-data）
  FormData: file, folder (media|templates|km|avatars)
  Response: { key, publicUrl, size, contentType }

DELETE /api/v1/storage                     # 刪除（by key）
  Body: { "key": "media/tenant/xxx.jpg" }

GET    /api/v1/storage/signed-url/:key     # Private 檔案取 presigned URL（1小時有效）

POST   /api/v1/storage/presign-upload      # 取得前端直傳 URL（避免大檔走 API Server）
  Body: { "filename": "banner.jpg", "contentType": "image/jpeg", "folder": "templates" }
  Response: { "uploadUrl": "https://minio/...", "publicUrl": "https://...", "key": "..." }
```

> **LINE 注意**：Flex Message 內圖片必須為公開 HTTPS URL。
> 所有上傳到 `/templates` 資料夾的圖片預設為 public ACL，直接用 `publicUrl` 填入 Flex JSON。

---

### 行銷（Marketing）— 補全版

```
# 受眾分群
GET    /api/v1/segments                    # 分群列表
POST   /api/v1/segments                    # 建立分群
GET    /api/v1/segments/:id                # 詳情
PATCH  /api/v1/segments/:id                # 更新
DELETE /api/v1/segments/:id                # 刪除
POST   /api/v1/segments/:id/count          # 即時計算符合人數
  Response: { "count": 1234, "estimatedAt": "..." }

# 廣播
GET    /api/v1/broadcasts                  # 廣播列表
POST   /api/v1/broadcasts                  # 建立廣播
GET    /api/v1/broadcasts/:id              # 詳情 + 統計
PATCH  /api/v1/broadcasts/:id              # 更新（DRAFT 狀態才可）
DELETE /api/v1/broadcasts/:id              # 刪除（只能刪 DRAFT）
POST   /api/v1/broadcasts/:id/send-now     # 立即發送
POST   /api/v1/broadcasts/:id/schedule     # 設定排程時間
POST   /api/v1/broadcasts/:id/cancel       # 取消排程

# 行銷活動
GET    /api/v1/campaigns                   # 活動列表
POST   /api/v1/campaigns                   # 建立活動
GET    /api/v1/campaigns/:id               # 活動詳情 + 下屬廣播
PATCH  /api/v1/campaigns/:id               # 更新
```

---

### License 狀態（供 Tenant Admin 查看，部分資訊）

> 這個端點只回傳允許 Tenant 知道的資訊，不包含 API Key / 計費細節。

```
GET /api/v1/license/status
Response:
{
  "plan": "professional",
  "expiresAt": "2026-12-31T23:59:59Z",
  "features": {
    "channels.whatsapp": false,
    "ai.imageGeneration": true,
    ...
  },
  "credits": {
    "llmTokens":      { "remaining": 8500000, "unit": "tokens" },
    "imageGen":       { "remaining": 450,      "unit": "images" },
    "broadcastMsgs":  { "remaining": 28000,    "unit": "messages" }
  }
}
```

---

## 補充：API Key 權限範圍（更新）

加入新模組的 scope：

```
read:conversations       write:messages
read:contacts            write:contacts
read:cases               write:cases
read:tags                write:tags
read:templates           write:templates
read:km                  write:km
read:segments            write:broadcasts
read:license_status      (只能讀，不可寫)
```

---

## 補充：錯誤代碼

| HTTP | Code | 說明 |
|------|------|------|
| 400 | `VALIDATION_ERROR` | 請求資料不符格式 |
| 401 | `UNAUTHORIZED` | 未登入或 Token 失效 |
| 403 | `FORBIDDEN` | 無此操作權限（角色限制）|
| 402 | `FEATURE_NOT_ENABLED` | 此功能未在授權方案內 |
| 402 | `INSUFFICIENT_CREDITS` | Credits 餘額不足 |
| 404 | `NOT_FOUND` | 資源不存在 |
| 409 | `CONFLICT` | 資源衝突（如重複 E-mail）|
| 422 | `UNPROCESSABLE` | 業務邏輯驗證失敗 |
| 429 | `RATE_LIMITED` | 請求過於頻繁 |
| 500 | `INTERNAL_ERROR` | 系統內部錯誤 |
