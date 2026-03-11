# 05 — 聯繫人統一身份 + 標籤系統

## 最核心的挑戰：同一個人，多個渠道

舊系統的問題：一個客戶在 LINE 是 `LINE-userId-abc`，在 FB 是 `fb-psid-xyz`，系統完全不知道是同一人。

新系統透過**聯繫人合併機制**解決這個問題。

---

## 身份識別策略

### 自動識別（被動）

| 識別條件 | 可靠度 | 說明 |
|---------|--------|------|
| 電話號碼相同 | 高 | 客戶在 LINE 填了電話，在 WebChat 也填了 |
| Email 相同 | 高 | 同上 |
| LINE Login OAuth | 確定 | LINE Login 可取得 LINE userId |

### 主動連結（主動）

客戶自行操作「帳號連結」：
```
客戶在 LINE 輸入 /link → 取得連結碼 → 在 Web Chat 輸入連結碼
→ 系統確認 → 兩個身份合併
```

### 客服手動合併
客服人員發現重複聯繫人 → 選擇合併 → 系統保留所有歷史資料。

---

## 聯繫人資料結構

```
Contact
  ├── 基本資料：name, avatar, phone, email, birthday
  ├── ChannelIdentity[]：每個渠道的 uid
  ├── Attribute[]：自訂欄位（企業自定）
  ├── Tag[]：標籤
  ├── ContactRelation[]：關係鏈
  └── Timeline：所有 Case / Conversation 歷程
```

### 自訂屬性（Attribute）範例（家電業者）

| 屬性名 | 類型 | 範例值 |
|--------|------|--------|
| appliance_brand | string | Samsung |
| purchase_date | date | 2024-06-01 |
| warranty_status | enum | in_warranty / expired |
| service_region | string | 台北 |
| vip_level | number | 3 |

---

## 標籤（Tag）系統

### 標籤類型

| 類型 | 建立方式 | 範例 |
|------|---------|------|
| 手動標籤 | 客服手動貼 | `VIP`, `冰箱客戶` |
| 自動標籤 | Automation Rule | `已完成首購`, `30天未互動` |
| 系統標籤 | 系統自動 | `LINE已追蹤`, `FB已訂閱` |
| 渠道標籤 | 渠道事件 | `來自官網Chat` |

### 標籤範疇

標籤可以貼在：
- **Contact**：跨渠道都生效
- **Conversation**：僅對該次對話
- **Case**：僅對該案件

### 標籤 Schema

```typescript
interface Tag {
  id: string;
  tenantId: string;
  name: string;
  color: string;          // hex 色碼，UI 顯示用
  type: TagType;          // manual / auto / system / channel
  scope: TagScope;        // contact / conversation / case
  description?: string;
}

interface ContactTag {
  contactId: string;
  tagId: string;
  addedBy: 'agent' | 'system' | 'automation';
  addedById?: string;
  addedAt: Date;
  expiresAt?: Date;       // 可設定標籤有效期（如：活動期間）
}
```

---

## 受眾分群（Segment）

行銷廣播需要「分群」，分群是標籤的組合查詢。

```typescript
interface Segment {
  id: string;
  name: string;
  conditions: SegmentCondition[];
  logic: 'AND' | 'OR';
}

interface SegmentCondition {
  field: string;        // 'tag', 'attribute', 'lastActiveAt', 'channel', ...
  operator: string;    // 'has', 'not_has', 'equals', 'gt', 'lt', 'between'
  value: any;
}
```

**分群範例：**
```json
{
  "name": "台北冰箱保固過期客戶",
  "logic": "AND",
  "conditions": [
    { "field": "attribute.service_region", "operator": "equals", "value": "台北" },
    { "field": "attribute.appliance_brand", "operator": "equals", "value": "Samsung" },
    { "field": "attribute.warranty_status", "operator": "equals", "value": "expired" },
    { "field": "tag", "operator": "has", "value": "冰箱客戶" }
  ]
}
```

---

## 關係鏈（Relation Graph）

### 應用場景（家電業者範例）

```
李大明（推薦人）──推薦了──> 王小美（被推薦人）
李大明（家長）──家庭成員──> 李小明（子女）
```

### 關係鏈資料

```typescript
interface ContactRelation {
  fromContactId: string;
  toContactId: string;
  relationType: string;    // 'referrer', 'family', 'colleague', custom
  metadata?: Record<string, any>;
  createdAt: Date;
}
```

### 關係鏈用途
- 推薦獎勵追蹤
- 家庭帳號識別（同地址、同電話）
- 企業客戶的部門關係

---

## 聯繫人時間軸（Contact Timeline）

在聯繫人詳細頁面，可以看到以「時間為軸」的所有互動記錄：

```
2024-06-15  ← [LINE] 追蹤官方帳號
2024-06-16  ← [LINE] 第一次對話，詢問冰箱型號
2024-06-16  → [AUTO] 貼標：冰箱客戶
2024-06-20  ← [WebChat] 開案：冰箱異音問題 (Case #102)
2024-06-20  → [Agent: 王客服] 指派案件
2024-06-22  → [CSAT] 滿意度 5/5
2024-06-22  ← [AUTO] 貼標：已解決維修
2024-09-01  → [行銷] 收到保固提醒廣播
```
