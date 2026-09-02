# API 端點總覽

本文檔列出系統所有 API 端點，分為內部 API 和外部 API。

---

## 1. API 分類總覽

| 分類 | 數量 | 認證方式 | 用途 |
|------|------|----------|------|
| **認證相關** | 3 | - | Token 管理 |
| **LINE 用戶** | 8 | JWT | 用戶資料管理 |
| **訊息發送** | 4 | JWT | 訊息廣告/推播 |
| **Rich Menu** | 5 | JWT | 選單管理 |
| **LIFF 應用** | 2 | - | LIFF 配置 |
| **行銷腳本** | 6 | JWT | 自動化行銷 |
| **優惠券** | 8 | JWT | 優惠券管理 |
| **素材** | 5 | JWT | 圖文素材 |
| **標籤/受眾** | 6 | JWT | 用戶分群 |
| **關鍵字** | 3 | JWT | 自動回覆 |
| **Short URL** | 4 | - | 短網址 |
| **AI 圖片** | 6 | JWT | AI 圖片生成 |
| **Avatar** | 3 | JWT | AI 頭像 |
| **活動模組** | 10+ | JWT | 投票/邀請/遊戲 |
| **系統設定** | 10+ | JWT | 租戶設定 |

---

## 2. 公開 API (無需認證)

### 2.1 Webhook

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | `/api/line/webhook` | LINE Webhook 接收 |

**檔案位置**：[`app/Http/Controllers/LineWebhookController.php`](app/Http/Controllers/LineWebhookController.php)

### 2.2 認證 Token

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | `/api/token` | 產生 JWT Token |
| POST | `/api/token/refresh` | 刷新 Token |
| POST | `/api/token/revoke` | 撤銷 Token |

**速率限制**：180 requests/minute

**檔案位置**：[`app/Http/Controllers/TokenController.php`](app/Http/Controllers/TokenController.php)

### 2.3 短網址

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/short_urls/transfer` | 短網址轉發 |

**檔案位置**：[`app/Http/Controllers/ShortUrlController.php`](app/Http/Controllers/ShortUrlController.php)

### 2.4 地區/語系

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/locales` | 取得支援的語系 |

**檔案位置**：[`app/Http/Controllers/LocaleController.php`](app/Http/Controllers/LocaleController.php)

### 2.5 LIFF 配置

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/liff/apps` | 取得可用的 LIFF Apps |

**檔案位置**：[`app/Http/Controllers/LiffGatewayController.php`](app/Http/Controllers/LiffGatewayController.php)

---

## 3. 需認證 API (JWT Required)

### 3.1 LINE 用戶管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/line_users` | 取得用戶列表 |
| GET | `/api/v1/line_users/export` | 匯出用戶 |
| PUT | `/api/v1/line_users/profile/{line_user_id}` | 更新用戶資料 |
| GET | `/api/v1/line_users/profile/{line_user_id}` | 取得 LINE 用戶資料 |
| GET | `/api/v1/line_users/check_binding_status` | 檢查綁定狀態 |
| PUT | `/api/v1/line_users/tagging_tag` | 標籤用戶 |
| POST | `/api/v1/line_users/batch_tagging_tag` | 批次標籤 |
| POST | `/api/v1/line_users/async_batch_tagging_tag` | 非同步批次標籤 |

**檔案位置**：[`app/Http/Controllers/LineUsersController.php`](app/Http/Controllers/LineUsersController.php)

### 3.2 訊息發送 (Campaigns)

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/campaigns` | 取得訊息列表 |
| POST | `/api/v1/campaigns` | 建立訊息 |
| GET | `/api/v1/campaigns/{id}` | 取得訊息詳情 |
| PUT | `/api/v1/campaigns/{id}` | 更新訊息 |
| DELETE | `/api/v1/campaigns/{id}` | 刪除訊息 |
| POST | `/api/v1/campaigns/{id}/send` | 發送訊息 |
| POST | `/api/v1/campaigns/{id}/retry-failed-batches` | 重試失敗批次 |
| GET | `/api/v1/campaigns/{id}/statistics` | 取得統計 |
| GET | `/api/v1/campaigns/{id}/insights` | 取得洞察報告 |

**檔案位置**：[`app/Http/Controllers/CampaignController.php`](app/Http/Controllers/CampaignController.php)

### 3.3 Rich Menu 管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/rich_menus` | 取得選單列表 |
| POST | `/api/v1/rich_menus` | 建立選單 |
| GET | `/api/v1/rich_menus/{id}` | 取得選單詳情 |
| PUT | `/api/v1/rich_menus/{id}` | 更新選單 |
| DELETE | `/api/v1/rich_menus/{id}` | 刪除選單 |
| PUT | `/api/v1/rich_menus/{rich_menu}/set_default` | 設定預設選單 |
| POST | `/api/v1/rich_menus/{rich_menu}/assign_to_user` | 綁定選單至用戶 |

