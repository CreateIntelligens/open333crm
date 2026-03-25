# 22 — 粉絲會員入口（Fan Portal）

## 定位

> 這是一個**可選的延伸模組**，不是 CRM 核心功能。
> 做成獨立部署的前端 App，透過 CRM API 讀寫資料。
> 企業可依需要開啟或關閉，License 控制開關。

### 為什麼做成 Plugin / 獨立模組？

| 理由 | 說明 |
|------|------|
| 受眾不同 | CRM 後台是給**客服/管理層**用的；Fan Portal 是給**粉絲/終端消費者**用的，完全不同的 UX |
| 部署可分離 | 不需要 Portal 的客戶不會被多餘程式碼影響，部署體積更小 |
| 前端技術可能不同 | Portal 可能需要更花俏的動畫、RWD mobile-first、SEO（SSR）|
| 商業上可加價 | Fan Portal 是進階功能，在 Professional / Enterprise 方案才開啟 |

---

## 整體架構

```
┌──────────────────────────────────────────────────┐
│           粉絲（消費者）的瀏覽器 / LINE WebView     │
└────────────────┬─────────────────────────────────┘
                 │ HTTPS
┌────────────────▼─────────────────────────────────┐
│  Fan Portal App（Next.js SSR/SSG）                │
│  https://fans.xx-appliance.com                    │
│                                                    │
│  ├─ 首頁（活動列表、熱門投票）                       │
│  ├─ 投票頁（單選/複選 + 圖片 + 進度條）             │
│  ├─ 表單頁（活動報名 + 抽獎 + 問卷）                │
│  ├─ 競猜頁（預測結果 + 即時統計）                    │
│  ├─ 會員中心（我的活動記錄 + 積分 + 優惠）          │
│  └─ 排行榜 / 留言牆                                │
└────────────────┬─────────────────────────────────┘
                 │ Internal API（透過 CRM API Key 或 Fan Session Token）
┌────────────────▼─────────────────────────────────┐
│  open333CRM API Server                            │
│                                                    │
│  /api/v1/portal/*   ← Fan Portal 專屬 API         │
│  /api/v1/contacts/* ← 聯繫人資料（Portal 讀取）    │
└──────────────────────────────────────────────────┘
```

---

## LINE OA → Fan Portal 導流（LIFF 整合）

> **這是最核心的使用場景**：企業在 LINE OA 發佈 Flex Message，
> 粉絲點擊按鈕 → 直接在 LINE App 內 WebView 打開 Portal 頁面，
> 身份自動帶入，**不需要額外登入**。

### 技術關鍵：LINE LIFF（LINE Front-end Framework）

LIFF 是 LINE 官方提供的 SDK，讓網頁在 LINE App 內開啟時，自動取得用戶的 LINE userId。

```
粉絲在 LINE OA 收到 Flex Message
  │
  ▼
點擊按鈕「立即投票 →」
  │  URL: https://liff.line.me/{LIFF_ID}/vote/abc123
  │
  ▼
LINE App 開啟內建 WebView（LIFF Browser）
  │
  ├─ LIFF SDK 自動注入登入狀態
  ├─ liff.getProfile() → 取得 userId + displayName + pictureUrl
  │   （不需要額外 OAuth 跳轉，使用者無感）
  │
  ▼
Fan Portal 收到 userId
  → 拿 userId 打 CRM API → 找到 Contact
  → 發行 Fan Session Token
  → 直接顯示投票頁面（已登入狀態）

整個過程：粉絲 **只點了一個按鈕**，零額外步驟。
```

### Flex Message 範例（含 LIFF 連結）

CRM 後台建立活動發布時，自動產生帶 LIFF URL 的 Flex 模板：

