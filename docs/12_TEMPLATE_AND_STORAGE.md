# 12 — 訊息模板庫 + 統一儲存層

---

## Part A：訊息模板庫（Template Library）

### 為什麼模板需要獨立管理？

LINE Flex Message 的 JSON 結構複雜，且：
- 30+ 個模板需要分類管理
- 模板內嵌的圖片 URL 必須是公網可存取的 HTTPS URL（LINE 限制）
- 模板需要「參數化」，讓不同發送場景塞入動態資料
- 未來 FB / WhatsApp 也有自己的模板格式

→ 需要一個**渠道無關的模板系統**，各渠道 Plugin 負責渲染自己的格式

---

### 模板分類架構（家電業者範例，30+ 模板）

```
Template Library
├── 📦 通用（Channel Agnostic）      # 純文字 / 快速回覆
│   ├── 歡迎訊息
│   ├── 服務選單（快速回覆按鈕）
│   ├── 滿意度調查（1~5 星）
│   └── 再等一下（等候通知）
│
├── 🃏 LINE Flex — 服務類
│   ├── 案件確認卡（Case 建立通知）
│   ├── 案件狀態更新
│   ├── 維修進度追蹤
│   ├── 維修師傅資訊卡
│   ├── 預約確認卡
│   ├── 預約提醒（前一天）
│   └── 預約取消確認
│
├── 🃏 LINE Flex — 行銷類
│   ├── 新品上市公告
│   ├── 限時優惠 Banner
│   ├── 保固到期提醒卡
│   ├── 延伸保固方案介紹
│   ├── 會員積點通知
│   ├── 促銷活動倒數
│   └── 節慶祝賀（春節/中秋...）
│
├── 🃏 LINE Flex — 產品資訊類
│   ├── 產品規格卡（含圖）
│   ├── 產品比較卡（2欄）
│   ├── 常用功能說明
│   └── QR Code 說明書連結
│
├── 🃏 LINE Flex — 互動類
│   ├── 問卷調查（單選）
│   ├── 問卷調查（多選）
│   ├── 搜尋結果卡（輪播）
│   ├── 圖文選單替代卡
│   └── 個人儀表板（保固/積點總覽）
│
└── 📘 FB 通用模板
    ├── 通用卡片（圖+標題+按鈕）
    ├── 輪播卡（多產品展示）
    └── 清單模板
```

---

### Template Schema 設計

```typescript
interface MessageTemplate {
  id: string;
  tenantId: string | null;        // null = 系統預設模板（不可刪）
  name: string;
  description: string;
  category: TemplateCategory;     // 見分類清單
  channelType: ChannelType | 'universal';  // 'line' | 'fb' | 'universal'
  contentType: 'text' | 'flex' | 'image_text' | 'quick_reply' | 'fb_generic' | 'fb_carousel';
  
  // 模板本體（支援變數替換）
  body: TemplateBody;
  
  // 可用變數定義（讓前端顯示填入提示）
  variables: TemplateVariable[];
  
  // 預覽圖（系統産生或手動上傳）
  previewImageUrl?: string;
  
  isActive: boolean;
  isSystem: boolean;    // 系統預設模板，不可刪改
  usageCount: number;   // 被使用次數（排行）
  createdAt: Date;
  updatedAt: Date;
}

interface TemplateVariable {
  key: string;           // e.g. "contact.name"
  label: string;         // 友善顯示名稱
  defaultValue?: string; // 找不到時的備用值
  required: boolean;
}

interface TemplateBody {
  // 通用文字
  text?: string;
  
  // LINE Flex: 直接存 Flex Message Container JSON
  flexJson?: Record<string, any>;
  
  // 快速回覆
  quickReplies?: Array<{
    label: string;
    text?: string;
    postbackData?: string;
    imageUrl?: string;    // LINE quick reply icon（需在 S3）
  }>;
  
  // FB 通用模板
  fbElements?: Array<{
    title: string;
    subtitle?: string;
    imageUrl?: string;
    buttons?: Array<{ type: 'web_url'|'postback'; title: string; payload: string }>;
  }>;
}
```

