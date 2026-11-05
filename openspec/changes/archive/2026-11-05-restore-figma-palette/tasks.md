## 1. 測試

- [x] 1.1 `apps/web/tests/unit/accessibility/design-system.test.ts` 改為檢查 Figma 色值（主色、主色 hover、文字、次要文字、刪除紅）與主要文字、成功、警告、AI 的 AA 對比；改色前在 `harden-web-wcag-typography` 的色票上失敗。

## 2. 實作

- [x] 2.1 `apps/web/src/app/globals.css` 淺色 14 個、深色 18 個色彩 token 改回 `186b791f~1` 的 Figma 值，其餘 CSS 不變。

## 3. 驗證

- [x] 3.1 web 單元測試與 `pnpm --filter @open333crm/web build`。
- [x] 3.2 `node scripts/validate-openspec.mjs restore-figma-palette` 與歸檔後 `--specs`。
- [x] 3.3 `CHANGELOG.md` 新增條目。