```json
{
  "type": "bubble",
  "hero": {
    "type": "image",
    "url": "https://storage.xx.com/templates/vote-banner.jpg",
    "size": "full"
  },
  "body": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      { "type": "text", "text": "🗳 2026燈會投票", "weight": "bold", "size": "xl" },
      { "type": "text", "text": "你最想去哪場燈會？投票抽 LINE Points！", "wrap": true },
      { "type": "text", "text": "📅 2/26 ~ 3/15 ・ 🎁 投票抽 100 LINE Points", "size": "sm", "color": "#999999" }
    ]
  },
  "footer": {
    "type": "box",
    "layout": "vertical",
    "contents": [
      {
        "type": "button",
        "style": "primary",
        "color": "#06C755",
        "action": {
          "type": "uri",
          "label": "立即投票 →",
          "uri": "https://liff.line.me/2001234567-AbCdEfGh/vote/act_xxx"
        }
      }
    ]
  }
}
```

### LIFF 初始化（Portal 前端）

```typescript
// apps/portal/src/lib/liff.ts
import liff from '@line/liff';

export async function initLiffAuth(): Promise<FanSession> {
  await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return; // 重導後會回來
  }

  // 取得 LINE Profile（userId 是關鍵）
  const profile = await liff.getProfile();

  // 用 LINE userId 向 CRM 換 Fan Token
  const res = await fetch('/api/v1/portal/auth/liff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken: liff.getAccessToken(),
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    }),
  });

  const { fanToken, contact } = await res.json();
  return { fanToken, contact };
}
```

### Portal Auth LIFF 端點

```
POST /api/v1/portal/auth/liff
Body: { accessToken, userId, displayName, pictureUrl }
處理邏輯：
  1. 驗證 accessToken（呼叫 LINE Verify API）
  2. 用 userId + channelId 查 ChannelIdentity → 找到 Contact
  3. 若 Contact 不存在 → 自動建立
  4. 發行 Fan Session Token（JWT）
```

### 各場景的導流方式

| 導流來源 | 方法 | 用戶體驗 |
|---------|------|---------|
| **LINE Flex 推播** | 按鈕 URI → LIFF URL | 🟢 **一鍵直達**，最佳體驗 |
| **LINE 圖文選單（Rich Menu）** | 格子 → LIFF URL | 🟢 固定入口，長期露出 |
| **LINE Bot 自動回覆** | Bot 回覆帶 LIFF 連結 | 🟢 對話中導流 |
| FB Messenger 推播 | 按鈕 URL | 🟡 跳外部瀏覽器，需 FB Login |
| 官網 / Email / QR Code | 直接 URL | 🟡 需 LINE Login 或 OTP |

### LIFF 環境變數

```env
# Fan Portal (apps/portal)
NEXT_PUBLIC_LIFF_ID=2001234567-AbCdEfGh
NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID=1234567890
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

> **LIFF URL 格式**：`https://liff.line.me/{LIFF_ID}/{path}`
>
> 每個 Tenant 在 LINE Developers Console 建立一個 LIFF App，
> Endpoint URL 設為 `https://fans.xx-appliance.com`。
> 之後 `https://liff.line.me/LIFF_ID/vote/act_xxx`
> 就會自動在 LINE 內開啟 `https://fans.xx-appliance.com/vote/act_xxx`。

---

## 粉絲身份認證（重要）

### 登入方式

粉絲不需要「註冊帳號」，透過**社交渠道認證**直接登入：

```
登入方式 1：LINE Login（最常見）
  → 企業的 LINE Login Channel → OAuth → 取得 LINE userId
  → 比對 CRM 中的 ChannelIdentity → 找到 Contact
  → 發行 Fan Session Token（JWT，24h 有效）

登入方式 2：FB Login
  → FB OAuth → PSID → 找到 Contact

登入方式 3：Email / 手機 OTP（無社交帳號的用戶）
  → 輸入 Email → 收驗證碼 → 建立或找到 Contact
```

**關鍵設計**：Fan Portal 用的 JWT 跟 Admin Console 的 JWT 完全分開。
Fan Token 只能存取自己的資料，後台 API（Case / Agent...）完全無法呼叫。

```typescript
// Fan Session Token Payload
{
  sub: 'fan',
  contactId: 'uuid',
  tenantId: 'uuid',
  displayName: '王小美',
  channels: ['LINE'],
  iat: ...,
  exp: ...   // 24 小時
}
```

