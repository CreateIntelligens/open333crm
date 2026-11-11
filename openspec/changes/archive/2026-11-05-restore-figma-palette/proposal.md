# Proposal

## Why

2026-11-02 的 `harden-web-wcag-typography` 為了 WCAG AA 對比，把 Web CRM 的色票從 Figma 設計系統（主色 `#378ADD`、文字 `#37404C`）改成另一套較深的顏色（主色 `#1D4ED8`、文字 `#0F172A`），沒有經過設計確認。2026-11-05 使用者在 UAT 看到色系與 Figma 不符，決定色票完全改回 Figma 原色，字級、焦點、觸控尺寸等其他無障礙改動保留。

## What Changes

- `apps/web/src/app/globals.css` 淺色與深色主題的色彩 token 改回 Figma 設計系統的值（淺色 14 個、深色 18 個），其餘 CSS 不變。
- `web-accessibility-system` 的「WCAG AA theme tokens」改為以 Figma 色票為準：主要文字、成功、警告、AI 色仍須達 AA；主色按鈕（白字約 3.6:1）、次要文字（約 4.1:1）、刪除紅（白字約 4.1:1），以及深色模式的成功與 AI 標籤（約 4.1:1、3.9:1）是使用者決定保留的例外。
- 無障礙測試改為檢查 Figma 色值與其餘色票的 AA 對比。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `web-accessibility-system`：「WCAG AA theme tokens」。

## Impact

- 影響程式：`apps/web/src/app/globals.css`、`apps/web/tests/unit/accessibility/design-system.test.ts`。
- 不影響 API、資料庫與路由。字級、焦點框、44px 觸控區、略過導覽連結維持 `harden-web-wcag-typography` 的內容。
