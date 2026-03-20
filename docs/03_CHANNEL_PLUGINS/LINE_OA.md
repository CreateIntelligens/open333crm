# LINE OA Channel Plugin — 官方 API 參考規範

> 本文件以 LINE 官方 API 為基準，定義 `LinePlugin` 需覆蓋的完整能力範圍。
> 實作時以此為 checklist，每個 API 對應到新系統的介面或擴展方法。

---

## 1. 憑證 (Credentials)

```typescript
interface LineChannelCredentials {
  channelId: string;           // LINE Messaging API Channel ID
  channelSecret: string;       // Webhook 簽名驗證用
  channelAccessToken: string;  // Long-lived Access Token
  loginChannelId?: string;     // LINE Login / LIFF 管理用
  loginChannelSecret?: string;
}
```

---

## 2. Webhook 簽名驗證

- Header: `X-Line-Signature`
- 演算法: `HMAC-SHA256(channelSecret, rawBody)` → Base64
- 驗證失敗回 `403`

---

## 3. Webhook 事件 (Events)

### 3.1 一對一聊天事件

| 事件 | 說明 |
|------|------|
| `message` | 用戶傳訊息（文字/圖片/影片/音訊/位置/貼圖） |
| `postback` | 用戶點擊 Postback/Datetime Picker/Rich Menu Switch |
| `follow` | 加好友或解除封鎖 |
| `unfollow` | 用戶封鎖 |
| `accountLink` | 帳號綁定完成（Account Link API 完成後觸發） |
| `videoPlayComplete` | 用戶看完指定影片（需在影片訊息設定 `trackingId`） |
| `unsend` | 用戶收回訊息 |

### 3.2 群組 / 聊天室事件

| 事件 | 說明 |
|------|------|
| `join` | 機器人被加入群組或聊天室 |
| `leave` | 機器人被踢出群組或聊天室 |
| `memberJoined` | 其他成員加入群組/聊天室 |
| `memberLeft` | 其他成員離開群組/聊天室 |

### 3.3 IoT

| 事件 | 說明 |
|------|------|
| `beacon` | 用戶進入/離開實體 LINE Beacon 裝置範圍 |
| `things` | LINE Things 物聯網設備互動事件 |

---

## 4. 訊息類型 (Message Types)

### 4.1 可接收（Inbound）

| 類型 | 說明 |
|------|------|
| `text` | 文字，最大 5000 字元 |
| `image` | 圖片，須立即呼叫 Content API 下載，URL 有效期短 |
| `video` | 影片，同上 |
| `audio` | 語音訊息，同上 |
| `file` | 檔案（PDF/DOC 等），同上 |
| `location` | 地理位置（含 title, address, lat, lon） |
| `sticker` | 貼圖（含 packageId, stickerId） |

> **重要**：所有含媒體的訊息，必須在收到 Webhook 後立即呼叫  
> `GET /v2/bot/message/{messageId}/content` 下載並存入 Storage Layer。

### 4.2 可發送（Outbound）

| 類型 | LINE API 物件 | 說明 |
|------|---------------|------|
| text | `TextMessage` | 最大 5000 字元，可加 emoji |
| image | `ImageMessage` | 需 `originalContentUrl` + `previewImageUrl` |
| video | `VideoMessage` | 需 `originalContentUrl` + `previewImageUrl` + `trackingId`（可選） |
| audio | `AudioMessage` | 需 `originalContentUrl` + `duration`（ms） |
| location | `LocationMessage` | `title`, `address`, `latitude`, `longitude` |
| sticker | `StickerMessage` | `packageId` + `stickerId` |
| **flex** | `FlexMessage` | JSON 自定義版面，最重要，涵蓋幾乎所有 UI 場景 |
| imagemap | `ImagemapMessage` | 可點擊多個熱區的圖文訊息 |
| template | `TemplateMessage` | Buttons / Carousel / Confirm / ImageCarousel（官方建議改用 Flex） |

### 4.3 Quick Reply

所有 Outbound 訊息均可掛載 Quick Reply，顯示在輸入框上方：