---

### 模板變數替換機制

Flex JSON 中用 `{{variable}}` 語法標記動態欄位：

```json
{
  "type": "bubble",
  "body": {
    "type": "box",
    "contents": [
      { "type": "text", "text": "嗨，{{contact.name}}！" },
      { "type": "text", "text": "您的 {{attribute.appliance_brand}} 保固將於 {{attribute.warranty_expires_at}} 到期" },
      { "type": "image", "url": "{{storage.base_url}}/templates/warranty-banner.jpg" }
    ]
  }
}
```

**`{{storage.base_url}}`** 是關鍵！模板中的圖片 URL 用變數而不是寫死，
這樣換儲存體（MinIO → S3 → GCP）時，只需改設定，不必逐一改模板。

---

### 模板管理 API

```
GET    /api/v1/templates                  # 列表（可過濾 channelType / category）
POST   /api/v1/templates                  # 建立
GET    /api/v1/templates/:id              # 詳情
PATCH  /api/v1/templates/:id              # 更新
DELETE /api/v1/templates/:id              # 刪除（系統模板不可刪）

POST   /api/v1/templates/:id/preview      # 預覽（代入變數值，回傳渲染後 JSON）
POST   /api/v1/templates/:id/render       # 渲染 + 發送（指定 conversationId）

GET    /api/v1/templates/categories       # 分類清單
```

---

### 前端模板編輯器

LINE Flex Message 的 JSON 不適合直接手寫，前端需提供：

1. **可視化 Flex Builder**（選用，複雜度高）
   - 拖曳元件：文字、圖片、按鈕、分隔線
   - 即時預覽（LINE Flex Simulator 風格）

2. **JSON 編輯器 + 預覽**（MVP 優先做）
   - Monaco Editor（VS Code 同款）編輯 Flex JSON
   - 右側即時預覽（渲染成卡片樣式）
   - 變數 `{{...}}` 語法高亮
   - 可從 LINE Flex Message Simulator 直接貼入 JSON

3. **模板庫匯入**（最快）
   - 系統預載 30+ 個官方/常用模板
   - 企業可複製後自行修改
   - 支援 JSON 匯入/匯出

---

## Part B：統一儲存層（Unified Storage Layer）

### 核心問題：LINE 對圖片的限制

LINE Messaging API 要求訊息內的圖片 URL 必須：
- ✅ HTTPS（不接受 HTTP）
- ✅ 公網可存取（不接受 localhost / 內網）
- ✅ 穩定可靠（圖片失效 = 訊息破圖）
- ✅ 支援 CORS（部分情況）

→ **所有用於 LINE / FB 訊息的圖片，都必須存在系統儲存體並給出公網 URL**

---

### 儲存層抽象設計

```typescript
interface StorageProvider {
  readonly name: string;

  // 上傳檔案，回傳公網可存取的 URL
  upload(file: Buffer, options: UploadOptions): Promise<UploadResult>;

  // 取得存取 URL（若為 private bucket，回傳有時效的 presigned URL）
  getAccessUrl(key: string, expiresIn?: number): Promise<string>;

  // 取得公開 URL（public bucket 專用）
  getPublicUrl(key: string): string;

  // 刪除
  delete(key: string): Promise<void>;

  // 列出（管理後台用）
  list(prefix?: string): Promise<StorageObject[]>;
}

interface UploadOptions {
  key?: string;          // 指定路徑，未指定則自動生成
  contentType: string;   // MIME type
  acl?: 'public' | 'private';  // 預設 public（LINE 需要）
  metadata?: Record<string, string>;
}

interface UploadResult {
  key: string;           // 儲存路徑
  publicUrl: string;     // 公網 URL（LINE 直接使用這個）
  size: number;
}
```

---

### 儲存體實作（三選一，設定切換）

