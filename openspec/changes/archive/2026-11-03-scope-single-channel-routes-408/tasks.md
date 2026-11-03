## 1. 單筆渠道路由的可見範圍

- [x] 1.1 先寫測試：`apps/api/tests/feature/modules/channel/channel-single-route-visibility.test.ts`，情境「讀取看不到的渠道被拒」「修改看不到的渠道被拒」「唯讀層級不能管理渠道」。修正前 10 個測試都在斷言上失敗（回 200 或 500）
- [x] 1.2 同一檔的「唯讀層級可以讀取渠道」「完整層級可以管理渠道」「總店不受可見範圍限制」是既有行為，以突變驗證：`GET /:id` 的層級改成 `full`，「唯讀層級可以讀取渠道」失敗；`assertChannelVisible()` 本來就對總店直接放行
- [x] 1.3 `channel.routes.ts`：新增 `requireVisibleChannel(level)` preHandler，排在 `requirePermission` 之後；`channel.view` 的路由用 `read_only`，`channel.update`／`channel.delete` 的路由用 `full`；`/:id/status` 改用同一個 preHandler
- [x] 1.4 既有測試 `channel-liff-id.test.ts`、`channel-liff-test.test.ts` 的角色加上 `channel.view_all`：測試的成員沒有綁定渠道，這是本 change 刻意的行為改變，它們測的不是可見範圍

## 2. 嵌入碼權限

- [x] 2.1 先寫測試：同一檔「嵌入碼需要 channel.view」，修正前回 200
- [x] 2.2 `GET /:id/embed-code` 加上 `requirePermission('channel.view')`

## 3. 團隊指派

- [x] 3.1 測試：同一檔「團隊指派由 channel.assign_team 控管」。既有行為，以突變驗證：在 `POST /:channelId/teams` 加上 `assertChannelVisible()`，測試失敗；還原後通過

## 4. Webhook 公開網址

- [x] 4.1 先寫測試：同一檔「分店成員不能套用 Webhook 公開網址」，修正前回 200 並改寫所有渠道
- [x] 4.2 `POST /webhook-base-url` 另加 `requirePermission('channel.view_all')`
- [x] 4.3 先寫測試：`apps/web/tests/unit/components/settings/channel-management.test.tsx`「分店成員看不到套用欄位」，修正前失敗
- [x] 4.4 `ChannelManagement.tsx`：沒有 `channel.view_all` 或 `channel.update` 時不顯示套用欄位，WebChat 連結照常顯示

## 5. 完成檢查

- [x] 5.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test`
- [x] 5.2 `tests/feature/modules/channel/` 全部 feature 測試
- [x] 5.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 以 `--strict` 通過；`tsc --noEmit` 沒有新錯誤
- [x] 5.4 `node scripts/validate-openspec.mjs scope-single-channel-routes-408`
- [x] 5.5 CHANGELOG、AUDIT（RBAC-07）與 AUDIT-REVIEWS 由合併的人統一更新（多個分支同時進行，避免衝突），條目文字附在交付說明