**檔案位置**：[`app/Http/Controllers/RichmenuController.php`](app/Http/Controllers/RichmenuController.php)

### 3.4 行銷腳本 (Marketing Scripts)

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/marketing_scripts` | 取得腳本列表 |
| POST | `/api/v1/marketing_scripts` | 建立腳本 |
| GET | `/api/v1/marketing_scripts/{id}` | 取得腳本詳情 |
| PUT | `/api/v1/marketing_scripts/{id}` | 更新腳本 |
| DELETE | `/api/v1/marketing_scripts/{id}` | 刪除腳本 |
| GET | `/api/v1/marketing_scripts/{id}/send_records` | 取得發送記錄 |
| GET | `/api/v1/marketing_scripts/{id}/statistics` | 取得統計 |

**檔案位置**：[`app/Http/Controllers/MarketingScriptController.php`](app/Http/Controllers/MarketingScriptController.php)

### 3.5 優惠券管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/coupons` | 取得優惠券列表 |
| POST | `/api/v1/coupons` | 建立優惠券 |
| GET | `/api/v1/coupons/{id}` | 取得優惠券詳情 |
| PUT | `/api/v1/coupons/{id}` | 更新優惠券 |
| DELETE | `/api/v1/coupons/{id}` | 刪除優惠券 |
| POST | `/api/v1/coupons/{coupon}/codes/assign` | 分配優惠碼 |
| POST | `/api/v1/coupons/codes/redeem` | 兌換優惠碼 |
| POST | `/api/v1/coupons/codes/cancel` | 取消優惠碼 |
| PUT | `/api/v1/coupons/codes/lock` | 鎖定優惠碼 |
| GET | `/api/v1/coupons/{coupon}/codes` | 取得優惠碼列表 |
| GET | `/api/v1/coupons/codes/{code}` | 取得優惠碼詳情 |

**檔案位置**：
- [`app/Http/Controllers/CouponController.php`](app/Http/Controllers/CouponController.php)
- [`app/Http/Controllers/CouponCodeController.php`](app/Http/Controllers/CouponCodeController.php)

### 3.6 用戶優惠券

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/line_users/{line_user_id}/coupons` | 取得用戶優惠券 |
| GET | `/api/v1/line_users/{line_user_id}/coupons/{coupon_code}` | 取得特定優惠券 |
| GET | `/api/v1/line_users/{line_user_id}/user_coupon_codes/{id}` | 取得用戶優惠碼 |
| GET | `/api/v1/line_users/coupons` | 取得所有用戶優惠券 |

**檔案位置**：[`app/Http/Controllers/UserCouponController.php`](app/Http/Controllers/UserCouponController.php)

### 3.7 素材管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/materials` | 取得素材列表 |
| POST | `/api/v1/materials` | 建立素材 |
| GET | `/api/v1/materials/{id}` | 取得素材詳情 |
| PUT | `/api/v1/materials/{id}` | 更新素材 |
| DELETE | `/api/v1/materials/{id}` | 刪除素材 |
| POST | `/api/v1/materials/convert_line_message` | 轉換為 LINE 訊息 |

**檔案位置**：[`app/Http/Controllers/MaterialController.php`](app/Http/Controllers/MaterialController.php)

### 3.8 標籤管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/tags` | 取得標籤列表 |
| POST | `/api/v1/tags` | 建立標籤 |
| PUT | `/api/v1/tags/{id}` | 更新標籤 |
| DELETE | `/api/v1/tags/{id}` | 刪除標籤 |
| GET | `/api/v1/tags/exists` | 檢查標籤是否存在 |
| POST | `/api/v1/tags/bulk` | 批次建立標籤 |

**檔案位置**：[`app/Http/Controllers/TagsController.php`](app/Http/Controllers/TagsController.php)

