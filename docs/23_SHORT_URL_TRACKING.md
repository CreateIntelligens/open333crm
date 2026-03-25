# 23 - Short URL Tracking / LIFF + Multi-Channel
# 短連結追蹤系統

## Position / 定位

> Marketing core tool: all outbound links go through short URLs.
> Each click auto-identifies the user + records behavior + auto-tags.
>
> 行銷核心工具：所有對外連結都走短連結，
> 每次點擊自動識別身份 + 記錄行為 + 自動貼標。

---

## Cross-Channel Identity Tracking / 各渠道身份追蹤能力比較

| Capability / 能力 | LINE (LIFF) | FB Messenger | WhatsApp | External / 外部瀏覽器 |
|------------|-------------|-------------|----------|-----------------|
| Identity method / 識別方式 | LIFF SDK 自動取 userId | MessengerExtensions 取 PSID | 個人化 token (Per-recipient) | 無法識別 (anonymous) |
| In-app WebView / App 內開啟 | Yes | Yes (僅 Messenger 內) | No (跳外部瀏覽器) | - |
| User experience / 使用者體驗 | 無感、一鍵 (Seamless) | 需點「允許」(Requires prompt) | 無感 (token in URL) | 需引導登入 |
| SDK | @line/liff | MessengerExtensions | 不需要 SDK | N/A |
| Success rate / 識別成功率 | ~95% | ~60% (需授權、政策常變) | ~90% (發送時已知) | 0% (需登入) |
| Auto-tag / 自動貼標 | Yes, 即時 | 取得 PSID 後可 | Yes, 即時 | 登入後才能 |
| Trigger automation / 觸發自動化 | Yes | 部分 (Partial) | Yes | No |
| UTM tracking / UTM 追蹤 | Yes | Yes | Yes | Yes |
| Use cases / 適用場景 | Flex/Rich Menu/廣播 | Messenger 按鈕 | Template Messages | Email/官網/QR Code |
| Limitations / 限制 | 需建 LIFF App | 需 FB App Review、Meta 政策不穩 | 每位收件人需產生唯一 URL | 無法主動識別 |

### Per-Channel Strategy / 分渠道追蹤策略

    短連結被點擊 -> 系統判斷來源環境：
    Short link clicked -> system detects source:

    1. LINE (LIFF WebView)
       -> liff.getProfile() 自動取得 userId -> 完整追蹤

    2. FB Messenger (Messenger WebView)
       -> MessengerExtensions.getContext() 嘗試取 PSID
       -> 成功 -> 追蹤 | 失敗 -> 降級為匿名 + UTM

    3. WhatsApp (外部瀏覽器，但帶 token)
       -> URL 含 ?ref=wa_{contactToken}
       -> 查表 -> 還原 Contact -> 追蹤
       (發送時就為每位收件人產生唯一 ref)

    4. External / 外部瀏覽器 (Email / 官網 / QR Code)
       -> 匿名點擊 (IP / UA / Referer / UTM)
       -> 到達頁引導登入 -> 補關聯 (late binding)

---

## Flow: LIFF Short Link / LIFF 短連結流程 (LINE Users)

    企業在 CRM 後台建立短連結
    Enterprise creates short link in CRM
      -> 系統產生：https://s.xx-crm.com/AbCd
      -> LIFF 版本：https://liff.line.me/{LIFF_ID}/redirect/AbCd

    粉絲在 LINE 內點擊
    Fan clicks in LINE
      -> LINE 開啟 LIFF WebView
      -> LIFF SDK 自動取得 userId（不需登入）
      -> 前端呼叫 POST /api/v1/links/AbCd/click
      -> API：記錄點擊 + 識別 Contact + 貼標 + 觸發 Automation
      -> 302 Redirect -> 目標 URL

## Flow: WhatsApp Per-Recipient Token / WhatsApp 個人化 Token 流程

    CRM 發送 WhatsApp Template 給「王小美 +886912345678」
      -> 產生唯一 ref: wa_c7f3e2
      -> 連結：https://s.xx-crm.com/AbCd?ref=wa_c7f3e2

    王小美點擊（跳外部瀏覽器）
      -> API 收到 ref=wa_c7f3e2
      -> 查表 -> Contact: 王小美
      -> 貼標 + 記錄 + 導向目標頁

