## 1. 分群條件依建立者的可見範圍

- [x] 1.1 先寫測試：`apps/api/tests/feature/modules/channel/channel-scoped-visibility.test.ts`，情境「分店建立的分群群發只以可見渠道判斷條件」（修正前預估回 1，失敗）
- [x] 1.2 先寫測試：同一檔，情境「總店建立的分群群發以所有渠道判斷條件」（修正前就通過；mutation：`resolveAgentChannelVisibility()` 的 `hasViewAll` 固定為 `false` 時失敗）
- [x] 1.3 `channel-visibility.ts` 新增 `resolveAgentChannelVisibility()` 與 `agentVisibilityResolver()`：依成員 ID 計算可見渠道，權限比照 request 版本
- [x] 1.4 `resolveAudience()` 收可見範圍，分群以它計算；`executeBroadcast()` 與附券廣播（`runCouponBroadcast()`）依建立者解析；預估與批次發放依操作的人
- [x] 1.5 route、排程器、MCP、附券廣播的入口傳入解析函式；route 與 MCP 經由 `agentVisibilityResolverOf()`，不直接使用 `prismaAdmin`

## 2. 完成檢查

- [x] 2.1 `pnpm test`、`pnpm build`、相關 feature 測試（channel、marketing、coupon、mcp）通過
- [x] 2.2 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 以 `--strict` 通過
- [x] 2.3 CHANGELOG、AUDIT-REVIEWS