---

## 核心功能

### 1. 投票（Poll / Voting）

```
┌──────────────────────────────────────────────┐
│  🗳  2026 燈會最好玩！你想去看哪場？           │
│      可複選，每人最多選 3 個                    │
│                                                │
│  ┌────────┐ ┌────────┐ ┌────────┐              │
│  │ 📸     │ │ 📸     │ │ 📸     │              │
│  │台北燈會│ │台南鹿耳│ │高雄愛河│              │
│  │ 284票  │ │ 238票  │ │ 321票  │              │
│  │ [投票] │ │ [投票] │ │ [投票] │              │
│  └────────┘ └────────┘ └────────┘              │
│                                                │
│  🔒 需要登入  │  📅 2026-02-26 ~ 03-15        │
│  👤 已投 843 人                                │
└──────────────────────────────────────────────┘
```

功能特點：
- 單選 / 複選 / 限選 N 個
- 圖片選項 + 即時票數（可設定投票後才顯示結果）
- 每人限投 1 次（依 contactId 防灌票）
- 可設定獎品：投票後自動抽獎 / 貼標 / 發LINE通知
- 時間限制：開始 ~ 結束時間

### 2. 表單活動（Form / Campaign）

- 活動報名（填寫姓名、電話、選場次）
- 問卷調查
- 抽獎活動（填表抽，中獎名單公告）
- 意見回饋
- 自訂欄位（文字 / 單選 / 複選 / 日期 / 上傳圖片）

投出/提交後觸發 Automation：
```
提交表單 → 自動貼標「2026燈會參加者」
         → LINE 推播感謝訊息 + 電子票券
         → CRM 後台可匯出報名名單
```

### 3. 競猜（Prediction / Quiz）

- 預測型：「今年金鐘獎最佳男主角是誰？」
- 問答型：「回答以下 3 題，答對即可抽獎」
- 即時統計全體猜測分布
- 活動結束後自動對答案，算出每個人的得分

### 4. 會員中心

每個粉絲登入後可以看到自己的資料：

```
┌──────────────────────────────────┐
│  👤 王小美     已綁定：LINE ✅    │
│                                    │
│  ── 我的活動 ─────────────────── │
│  ✅ 2026燈會投票      已投票       │
│  ✅ 金鐘競猜          答對2題      │
│  📝 春節抽獎          已報名       │
│                                    │
│  ── 我的標籤 ─────────────────── │
│  [冰箱客戶] [VIP] [2026燈會]     │
│                                    │
│  ── 我的積分 ─────────────────── │
│  目前積分：380 點                  │
│  [兌換優惠券]                     │
└──────────────────────────────────┘
```

### 5. 排行榜 / 留言牆（Optional）

- 投票排行：顯示選項票數排名
- 積分排行：競猜最高分
- 留言牆：粉絲對活動的留言（需審核機制）

### 6. 商品兌換 / 獎勵商城（Reward Marketplace）

粉絲用經驗幣（積分）兌換實體或虛擬商品，串接第三方兌換廠商：

```
┌──────────────────────────────────────────────┐
│  🛍 獎勵商城          我的經驗幣：380         │
├──────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐            │
│  │ 📸     │ │ 📸     │ │ 📸     │            │
│  │茶葉蛋  │ │麥當勞  │ │空調清洗│            │
│  │ 7-11   │ │大薯    │ │$500折扣│            │
│  │ 50 幣  │ │120 幣  │ │200 幣  │            │
│  │[兌換]  │ │[兌換]  │ │[兌換]  │            │
│  └────────┘ └────────┘ └────────┘            │
│                                                │
│  [合作夥伴] [自家商品] [優惠券]                │
└──────────────────────────────────────────────┘
```

**經驗幣（Experience Coins）獲取方式：**

