## Context

系統目前無任何券的概念。但發券所需的周邊能力幾乎都已就緒——實查結果：

| 能力 | 狀態 | 位置 |
|---|---|---|
| 發送層（`push`/`reply`/`multicast`/`broadcast`/`narrowcast`） | 現成 | `packages/channel-plugins/src/line/index.ts:315` |
| SafeReply 降級（reply 失敗自動改 push） | 現成 | `conversation.service.ts:651` |
| `replyToken` 傳遞鏈路 | 現成 | webhook → `message.received` → automation worker |
| 貼標 | 現成 | `tagging.service.ts`（已被 5 模組跨模組呼叫） |
| 短網址 + 點擊歸因 + QR | 現成 | `modules/shortlink/` |
| 關鍵字觸發 | 現成 | `keyword.matched` + 專屬管理頁 |
| 圖文選單 | 現成 | Rich Menu 完整管理 |
| 卡片訊息版型 | 現成 | 16 種（LINE 6 / FB 9） |
| 外部 API 呼叫 | 現成 | `executeApiFetchNode`（canvas） |
| LINE 身分驗證 | 現成 | `line-login` 的 `verifyIdToken` |
| 粉絲端前端 | **零** | `apps/web/src/app/liff/` 僅 callback／redirect 兩支導流頁 |

因此本 change 的實作重心是**券本身的資料模型、狀態機與 LIFF 前端**，而非發送或觸發機制。

## Goals / Non-Goals

**Goals**
- 券的完整生命週期：建立 → 發放 → 領取 → 核銷，狀態不可逆且防重複。
- 客服可在對話中發券並歸戶該聯絡人（差異化主場）。
- 顧客在 LIFF 內看券夾、出示券、完成核銷。
- 會員綁定的產品層介面：設定驅動，不為單一客戶寫死。

**Non-Goals**
- 跨渠道券夾統一（LIFF 主場架構下不需要）。
- 對接特定客戶的會員 API（客製層）。
- 互動遊戲、POS API 核銷、點數換券。

## Decisions

### D1：LINE LIFF 為唯一主場，FB／IG 導流

**理由**：LIFF `id_token` 是平台簽發的可信身分，FB／IG 沒有等價機制（Messenger Extensions SDK 已淡出，IG 完全沒有）。若為 FB／IG 另做簽章連結換 token，會引入「連結被轉發＝身分被轉移」的安全弱點——而券帶金錢價值，這個取捨不划算。

**替代方案（否決）**
- *三渠道各自券夾*：需要跨渠道歸戶才能讓同一人看到同一份券，而歸戶本身是獨立的大題目（見 D6）。
- *簽章連結*：安全強度低於 LIFF id_token，且需額外做短效、一次性、綁定該券等緩解措施。

**代價**：FB／IG 使用者多一次跳轉，且必須是 LINE 用戶。台灣市場此假設多半成立，但客群集中在 IG 且不常用 LINE 的商家會流失轉換——提案時需確認客戶渠道組成。

### D2：不使用 LINE 原生優惠券 API

LINE 已有 `POST /v2/bot/coupon` 等四支端點（建立／停用／列表／詳情），且內建抽獎機率。但**沒有任何端點能取得領取者或核銷名單**，官方文件明載成效只能在 LINE 官方帳號管理後台查看。

自建的理由因此要精確表述為：**不是「LINE 沒有券 API」，而是「有發券 API 但拿不回資料」**。既然核心價值是歸戶與成效追蹤，混合模式（用原生 API 發、自己記發送紀錄）只能拿到發券歸因、拿不到核銷，無法支撐「證明哪則訊息帶來核銷」的定位。

**註**：官方文件的券範例皆為日圓（`currency: JPY`、`timezone: ASIA_TOKYO`），該 API 在台灣 LINE OA 的開放狀況與幣別支援未經實測。此為不採用的次要原因，非主因。

### D3：三張表，狀態機集中在 `CouponInstance`

```
Coupon          券主檔（設定）
CouponInstance  每張券的生命週期（核心表）
CouponCode      序號包庫存（僅 imported_codes 模式使用）
```

狀態流轉：`issued → claimed → opened → redeemed`，另有 `expired` / `revoked` 終態。

**核銷防重複**：核銷在 DB transaction 內以條件式更新搶狀態（`WHERE status = 'claimed'`），受影響列數為 0 即表示已被他人核銷，回報「此券已使用」。不依賴應用層檢查，避免併發下的競態。`TenantDb` 型別已含 `Prisma.TransactionClient`，交易可直接使用。

