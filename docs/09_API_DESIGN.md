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

---

### 案件 (Cases)

```
GET    /api/v1/cases                      # 案件列表
POST   /api/v1/cases                      # 建立案件
GET    /api/v1/cases/:id                  # 案件詳情
PATCH  /api/v1/cases/:id                  # 更新（狀態/優先級/指派）
DELETE /api/v1/cases/:id                  # 刪除

GET    /api/v1/cases/:id/events           # 案件歷程
POST   /api/v1/cases/:id/notes            # 新增內部備註
POST   /api/v1/cases/:id/resolve          # 標記解決
POST   /api/v1/cases/:id/close            # 關閉
```

---

### 渠道 (Channels)

```
GET    /api/v1/channels                   # 列表
POST   /api/v1/channels/line               # 新增 LINE OA
POST   /api/v1/channels/fb                 # 新增 FB Messenger
POST   /api/v1/channels/webchat            # 新增 Web Chat
GET    /api/v1/channels/:id               # 詳情
PATCH  /api/v1/channels/:id               # 更新
DELETE /api/v1/channels/:id               # 刪除

POST   /api/v1/channels/:id/teams          # 授權 Team 使用此 Channel
DELETE /api/v1/channels/:id/teams/:teamId  # 撤除授權
```

---

### 自動化規則 (Automation)

```
GET    /api/v1/automation/rules           # 規則列表
POST   /api/v1/automation/rules           # 建立規則
GET    /api/v1/automation/rules/:id       # 規則詳情
PATCH  /api/v1/automation/rules/:id       # 更新規則
DELETE /api/v1/automation/rules/:id       # 刪除規則
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
POST   /api/v1/km/search                  # 語義搜尋 (Vector + BM25)
  Body: { "query": "冰箱不製冷", "topK": 5 }
```

---

### LLM 建議 (AI Suggest)

```
POST   /api/v1/ai/suggest-reply           # 取得建議回覆
  Body: { "conversationId": "...", "topK": 3 }
  Response: { "suggestions": [{ "text": "...", "confidence": 0.9, "kmRefs": [...] }] }

POST   /api/v1/ai/summarize               # 摘要對話
POST   /api/v1/ai/classify-issue          # 自動分類問題 (意圖識別)
```

---

## 整合 API (Integration API) — 開放平台策略

> 讓企業現有的 ERP、電商、IoT、預約系統可以將資料 Push 進來，觸發 **Automation Engine**，使 CRM 成為企業所有客戶互動的**中心樞紐**。

### Inbound 資料 API (外部系統 Push 進來)

#### 通用事件推播 (Event Gateway)

```
POST /api/v1/integrations/events
Header: X-API-Key: {apiKey}
```

**Request Body**
```json
{
  "eventType": "order.placed",      // 用於 Automation Rule 匹配
  "externalId": "ORDER-2025001",    // 冪等性處理 (24h)
  "payload": {
    "orderId": "ORD-001",
    "amount": 35000,
    "product": "冷氣"
  },
  "contact": {
    "matchBy": "phone",             // phone | email | externalId
    "matchValue": "0912345678",
    "upsert": true,                 // 若找不到是否自動建立
    "name": "王小美"                 // 若為新建則使用的名稱
  },
  "occurredAt": "2025-03-25T10:00:00Z"
}
```

**核心機制 (Process)**
1. **認證**: 驗證 API Key 與 `write:integration_events` 權限。
2. **聯繫人關聯**: 根據 `matchBy` 查找聯繫人；若 `upsert: true` 則自動建立。
3. **事件入庫**: 檢查 `externalId` 是否重複。
4. **自動化觸發**: 發送事件至 **Automation Engine**。
5. **回應**: 告知受影響的聯繫人 ID 與觸發的規則數量。

#### 批量聯繫人更新 (ERP / POS 同步用)

```
POST /api/v1/integrations/contacts/batch-upsert
Header: X-API-Key: {apiKey}
Body:
{
  "contacts": [
    {
      "matchBy": "email",
      "matchValue": "wang@example.com",
      "attributes": {
        "brand": "Samsung",
        "model": "RF90K",
        "purchaseDate": "2023-03-01"
      },
      "tags": ["冰箱客戶", "保固中"],
      "externalId": "ERP-CUST-001"
    }
  ]
}
```

---

### Outbound 事件推播 (Webhook 訂閱)

外部系統訂閱 CRM 事件，當 CRM 有動作時主動 Push：

```
POST /api/v1/webhooks/subscriptions
Body:
{
  "url": "https://your-erp.com/crm-events",
  "events": ["case.created", "case.closed", "contact.tagged", "csat.responded"],
  "secret": "your-hmac-secret"
}
```

---

### API Key 管理

```
GET    /api/v1/api-keys                  # API Key 列表
POST   /api/v1/api-keys                  # 建立 (指定 name, scopes)
DELETE /api/v1/api-keys/:id             # 撤銷
```

---

## 補充：API Key 權限範圍 (Scopes)

加入整合與自動化相關 scope：

```
read:conversations       write:messages
read:contacts            write:contacts
read:cases               write:cases
read:tags                write:tags
read:templates           write:templates
read:km                  write:km
read:segments            write:broadcasts
write:integration_events    # 推播外部事件 (IoT/ERP)
write:contacts_batch        # 批量更新聯繫人 (ERP 同步)
read:license_status         # 讀取授權狀態
```

---

## 補充：錯誤代碼

| HTTP | Code | 說明 |
|------|------|------|
| 400 | `VALIDATION_ERROR` | 請求資料不符格式 |
| 401 | `UNAUTHORIZED` | 未登入或 Token 失效 |
| 403 | `FORBIDDEN` | 無此操作權限 |
| 402 | `INSUFFICIENT_CREDITS` | Credits 餘額不足 |
| 404 | `NOT_FOUND` | 資源不存在 |
| 429 | `RATE_LIMITED` | 請求過於頻繁 |
| 500 | `INTERNAL_ERROR` | 系統內部錯誤 |

---

### 開發者文件 (自動產生)

使用 **Scalar** (基於 OpenAPI) 自動產生互動式 API 文件：

```
https://your-domain.com/api/docs
```
