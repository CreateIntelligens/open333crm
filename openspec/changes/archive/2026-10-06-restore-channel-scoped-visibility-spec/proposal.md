## Why

渠道可見範圍讓同一個租戶內的成員只看到被授權的渠道，程式在 `apps/api/src/services/channel-visibility.ts`。這項功能的規格有三個問題：

- change `channel-scoped-visibility` 在 `aa274cf0`（2026-09-15）以改名的方式搬進 `archive/`，沒有經過 `openspec archive`。它的 delta spec 從來沒有套用到主規格（issue #228）。
- 歸檔的 delta spec 已經過時：之後的實作（CM-173）加上成員直接綁定渠道（`AgentChannelAccess`）與存取層級，歸檔的規格都沒有描述。
- 主規格 `channel-team-access` 的「Access Level Enforcement」規定存取層級限制群發，但存取層級實際上用在對話與工單的操作；「Fee Attribution for Shared Channels」依賴 #224 移除的授權計費設計。

#230 已經把可見範圍改回 fail-closed，並新增主規格 `channel-visibility-defaults`，描述可見渠道的解析與預設綁定。這個 change 補上其餘的部分。

## What Changes

- 新增主規格 `channel-scoped-visibility`：
  - 列表、單筆讀取、操作與 socket 推播都套用同一個可見範圍。
  - 存取層級：對話與工單的每種操作要求的層級。依 issue #217 的決定，群發不受渠道存取層級限制，由 `marketing.broadcast` 控管。
  - 團隊對話只限團隊成員或被指派人操作。
  - 進站訊息不受可見範圍影響。
- 修改 `channel-visibility-defaults` 的「Unbound Channel Is Not Visible」：補上停用的渠道看不到、直接綁定與團隊授權取聯集。
- 修改 `channel-team-access`：
  - 「Channel Multi-Team Authorization」改寫成現行行為：需要 `channel.assign_team`；依 issue #217 的決定，重複授權同一個團隊時更新層級，不回 409。
  - 移除「Access Level Enforcement」，存取層級的規則移到 `channel-scoped-visibility`。
  - 移除「Fee Attribution for Shared Channels」。

## Capabilities

### New Capabilities

- `channel-scoped-visibility`：租戶內渠道可見範圍與存取層級的套用。

### Modified Capabilities

- `channel-visibility-defaults`：可見渠道的解析補上停用渠道與聯集。
- `channel-team-access`：渠道與團隊的授權。

## Impact

- 這個 change 只補規格，不修改程式。
- 現況違反「與即時推播一致」：每條 socket 都會加入租戶房間，收到所有渠道的 `message.new`。`ai.routes.ts` 違反「單筆讀取與操作的存取檢查」。兩者都是 `docs/ref/system/AUDIT.md` 的 RBAC-04，補上規格依據。
- 歸檔後，`channel-scoped-visibility`、`channel-team-access` 與 `channel-visibility-defaults` 的 Purpose 是 CLI 產生的佔位文字，要手動改寫。
