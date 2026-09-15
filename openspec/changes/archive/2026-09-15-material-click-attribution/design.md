## Context

程式碼實查（附行號）：
- `ShortLink`（`schema.prisma:1475-1507`）有 tagOnClick、totalClicks、uniqueClicks，**無 materialId**。
- `ClickLog`（`schema.prisma:1509-1526`）記 shortLinkId + contactId + lineUid，經 shortLinkId 可回推 material（若 ShortLink 有 materialId）。
- `getMaterialStats`（`material.service.ts:810`）目前算 usageCount/回覆/開案，`clickThroughRate: null`。
- **廣播發送不經短連結**：executeBroadcast（`marketing.service.ts:262-288`）取 material.body 後直接發，body 裡 action.uri（`builders.ts:22`）/imagemap linkUri（`builders.ts:249`）是原始 URL。
- createShortLink（`shortlink.service.ts:100+`）支援 slug/targetUrl/tagOnClick/UTM，可擴充 materialId。

## Goals / Non-Goals

**Goals:**
- ShortLink 可標記 materialId，點擊歸因回素材。
- 廣播發送時素材 body 的外部 URL 自動轉帶 materialId 短連結。
- getMaterialStats 產出素材級點擊數 / 點擊率（無資料回 null）。
- 素材詳情顯示點擊成效。

**Non-Goals:**
- per-recipient 個人化短連結（每人一條追個人）——本 change 素材層共用一條。
- 非廣播路徑（自動回覆/關鍵字/canvas）的素材點擊歸因——先做廣播。
- A/B 測試、發送時間最佳化。

## Decisions

### D1. ShortLink 加 materialId（nullable）
- `ShortLink.materialId String? @db.Uuid` + `material Material? @relation(onDelete: SetNull)` + `@@index([materialId])`。
- Material 加反向 `shortLinks ShortLink[]`。
- nullable：手動建的短連結、非素材產生的都不帶 materialId，相容。

### D2. 發送時自動轉短連結（素材層共用，非 per-recipient）
- 位置：executeBroadcast 取得 material.body 後、進入收件人迴圈前（`marketing.service.ts:270` 附近），對 body 做一次「URL → 短連結」轉換，得到 renderedBody 供所有收件人共用。
- **為何素材層共用而非 per-recipient**：本 change 要的是「這則素材被點幾次」，共用一條短連結即可；per-recipient（追誰點的）成本高、且點擊已能經 ClickLog.contactId 部分歸因到人，留待後續。
- **走訪 URL 的範圍**：action.uri（buttons/carousel/video endCard）、imagemap linkUri。純文字內嵌 URL 本 change 不處理（LINE 文字訊息不解析連結為可追蹤，需另做文字 URL 偵測，範圍外）。
- **複用既有短連結**：同 (materialId, targetUrl) 已有短連結就複用，不每次廣播建新——用 findFirst(materialId+targetUrl) → 無則 createShortLink。避免短連結表膨脹。

### D3. 短連結 targetUrl = 原始 URL，slug 自動產
- createShortLink 帶 materialId + targetUrl（原 uri）+ lineChannelId（廣播的 channel，若 LINE）。
- 發送用的 uri 換成短連結的對外網址（buildTargetUrl / 短網域 + slug）。

### D4. getMaterialStats 點擊聚合
- 加：`clicks = ClickLog count where shortLink.materialId = 該素材`（經關聯）；`uniqueClicks` 同理 distinct contactId 或用 ShortLink.uniqueClicks 加總。
- **點擊率** = clicks ÷ usageCount（送出數）；usageCount=0 或無短連結 → 回 null（不假造 0，沿用現有精神）。
- 走 tenantPrisma（RLS）。

### D5. 前端顯示
- 素材詳情 stats 面板既有 usageCount/回覆/開案，補「點擊數」「點擊率」；null 顯示「暫無資料」。

## Risks / Trade-offs

- **短連結表膨脹**：每素材每 URL 一條短連結 → 用 D2 複用機制控制（同素材同 URL 共用）。
- **發送效能**：轉短連結是每則廣播一次（非每收件人），成本低；但要建短連結是 DB 寫入，包在發送前一次做完。
- **只算廣播點擊**：非廣播路徑的素材使用不會有點擊歸因 → stats 的點擊率只反映廣播成效，UI 需說明「點擊率基於廣播發送」。
- **targetUrl 可能已是短連結**：避免二次包裝——轉換前判斷 URL 是否已是本站短網域，是則跳過。
- **RLS**：executeBroadcast 目前用 fastify.prisma（交易 service，見 RLS skill TODO）；建短連結要確保帶對 tenantId，不因 RLS 未綁定而失敗。實作時確認連線 scope。
- **migration**：short_links 已在 RLS 管轄，加 nullable 欄非破壞性；產正式 migration。