### 3.9 受眾管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/audiences` | 取得受眾列表 |
| POST | `/api/v1/audiences` | 建立受眾 |
| GET | `/api/v1/audiences/{id}` | 取得受眾詳情 |
| PUT | `/api/v1/audiences/{id}` | 更新受眾 |
| DELETE | `/api/v1/audiences/{id}` | 刪除受眾 |
| POST | `/api/v1/audiences/bulk` | 批次建立受眾 |
| GET | `/api/v1/audiences/{audience}/export` | 匯出受眾用戶 |

**檔案位置**：[`app/Http/Controllers/AudienceController.php`](app/Http/Controllers/AudienceController.php)

### 3.10 關鍵字回覆

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/keywords` | 取得關鍵字列表 |
| POST | `/api/v1/keywords` | 建立關鍵字 |
| PUT | `/api/v1/keywords/{id}` | 更新關鍵字 |
| DELETE | `/api/v1/keywords/{id}` | 刪除關鍵字 |
| GET | `/api/v1/keywords/answer` | 取得關鍵字回覆 |
| GET | `/api/v1/keywords/exists` | 檢查關鍵字是否存在 |

**檔案位置**：[`app/Http/Controllers/KeywordController.php`](app/Http/Controllers/KeywordController.php)

### 3.11 短網址管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/short_urls` | 取得短網址列表 |
| POST | `/api/v1/short_urls` | 建立短網址 |
| GET | `/api/v1/short_urls/{id}` | 取得短網址詳情 |
| PUT | `/api/v1/short_urls/{id}` | 更新短網址 |
| DELETE | `/api/v1/short_urls/{id}` | 刪除短網址 |

**檔案位置**：[`app/Http/Controllers/ShortUrlController.php`](app/Http/Controllers/ShortUrlController.php)

### 3.12 發送者管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/senders` | 取得發送者列表 |
| POST | `/api/v1/senders` | 建立發送者 |
| PUT | `/api/v1/senders/{id}` | 更新發送者 |
| DELETE | `/api/v1/senders/{id}` | 刪除發送者 |

**檔案位置**：[`app/Http/Controllers/SenderController.php`](app/Http/Controllers/SenderController.php)

### 3.13 AI 圖片生成

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/ai-images/logs` | 取得生成日誌 |
| GET | `/api/v1/ai-images/usage` | 取得使用量 |
| POST | `/api/v1/ai-images/generate` | 生成圖片 |
| POST | `/api/v1/ai-images/edit` | 編輯圖片 |

**檔案位置**：[`app/Http/Controllers/AiImageController.php`](app/Http/Controllers/AiImageController.php)

### 3.14 AI 頭像

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | `/api/v1/avatar` | 建立頭像任務 |
| GET | `/api/v1/avatar/status/{taskId}` | 檢查任務狀態 |
| GET | `/api/v1/avatar/user/{userId}/avatars` | 取得用戶頭像 |

**檔案位置**：[`app/Http/Controllers/AvatarController.php`](app/Http/Controllers/AvatarController.php)

### 3.15 互動活動

#### 邀請活動 (Invite)

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/invite` | 取得邀請列表 |
| POST | `/api/v1/invite/publish/{id}` | 發布邀請 |
| POST | `/api/v1/invite/shareSuccess` | 分享成功 |

**檔案位置**：[`app/Http/Controllers/InviteController.php`](app/Http/Controllers/InviteController.php)

#### 投票活動 (Poll)

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/poll` | 取得投票列表 |
| POST | `/api/v1/poll/publish/{id}` | 發布投票 |

**檔案位置**：[`app/Http/Controllers/PollController.php`](app/Http/Controllers/PollController.php)

#### 遊戲 (Playground)

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/playground` | 取得遊戲列表 |
| GET | `/api/v1/playground/get_lottery` | 取得抽獎資訊 |
| GET | `/api/v1/playground/info/{id}` | 取得遊戲詳情 |
| POST | `/api/v1/playground/lottery` | 執行抽獎 |
| POST | `/api/v1/playground/publish/{id}` | 發布遊戲 |

**檔案位置**：[`app/Http/Controllers/PlaygroundController.php`](app/Http/Controllers/PlaygroundController.php)