| 行為 | 獲得幣數 |
|------|---------|
| 完成投票 | +10 |
| 填寫表單/問卷 | +20 |
| 競猜答對 | +15 per 題 |
| 每日簽到 | +5 |
| 推薦好友加入 | +50 |
| 購買商品（ERP 回傳） | 消費 $100 = +1 幣 |

**第三方兌換廠商串接：**

```
兌換流程：
  粉絲點「兌換 7-11 茶葉蛋」
    → 確認扣除 50 經驗幣
    → 系統呼叫第三方兌換 API
    → 取得兌換序號 / Barcode
    → LINE 推播 Flex 卡片（含 Barcode + 到期日）
    → 粉絲到 7-11 出示 Barcode 兌換

第三方 API 介面（抽象層）：
  POST /vendor/redeem
  Body: { vendorId, productId, contactId, quantity }
  Response: { code: "ABC123", barcode: "...", expiresAt: "..." }
```

支援的兌換廠商模式：
- **API 串接**：7-11 / 全家 / 麥當勞（透過 Ticket Xpress 等平台）
- **自家優惠券**：系統自行產生 QR Code，門市掃碼核銷
- **電子票券**：直接發送 PDF / 圖片票券

### 7. 訂票 / 訂位系統（Ticketing）

企業可販售或贈送活動門票：演唱會、握手會、粉絲見面會、講座等。

```
┌──────────────────────────────────────────────┐
│  🎫 xx家電 2026 感恩演唱會                     │
│  📅 2026-05-20 (六) 19:00                     │
│  📍 台北小巨蛋                                 │
│                                                │
│  區域選擇：                                    │
│  ┌──────────────────────────────────┐          │
│  │  [VIP $3,800] [A區$2,200] [B區$1,200]│     │
│  │  剩餘：12     剩餘：89    剩餘：234   │     │
│  └──────────────────────────────────┘          │
│                                                │
│  或用 500 經驗幣 兌換 B區門票  [用幣兌換]      │
│                                                │
│  [立即購票 →]                                  │
└──────────────────────────────────────────────┘
```

**票務功能：**
- 座位區域 / 場次管理（庫存控制）
- 付款方式：信用卡（串金流）/ 經驗幣兌換 / 免費（贈票）
- 電子票券：QR Code 透過 LINE Flex 發送
- 入場驗票：現場掃 QR Code 核銷
- 轉讓功能：持票人可轉讓給其他 Contact

**DB Schema 補充（訂票）：**

```prisma
model TicketEvent {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String   @db.Uuid
  title       String
  venue       String
  eventDate   DateTime
  coverImage  String?
  description String?
  status      String   @default("draft")  // draft | on_sale | sold_out | ended
  createdAt   DateTime @default(now())

  tiers   TicketTier[]
  orders  TicketOrder[]
  @@map("ticket_events")
}

model TicketTier {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  eventId     String  @db.Uuid
  name        String  // "VIP", "A區", "B區"
  price       Int     // 價格（TWD），0 = 免費
  coinPrice   Int?    // 經驗幣價格（可選）
  totalSeats  Int
  soldCount   Int     @default(0)
  sortOrder   Int     @default(0)

  event   TicketEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  @@map("ticket_tiers")
}

model TicketOrder {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  eventId     String   @db.Uuid
  tierId      String   @db.Uuid
  contactId   String   @db.Uuid
  payMethod   String   // credit_card | coins | free
  amount      Int      // 實付金額
  coinsUsed   Int      @default(0)
  qrCode      String   @unique  // 入場 QR Code
  status      String   @default("valid")  // valid | used | cancelled | transferred
  usedAt      DateTime?
  createdAt   DateTime @default(now())

  event   TicketEvent @relation(fields: [eventId], references: [id])
  @@index([contactId])
  @@index([eventId])
  @@map("ticket_orders")
}
```

---

## DB Schema 擴充