```typescript
quickReply: {
  items: [{
    type: 'action',
    imageUrl?: string,   // 按鈕左側圖示
    action: MessageAction | PostbackAction | URIAction
           | DatetimePickerAction | CameraAction
           | CameraRollAction | LocationAction
  }]
}
```

---

## 5. Action 類型

| Action | 說明 |
|--------|------|
| `message` | 代用戶發送指定文字 |
| `postback` | 觸發 Postback 事件（帶 `data`，不顯示在對話中），可選顯示 `displayText` |
| `uri` | 開啟連結（`https://`、`line://`、LIFF URL） |
| `datetimepicker` | 彈出日期/時間/日期時間選擇器，結果以 Postback 回傳 |
| `camera` | 喚起相機拍照 |
| `cameraRoll` | 開啟相簿選擇圖片 |
| `location` | 喚起地圖讓用戶傳送位置 |
| `richMenuSwitch` | 切換至指定 Rich Menu（需設定 `richMenuAliasId`） |

---

## 6. 訊息發送 API

| 策略 | 端點 | 費用 | 說明 |
|------|------|------|------|
| Reply | `POST /v2/bot/message/reply` | 免費 | 需在 Webhook 收到後 30 秒內使用 `replyToken` |
| Push | `POST /v2/bot/message/push` | 計費 | 主動推播給 1 位用戶 |
| Multicast | `POST /v2/bot/message/multicast` | 計費 | 最多 500 個 userId/次 |
| Broadcast | `POST /v2/bot/message/broadcast` | 計費 | 推播給所有有效好友 |
| Narrowcast | `POST /v2/bot/message/narrowcast` | 計費 | 依受眾包或人口統計精準推播 |

### 6.1 Narrowcast 附加參數

```json
{
  "messages": [...],
  "recipient": { "type": "audienceGroup", "audienceGroupId": 12345 },
  "filter": { "demographic": { ... } },
  "limit": { "max": 1000, "upToRemainingQuota": false }
}
```

### 6.2 發送進度查詢 & 取消

| 操作 | 端點 |
|------|------|
| 查 Narrowcast 進度 | `GET /v2/bot/message/progress/narrowcast?requestId=` |
| 取消 Narrowcast | `DELETE /v2/bot/message/narrowcast?requestId=` |
| 查 Broadcast 進度 | `GET /v2/bot/message/progress/broadcast?requestId=` |

### 6.3 配額查詢

| 操作 | 端點 |
|------|------|
| 取得當月配額上限 | `GET /v2/bot/message/quota` |
| 取得當月已用量 | `GET /v2/bot/message/quota/consumption` |

### 6.4 訊息格式驗證（不計費，測試用）

| 端點 | 說明 |
|------|------|
| `POST /v2/bot/message/validate/reply` | 驗證 Reply 訊息格式 |
| `POST /v2/bot/message/validate/push` | 驗證 Push 格式 |
| `POST /v2/bot/message/validate/multicast` | 驗證 Multicast 格式 |
| `POST /v2/bot/message/validate/broadcast` | 驗證 Broadcast 格式 |
| `POST /v2/bot/message/validate/narrowcast` | 驗證 Narrowcast 格式 |

---

## 7. 訊息內容取得

| 操作 | 端點 | 說明 |
|------|------|------|
| 下載訊息媒體檔案 | `GET /v2/bot/message/{messageId}/content` | 圖片/影片/音訊/檔案 |
| 取得媒體檔案 Header | `GET /v2/bot/message/{messageId}/content/transcoding` | 查詢轉碼狀態 |

---

## 8. 用戶 Profile

| 操作 | 端點 |
|------|------|
| 取得好友 Profile | `GET /v2/bot/profile/{userId}` |
| 取得群組成員 Profile | `GET /v2/bot/group/{groupId}/member/{userId}` |
| 取得群組摘要 | `GET /v2/bot/group/{groupId}/summary` |
| 取得群組人數 | `GET /v2/bot/group/{groupId}/members/count` |
| 取得群組所有成員 IDs | `GET /v2/bot/group/{groupId}/members/ids` |
| 取得聊天室成員 Profile | `GET /v2/bot/room/{roomId}/member/{userId}` |
| 機器人主動離開群組 | `DELETE /v2/bot/group/{groupId}/leave` |
| 機器人主動離開聊天室 | `DELETE /v2/bot/room/{roomId}/leave` |