## Flow: External / Anonymous / 外部匿名點擊流程

    粉絲掃 QR Code 或點 Email 連結
      -> 匿名點擊（IP, UA, Referer）
      -> 302 Redirect -> 目標頁
      -> 之後透過 LINE 互動 -> 補關聯 (late binding)

---

## Short Link API / 短連結 API

```
POST   /api/v1/links                  # 建立 (create)
GET    /api/v1/links                  # 列表 (list)
GET    /api/v1/links/:id              # 詳情 + 統計 (detail + stats)
PATCH  /api/v1/links/:id              # 更新 (update)
DELETE /api/v1/links/:id              # 刪除 (delete)
GET    /api/v1/links/:id/clicks       # 點擊明細 (click detail list)
GET    /api/v1/links/:id/stats        # 點擊統計 - 日/時段/渠道 (daily/hourly/channel)
GET    /api/v1/links/:id/qr           # 取得 QR Code 圖片
```

### Create Short Link / 建立短連結

```json
{
  "name": "Spring AC Promo",
  "targetUrl": "https://www.xx-appliance.com/promo/spring-2026",
  "slug": "spring26",
  "tags": ["spring-campaign", "AC"],
  "utmSource": "line_oa",
  "utmMedium": "flex_message",
  "utmCampaign": "spring_2026",
  "expiresAt": "2026-04-30T23:59:59Z",
  "useLiff": true,
  "automationRuleId": null
}
```

Response:
```json
{
  "id": "link_xxx",
  "shortUrl": "https://s.xx-crm.com/spring26",
  "liffUrl": "https://liff.line.me/LIFF_ID/redirect/spring26",
  "qrCodeUrl": "https://s.xx-crm.com/spring26/qr.png"
}
```

---

## Click Handler Logic & Automation / 點擊處理邏輯與自動化

```typescript
async function handleClick(slug: string, liffData?: LiffClickData, refToken?: string) {
  const link = await db.shortLinks.findBySlug(slug);
  if (!link || link.isExpired()) return { redirect: '/404' };

  const click = await db.clickLogs.create({
    linkId: link.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    referer: req.headers['referer'],
    source: liffData ? 'liff' : refToken ? 'wa_token' : 'anonymous',
  });

  // Identify contact by available method / 依可用方式識別聯繫人
  let contact: Contact | null = null;
  if (liffData?.userId) {
    contact = await contactService.findByChannelUid('LINE', liffData.userId);
  } else if (refToken) {
    contact = await contactService.findByRefToken(refToken);
  }

  if (contact) {
    click.contactId = contact.id;
    for (const tagName of link.tags) {
      await tagService.addTag(contact.id, tagName, 'link_click');
    }
    await contactService.updateAttribute(contact.id, 'lastClickedLink', link.name);
    
    // --- 觸發自動化 ---
    await eventBus.publish('link.clicked', {
      contactId: contact.id, linkId: link.id, linkName: link.name, tags: link.tags,
    });
  }

  await db.shortLinks.incrementClicks(link.id);
  return { redirect: appendUtm(link.targetUrl, link) };
}
```

**自動化範例**:
- **觸發**: `link.clicked` (linkName: "春季空調優惠")
- **條件**: Contact 標籤包含 `VIP`
- **動作**: 立即發送「小鈴鐺」通知給該客戶的專屬業務。

---

## LIFF Redirect Page (Frontend) / LIFF 中繼導向頁面（前端）