```prisma
// ── Fan Portal 活動 ──────────────────────

model PortalActivity {
  id           String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String         @db.Uuid
  type         ActivityType   // POLL | FORM | QUIZ
  title        String
  description  String?
  coverImage   String?        // Storage Layer URL
  status       ActivityStatus @default(DRAFT)
  startAt      DateTime
  endAt        DateTime
  settings     Json           // 活動特有設定（複選數、是否匿名、抽獎規則等）
  createdById  String         @db.Uuid
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt

  options      PortalOption[]
  fields       PortalField[]
  submissions  PortalSubmission[]

  @@index([tenantId, status])
  @@index([tenantId, endAt])
  @@map("portal_activities")
}

enum ActivityType   { POLL FORM QUIZ }
enum ActivityStatus { DRAFT ACTIVE ENDED ARCHIVED }

// 投票/競猜的選項
model PortalOption {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  activityId  String  @db.Uuid
  label       String
  imageUrl    String?
  sortOrder   Int     @default(0)
  isCorrect   Boolean @default(false)   // 競猜用：這個選項是否為正確答案
  voteCount   Int     @default(0)       // 反正規化，方便即時顯示

  activity    PortalActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)

  @@map("portal_options")
}

// 表單自訂欄位
model PortalField {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  activityId  String  @db.Uuid
  label       String
  fieldType   String  // text | select | multi_select | date | file | number
  required    Boolean @default(false)
  options     Json?   // select/multi_select 的選項清單
  sortOrder   Int     @default(0)

  activity    PortalActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)

  @@map("portal_fields")
}

// 粉絲提交資料（投票 / 表單填寫 / 競猜答案）
model PortalSubmission {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  activityId  String   @db.Uuid
  contactId   String   @db.Uuid
  data        Json     // { selectedOptions: [...], answers: {...}, formData: {...} }
  score       Int?     // 競猜得分
  isWinner    Boolean  @default(false)    // 抽獎是否中獎
  createdAt   DateTime @default(now())

  activity    PortalActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)

  @@unique([activityId, contactId])       // 每人每活動只能提交一次
  @@index([activityId])
  @@map("portal_submissions")
}

// 積分帳本
model PointTransaction {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String   @db.Uuid
  contactId   String   @db.Uuid
  type        String   // earn | redeem | expire | admin_adjust
  amount      Int      // 正=獲得 負=扣除
  balance     Int      // 異動後餘額
  source      String?  // 來源（activityId / orderId / manual）
  note        String?
  createdAt   DateTime @default(now())

  @@index([tenantId, contactId])
  @@map("point_transactions")
}
```

---

## Fan Portal API

```
# 認證
POST /api/v1/portal/auth/line-login     # LINE Login → Fan Token
POST /api/v1/portal/auth/fb-login       # FB Login → Fan Token
POST /api/v1/portal/auth/otp/send       # 寄 OTP 到 Email
POST /api/v1/portal/auth/otp/verify     # 驗證 OTP → Fan Token

# 活動列表（公開）
GET  /api/v1/portal/activities          # 進行中/已結束活動列表
GET  /api/v1/portal/activities/:id      # 活動詳情

# 參與活動（需登入）
POST /api/v1/portal/activities/:id/submit   # 投票/填表/競猜
  Body（投票）: { "selectedOptions": ["optionId1", "optionId2"] }
  Body（表單）: { "formData": { "name": "王小美", "session": "上午場" } }
  Body（競猜）: { "answers": [{ "questionId": "q1", "optionId": "o3" }] }

GET  /api/v1/portal/activities/:id/result   # 活動結果（票數統計/中獎名單）

# 我的
GET  /api/v1/portal/me                 # 我的資料
GET  /api/v1/portal/me/activities      # 我參加過的活動
GET  /api/v1/portal/me/points          # 積分餘額 + 交易記錄
```

---

## CRM 後台管理端

Fan Portal 的活動由 CRM 後台的 Admin 建立和管理：

