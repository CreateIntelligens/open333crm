## 1. 資料模型與 migration

- [x] 1.1 `schema.prisma`：`ShortLink` 加 `materialId String? @db.Uuid` + `material Material? @relation(fields:[materialId], references:[id], onDelete: SetNull)` + `@@index([materialId])`
- [x] 1.2 `schema.prisma`：`Material` 加反向 `shortLinks ShortLink[]`
- [x] 1.3 產正式 migration（本機 DB 有漂移用手寫 SQL：ALTER TABLE short_links ADD COLUMN materialId + FK + index）並套用 + migrate resolve 標記
- [x] 1.4 prisma generate；確認 short_links 的 RLS policy 不受新欄影響（nullable，policy 讀 tenantId 不變）

## 2. 短連結建立支援 materialId

- [x] 2.1 `shortlink.service.ts` createShortLink 參數加 materialId（選填），寫入 ShortLink
- [x] 2.2 加 helper：findOrCreateMaterialShortLink(tenantId, materialId, targetUrl, lineChannelId)——同 material+targetUrl 複用既有、無則建（避免膨脹）
- [x] 2.3 trackClick 不用改（ClickLog 經 shortLinkId 已能回推 material）

## 3. 發送時自動轉短連結

- [x] 3.1 加 body URL 走訪工具：找出 action.uri（buttons/carousel/video endCard）與 imagemap linkUri 的所有外部 URL
- [x] 3.2 executeBroadcast 取得 material.body 後、收件人迴圈前，對每個 URL findOrCreateMaterialShortLink → 換成短連結對外網址，得共用 renderedBody
- [x] 3.3 跳過已是本站短連結的 URL（不二次包裝）；無 URL 的素材不受影響
- [x] 3.4 確認建短連結帶對 tenantId（executeBroadcast 是交易 service，注意 RLS 連線 scope）

## 4. getMaterialStats 接點擊率

- [x] 4.1 加點擊聚合：clicks = ClickLog count where shortLink.materialId = 該素材（經關聯）
- [x] 4.2 clickThroughRate = clicks ÷ usageCount；usageCount=0 或無短連結資料 → null（不假造 0）
- [x] 4.3 回傳加 clickCount / clickThroughRate；走 tenantPrisma（RLS）

## 5. 前端

- [x] 5.1 素材詳情 stats 面板顯示「點擊數 / 點擊率」；null 顯示「暫無資料」
- [x] 5.2 說明點擊率基於廣播發送（tooltip 或註解）

## 6. 驗證與收尾

- [x] 6.1 端到端/單元：建材料含 URL → 廣播發送 → 確認 body URL 被換成帶 materialId 短連結
- [x] 6.2 複用測試：同素材同 URL 二次廣播 → 不建新短連結
- [x] 6.3 歸因測試：模擬點擊 ClickLog → getMaterialStats 點擊數/率正確
- [x] 6.4 無資料：無短連結素材 → 點擊率 null（非 0）
- [x] 6.5 跨租戶：點擊聚合只算本租戶（RLS）
- [x] 6.6 `openspec validate --strict` 通過
- [x] 6.7 更新 CHANGELOG.md（Added：素材級點擊歸因 + 發送自動轉短連結）
