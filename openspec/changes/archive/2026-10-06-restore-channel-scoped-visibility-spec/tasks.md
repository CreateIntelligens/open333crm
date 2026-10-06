## 1. 對照現有測試

這個 change 只補規格，不修改程式。下表記錄每個情境目前由哪個測試涵蓋。現有測試多數寫在規格之前，名稱不是情境名稱。

測試檔的簡稱：

- `visibility`：`apps/api/tests/unit/services/channel-visibility.test.ts`
- `socket`：`apps/api/tests/unit/modules/socket/socket-room-authorization.test.ts`
- `mcp`：`apps/api/tests/feature/modules/mcp/mcp-channel-visibility.test.ts`（MCP 路徑，不是 REST 路由）

**`channel-scoped-visibility`**

| 需求 | 情境 | 現有測試 |
| --- | --- | --- |
| 列表查詢套用渠道過濾 | 對話列表只含可見渠道 | `visibility`：`channel id where filter`；`mcp` 的列對話情境 |
| 列表查詢套用渠道過濾 | 工單列表只含可見渠道 | `visibility`：`channel id where filter` |
| 單筆讀取與操作的存取檢查 | 讀取不可見渠道的對話被拒 | `mcp` 的讀單筆情境。REST 路由沒有 |
| 單筆讀取與操作的存取檢查 | 讀取不可見渠道的工單被拒 | 同上 |
| 單筆讀取與操作的存取檢查 | 操作不可見渠道的對話被拒 | 沒有 |
| 存取層級 | 多個來源取最高層級 | `visibility`：`resolve level` |
| 存取層級 | 唯讀成員不能回覆 | `mcp` 的發 LINE 情境。REST 路由沒有 |
| 存取層級 | 回覆層級不能關閉對話 | 沒有 |
| 存取層級 | 群發不檢查渠道層級 | 沒有 |
| 團隊對話只限團隊成員操作 | 非團隊成員操作團隊對話被拒 | `socket`：`team scoped conversation does not fall back to channel access`（socket 路徑）。REST 路由沒有 |
| 團隊對話只限團隊成員操作 | 被指派人可以操作 | 沒有 |
| 與即時推播一致 | socket 與列表一致 | 現況違反（AUDIT RBAC-04） |
| 與即時推播一致 | 訂閱不可見渠道的對話房間被拒 | `socket`：`rejects conversation outside scope` |
| 進站訊息分派不受成員可見範圍限制 | 進站訊息正常建立 | 沒有 |

**`channel-visibility-defaults` 的「Unbound Channel Is Not Visible」**

原有的 3 個情境已有同名測試（#230）。新增的情境：

| 情境 | 現有測試 |
| --- | --- |
| Inactive channel hidden | 沒有 |
| Direct and team bindings combined | 沒有。`visibility` 的 `agent direct binding` 分別測直接綁定與團隊授權，沒有測同一位成員兩者都有 |
| Several teams combined | `visibility`：`multi team union` |

**`channel-team-access` 的「Channel Multi-Team Authorization」**

8 個情境都沒有測試。

標示「沒有」的情境，現行程式符合規格，但沒有測試。補測試不在這個 change 的範圍內；修改相關程式時一併補上。

- [x] 1.1 逐一對照情境與現有測試，記錄在上表
- [x] 1.2 現況違反的情境記在 `docs/ref/system/AUDIT.md` 的 RBAC-04，補上規格依據

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
