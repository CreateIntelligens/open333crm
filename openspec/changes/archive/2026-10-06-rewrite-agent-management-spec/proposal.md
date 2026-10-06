## Why

主規格 `agent-management` 有 4 條需求與現行程式不同：

- 「Create Agent」「Assign Agent Role」「Admin Reset Agent Password」以角色列舉授權，例如「只有 `ADMIN` 與 `SUPERVISOR` 能建立成員」「`SUPERVISOR` 不能指派 `ADMIN`」。現行系統以權限碼授權，並以越權防護取代固定的角色規則（#232 的 `role-management`）。
- 「Deactivate Agent」規定 `DELETE /api/v1/agents/:id` 停用成員。change `agent-deactivate-vs-delete`（#172）之後，停用改為 `POST /api/v1/agents/:id/deactivate`，`DELETE` 改為永久刪除。

`agent-deactivate-vs-delete` 的 delta spec 要新增主規格 `agent-lifecycle`，但這個 change 在 `aa274cf0`（2026-09-15）以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。

## What Changes

- 修改主規格 `agent-management`：
  - REMOVED「Create Agent」「Assign Agent Role」「Admin Reset Agent Password」「Deactivate Agent」。舊的情境名稱以角色列舉命名，例如「Supervisor attempts to create ADMIN agent」，不能以 MODIFIED 保留。
  - ADDED「建立成員」「指派成員的角色」「重設其他成員的密碼」：以權限碼授權，越權防護、人數上限與新成員的渠道引用其他主規格。
  - MODIFIED「Change Own Password」：回應改成全站的錯誤格式，不再規定英文訊息。情境名稱不變。
- 新增主規格 `agent-lifecycle`，照現行程式改寫歸檔的 delta spec：
  - 「停用成員」：保留記錄與 email、不出現在成員列表、不能停用自己、不能停用最後一位管理員。
  - 「重新啟用成員」：停用是可以復原的動作。歸檔的 delta spec 已有這條規定，前端的確認對話框也寫「帳號可日後再啟用」。
  - 「永久刪除成員」：釋放 email、清理會阻止刪除的關聯、保留歷史資料、不能刪除自己、不能刪除最後一位管理員。
  - 歸檔的「端點語義」併入上面兩條需求。

## Capabilities

### New Capabilities

- `agent-lifecycle`：成員的停用、重新啟用與永久刪除。

### Modified Capabilities

- `agent-management`：成員的建立、角色指派與密碼，改以權限碼授權。

## Impact

- 這個 change 只補規格、測試與文件，不修改程式的行為。
- 現況違反兩條規格，記在 `docs/ref/system/AUDIT.md`：
  - 「重新啟用成員」：沒有重新啟用的路由，`GET /api/v1/agents` 也不回傳停用的成員。新增 AUTH-09。
  - 「停用成員」與「永久刪除成員」的「最後一位管理員」：`assertNotLastActiveAdmin()` 把角色列舉為 `ADMIN`、但角色已改成自訂角色的成員也算成管理員。併入 RBAC-03，RBAC-03 因此由 P3 調為 P2。
- 重新啟用時要不要檢查方案的人數上限，留給實作的 change 決定：`plan-limits-core` 只在建立成員時檢查，停用的成員不計數。
- 歸檔後，`agent-lifecycle` 的 Purpose 是 CLI 產生的佔位文字，`agent-management` 的 Purpose 也要配合改寫。
