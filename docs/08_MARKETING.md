# 08 — 行銷模組 (Marketing Module)

## 定位

行銷模組負責「主動觸達」，與 Case 管理的「被動接收」形成完整閉環：

```
主動觸達（Marketing）→ 客戶互動 → 被動接收（Inbox）→ 案件處理（Case）→ 回饋循環
```

---

## 廣播（Broadcast）

### 廣播類型

| 類型 | 說明 | 適用渠道 |
|------|------|---------|
| 立即廣播 | 馬上發送 | LINE / FB |
| 排程廣播 | 指定時間發送 | LINE / FB |
| 觸發廣播 | 由 Automation Rule 觸發 | 所有渠道 |
| A/B Test（v1.1）| 兩版訊息 AB 測試 | LINE / FB |

### 廣播流程

```
建立廣播
  ├── 選擇渠道（LINE OA / FB Page / 多選）
  ├── 選擇受眾（Segment / 全部 / 手動選擇）
  ├── 設計訊息（模板編輯器）
  ├── 預覽（Preview 模擬）
  ├── 排程設定
  │
  └── 發送
       ├── 計算受眾人數
       ├── 分批發送（避免 API Rate Limit）
       └── 記錄送達狀態
```

### 廣播限制注意事項

| 渠道 | 限制 |
|------|------|
| LINE | 需使用推播訊息 API；免費版有每月上限；需用戶曾追蹤 |
| FB | 24+1 規則：24小時內可任意發，之後只能發特定類型 |
| WebChat | 無推播，僅 in-session 使用 |

---

## 訊息模板（Template）

### 模板類型

| 類型 | 說明 |
|------|------|
| 純文字 | 基本文字訊息 |
| 圖文（Image + Text）| 圖片 + 文字的組合 |
| LINE Flex Message | LINE 特有的卡片式樣式，高自訂度 |
| FB 一般模板 | 圖片 + 標題 + 按鈕 |
| 帶快速回覆按鈕 | 文字 + 快速選項按鈕 |

### Flex Message 模板庫（家電業者範例）

```
模板庫
├── 保固提醒卡片
│   └── 品牌 Logo + 到期日期 + 延伸保固按鈕
├── 維修進度通知
│   └── 案件編號 + 維修師傅 + 預計到達時間
├── 新品推薦
│   └── 圖片 + 價格 + 立即購買按鈕
├── 滿意度調查
│   └── 星星評分按鈕 (1~5 星)
└── 活動公告
    └── Banner 圖 + 活動說明 + 立即查看按鈕
```

### 模板變數

模板支援動態變數，系統在發送時自動填入：

```
親愛的 {{contact.name}}，
您的 {{attribute.appliance_brand}} {{attribute.appliance_model}}
保固將於 {{attribute.warranty_expires_at}} 到期。

立即了解延伸保固方案！
```

---

## 受眾（Audience）

### 受眾建立方式

1. **即時分群**：上傳時根據 Segment 條件即時計算
2. **靜態清單**：匯入 CSV 清單（指定渠道 UID）
3. **手動勾選**：在聯繫人列表中手動選擇

### 分群組合範例（家電業者）

```
廣播名稱：冬季空調保養提醒
受眾條件：
  AND
  ├── 擁有標籤：「空調客戶」
  ├── 屬性：空調購買日期 > 1年前
  ├── 屬性：上次保養日期 > 6個月前
  └── 渠道：已追蹤 LINE OA
預估受眾：1,234 人
```

---

## 行銷活動（Campaign）

Campaign 是廣播的上層概念，把一系列相關廣播組織在一起。

```typescript
interface MarketingCampaign {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  startDate: Date;
  endDate?: Date;
  broadcasts: Broadcast[];  // 多次廣播（如活動3天，每天一波）
  goal: CampaignGoal;
  metrics: CampaignMetrics;
}

interface CampaignMetrics {
  totalSent: number;
  delivered: number;
  opened?: number;       // LINE 已讀（若 API 支援）
  clicked?: number;      // 按鈕點擊（Postback 計算）
  replied: number;       // 回覆人數
  casesOpened: number;   // 由此活動引發的開案數
  conversionRate: number;
}
```

---

## 行銷效果追蹤

### UTM 參數追蹤（WebChat / Web URL）
廣播中的 URL 自動加上 UTM 參數，追蹤來源：
```
https://example.com/product?utm_source=lineoa&utm_medium=broadcast&utm_campaign=winter_ac_2024
```

### Postback 追蹤（LINE / FB）
按鈕設定帶有活動 ID 的 postback data：
```json
{ "action": "view_product", "campaign_id": "camp_001", "product_id": "SKU-AC-001" }
```
系統自動記錄按鈕點擊，計算 CTR。

---

## 報到/活動報名（v1.1 規劃）

### 功能說明

```
活動建立
  ├── 活動名稱、時間、地點、名額
  ├── 報名連結（Web 表單 or LINE 快速回覆）
  │
  ├── 自動確認訊息
  ├── 提醒時間設定（活動前 24 小時 / 1 小時）
  │
  └── 出席確認（現場 QR Code 掃描 or 聯繫人 UID）

資料輸出
  └── 報名清單 CSV 匯出
```

---

## 預約系統（v1.1 規劃）

```
客戶申請維修預約
  ├── 選擇日期 + 時段（來自可用時段設定）
  ├── 填入問題描述
  ├── 系統確認 + 自動建立 Case
  └── 預約提醒（前一天 + 當天）

後台時段管理
  ├── 設定每日可用時段
  ├── 維修師傅排班
  └── 預約衝突偵測
```
