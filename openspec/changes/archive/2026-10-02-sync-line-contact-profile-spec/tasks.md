## 1. 規格與測試對齊

測試檔：`apps/api/tests/feature/modules/line/line-profile-sync.test.ts`（下稱 feature 測試）。

- 1.1 的測試在修正前寫好，並確認因斷言失敗。
- 1.3 與 1.4 的測試在實作（`f4c76b5`）之後補上。這些測試沒有先看到失敗，改以突變驗證確認：拿掉對應的檢查後，測試會失敗。

- [x] 1.1 測試（feature）：「其他租戶的渠道」「沒有 contact.update」「渠道不在成員的可見範圍」「非 LINE 渠道」，修正前皆因斷言失敗
- [x] 1.2 實作：路由改用 `request.tenantPrisma`，加上 `requirePermission('contact.update')` 與渠道可見範圍檢查；service 以 `tenantId`、`isActive` 與 LINE 類型查詢（`f4c76b5`）
- [x] 1.3 補測試（unit）`apps/api/tests/unit/modules/line/line-profile.service.test.ts`：「其他租戶的渠道（executor 不受 RLS 約束時）」「同步成功」，確認 service 自己帶 `tenantId` 條件
- [x] 1.4 補測試（feature）：「同步成功」「不改聯絡人本身」「只改目標那一筆身分」「找不到身分」「未登入」「LINE 回錯誤」「channelId 格式錯誤」「渠道已停用」
- [x] 1.5 測試名稱改為與本規格的情境同名

## 2. 完成檢查

- [x] 2.1 `pnpm --filter @open333crm/api test` 與 `test:feature` 通過；`tsc --noEmit` 通過
- [x] 2.2 `check-tenant-scoping.mjs --strict` 通過；`check-prisma-admin-usage.mjs --strict` 只有 `main` 既有的違規（RLS-07 與粉絲端路由），沒有新增
- [x] 2.3 `CHANGELOG.md` 已在 `f4c76b5` 新增條目
- [x] 2.4 歸檔本 change，把 `line-contact-profile-sync` 套用到主規格
