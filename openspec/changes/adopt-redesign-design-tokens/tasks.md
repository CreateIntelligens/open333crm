## 1. 合併改版

- [x] 1.1 從設計師的 `feat/ui-polish` 建分支，併入 PR #521 分支（沿用設計師 11/16 已解的衝突），再合併最新 main，解 5 個衝突：版面以設計師為準，main 新增的功能放進新版面（側欄的留言自動私訊入口、訊息泡泡的留言私訊快照、連結粉專後回到來源頁、關鍵字回覆頁的留言私訊說明）
- [x] 1.2 側欄的留言自動私訊入口測試改成新選單結構；變異驗證：拿掉「子頁不在 match 路徑下也算該區」、把 `richmenu.manage` 放回圖示欄，兩者都讓測試失敗

## 2. 規格與測試

- [x] 2.1 `design-system.test.ts` 測試名稱對齊 scenario（`Light theme primary action`、`Semantic status text`、`Documented contrast exceptions`、`Small utility text`、`Touch target`），並在 `Documented contrast exceptions` 檢查輸入框框線是 Figma Border/Default
- [x] 2.2 `.agents/skills/open333crm-ui/references/tokens.md` 更新為實際色票

## 3. 驗證

- [x] 3.1 前端型別檢查與單元測試
- [x] 3.2 `pnpm --filter @open333crm/web build`
- [x] 3.3 `node scripts/validate-openspec.mjs adopt-redesign-design-tokens` 與 `--specs`
- [x] 3.4 `CHANGELOG.md` 新增條目
- [ ] 3.5 【需使用者同意】推送分支、開 PR；合併前通知設計師（PR #521 由本 PR 取代）