```typescript
// 1. MinIO（預設，本地自架）
class MinioStorageProvider implements StorageProvider { ... }

// 2. AWS S3
class S3StorageProvider implements StorageProvider { ... }

// 3. Google Cloud Storage
class GCSStorageProvider implements StorageProvider { ... }

// 未來可擴展
// class AzureBlobStorageProvider implements StorageProvider { ... }
// class CloudflareR2StorageProvider implements StorageProvider { ... }
```

---

### 設定方式（環境變數）

```env
# 選擇儲存體 Provider
STORAGE_PROVIDER=minio        # minio | s3 | gcs

# MinIO（本地或自架）
MINIO_ENDPOINT=your-server.com
MINIO_PORT=9000
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=xxx
MINIO_SECRET_KEY=xxx
MINIO_BUCKET=open333crm
MINIO_PUBLIC_BASE_URL=https://your-server.com:9000/open333crm
# ↑ 這就是模板中 {{storage.base_url}} 的值

# AWS S3
S3_REGION=ap-northeast-1
S3_BUCKET=open333crm
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_PUBLIC_BASE_URL=https://open333crm.s3.ap-northeast-1.amazonaws.com

# GCS
GCS_PROJECT_ID=my-project
GCS_BUCKET=open333crm
GCS_KEY_FILE=/secrets/gcp-key.json
GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/open333crm
```

---

### 檔案組織結構（Bucket 內的目錄）

```
open333crm/
├── media/
│   ├── {tenantId}/
│   │   ├── contacts/           # 聯繫人上傳的圖片（inbound）
│   │   ├── conversations/      # 對話中的媒體檔
│   │   └── cases/              # Case 附件
│
├── templates/                  # 模板圖片（用於 Flex / FB 模板）
│   ├── system/                 # 系統預設模板圖片
│   └── {tenantId}/             # 企業自訂模板圖片
│
├── km/                         # 知識庫文章附件
│   └── {tenantId}/
│
└── avatars/                    # 聯繫人/Agent 頭像
    └── {tenantId}/
```

---

### 儲存 API（內部使用）

```
POST /api/v1/storage/upload                # 上傳檔案
  Body: multipart/form-data
  Response: { key, publicUrl, size, contentType }

DELETE /api/v1/storage/:key                # 刪除
GET    /api/v1/storage/signed-url/:key     # 取 presigned URL（private 檔案）

# 前端直傳支援（減少 API server 流量）
POST /api/v1/storage/presign-upload        # 取得前端直傳 URL
  Body: { filename, contentType, folder }
  Response: { uploadUrl, publicUrl, key }
```

---

### LINE 圖片最佳實踐

| 場景 | 要求 |
|------|------|
| Flex Message 內圖片 | 公網 HTTPS URL，建議 CDN 加速 |
| Quick Reply 按鈕圖示 | HTTPS URL，建議 PNG，尺寸 24x24 |
| 廣播圖片訊息 | HTTPS URL，JPEG/PNG，最大 10MB |
| Rich Menu 圖片 | 需透過 LINE API 上傳，不是 URL 方式 |
| 用戶傳來的圖片 | LINE 提供臨時 Content URL（數天過期），需要及時下載到自己的 S3 |

**關鍵點**：用戶傳來的媒體，LINE 提供的 `content_url` 只有數天有效期。
系統需要在 Webhook 收到時，**立即下載並存到自己的 S3**，否則日後查看歷史訊息圖片會消失。

```typescript
// 在 LinePlugin.parseWebhook() 中
async function handleImageMessage(event: LineImageEvent): Promise<UniversalMessage> {
  const contentBuffer = await lineClient.getMessageContent(event.message.id);
  const { publicUrl } = await storageService.upload(contentBuffer, {
    key: `media/${tenantId}/conversations/${conversationId}/${event.message.id}.jpg`,
    contentType: 'image/jpeg',
    acl: 'public',
  });
  return {
    contentType: 'image',
    content: { mediaUrl: publicUrl },  // 存自己的 S3 URL
    ...
  };
}
```
