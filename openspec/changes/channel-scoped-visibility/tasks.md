## 1. 資料層與權限點

- [x] 1.1 確認 `ChannelTeamAccess` schema 欄位（channelId/teamId/accessLevel/grantedById?/grantedAt）與索引足夠；本期只用 `full` accessLevel，如需擴充才產正式 migration（勿只 db push）
- [x] 1.2 確認 `Channel`/`Team` 刪除時 `ChannelTeamAccess` 的 `onDelete: Cascade` 已設；缺則補
- [x] 1.3 新增權限點 `channel.view_all`（全渠道可見／總店）到權限 registry，設定 group 與說明
- [x] 1.4 確認 `channel.manage`（或等效）作為指派 API 的授權權限點存在

## 2. 後端核心：可見渠道解析

- [x] 2.1 實作共用函式 `getAccessibleChannelIds(ctx)`：持有 `channel.view_all` → 回哨兵 `ALL`；否則 agent→teams→ChannelTeamAccess→channelId 去重；空 → 空集合（fail-closed）
- [x] 2.2 加 Redis 快取（key 依 agentId＋授權版本），並在 grant/revoke、team 成員異動時失效
- [x] 2.3 `services/channel-team-access.ts` 由 in-memory mock 改 Prisma 真實實作，維持既有介面（grant/revoke/check/listChannelsForTeam/listTeamsForChannel），移除 `mock-line-channel-id`/`team_sales` 假資料
- [x] 2.4 確認 `inbound-router.ts`／`message.ts` 呼叫端在改真實判斷後行為正確——尤其進站分派不因 fail-closed 被誤擋（見 spec：進站不受 agent 可見性限制）

## 3. 後端：查詢層接可見渠道過濾

- [x] 3.1 對話／收件匣 list 查詢加 `channelId in accessibleIds`（`ALL` 時略過過濾）
- [x] 3.2 案件（case）list 查詢加同等過濾
- [x] 3.3 單筆對話讀取：assert 渠道 ∈ 可見集合，否則 404
- [x] 3.4 對話操作（回覆／指派／狀態變更）：assert 渠道 ∈ 可見集合，否則 403
- [x] 3.5 全部查詢走 tenantPrisma（RLS session 之上疊加渠道過濾），確認未使用 prismaAdmin 繞過
- [x] 3.6 收件匣「渠道篩選」下拉僅回傳可見渠道

## 4. 後端：指派管理 API

- [x] 4.1 指派／撤銷渠道↔團隊 API（upsert / delete ChannelTeamAccess），掛 `channel.manage` 權限
- [x] 4.2 租戶邊界檢查：channel 與 team 同租戶，跨租戶拒絕
- [x] 4.3 查詢 API：某渠道被指派給哪些團隊、某團隊可見哪些渠道

## 5. 前端

- [x] 5.1 渠道設定頁新增「指派團隊」區塊（多選團隊、儲存呼叫指派 API）
- [x] 5.2 人員／團隊設定顯示渠道對應關係（唯讀檢視）
- [x] 5.3 收件匣渠道篩選只顯示可見渠道
- [x] 5.4 無可見渠道且非總店時，收件匣顯示空狀態提示「尚未被指派任何渠道，請聯繫管理員」

## 6. Socket 一致性

- [x] 6.1 socket room 授權改用 `getAccessibleChannelIds` 為同一事實來源，確保 REST 與推播一致
- [x] 6.2 驗證：不可見渠道的 message.new/conversation.updated 不推送給該 agent

## 7. 測試

- [x] 7.1 整合測試：分店 agent 的對話 list 只含可見渠道
- [x] 7.2 整合測試：分店 agent 的案件 list 只含可見渠道
- [x] 7.3 整合測試：直接以 ID 讀取未授權渠道對話 → 404；操作 → 403
- [x] 7.4 整合測試：`channel.view_all`（總店）看得到全部渠道
- [x] 7.5 整合測試：無授權且非總店 → list 為空（fail-closed）
- [x] 7.6 整合測試：socket 與 REST 一致（不可見渠道不推播）
- [x] 7.7 整合測試：進站訊息在無在線可見 agent 時仍正常建立

## 8. 部署與回填

- [ ] 8.1 資料回填：既有租戶現存 channel 預設處理（給總店角色 `view_all` 或指派預設團隊），避免上線當下有人突然看不到
- [ ] 8.2 跑 `scripts/reconcile-system-role-permissions.mjs` 讓既有租戶 system role 取得新權限點，清權限快取
- [x] 8.3 加 feature flag／預設「全開」退路：旗標關閉時 `getAccessibleChannelIds` 回 `ALL`（行為等同現況），供快速 rollback
- [ ] 8.4 UAT 驗證：用「分店帳號」實測拿不到他店對話、總店帳號看得到全部

## 9. 待確認（Open Questions，實作前收斂）

- [ ] 9.1 Q3：case 依 channelId 過濾已定，contact（可能跨渠道身分）可見性是否延伸——確認範圍
- [ ] 9.2 Q1：本期是否只做 `full`（可見）、read-only 留後續——確認
- [ ] 9.3 Q4：回填「預設團隊」策略與客戶溝通方式——確認
