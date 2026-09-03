# LINE CRM 系統架構文檔

## 1. 系統概述

這是一個深度綁定 LINE Official Account (LINE OA) 運作的 CRM 系統，主要功能包括：

- **訊息發送**：透過 LINE Messaging API 發送各類型訊息
- **用戶管理**：管理 LINE 用戶資料、標籤綁定
- **Rich Menu**：動態 Rich Menu 管理與綁定
- **LIFF 應用**：LINE LIFF (LINE Front-end Framework) 應用管理
- **數據分析**：LINE Insight API 數據分析
- **Webhook 處理**：處理 LINE 平台回傳的各類事件

## 2. 技術架構

### 2.1 核心框架
- **後端框架**：Laravel 11.9+
- **PHP 版本**：^8.3
- **資料庫**：MongoDB (laravel-mongodb), MySQL/SQLite
- **隊列處理**：Laravel Horizon

### 2.2 LINE SDK
```
linecorp/line-bot-sdk: ^9.9
```

這是 LINE 官方提供的 PHP SDK，包含以下主要组件：
- `LINE\Laravel\Facades\LINEMessagingApi` - 訊息 API
- `LINE\Laravel\Facades\LINEMessagingBlobApi` - Blob API (圖片上傳)
- `LINE\Laravel\Facades\LINEInsightApi` - 數據分析 API
- `LINE\Laravel\Facades\LINEChannelAccessTokenApi` - 認證 Token API

### 2.3 專案目錄結構

```
app/
├── Services/
│   └── Line/
│       ├── LineMessageService.php      # 訊息發送服務
│       ├── LineRichmenuService.php      # Rich Menu 服務
│       ├── LineWebhookService.php       # Webhook 處理服務
│       ├── LineMetricService.php        # 數據分析服務
│       ├── LineLiffService.php          # LIFF 應用服務
│       ├── LineMaterialMessageConverter.php  # 訊息格式轉換
│       ├── Factories/
│       │   ├── LineMessageBuilder.php   # 訊息建構器
│       │   ├── LineActionFactory.php    # Action 建構器
│       │   └── KeywordMessageFactory.php
│       └── PostbackHandlers/            # Postback 事件處理
│           ├── AssignCouponHandler.php
│           ├── SwitchRichmenuHandler.php
│           ├── PollHandler.php
│           └── ...
├── Http/
│   └── Controllers/
│       ├── LineUsersController.php      # LINE 用戶相關 API
│       ├── LineWebhookController.php   # Webhook 接收端點
│       ├── LineMetricsController.php    # 數據儀表板 API
│       ├── RichmenuController.php       # Rich Menu API
│       └── LiffGatewayController.php    # LIFF 閘道控制器
├── Models/
│   ├── LineUser.php                     # LINE 用戶模型
│   ├── Richmenu.php                     # Rich Menu 模型
│   └── ...
└── Jobs/
    ├── SendCampaignMessageBatch.php    # 訊息批次發送
    ├── RichmenuPublishJob.php           # Rich Menu 排程發布
    └── ...
```

### 2.4 配置文件

**config/line-bot.php**:
```php
[
    'channel_basic_id' => env('LINE_BOT_CHANNEL_BASIC_ID'),
    'channel_access_token' => env('LINE_BOT_CHANNEL_ACCESS_TOKEN'),
    'channel_id' => env('LINE_BOT_CHANNEL_ID'),
    'channel_secret' => env('LINE_BOT_CHANNEL_SECRET'),
    'login_channel_id' => env('LINE_LOGIN_CHANNEL_ID'),
    'login_channel_secret' => env('LINE_LOGIN_CHANNEL_SECRET'),
    'bot_data_api_url' => 'https://api-data.line.me/v2/bot/',
    'profile_encryption_key' => env('LINE_PROFILE_ENCRYPTION_KEY'),
]
```

## 3. 系統流程

