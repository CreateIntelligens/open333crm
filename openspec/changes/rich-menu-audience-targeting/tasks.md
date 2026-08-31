## 1. 受眾 → LINE uid 解析

- [ ] 1.1 helper：resolveAudienceLineUids(prisma, tenantId, channelId, { segmentId? | tagId? }) → string[]（去重）
- [ ] 1.2 segmentId 走 calculateSegmentContacts；tagId 直接篩 contactTag → contactIds
- [ ] 1.3 contactIds → ChannelIdentity where channelType='LINE'（同 channel）取 uid

## 2. 綁定 service + 背景佇列

- [ ] 2.1 `rich-menu.service.ts` bindRichMenuToAudience(menuId, tenantId, { segmentId?|tagId? })：檢查 menu.status==='published' && lineRichMenuId，解析 uid，入 rich-menu-bind job，回 { queued: N }
- [ ] 2.2 unbindRichMenuFromAudience：解析 uid，入 job（unlink）
- [ ] 2.3 draft/error menu 擋（回「請先發布」錯誤）
- [ ] 2.4 worker：rich-menu-bind job handler → 取 channel 憑證 → plugin.linkMenuToUsers / unlinkMenuFromUsers（已自動每 500 分批）
- [ ] 2.5 job 帶 tenantId，worker 驗證 channel 屬本租戶

## 3. route

- [ ] 3.1 `POST /rich-menus/:id/bind-audience`（body: segmentId 或 tagId）
- [ ] 3.2 `POST /rich-menus/:id/unbind-audience`
- [ ] 3.3 掛 requirePermission（比照 rich menu 其他寫入操作的權限點）

## 4. 前端

- [ ] 4.1 Rich Menu 詳情/列表：已發布 menu 顯示「綁定受眾」操作
- [ ] 4.2 綁定 dialog：選 segment 或 tag → 送出，顯示「已送出綁定 N 人」
- [ ] 4.3 draft menu 不顯示綁定（或 disabled 提示先發布）

## 5. 驗證與收尾

- [ ] 5.1 端到端/單元：published menu + segment → 解析 uid → 入 job → plugin.linkMenuToUsers 被呼叫
- [ ] 5.2 draft menu 綁定被擋
- [ ] 5.3 受眾解析只取本租戶 + 該 channel 的 LINE uid（跨租戶不洩漏）
- [ ] 5.4 unbind 流程
- [ ] 5.5 `openspec validate --strict` 通過
- [ ] 5.6 更新 CHANGELOG.md（Added：Rich Menu 分眾綁定）