### 3.16 獎品管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/prizes` | 取得獎品列表 |
| POST | `/api/v1/prizes` | 建立獎品 |
| PUT | `/api/v1/prizes/{id}` | 更新獎品 |
| PUT | `/api/v1/prizes/batch` | 批次更新獎品 |

**檔案位置**：[`app/Http/Controllers/PrizeController.php`](app/Http/Controllers/PrizeController.php)

### 3.17 對話管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/conversations` | 取得對話列表 |
| PATCH | `/api/v1/conversations/{id}` | 更新對話 |
| GET | `/api/v1/conversations/by-user/{user_id}` | 依用戶查詢對話 |
| GET | `/api/v1/conversations/{id}/messages` | 取得對話訊息 |
| POST | `/api/v1/conversations/{id}/messages` | 發送訊息 |
| GET | `/api/v1/conversations/{id}/export` | 匯出對話 |

**檔案位置**：[`app/Http/Controllers/ConversationController.php`](app/Http/Controllers/ConversationController.php)

### 3.18 筆記管理

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/notes` | 取得筆記列表 |
| POST | `/api/v1/notes` | 建立筆記 |
| PUT | `/api/v1/notes/{id}` | 更新筆記 |
| DELETE | `/api/v1/notes/{id}` | 刪除筆記 |

**檔案位置**：[`app/Http/Controllers/NoteController.php`](app/Http/Controllers/NoteController.php)

### 3.19 租戶設定

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/tenant_settings` | 取得設定 |
| POST | `/api/v1/tenant_settings` | 更新設定 |
| DELETE | `/api/v1/tenant_settings` | 刪除設定 |
| GET | `/api/v1/tenant_settings/schema` | 取得設定結構 |
| POST | `/api/v1/tenant_settings/validate` | 驗證設定 |
| POST | `/api/v1/tenant_settings/reset` | 重設設定 |
| POST | `/api/v1/tenant_settings/clear_cache` | 清除快取 |

**檔案位置**：[`app/Http/Controllers/TenantSettingController.php`](app/Http/Controllers/TenantSettingController.php)

### 3.20 用戶發送者

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/v1/users/senders` | 取得用戶發送者 |
| PUT | `/api/v1/users/senders` | 替換發送者 |
| POST | `/api/v1/users/senders` | 新增發送者 |
| DELETE | `/api/v1/users/senders/{id}` | 刪除發送者 |
| DELETE | `/api/v1/users/senders` | 刪除全部發送者 |

**檔案位置**：[`app/Http/Controllers/UserSenderController.php`](app/Http/Controllers/UserSenderController.php)

---

## 4. 外部 API (合作夥伴)

### 4.1 Partner API

| Method | Endpoint | 說明 |
|--------|----------|------|
| PUT | `/partner/v1/line_users/profile/{line_user_id}` | 更新 LINE 用戶資料 |
| GET | `/partner/v1/line_users/profile/{line_user_id}` | 取得 LINE 用戶資料 |

**認證方式**：API Key (X-API-Key header)

**檔案位置**：[`routes/partner.php`](routes/partner.php)

---

## 5. 認證方式

### 5.1 JWT Token

```http
Authorization: Bearer {token}
```

### 5.2 API Key

```http
X-API-Key: {api_key}
```

### 5.3 LINE Signature

```http
X-Line-Signature: {signature}
```

用於 Webhook 驗證

---

## 6. 速率限制

| 端點 | 限制 |
|------|------|
| `/api/token` | 180 requests/minute |
| LINE Multicast | 200 requests/second |
| Rich Menu Batch | 3 requests/hour |

---

## 7. 響應格式

### 7.1 成功響應

```json
{
  "data": {},
  "message": "Success",
  "status": 200
}
```

### 7.2 錯誤響應

```json
{
  "message": "Error message",
  "errors": {},
  "status": 400
}
```

---

## 8. API 文件

完整的 API 文件可通過 Swagger/OpenAPI 訪問：

**檔案位置**：[`chat_api.yaml`](chat_api.yaml)

---

## 9. 總結

這個系統有 **完整的 REST API** 可以讓外部系統呼叫：

- ✅ 訊息發送
- ✅ 用戶管理
- ✅ 優惠券發放
- ✅ 素材管理
- ✅ 數據分析
- ✅ 遊戲/活動管理

外部系統可以通過 **JWT Token** 或 **API Key** 認證來調用這些 API。
