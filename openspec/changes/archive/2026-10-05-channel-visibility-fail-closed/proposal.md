## Why

#217 的決定（留言 5990552133）：渠道可見範圍改回 fail-closed。

`channel-scoped-visibility`（#172/#173，`4382dc32`）的 design.md 原本是 fail-closed，搭配上線時把既有渠道回填出去。上線時沒有回填，改由 `services/channel-visibility.ts` 的 legacy 分支頂替：完全沒有綁定任何團隊或成員的渠道，所有成員都看得到，而且是 `full`。這是過渡做法，造成兩個問題：

- 新增的渠道在綁定之前，有在用分店的租戶中所有分店都看得到。
- 規格與程式不一致：歸檔規格要求成員沒有任何授權時列表為空。

改成 fail-closed 之後，新渠道與新成員預設看不到任何東西。建立渠道、建立成員時若不能一併指定可見範圍，管理員一定會漏掉。

## What Changes

- **回填**（migration `20261005120000_backfill_unbound_channel_access`）：每個租戶中完全沒有綁定任何團隊或成員的渠道（含停用的渠道），直綁給該租戶目前所有啟用中的成員，`accessLevel` 為 `full`。回填後每個人看到的渠道與現況相同。執行身分不能略過 RLS 時，migration 中止，不會靜默寫入 0 筆。
- **移除 legacy 分支**：`getAccessibleChannelIds()` 與 `resolveChannelAccessLevel()` 不再把沒有綁定的渠道視為全員可見。REST、socket 房間、MCP 都經由這兩個函式，一併生效。
- **建立渠道時指定可見成員**：`POST /channels` 接受 `visibleAgentIds`，在建立渠道的同一個交易內寫入成員直綁；沒有送時直綁給所有啟用中的成員（API 用戶端與 Meta 串接維持「新渠道大家看得到」）。前端新增渠道時列出成員，預設全選。
- **建立成員時指定可見渠道**：`POST /agents` 接受 `channelIds`，在建立成員的同一個交易內寫入直綁。沒有送時，直綁建立者自己看得到的渠道（總店為所有渠道）。建立者沒有 `channel.view_all` 或 `channel.assign_team` 時，只能指定自己看得到的渠道。前端新增成員時列出渠道，預設全選。
- 編輯成員的「可使用的渠道」說明改成新規則：沒有勾選的渠道就看不到。
- 建立者沒有 `channel.view_all` 時，新成員的層級不高於建立者自己的層級；建立渠道時建立者自動加入可見成員。
- 自動派案只派給綁定該渠道、層級能回覆的成員，否則工單會派給看不到它的人。

## Capabilities

### New Capabilities

- `channel-visibility-defaults`：沒有綁定的渠道不可見、既有渠道回填、建立渠道與成員時的預設可見範圍。

## 與後端規格 PR 的關係

#217 中後端（@yunfish0302）的第 2 個 PR 會照現行程式重寫 `channel-scoped-visibility`、修改 `channel-team-access`，本 change 不修改這兩份主規格。本 change 只新增 `channel-visibility-defaults`；後端重寫時可以把 fail-closed 的描述併過去，或引用本規格。

## Impact

- `packages/database`（migration）、`apps/api`（可見範圍解析、渠道與成員的建立）、`apps/web`（新增渠道、新增成員、編輯成員）
- 部署：migration 由 entrypoint 的 `migrate deploy` 以 owner 身分在新程式啟動前執行，因此回填一定先於移除 legacy 分支生效。
- UAT 預估：Demo Tenant 8 個渠道 × 5 位啟用中成員 = 40 筆；創造智能的兩個渠道都已綁定，不受影響。
- 已知取捨：停用中的成員不回填，日後重新啟用時要由管理員指派渠道。
