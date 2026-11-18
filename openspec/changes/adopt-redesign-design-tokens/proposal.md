# Proposal

## Why

設計師的前端改版（PR #521 與分支 `feat/ui-polish`）依 Figma 重做外框、導覽、共用元件與大部分頁面，並做了三個與主線規格不同的設計決定（見 PR #521「設計決定」）：

1. 色票調深，讓主色、次要文字、刪除紅、成功、警示在白底都達 WCAG 2.1 AA 4.5:1（例：主色 `#378ADD` → `#2876C4`）。
2. 輸入框與分隔線維持 Figma Border/Default `#E2E8F0`（對比約 1.23:1，未達非文字 3:1，為設計取捨）。
3. 字級與元件尺寸依 Figma 設計系統（最小字 12px、按鈕 40／36／32／28px），不採用主線「中文最小 13.5pt」與「全域 44px 最小高度」。

2026-11-18 使用者決定「依照設計師給的規則」合併改版。主線的 `web-accessibility-system` 規格仍寫著 2026-11-05 `restore-figma-palette` 的 Figma 原色、13.5pt 與 44px，直接合併會讓規格與程式互相矛盾，所以以本 change 改寫規格。

## What Changes

- `web-accessibility-system`「WCAG AA theme tokens」：色票改以設計師的版本為準，亮色模式主色、次要文字、刪除紅、成功、警示、AI 色都須達 4.5:1；輸入框框線與深色模式成功、AI 標籤列為例外。
- `web-accessibility-system`「Chinese typography floor」：改為依 Figma 字級（12／14／16／18／20／24／28／42px），最小 12px，不再有全域強制的 13.5pt。
- `web-accessibility-system`「Keyboard and touch access」：元件尺寸依 Figma（按鈕 40／36／32／28px），不再有全域 44px 最小高度；鍵盤焦點與分頁語意不變。
- `design-system.test.ts` 的測試名稱對齊上述 scenario，並補上輸入框框線例外的檢查。
- 設計師的 skill `references/tokens.md` 更新為實際色票（原表仍寫改色前的 Figma 色碼）。
- 程式（`globals.css`、`tailwind.config.ts`、各頁面）沿用設計師分支，本 change 不改。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `web-accessibility-system`：「WCAG AA theme tokens」、「Chinese typography floor」、「Keyboard and touch access」。

## Impact

- 影響程式：`apps/web` 前端畫面（來自設計師分支）、`apps/web/tests/unit/accessibility/design-system.test.ts`、`.agents/skills/open333crm-ui/references/tokens.md`。
- 不影響 API、資料庫、背景工作與權限。
- 「Motion and shell landmarks」不變（略過導覽連結、減少動態效果維持）。
