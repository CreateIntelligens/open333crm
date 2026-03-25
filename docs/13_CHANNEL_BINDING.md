# 13 — 企業自助綁定社交渠道 (Channel Self-Binding)

## 設計目標

企業管理員能在後台**自行**完成各渠道的綁定，不需要找工程師手動設定環境變數或操作資料庫。

綁定流程涉及：
1. 取得渠道的 API 憑證（Access Token / Secret）
2. 設定 Webhook URL 讓渠道能回呼本系統
3. 驗證連線正常
4. **授權部門存取 (Team Access)**
5. 啟用並管理

---

## 渠道綁定流程總覽

```
後台設定頁 → 選擇渠道類型 → 填入憑證 → 系統驗證 → 選擇授權部門 → 啟用
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

步驟 3：本系統後台 → 新增 LINE OA → 貼入上方資料 → 選擇授權部門 (Authorized Teams)

步驟 4：系統自動顯示 Webhook URL（如下）
  https://your-domain.com/webhooks/line/{channelId}

步驟 5：回到 LINE Developers Console
  → Messaging API → Webhook URL → 貼入步驟4的 URL → 啟用 Webhook

步驟 6：本系統後台 → 點「驗證連線」
  → 系統發送 LINE Verification Request → 確認成功 ✅
```

### 系統後端自動化完成的事 (Security Flow)

```typescript
async function activateLineChannel(channelConfig: CreateLineChannelDto) {
  // 1. 儲存憑證（加密存入 DB）
  const channel = await channelRepo.create({
    ...channelConfig,
    credentials: await encrypt(channelConfig.credentials),
    authorizedTeamIds: channelConfig.teamIds, // 授權特定部門
  });

  // 2. 產生 Webhook URL 與 Verify Token
  // 系統隨機生成強強度 Verify Token 並與渠道 ID 綁定，防止 Webhook 偽造

  // ... 其餘自動化設定 (setWebhook 等)
}
```

---

## FB Messenger 綁定流程

### 模式 A：自建 FB App（MVP 優先）

```
步驟 1：企業在 developers.facebook.com 建立 App
步驟 2：取得並貼入本系統後台 (App ID, Secret, Token)
步驟 3：設定授權部門 (Authorized Teams)
步驟 4：本系統後台 → 儲存 → 顯示 Webhook URL 與 Verify Token
步驟 5：企業到 FB Developers Console 完成 Webhook 訂閱
```

---

## Web Chat Widget 綁定流程

Web Chat 沒有第三方 OAuth，是本系統自建的，最簡單：

```
步驟 1：後台 → 新增 Web Chat → 填入
  ├── 名稱
  ├── 允許嵌入的網域 (Origin Whitelist) ← 安全防護，防止盜用
  ├── 授權部門 (Authorized Teams)
  └── 外觀設定

步驟 2：系統產生嵌入碼
  <script src="..." data-key="wc_{channelId}_{token}"></script>

步驟 3：貼到官網 </body> 前
```

---

## Channel 綁定後台 UI 流程

```
設定 → 渠道管理
  │
  ├── 已綁定渠道清單 (顯示狀態、授權部門)
  └── [+ 新增渠道]
```

### 憑證安全管理

- **加密儲存**: 憑證使用 AES-256-GCM 加密後存入資料庫。
- **權限隔離**: 只有 Whitelist 內的 Team 成員可讀寫此渠道的對話。

---

## 渠道管理 API

```
GET    /api/v1/channels                    # 列出所有已綁定渠道
POST   /api/v1/channels/line               # 新增 LINE OA (含 teamIds)
POST   /api/v1/channels/fb                 # 新增 FB Messenger (含 teamIds)
POST   /api/v1/channels/webchat            # 新增 Web Chat (含 teamIds, origins)
PATCH  /api/v1/channels/:id                # 更新設定 (名稱/外觀/授權部門)
DELETE /api/v1/channels/:id                # 解綁渠道
```
