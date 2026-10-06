## 1. 測試

這個 change 只補規格，不修改程式。每個情境的測試如下；測試名稱以情境名稱開頭的，是這個 change 新增的測試。

測試檔的簡稱：

- `scoped`：`apps/api/tests/feature/modules/channel/channel-scoped-visibility.test.ts`（新增）
- `team`：`apps/api/tests/feature/modules/channel/channel-team-access.test.ts`（新增）
- `visibility`：`apps/api/tests/unit/services/channel-visibility.test.ts`
- `socket`：`apps/api/tests/unit/modules/socket/socket-room-authorization.test.ts`
- `mcp`：`apps/api/tests/feature/modules/mcp/mcp-channel-visibility.test.ts`（MCP 路徑）

**`channel-scoped-visibility`**

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 列表查詢套用渠道過濾 | 對話列表只含可見渠道 | `visibility`：`channel id where filter`；`mcp` 的列對話情境 |
| 列表查詢套用渠道過濾 | 工單列表只含可見渠道 | `visibility`：`channel id where filter` |
| 單筆讀取與操作的存取檢查 | 讀取不可見渠道的對話被拒 | `scoped`（REST）；`mcp` 的讀單筆情境 |
| 單筆讀取與操作的存取檢查 | 讀取不可見渠道的工單被拒 | `scoped`（REST）；`mcp` 的讀單筆情境 |
| 單筆讀取與操作的存取檢查 | 操作不可見渠道的對話被拒 | `scoped` |
| 存取層級 | 多個來源取最高層級 | `visibility`：`resolve level` |
| 存取層級 | 唯讀成員不能回覆 | `scoped`（REST）；`mcp` 的發 LINE 情境 |
| 存取層級 | 回覆層級不能關閉對話 | `scoped` |
| 存取層級 | 群發不檢查渠道層級 | `scoped` |
| 團隊對話只限團隊成員操作 | 非團隊成員操作團隊對話被拒 | `scoped`（REST）；`socket`：`team scoped conversation does not fall back to channel access` |
| 團隊對話只限團隊成員操作 | 被指派人可以操作 | `scoped` |
| 與即時推播一致 | socket 與列表一致 | 現況違反（AUDIT RBAC-04），修正時補測試 |
| 與即時推播一致 | 訂閱不可見渠道的對話房間被拒 | `socket`：`rejects conversation outside scope` |
| 進站訊息分派不受成員可見範圍限制 | 進站訊息正常建立 | `scoped` |

**`channel-visibility-defaults` 的「Unbound Channel Is Not Visible」**

原有的 3 個情境已有同名測試（#230）。新增的情境：

| 情境 | 測試 |
| --- | --- |
| Inactive channel hidden | `scoped` |
| Direct and team bindings combined | `scoped` |
| Several teams combined | `visibility`：`multi team union` |

**`channel-team-access` 的「Channel Multi-Team Authorization」**

8 個情境都在 `team`。

新增的測試都對應現行程式，寫好時就通過，沒有先看到失敗。改以突變驗證確認：拿掉對應的檢查後，測試會失敗。

| 拿掉的檢查 | 失敗的測試 |
| --- | --- |
| `assertEntityChannelVisible()` 的層級比較 | 唯讀成員不能回覆、回覆層級不能關閉對話 |
| `assertConversationChannelVisible()` 的團隊檢查 | 非團隊成員操作團隊對話被拒 |
| `getAccessibleChannelIds()` 的 `isActive` 條件 | Inactive channel hidden |
| `GET /conversations/:id`、`GET /cases/:id` 的可見範圍檢查 | 讀取不可見渠道的對話被拒、讀取不可見渠道的工單被拒 |
| `grantChannelTeamAccess()` 的 upsert（改為 create） | Channel Already Granted |
| 撤銷路由的 `channel.assign_team` | Missing permission |
| 撤銷不存在的授權時回 404 | Revoke a grant that does not exist |

另外，`apps/api/tests/feature/modules/line/line-profile-sync.test.ts` 的渠道沒有綁定，18c962b（#230）改為 fail-closed 之後有 2 個測試失敗。這個 PR 把測試的渠道綁給測試成員。

- [x] 1.1 對照情境與現有測試
- [x] 1.2 為沒有測試的情境，以及只有 MCP 或 socket 測試的 REST 情境新增測試，並以突變驗證確認
- [x] 1.3 現況違反的情境記在 `docs/ref/system/AUDIT.md` 的 RBAC-04，補上規格依據

## 2. 修改其他主規格

- [x] 2.1 `channel-visibility-defaults`：MODIFIED「Unbound Channel Is Not Visible」，保留原有 3 個情境的名稱
- [x] 2.2 `channel-team-access`：MODIFIED「Channel Multi-Team Authorization」，保留原有 5 個情境的名稱；重複授權改為更新層級（issue #217）
- [x] 2.3 `channel-team-access`：REMOVED「Access Level Enforcement」，規則移到 `channel-scoped-visibility` 的「存取層級」；群發不受層級限制（issue #217）
- [x] 2.4 `channel-team-access`：REMOVED「Fee Attribution for Shared Channels」

## 3. 完成檢查

- [x] 3.1 `openspec validate restore-channel-scoped-visibility-spec --strict` 通過
- [x] 3.2 以 `openspec archive` 歸檔本 change
- [x] 3.3 改寫 `channel-scoped-visibility`、`channel-team-access` 與 `channel-visibility-defaults` 的 Purpose
- [x] 3.4 `openspec validate --specs --strict` 通過
- [x] 3.5 `pnpm test` 與 `pnpm --filter @open333crm/api test:feature` 通過
