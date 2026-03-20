# a平台使用到的 LINE OA API 清單 (API Inventory)

本文檔詳細列出系統中所有使用的 LINE Official Account API。

---

## 1. Messaging API

### 1.1 訊息發送 (Message Sending)

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Reply Message](https://developers.line.biz/en/reference/messaging-api/#reply-message) | `LINEMessagingApi::replyMessage()` | 回覆用戶訊息 | [`LineMessageService.php:41`](app/Services/Line/LineMessageService.php:41) |
| [Push Message](https://developers.line.biz/en/reference/messaging-api/#send-push-message) | `LINEMessagingApi::pushMessage()` | 主動推播訊息給單一用戶 | [`LineMessageService.php:75`](app/Services/Line/LineMessageService.php:75) |
| [Multicast](https://developers.line.biz/en/reference/messaging-api/#send-multicast-message) | `LINEMessagingApi::multicast()` | 群發訊息給多個用戶 (最多500人/次) | [`LineMessageService.php:117`](app/Services/Line/LineMessageService.php:117) |
| [Broadcast](https://developers.line.biz/en/reference/messaging-api/#send-broadcast-message) | `LINEMessagingApi::broadcast()` | 廣播訊息給所有粉絲 | [`LineMessageService.php:149`](app/Services/Line/LineMessageService.php:149) |

### 1.2 訊息驗證 (Message Validation)

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Validate Message](https://developers.line.biz/en/reference/messaging-api/#validate-message) | `LINEMessagingApi::validateBroadcast()` | 驗證廣播訊息格式 | [`LineMessageService.php:176`](app/Services/Line/LineMessageService.php:176) |
| [Validate Message](https://developers.line.biz/en/reference/messaging-api/#validate-message) | `LINEMessagingApi::validateMulticast()` | 驗證群發訊息格式 | [`LineMessageService.php:177`](app/Services/Line/LineMessageService.php:177) |
| [Validate Message](https://developers.line.biz/en/reference/messaging-api/#validate-message) | `LINEMessagingApi::validateReply()` | 驗證回覆訊息格式 | [`LineMessageService.php:178`](app/Services/Line/LineMessageService.php:178) |

### 1.3 訊息內容取得 (Message Content)

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Get Message Content](https://developers.line.biz/en/reference/messaging-api/#get-message-content) | `GET /v2/bot/message/{messageId}/content` | 下載訊息中的圖片/影片/音頻 | [`LineMessageService.php:222`](app/Services/Line/LineMessageService.php:222) |

### 1.4 用戶資料 (User Profile)

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Get Profile](https://developers.line.biz/en/reference/messaging-api/#get-profile) | `LINEMessagingApi::getProfile()` | 取得用戶個人資料 | [`LineWebhookService.php:160`](app/Services/Line/LineWebhookService.php:160) |

---

## 2. Rich Menu API

### 2.1 Rich Menu 管理

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Create Rich Menu](https://developers.line.biz/en/reference/messaging-api/#create-rich-menu) | `LINEMessagingApi::createRichMenu()` | 建立 Rich Menu | [`LineRichmenuService.php:78`](app/Services/Line/LineRichmenuService.php:78) |
| [Delete Rich Menu](https://developers.line.biz/en/reference/messaging-api/#delete-rich-menu) | `LINEMessagingApi::deleteRichmenu()` | 刪除 Rich Menu | [`LineRichmenuService.php:131`](app/Services/Line/LineRichmenuService.php:131) |
| [Set Default Rich Menu](https://developers.line.biz/en/reference/messaging-api/#set-default-rich-menu) | `LINEMessagingApi::setDefaultRichMenu()` | 設定預設 Rich Menu | [`LineRichmenuService.php:149`](app/Services/Line/LineRichmenuService.php:149) |
| [Cancel Default Rich Menu](https://developers.line.biz/en/reference/messaging-api/#cancel-default-rich-menu) | `LINEMessagingApi::cancelDefaultRichMenu()` | 取消預設 Rich Menu | [`LineRichmenuService.php:162`](app/Services/Line/LineRichmenuService.php:162) |
| [Get Default Rich Menu ID](https://developers.line.biz/en/reference/messaging-api/#get-default-rich-menu-id) | `LINEMessagingApi::getDefaultRichMenuId()` | 取得預設 Rich Menu ID | [`LineRichmenuService.php:174`](app/Services/Line/LineRichmenuService.php:174) |

### 2.2 Rich Menu 與用戶綁定

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Link Rich Menu to User](https://developers.line.biz/en/reference/messaging-api/#link-rich-menu-to-user) | `LINEMessagingApi::linkRichMenuIdToUser()` | 綁定 Rich Menu 給單一用戶 | [`LineRichmenuService.php:229`](app/Services/Line/LineRichmenuService.php:229) |
| [Unlink Rich Menu from User](https://developers.line.biz/en/reference/messaging-api/#unlink-rich-menu-from-user) | `LINEMessagingApi::unlinkRichMenuIdFromUsers()` | 解除 Rich Menu 綁定 (批次) | [`LineRichmenuService.php:254`](app/Services/Line/LineRichmenuService.php:254) |
| [Link Rich Menu to Users](https://developers.line.biz/en/reference/messaging-api/#link-rich-menu-to-users) | `LINEMessagingApi::linkRichMenuIdToUsers()` | 批次綁定 Rich Menu 給多用戶 | [`LineRichmenuService.php:280`](app/Services/Line/LineRichmenuService.php:280) |
| [Unlink All Rich Menus from Users](https://developers.line.biz/en/reference/messaging-api/#unlink-all-rich-menus-from-users) | `LINEMessagingApi::richMenuBatch()` | 批次解除所有 Rich Menu | [`LineRichmenuService.php:206`](app/Services/Line/LineRichmenuService.php:206) |

### 2.3 Rich Menu 圖片上傳

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Upload Rich Menu Image](https://developers.line.biz/en/reference/messaging-api/#upload-rich-menu-image) | `LINEMessagingBlobApi::setRichMenuImage()` | 上傳 Rich Menu 圖片 | [`LineRichmenuService.php:324`](app/Services/Line/LineRichmenuService.php:324) |

---

## 3. LINE Insight API (數據分析)

### 3.1 粉絲數據

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Get Number of Followers](https://developers.line.biz/en/reference/insight-api/#get-number-of-followers) | `LINEInsightApi::getNumberOfFollowers()` | 取得粉絲數、封鎖數等 | [`LineMetricService.php:161`](app/Services/Line/LineMetricService.php:161) |

### 3.2 訊息數據

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Get Message Event](https://developers.line.biz/en/reference/insight-api/#get-message-event) | `LINEInsightApi::getMessageEvent()` | 取得訊息傳送結果 (需 requestId) | [`LineMetricService.php:220`](app/Services/Line/LineMetricService.php:220) |
| [Get Statistics Per Unit](https://developers.line.biz/en/reference/insight-api/#get-statistics-per-unit) | `LINEInsightApi::getStatisticsPerUnit()` | 取得自訂聚合統計資料 | [`LineMetricService.php:259`](app/Services/Line/LineMetricService.php:259) |

### 3.3 訊息配額

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Get Message Quota](https://developers.line.biz/en/reference/messaging-api/#get-message-quota) | `LINEMessagingApi::getMessageQuota()` | 取得訊息配額資訊 | [`LineMetricService.php:178`](app/Services/Line/LineMetricService.php:178) |
| [Get Message Quota Consumption](https://developers.line.biz/en/reference/messaging-api/#get-message-quota-consumption) | `LINEMessagingApi::getMessageQuotaConsumption()` | 取得訊息使用量 | [`LineMetricService.php:179`](app/Services/Line/LineMetricService.php:179) |

---

## 4. LIFF API (LINE Front-end Framework)

### 4.1 LIFF 應用管理

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Get All LIFF Apps](https://developers.line.biz/en/reference/liff-api/#get-all-liff-apps) | `LiffApi::getAllLIFFApps()` | 取得所有 LIFF 應用 | [`LineLiffService.php:50`](app/Services/Line/LineLiffService.php:50) |
| [Create LIFF App](https://developers.line.biz/en/reference/liff-api/#create-liff-app) | `LiffApi::addLIFFApp()` | 建立 LIFF 應用 | [`LineLiffService.php:66`](app/Services/Line/LineLiffService.php:66) |
| [Update LIFF App](https://developers.line.biz/en/reference/liff-api/#update-liff-app) | `LiffApi::updateLIFFApp()` | 更新 LIFF 應用 | [`LineLiffService.php:86`](app/Services/Line/LineLiffService.php:86) |
| [Delete LIFF App](https://developers.line.biz/en/reference/liff-api/#delete-liff-app) | `LiffApi::deleteLIFFApp()` | 刪除 LIFF 應用 | [`LineLiffService.php:118`](app/Services/Line/LineLiffService.php:118) |

### 4.2 Channel Access Token

| API | 方法 | 用途 | 檔案位置 |
|-----|------|------|----------|
| [Issue Channel Access Token](https://developers.line.biz/en/reference/messaging-api/#issue-channel-access-token) | `LINEChannelAccessTokenApi::issueChannelToken()` | 取得 LIFF API 存取權杖 | [`LineLiffService.php:34`](app/Services/Line/LineLiffService.php:34) |

---

## 5. LINE Webhook (事件接收)

### 5.1 Webhook 事件類型

系統通過 [`LineWebhookService`](app/Services/Line/LineWebhookService.php) 處理以下事件：

| 事件類型 | 常數 | 處理器 | 檔案位置 |
|----------|------|--------|----------|
| Message Event | `LineEventType::MESSAGE` | `handleMessageEvent()` | [`LineWebhookService.php:85`](app/Services/Line/LineWebhookService.php:85) |
| Postback Event | `LineEventType::POSTBACK` | `handlePostbackEvent()` | [`LineWebhookService.php:86`](app/Services/Line/LineWebhookService.php:86) |
| Follow Event | `LineEventType::FOLLOW` | `handleFollowEvent()` | [`LineWebhookService.php:87`](app/Services/Line/LineWebhookService.php:87) |
| Unfollow Event | `LineEventType::UNFOLLOW` | `handleUnfollowEvent()` | [`LineWebhookService.php:88`](app/Services/Line/LineWebhookService.php:88) |
| Join Event | `LineEventType::JOIN` | `handleJoinEvent()` | [`LineWebhookService.php:89`](app/Services/Line/LineWebhookService.php:89) |
| Leave Event | `LineEventType::LEAVE` | `handleLeaveEvent()` | [`LineWebhookService.php:90`](app/Services/Line/LineWebhookService.php:90) |

### 5.2 Postback 處理器

系統支持以下 Postback 動作：

| Action Key | 處理器類別 | 用途 |
|------------|------------|------|
| `switchRichmenu` | `SwitchRichmenuHandler` | 切換 Rich Menu |
| `materialActionTags` | `MaterialActionTagsHandler` | 素材動作標籤 |
| `getInviteAddNum` | `InviteAddNumHandler` | 邀請人數查詢 |
| `poll` | `PollHandler` | 投票互動 |
| `assignCouponToUser` | `AssignCouponHandler` | 發放優惠券 |

---

## 6. 訊息類型支援

系統通過 [`LineMessageBuilder`](app/Services/Line/Factories/LineMessageBuilder.php) 支援以下訊息類型：

| 訊息類型 | LINE SDK Model | 用途 |
|----------|----------------|------|
| Text | `TextMessage` | 文字訊息 |
| Image | `ImageMessage` | 圖片訊息 |
| Video | `VideoMessage` | 影片訊息 |
| Flex Message | `FlexMessage` | 模板訊息 (Flex) |
| Imagemap | `ImagemapMessage` | 圖文訊息 |
| Sticker | (內建支援) | 貼圖訊息 |

### Rich Menu Action 類型

通過 [`LineActionFactory`](app/Services/Line/Factories/LineActionFactory.php) 支援：

| Action Type | LINE SDK Model | 用途 |
|-------------|----------------|------|
| message | `MessageAction` | 傳送訊息 |
| postback | `PostbackAction` | 執行回調 |
| uri | `URIAction` | 開啟連結 |

---

## 7. API 使用總結

### 按功能分類

| 功能模組 | API 數量 | 主要服務類別 |
|----------|----------|--------------|
| 訊息發送 | 4 | `LineMessageService` |
| 訊息驗證 | 3 | `LineMessageService` |
| Rich Menu 管理 | 10 | `LineRichmenuService` |
| 數據分析 | 5 | `LineMetricService` |
| LIFF 應用 | 5 | `LineLiffService` |
| Webhook 處理 | 6+ | `LineWebhookService` |

### 按 LINE API 分類

| API 分類 | 使用次數 |
|----------|----------|
| Messaging API | ~20 |
| Insight API | 5 |
| LIFF API | 5 |
| **總計** | **~30** |

---

## 8. 重要限制提醒

1. **Multicast 限制**：每次最多 500 個用戶
2. **Rich Menu Batch 限制**：每小時最多 3 次請求
3. **訊息配額**：依據 LINE 官方帳號類型
4. **Insight 資料保留**：14 天

---

## 9. 相關檔案索引

- 服務類別：
  - [`app/Services/Line/LineMessageService.php`](app/Services/Line/LineMessageService.php)
  - [`app/Services/Line/LineRichmenuService.php`](app/Services/Line/LineRichmenuService.php)
  - [`app/Services/Line/LineWebhookService.php`](app/Services/Line/LineWebhookService.php)
  - [`app/Services/Line/LineMetricService.php`](app/Services/Line/LineMetricService.php)
  - [`app/Services/Line/LineLiffService.php`](app/Services/Line/LineLiffService.php)

- 工廠類別：
  - [`app/Services/Line/Factories/LineMessageBuilder.php`](app/Services/Line/Factories/LineMessageBuilder.php)
  - [`app/Services/Line/Factories/LineActionFactory.php`](app/Services/Line/Factories/LineActionFactory.php)

- 配置檔案：
  - [`config/line-bot.php`](config/line-bot.php)

- 控制器：
  - [`app/Http/Controllers/LineUsersController.php`](app/Http/Controllers/LineUsersController.php)
  - [`app/Http/Controllers/LineWebhookController.php`](app/Http/Controllers/LineWebhookController.php)
  - [`app/Http/Controllers/RichmenuController.php`](app/Http/Controllers/RichmenuController.php)


---
# 我們「缺少」的重點功能模組 (The Gap)
# LINE Messaging API 完整功能盤點清單 (API Full Inventory)

狀態說明：
✅ = a平台已實作
❌ = a平台目前漏掉 / 未使用

---

## 1. 訊息發送與管理 (Message Sending)

| API 功能名稱 | 用途說明 | 目前狀態 |
|--------------|----------|----------|
| Reply Message | 回覆用戶觸發的訊息 (免費) | ✅ 已使用 |
| Push Message | 主動發送訊息給單一用戶 | ✅ 已使用 |
| Multicast | 主動群發訊息給多個用戶 (最多500人) | ✅ 已使用 |
| Broadcast | 廣播給所有有效好友 | ✅ 已使用 |
| **Narrowcast** | **依據人口統計或受眾標籤進行精準分眾推播** | ❌ 未使用 |
| **Get Narrowcast Progress** | **取得分眾推播的發送進度** | ❌ 未使用 |
| **Cancel Narrowcast** | **取消尚未發送完成的受眾推播** | ❌ 未使用 |
| Get Message Content | 下載用戶傳送的圖片/影片/音訊檔案 | ✅ 已使用 |
| Get Message Quota | 取得當月發送額度上限 | ✅ 已使用 |
| Get Quota Consumption | 取得當月已使用的推播則數 | ✅ 已使用 |
| Validate Message | 驗證訊息物件格式是否正確 | ✅ 已使用 |

---

## 2. 訊息類型與互動介面 (Message Types & Actions)

### 2.1 訊息類型 (Message Types)
| 功能名稱 | 用途說明 | 目前狀態 |
|----------|----------|----------|
| Text / Image / Video | 文字、圖片、影片訊息 | ✅ 已使用 |
| Flex Message | 高度客製化排版的 JSON 模板訊息 | ✅ 已使用 |
| Imagemap | 可點擊多個區塊的圖文訊息 | ✅ 已使用 |
| Sticker | 貼圖訊息 | ✅ 已使用 |
| **Audio** | **語音訊息** | ❌ 未使用 |
| **Location** | **地理位置訊息** | ❌ 未使用 |
| **Template Message** | **舊版模板訊息 (Buttons, Carousel, Confirm) (註：官方建議改用 Flex)** | ❌ 未使用 |

### 2.2 互動行為 (Action Types) & 快捷回覆 (Quick Reply)
| 功能名稱 | 用途說明 | 目前狀態 |
|----------|----------|----------|
| Message / Postback / URI | 傳送文字、回傳隱藏數據、開啟連結 | ✅ 已使用 |
| Rich Menu Switch | 切換圖文選單 (你們透過 Postback 實作) | ✅ 已使用 |
| **Datetime Picker** | **彈出日期/時間選擇器** | ❌ 未使用 |
| **Camera / Camera Roll** | **喚起相機拍照 / 開啟相簿選擇圖片** | ❌ 未使用 |
| **Location Action** | **喚起地圖讓用戶傳送位置** | ❌ 未使用 |
| **Quick Reply** | **訊息底部的浮動快捷按鈕 (所有訊息類型皆可掛載)** | ❌ 未使用 |

---

## 3. Webhook 事件接收 (Webhook Events)

| 事件名稱 | 用途說明 | 目前狀態 |
|----------|----------|----------|
| Message / Postback | 收到一般訊息 / 收到按鈕回傳值 | ✅ 已使用 |
| Follow / Unfollow | 加好友 / 解除封鎖 vs. 封鎖機器人 | ✅ 已使用 |
| Join / Leave | 機器人被加入群組/聊天室 vs. 被踢出 | ✅ 已使用 |
| **Unsend** | **用戶「收回」了訊息** | ❌ 未使用 |
| **MemberJoined / Left** | **群組/聊天室中有「其他用戶」加入或離開** | ❌ 未使用 |
| **VideoPlayComplete** | **用戶看完了你推播的影片 (需設定 trackingId)** | ❌ 未使用 |
| **Beacon** | **用戶走近或離開實體 LINE Beacon 設備範圍** | ❌ 未使用 |
| **AccountLink** | **用戶完成官方帳號與企業自有帳號的綁定** | ❌ 未使用 |
| **Things** | **與 LINE Things (物聯網設備) 互動的事件** | ❌ 未使用 |

---

## 4. 圖文選單管理 (Rich Menu)

| API 功能名稱 | 用途說明 | 目前狀態 |
|--------------|----------|----------|
| Create / Delete | 建立與刪除 Rich Menu | ✅ 已使用 |
| Set / Cancel Default | 設定與取消預設 (所有人看見的) 選單 | ✅ 已使用 |
| Get Default ID | 取得目前預設的選單 ID | ✅ 已使用 |
| Link / Unlink (User/Users) | 綁定或解除特定用戶的客製化選單 | ✅ 已使用 |
| Upload Image | 上傳選單背景圖 | ✅ 已使用 |
| **Get Rich Menu (List)** | **取得單一選單詳情 / 取得帳號下所有選單列表** | ❌ 未使用 |
| **Get Rich Menu ID of User** | **查詢某個特定用戶目前被綁定哪一張選單** | ❌ 未使用 |
| **Download Image** | **下載某張選單的背景圖檔** | ❌ 未使用 |
| **Rich Menu Alias API** | **建立/更新/取得「選單別名」，用於極速切換選單 (A/B選單)** | ❌ 未使用 |

---

## 5. 用戶、群組與聊天室 (Profile, Group & Room)

| API 功能名稱 | 用途說明 | 目前狀態 |
|--------------|----------|----------|
| Get Profile | 取得一般用戶的個人資料 (暱稱、大頭貼) | ✅ 已使用 |
| **Get Group/Room Summary** | **取得群組/聊天室的摘要 (如群組名稱、群組頭像)** | ❌ 未使用 |
| **Get Members Count** | **取得該群組/聊天室的總人數** | ❌ 未使用 |
| **Get Member Profile** | **取得群組/聊天室內「特定成員」的個人資料** | ❌ 未使用 |
| **Get Member User IDs** | **取得群組/聊天室內「所有成員」的 User ID 列表** | ❌ 未使用 |
| **Leave Group/Room** | **讓機器人主動退出該群組或聊天室** | ❌ 未使用 |

---

## 6. Insight 數據分析 (Insight)

| API 功能名稱 | 用途說明 | 目前狀態 |
|--------------|----------|----------|
| Followers | 取得好友數、封鎖數統計 | ✅ 已使用 |
| Message Event | 驗證特定推播的觸及狀況 | ✅ 已使用 |
| Statistics Per Unit | 取得自訂聚合單位的統計資料 | ✅ 已使用 |
| **Demographics** | **取得好友的人口統計分佈 (性別、年齡、地區、OS)** | ❌ 未使用 |
| **Interaction Statistics** | **取得推播訊息的「點擊率」、「播放率」等互動數據** | ❌ 未使用 |

---

## 7. 進階受眾管理 (Audience Group Management)

*(這組 API 專門配合 Narrowcast 使用，目前 a平台完全未使用)*

| API 功能名稱 | 用途說明 | 目前狀態 |
|--------------|----------|----------|
| **Create Audience Group** | **上傳 IFA 或 User ID 建立受眾包** | ❌ 未使用 |
| **Click-based Audience** | **將「點擊過特定連結」的人打包成受眾** | ❌ 未使用 |
| **Imp-based Audience** | **將「看過特定推播訊息」的人打包成受眾** | ❌ 未使用 |
| **Manage Audience** | **更新/取得/刪除受眾包，或增加受眾名單** | ❌ 未使用 |

---

## 8. 帳號連結 (Account Link)

| API 功能名稱 | 用途說明 | 目前狀態 |
|--------------|----------|----------|
| **Issue Link Token** | **核發 Account Link Token，用於實作無縫的自有會員綁定流程** | ❌ 未使用 |

# LINE 官方帳號直播 (LINE OA Live) 目前技術狀態

| 項目 | 目前支援狀態 | 說明 |
|------|--------------|------|
| **Messaging API / SDK** | ❌ 未開放 | 目前 `line-bot-sdk-php` 中**沒有**任何與建立、管理直播相關的 Endpoint (例如沒有 `$client->startLive()`)。 |
| **實際開播方式** | 需透過後台手動設定 | 必須登入 LINE OA 網頁版後台（或透過 LINE 購物團隊協助），手動開啟直播功能，取得 RTMP URL 與 Stream Key，再透過 OBS、vMix 等軟體或硬體導播機推流。 |
| **資格限制** | 嚴格限制 | 通常僅限「認證帳號 (藍盾/綠盾)」，且需另外向 LINE 原廠或代理商申請開通直播權限（常與 LINE 購物模組綁定）。 |
| **自動化推播 (開播通知)**| ⚠️ 僅能用變通作法 | 系統無法透過 API 直接生成「原生直播視窗」，但你們可以寫程式在手動開播時，透過目前的 Push/Broadcast API 發送帶有直播連結的 Flex Message 來通知粉絲。 |


# LINE 透過手機門號互動之技術解析 (PNP 機制)

## 1. 為什麼標準 SDK 沒有這個功能？
- **隱私紅線**：LINE 嚴格禁止未經用戶同意的「無差別比對」。
- **單向加密**：即使有合作的 API，LINE 傳遞的也是經過 Hash 處理的號碼，絕不會明文回傳「這支手機對應的 User ID 是 XXX」。

---

## 2. 官方唯一解法：通知型訊息 (Notification Messages / PNP)

如果 a平台 想要讓客戶單用「手機號碼」就能發 LINE 訊息，必須走 PNP 流程。這不在一般的 SDK 裡，而是需要**專案申請**的進階服務。

### PNP 的運作架構 (單向盲發機制)
1. **發送階段**：企業端將「手機號碼」與「訊息內容（通常被限制只能是重要的系統通知，如：到貨通知、訂單確認，**不可包含行銷內容**）」透過特定的 PNP API 發給 LINE。
2. **比對階段**：LINE 伺服器在自己內部進行比對（開發者看不到過程與結果）。
3. **用戶接收**：如果該手機號碼有註冊 LINE，且用戶沒有關閉「接收通知型訊息」的設定，用戶就會收到來自官方帳號的推播。
4. **取得 User ID (破冰)**：此時 a平台 **仍然不知道** 用戶的 User ID。必須等到該用戶在訊息內點擊按鈕，或是回覆訊息，觸發了 Webhook (Postback / Message Event)，a平台 才能從 Webhook payload 中抓到他的 User ID，正式完成「手機門號 ↔ User ID」的雙向綁定。

---

## 3. 系統帳號綁定 (Account Link) 的常見替代方案

如果不申請門檻極高且限制多的 PNP，業界目前最標準的「手機號碼比對/綁定」技術作法如下：

| 實作方式 | 開發難度 | 說明 | 適用場景 |
|----------|----------|------|----------|
| **LIFF + 簡訊 OTP** | 中 | 用戶點擊選單開啟 LIFF 網頁，在網頁內輸入手機號碼並接收簡訊驗證碼。驗證成功後，系統將當時的 LIFF User ID 與會員手機號碼綁定。 | 最常見、最彈性的作法。a平台已有 LIFF 基礎，最容易實作。 |
| **Account Link API** | 中高 | 透過 LINE 官方的 Account Link API 發出綁定要求，引導用戶登入企業自有網站進行授權綁定。 | 適合已有完善會員登入系統的企業。 |
| **LINE Login (網頁)** | 低 | 在企業官網放「用 LINE 登入」按鈕，並向 LINE 申請「取得 User 手機號碼」的權限（需審核）。 | 適合以網站購物為主，且用戶尚未加入官方帳號的情境。 |