```
# Admin API
GET    /api/v1/activities                  # 活動列表
POST   /api/v1/activities                  # 建立投票/表單/競猜
GET    /api/v1/activities/:id              # 詳情
PATCH  /api/v1/activities/:id              # 更新
DELETE /api/v1/activities/:id              # 刪除（DRAFT 才可）
POST   /api/v1/activities/:id/publish      # 發布（DRAFT → ACTIVE）
POST   /api/v1/activities/:id/end          # 結束
GET    /api/v1/activities/:id/submissions  # 所有提交資料（匯出報名名單）
POST   /api/v1/activities/:id/draw         # 抽獎（隨機抽 N 名中獎者）
```

### CRM 後台 UI（ASCII Wireframe）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  粉絲活動管理                                              [+ 建立活動]      │
├──────────────────────────────────────────────────────────────────────────────┤
│  [全部] [進行中 3] [已結束 12] [草稿 2]                                     │
├──┬──────────────────────────┬──────┬──────────────┬──────┬────────┬─────────┤
│  │ 活動名稱                 │ 類型 │ 期間          │ 參與 │ 狀態   │ 操作     │
├──┼──────────────────────────┼──────┼──────────────┼──────┼────────┼─────────┤
│🟢│ 2026燈會投票             │ 投票 │ 02/26-03/15  │ 843  │ 進行中 │ [管理]  │
│🟢│ 春節抽獎活動             │ 表單 │ 02/01-02/28  │ 1280 │ 進行中 │ [管理]  │
│🔵│ 金鐘60熱力問答           │ 競猜 │ 09/22-09/30  │ 1313 │ 已結束 │ [查看]  │
│📝│ 母親節感恩回饋           │ 表單 │ 未設定       │ —    │ 草稿   │ [編輯]  │
└──┴──────────────────────────┴──────┴──────────────┴──────┴────────┴─────────┘
```

---

## 與 CRM 的深度整合

Fan Portal 不是獨立存在的，它和 CRM 核心深度互動：

### 1. 自動貼標與後續追蹤 (Automation)

```
粉絲投票/填表/答題後
  → Portal API 發布事件：`portal.activity.submitted`
  → Automation Engine 觸發規則：
      IF activity.type == 'POLL' AND activity.id == 'xxx'
      THEN 貼標 `2026燈會參加者`
      AND  發 LINE 訊息 `感謝您的投票！🎉`
```

### 2. 受眾分群加強

行銷廣播可以用 Portal 資料做分群：

```
分群條件：
  - 參加過「春節抽獎」活動 ✅
  - 且 標籤包含「VIP」 ✅
  - 且 積分 >= 100
→ 篩選出 234 人 → 發送專屬優惠
```

### 3. 積分兌換 + 優惠券

```
粉絲在會員中心
  → 用 200 積分兌換「空調清洗 $500 折扣券」
  → 系統扣積分 → 發 LINE 訊息（Flex 卡片：電子券 QR Code）
  → 門市掃碼核銷
```

---

## 部署方式

Fan Portal 是在 Monorepo 裡多一個 app：

```
open333CRM/
├── apps/
│   ├── api/
│   ├── web/          ← Admin 後台
│   ├── widget/       ← WebChat Widget
│   ├── workers/
│   └── portal/       ← 🆕 Fan Portal（Next.js SSR）
```

```yaml
# docker-compose.yml 新增
portal:
  build:
    context: .
    dockerfile: apps/portal/Dockerfile
  environment:
    NEXT_PUBLIC_API_URL: https://api.your-domain.com
    NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID: "1234567890"
  ports:
    - "3003:3003"
```

域名：每個客戶的 Portal 可以用**子域名**或**自訂域名**：
```
fans.xx-appliance.com    ← 子域名
vote.some-brand.com      ← 客戶自訂域名
```

---

## License 控制

```json
{
  "features": {
    "portal": {
      "enabled": true,
      "maxActiveActivities": 10,
      "maxSubmissionsPerMonth": 50000,
      "pointSystem": true,
      "customDomain": true
    }
  }
}
```

| 方案 | Portal |
|------|--------|
| Starter | ❌ 不含 |
| Professional | ✅ 3 個活動上限，月 5,000 參與 |
| Enterprise | ✅ 無限活動，月 50,000+ 參與 |