### D4：會員編號對應沿用 `ContactAttribute`，不新建表

`ContactAttribute` 已有 `key` / `value` / `dataType` 與 `@@unique([contactId, key])`，足以承載「此聯絡人對應的商家會員編號」。新建一張 `ContactExternalId` 只會重複既有能力。

### D5：會員綁定的對外 API 走設定驅動

綁定介面在後台以設定描述（端點位址、認證方式、請求／回應格式、欄位對應），由既有的 `executeApiFetchNode` 執行呼叫，而非為每個客戶寫轉接程式。

**理由**：這決定了日後每接一個客戶是「改設定」還是「改程式」。若寫死，核心程式會隨客戶數量腐化。

**限制**：格式特殊（如需簽章、多步驟 OAuth）的客戶仍需寫轉接程式，此為客製層工作。

### D6：不做跨渠道歸戶

系統已有 `IdentityMap`（含 `source`／`confidence`）與 `MergeSuggestion`（含人工審核流程），五種歸戶來源也已定義。但**實查 UAT 兩張表皆為 0 筆**，且四個歸戶函式中僅讀取用的 `resolveUidToContact` 有呼叫端，三個寫入函式（`stitchByPhone`／`stitchByLiffCookie`／`detectPhoneDuplicates`）**無任何呼叫端**——機制從未啟用。

LIFF 主場架構下券只活在 LINE，沒有跨渠道券夾要合併，故本 change 不需要歸戶。

**且歸戶不應埋在本 change**：它是整個 CRM 的會員識別地基（做起來後對話、標籤、消費歷程都能跨渠道整合），應獨立提案。另需注意**合併錯誤比不合併嚴重**——兩人共用公司電話、家人共用 email 都可能誤判，一旦合併 A 會看到 B 的券甚至能核銷。自動歸戶應只採強證據（OTP 驗證），弱證據走人工確認。

### D7：發券沿用既有發送層，依場景選策略

| 場景 | 策略 | 理由 |
|---|---|---|
| 關鍵字領券 | `reply` | 免費；`replyToken` 有效期短（約 1 分鐘、限用一次），須在收到訊息後立即送出 |
| 加好友禮 | `reply` | `follow` 事件亦帶 `replyToken`，免費 |
| 客服對話發券 | `push` | 座席主動挑券，當下通常已無有效 `replyToken` |
| 分眾群發 | `multicast` | service 層已處理 500/批切分 |

發券只需組出券卡的 `OutboundPayload` 並指定 `strategy`，交給既有 `deliverToChannel`。SafeReply 降級已內建，reply 失敗自動改 push，不會漏發。

### D8：fan auth 必須補 LIFF id_token 驗證

現況 `POST /api/v1/fan/auth` 只收 `{ contactId, tenantId }`，查到 contact 存在就發 24 小時 token，**無任何身分驗證**。

目前僅服務活動與點數，風險尚可控；但**券帶金錢價值後屬上線阻斷**——取得或猜到他人 contactId 即可領走、核銷其券。必須與券夾同時完成，不可延後。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| FB／IG 使用者流失（需跳轉且須為 LINE 用戶） | 提案時確認客戶渠道組成；LIFF 可設定先引導加好友，將發券轉為獲客誘因 |
| 併發核銷造成重複使用 | DB transaction 條件式更新搶狀態，不依賴應用層檢查 |
| 新增權限點後既有租戶 403 | 部署後執行 reconcile 並清權限快取（列入 tasks） |
| 新表漏接 RLS | RLS policy migration 列為 A1 的一部分，並由 `check-tenant-scoping.mjs` 把關 |
| 設定驅動介面設計不足，客製仍需改程式 | 介面設計階段先蒐集 2–3 個真實客戶的 API 規格驗證涵蓋度 |

## Migration Plan

新增三張表，皆為新表，無既有資料需回填。`ContactAttribute` 沿用既有結構，不變更。

部署順序：migration → RLS policy → reconcile 權限 → 清快取。

## Open Questions

- 券圖的儲存走既有 MinIO 或外部 CDN？（影響 A6 的上傳流程）
- 核銷台是否需要獨立登入（店員非系統座席）？目前假設用座席帳號，若商家不願為店員開帳號則需另設計。
- 抽獎模式（機率式）列於 Phase 2，但 LINE 原生 API 已內建——若未來改用混合模式可省下此項，值得在 Phase 2 前重新評估。