---

## 9. Rich Menu API (`ChannelUiExtension`)

### 9.1 Rich Menu 管理

| 操作 | 端點 |
|------|------|
| 建立 | `POST /v2/bot/richmenu` |
| 取得單一選單 | `GET /v2/bot/richmenu/{richMenuId}` |
| 取得所有選單列表 | `GET /v2/bot/richmenu/list` |
| 刪除 | `DELETE /v2/bot/richmenu/{richMenuId}` |
| 上傳背景圖 | `POST /v2/bot/richmenu/{richMenuId}/content` （multipart） |
| 下載背景圖 | `GET /v2/bot/richmenu/{richMenuId}/content` |

### 9.2 預設選單

| 操作 | 端點 |
|------|------|
| 設定預設選單 | `POST /v2/bot/user/all/richmenu/{richMenuId}` |
| 取消預設選單 | `DELETE /v2/bot/user/all/richmenu` |
| 取得預設選單 ID | `GET /v2/bot/user/all/richmenu` |

### 9.3 用戶綁定

| 操作 | 端點 |
|------|------|
| 查詢用戶目前選單 | `GET /v2/bot/user/{userId}/richmenu` |
| 綁定單一用戶 | `POST /v2/bot/user/{userId}/richmenu/{richMenuId}` |
| 解除單一用戶 | `DELETE /v2/bot/user/{userId}/richmenu` |
| 批次綁定（最多 500 人） | `POST /v2/bot/richmenu/bulk/link` |
| 批次解除 | `POST /v2/bot/richmenu/bulk/unlink` |

> ⚠️ **Batch 限制**：每小時最多 3 次批次請求，需 Queue 控制。

### 9.4 Rich Menu Alias（A/B 選單切換）

| 操作 | 端點 |
|------|------|
| 建立 Alias | `POST /v2/bot/richmenu/alias` |
| 更新 Alias | `PUT /v2/bot/richmenu/alias/{aliasId}` |
| 取得 Alias | `GET /v2/bot/richmenu/alias/{aliasId}` |
| 取得所有 Alias | `GET /v2/bot/richmenu/alias/list` |
| 刪除 Alias | `DELETE /v2/bot/richmenu/alias/{aliasId}` |

### 9.5 Rich Menu 結構

```typescript
interface RichMenuRequest {
  size: { width: 2500; height: 1686 | 843 };  // Full or Half
  selected: boolean;          // 預設展開
  name: string;               // 後台辨識名
  chatBarText: string;        // 展開按鈕文字（最多 14 字）
  areas: Array<{
    bounds: { x: number; y: number; width: number; height: number };
    action: PostbackAction | MessageAction | URIAction | RichMenuSwitchAction;
  }>;
}
```

---

## 10. Insight API (`ChannelAnalyticsExtension`)

| 操作 | 端點 | 說明 |
|------|------|------|
| 好友數統計 | `GET /v2/bot/insight/followers?date=YYYYMMDD` | 好友數、封鎖數、目標觸及數 |
| 人口統計分布 | `GET /v2/bot/insight/demographic` | 性別、年齡層、地區、使用 OS |
| 訊息互動數據 | `GET /v2/bot/insight/message/event?requestId=` | 指定推播的傳達/已讀/點擊 |
| 自訂統計單位 | `GET /v2/bot/insight/message/event/aggregation` | 依 customAggregationUnit 統計 |

> ⚠️ **資料保留**：Insight 數據只保留 **14 天**，需每日定時拉取存入系統 DB。

---

## 11. 受眾管理 API (`ChannelAudienceExtension`)

配合 Narrowcast 使用：

| 操作 | 端點 |
|------|------|
| 建立 User ID 受眾包 | `POST /v2/bot/audienceGroup/upload` |
| 建立點擊型受眾 | `POST /v2/bot/audienceGroup/click` |
| 建立曝光型受眾 | `POST /v2/bot/audienceGroup/impression` |
| 新增成員至受眾包 | `POST /v2/bot/audienceGroup/{id}/users` |
| 更新受眾包名稱 | `PUT /v2/bot/audienceGroup/{id}/updateDescription` |
| 取得受眾包詳情 | `GET /v2/bot/audienceGroup/{id}` |
| 列出所有受眾包 | `GET /v2/bot/audienceGroup/list` |
| 刪除受眾包 | `DELETE /v2/bot/audienceGroup/{id}` |

