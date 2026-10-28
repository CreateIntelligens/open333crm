## 1. 搬遷前的測試

- [x] 1.1 新增 `tests/feature/modules/shortlink/shortlink-flow.test.ts`，在搬遷前的程式碼上執行：建立與修改目標網址時寫回 OG 快照、點擊記錄與點擊貼標、點擊貼標失敗時點擊照樣記錄、不存在的短連結回 410 都通過；「Click events commit with the click」失敗在斷言上（outbox 沒有 `link.clicked`）
- [x] 1.2 在 `tests/feature/modules/marketing/broadcast-coupon.test.ts` 寫「Material short link created inside a transaction gets its snapshot」，在搬遷前的程式碼上失敗在斷言上（`ogTitle` 是 null，log 有 `OG snapshot update failed`）

## 2. 搬遷

- [x] 2.1 `shortlink.service.ts` 改收 `TenantCtx`，不再抓 OG、推播或發事件；`trackClick` 改為 `recordClick`，點擊貼標在 savepoint 內執行
- [x] 2.2 新增 `shortlink.flow.ts`、`og-snapshot.ts`；`shortlink.routes.ts`、`shortlink-redirect.routes.ts` 改呼叫 flow，讓 1.1 通過
- [x] 2.3 `convertBodyUrlsToShortLinks` 收集新建的短連結；`marketing.service.ts` 的一般廣播與 `broadcast-coupon.flow.ts` 在寫入之後抓 OG 快照，讓 1.2 通過
- [x] 2.4 新增 `tests/unit/modules/shortlink/shortlink.flow.test.ts`：事件在 commit 之前寫入、推播與 OG 抓取在 commit 之後、rollback 時都不發生。突變驗證：`link.stats.updated` 改成在交易內直接推播時失敗；OG 抓取改成在交易內呼叫時失敗

## 3. 完成定義

- [x] 3.1 `pnpm test:all` 通過；`tsc --noEmit`、`check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 通過，基準檔已更新
- [x] 3.2 `CHANGELOG.md` 在 `## [2026-10-28]` 加 Changed 與 Fixed 條目；更新 `docs/ref/features/tenant/SHORTLINKS.md`、`docs/ref/modules/EVENTS.md`、`docs/ref/system/AUDIT.md`
- [x] 3.3 `node scripts/validate-openspec.mjs migrate-shortlink-tenant-ctx` 與 `--specs` 通過