```typescript
// apps/portal/src/pages/redirect/[slug].tsx
import liff from '@line/liff';

export default function RedirectPage({ slug }: { slug: string }) {
  useEffect(() => {
    async function init() {
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });
      let userId: string | undefined;
      if (liff.isInClient() && liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        userId = profile.userId;
      }
      const res = await fetch(`/api/v1/links/${slug}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, accessToken: liff.getAccessToken(), liffContext: liff.isInClient() }),
      });
      const { redirectUrl } = await res.json();
      if (liff.isInClient()) { liff.openWindow({ url: redirectUrl, external: true }); liff.closeWindow(); }
      else { window.location.href = redirectUrl; }
    }
    init();
  }, [slug]);
  return <div style={{ textAlign: 'center', padding: '40px' }}>Redirecting...</div>;
}
```

---

## DB Schema / 資料庫結構

```prisma
model ShortLink {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId          String    @db.Uuid
  slug              String    @unique
  name              String
  targetUrl         String
  useLiff           Boolean   @default(true)
  tags              String[]
  automationRuleId  String?   @db.Uuid
  utmSource         String?
  utmMedium         String?
  utmCampaign       String?
  clickCount        Int       @default(0)
  uniqueClickCount  Int       @default(0)
  expiresAt         DateTime?
  isActive          Boolean   @default(true)
  createdAt         DateTime  @default(now())

  clicks  ClickLog[]

  @@index([tenantId])
  @@map("short_links")
}

model ClickLog {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  linkId      String    @db.Uuid
  contactId   String?   @db.Uuid
  source      String    @default("anonymous")  // liff | messenger_ext | wa_token | anonymous
  ip          String?
  userAgent   String?
  referer     String?
  createdAt   DateTime  @default(now())

  link  ShortLink @relation(fields: [linkId], references: [id], onDelete: Cascade)

  @@index([linkId, createdAt])
  @@index([contactId])
  @@map("click_logs")
}
```

---

## Use Cases / 使用情境

### Case A: Flex 廣播 + 點擊追蹤

    行銷人員在 CRM：建立短連結 -> 取得 LIFF URL -> 放入 Flex 模板 -> 廣播
    粉絲點擊 -> LIFF 取得 userId -> 記錄 + 貼標 -> 導向商品頁
    行銷人員：報表顯示 1,234 次點擊、876 不重複 -> 篩選「點了但沒回覆」-> 二次推播

### Case B: Rich Menu 行為追蹤

    Rich Menu 每格都用 LIFF 短連結：
      [產品資訊] -> 貼標「對產品有興趣」
      [維修預約] -> 貼標「有維修需求」
      [最新優惠] -> 貼標「價格敏感」
    CRM 自動分群：「點擊維修 2 次以上 + 保固即將到期」-> 推播續約

### Case C: WhatsApp 活動追蹤

    CRM 發 WhatsApp Template 給 500 位聯繫人，每人帶唯一 ?ref=
    312 次點擊、298 位被識別 (95.5%) -> 自動貼標「回應了 WA 活動」

### Case D: Email + QR Code 線下追蹤

    門市 QR Code -> 匿名點擊 -> Fan Portal -> LINE Login -> 補關聯
    結果：「原來這個人是從台北門市來的」

---

## Report / 報表

```
+--------------------------------------------------------------------------------+
|  Short Link Report / 短連結報表                              [Export CSV]       |
+------------------+-------+--------+-----------+--------+----------------------+
| Name / 名稱      | Clicks| Unique |  ID Rate  | Tagged | Source / 來源        |
|                  | 點擊  | 不重複 | 識別成功率 | 貼標數 |                      |
+------------------+-------+--------+-----------+--------+----------------------+
| 春季空調優惠      | 1234  | 876    | 92% LIFF  | 812    | LINE 89%            |
| 維修預約入口      | 567   | 345    | 96% LIFF  | 331    | LINE 94%            |
| WA 春季訊息       | 312   | 298    | 95% Token | 285    | WhatsApp 100%       |
| Email 促銷        | 450   | 420    | 12% Login | 51     | Email 78%           |
| 門市 QR Code      | 89    | 82     |  8% Login | 7      | QR 100%             |
+------------------+-------+--------+-----------+--------+----------------------+

  ID Rate / 識別成功率 = 成功識別身份的點擊 / 總點擊數
  Source Mix / 來源分布 = 點擊來自哪個渠道
```

---

## License Control / 授權控制

| Plan / 方案 | Short Links / 短連結 |
|------|-------------|
| Starter | 10 個連結，無身份追蹤 |
| Professional | 100 個，LIFF + WA token + 自動貼標 |
| Enterprise | 無限，可觸發 Automation |