---

## 12. LIFF API

| 操作 | 端點 |
|------|------|
| 列出所有 LIFF Apps | `GET /liff/v1/apps` |
| 建立 LIFF App | `POST /liff/v1/apps` |
| 更新 LIFF App | `PUT /liff/v1/apps/{liffId}` |
| 刪除 LIFF App | `DELETE /liff/v1/apps/{liffId}` |

**LIFF View 類型**：

| Type | 高度 | 適用 |
|------|------|------|
| `compact` | 50% | 快速確認 |
| `tall` | 80% | 表單填寫 |
| `full` | 100% | 互動遊戲/完整頁面 |

---

## 13. Account Link

用於將企業自有系統帳號與 LINE User ID 做雙向綁定：

| 步驟 | 操作 | 端點 |
|------|------|------|
| 1 | 核發一次性 Link Token（10 分鐘有效） | `POST /v2/bot/user/{userId}/linkToken` |
| 2 | 導引用戶至企業網站登入授權 | — |
| 3 | 授權完成 → LINE 回呼 `accountLink` Webhook 事件 | — |

---

## 14. Webhook 設定

| 操作 | 端點 |
|------|------|
| 設定 Webhook URL | `PUT /v2/bot/channel/webhook/endpoint` |
| 取得目前 Webhook 設定 | `GET /v2/bot/channel/webhook/endpoint` |
| 測試 Webhook（發測試事件） | `POST /v2/bot/channel/webhook/test` |

---

## 15. 速率限制總覽

| API 類型 | 限制 |
|----------|------|
| Multicast | 最多 500 userId/次，200 requests/秒 |
| Rich Menu Batch Link/Unlink | 3 次/小時 |
| 配額依帳號方案 | Broadcast / Narrowcast 扣推播則數 |
| Insight | 无明確限制，建議 1 次/日定時拉取 |

---

## 16. 無法透過 API 提供的功能

| 功能 | 說明 |
|------|------|
| LINE OA 直播 | 無 API，需在 LINE OA Manager 手動取得 RTMP 推流 URL |
| 手機號碼 → User ID 查詢 | LINE 嚴格禁止，合規作法為 LIFF OTP 或 Account Link |
| 已讀回條 | Messaging API 層級不提供 |

---

## 🛠 實作與營運注意事項 (Implementation & Ops Notes)

### 1. 資料庫同步
程式碼中新增了 5 個 Prisma Model（`RichMenu`, `RichMenuUserBinding`, `RichMenuAlias`, `AudienceGroup`, `InsightSnapshot`）。在啟動前務必執行：
```bash
npx prisma migrate dev --name add-line-oa-models
```

### 2. 環境變數與憑證
`LinePlugin` 需要正確配置以下憑證（儲存於 `Channel.credentialsEncrypted`）：
- `channelId`, `channelSecret`, `channelAccessToken`
- 若需支援 LIFF/Login 相關功能：`loginChannelId`, `loginChannelSecret`

### 3. Worker 啟動
本插件高度依賴 **BullMQ** 處理非同步長任務，需確保 `packages/channel-plugins/src/line/` 相關 Worker 正常執行：
- `line-media-download`: 負責 Webhook 收到媒體後立即轉存。
- `line-narrowcast-progress`: 負責 Narrowcast 送達進度追蹤。
- `line-insight-sync`: 每日凌晨 UTC 00:30 同步前一日分析數據。

### 4. 驗證重點 (Pending Tasks 11.x)
- **Webhook 驗證**：使用 LINE Developer Console 的 Verify 工具測試 `X-Line-Signature` 邏輯。
- **媒體轉存**：傳送圖片/影片，確認 DB 的 `Message.content.mediaUrl` 是否從 `line-content:ID` 成功轉換為 Storage Layer 連結。
- **Rich Menu 限制**：測試 `linkMenuToUsers` 時，確認是否受「每小時 3 次」的批次 API 呼叫限制保護。