### 3.1 訊息發送流程
```
Client Request → CampaignService → LineMessageService → LINE Messaging API
                                    ↓
                            MongoDB (訊息記錄)
```

### 3.2 Webhook 處理流程
```
LINE Platform → Webhook Endpoint → LineWebhookService → 事件分流
                                                              ↓
                                              ┌───────────────┼───────────────┐
                                              ↓               ↓               ↓
                                      MessageEvent    PostbackEvent    FollowEvent
                                              ↓               ↓               ↓
                                      KeywordService   PostbackHandler  LineUserService
```

### 3.3 Rich Menu 管理流程
```
Admin Action → RichmenuController → LineRichmenuService → LINE Messaging API
                                              ↓
                                      資料庫同步
```

## 4. 數據模型

### 4.1 LineUser (line_users 表)
```php
- id: ULID (Primary Key)
- line_user_id: string (LINE 用戶唯一 ID)
- name: string
- email: string (可選綁定)
- picture_url: string
- status: string
- language: string (LINE 語言代碼)
- metadata: JSON (額外元數據)
```

### 4.2 Richmenu (richmenus 表)
```php
- id: ULID
- line_richmenu_id: string (LINE Rich Menu ID)
- name: string
- chat_bar_text: string
- areas: JSON (選單區塊配置)
- is_default: boolean
- is_active: boolean
- publish_at: timestamp (排程發布)
- unpublish_at: timestamp (排程下架)
```

### 4.3 RichmenuUser (richmenu_users 表)
```php
- richmenu_id: ULID (Foreign Key)
- line_user_id: ULID (Foreign Key to line_users)
```

## 5. API 端點

### 5.1 LINE 用戶相關
- `GET /api/v1/line_users` - 取得用戶列表
- `GET /api/v1/line_users/{line_user_id}` - 取得用戶詳情
- `PUT /api/v1/line_users/profile/{line_user_id}` - 更新用戶資料 (外部)
- `GET /api/v1/line_users/profile/{line_user_id}` - 取得 LINE 用戶資料 (外部)
- `POST /api/v1/line_users/binding` - 綁定 LINE 帳號

### 5.2 訊息相關
- `POST /api/v1/campaigns/{id}/send` - 發送訊息
- `POST /api/v1/messages/broadcast` - 廣播訊息
- `POST /api/v1/messages/multicast` - 群發訊息

### 5.3 Rich Menu 相關
- `GET /api/v1/richmenus` - 取得 Rich Menu 列表
- `POST /api/v1/richmenus` - 建立 Rich Menu
- `PUT /api/v1/richmenus/{id}` - 更新 Rich Menu
- `DELETE /api/v1/richmenus/{id}` - 刪除 Rich Menu

### 5.4 LIFF 相關
- `GET /api/v1/liff/init` - 初始化 LIFF 應用

### 5.5 Webhook
- `POST /api/webhook/line` - LINE Webhook 接收端點

## 6. 速率限制

系統根據 LINE API 的限制進行優化：
- **Multicast API**：每秒最多 200 請求
- **Rich Menu Batch**：每小時最多 3 次請求
- 每批 multicast 最多 500 個用戶
- 每批 Rich Menu 綁定最多 500 個用戶

## 7. 依賴套件

```json
{
    "linecorp/line-bot-sdk": "^9.9",
    "laravel/framework": "^11.9",
    "laravel/horizon": "^5.27",
    "mongodb/laravel-mongodb": "^5.4",
    "archtechx/enums": "^1.1"
}
```

## 8. 環境變數

```
LINE_BOT_CHANNEL_BASIC_ID=...
LINE_BOT_CHANNEL_ACCESS_TOKEN=...
LINE_BOT_CHANNEL_ID=...
LINE_BOT_CHANNEL_SECRET=...
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...
LINE_PROFILE_ENCRYPTION_KEY=...
LINE_MESSAGE_SYNC_TO_MONGODB=false
```
