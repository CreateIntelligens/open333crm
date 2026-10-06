## 1. 測試

這個 change 只補規格、測試與文件，不修改程式的行為。除了下面註明的情境，每個情境都在 `apps/api/tests/feature/modules/agent/agent-management.test.ts`（新增），測試名稱以情境名稱開頭。

| 主規格 | 需求 | 情境 | 測試 |
| --- | --- | --- | --- |
| `agent-lifecycle` | 重新啟用成員 | 管理員看得到停用的成員 | 現況違反（AUDIT AUTH-09），修正時補測試 |
| `agent-lifecycle` | 重新啟用成員 | 重新啟用後可以登入 | 現況違反（AUDIT AUTH-09），修正時補測試 |

「不能停用最後一位管理員」與「不能刪除最後一位管理員」的測試，只涵蓋角色列舉與 `admin` 系統角色一致的情況。兩者不一致時，現況違反這兩個情境（AUDIT RBAC-03），修正時補測試。

**突變驗證**

新增的測試都對應現行程式，寫好時就通過，沒有先看到失敗。改以突變驗證確認：改壞下表的程式之後，對應的測試會失敗。22 處都讓測試失敗。

| 改壞的程式 | 失敗的測試 |
| --- | --- |
| `error-handler.plugin.ts`：唯一約束衝突不轉成 409 | email 已被其他租戶使用 |
| `agent.routes.ts`：建立、改角色、重設密碼、停用、刪除的權限碼各改成 `agent.view` | 對應的 5 個「沒有權限時被拒」情境 |
| `agent.service.ts`：回應帶 `passwordHash` | 建立成員成功 |
| `agent.schema.ts`：建立成員與修改密碼的密碼下限改成 1 | 密碼太短、New password too short |
| `agent.service.ts`：忽略 `roleId` | 以 roleId 改成員的角色 |
| `agent.routes.ts`：角色列舉一律當成 `AGENT` | 以角色列舉指定系統角色 |
| `agent.service.ts`：改角色時不檢查成員是否存在 | 成員不存在 |
| `agent.service.ts`：重設密碼時不寫入新密碼 | 重設後以新密碼登入 |
| `agent.service.ts`：不檢查目前的密碼 | Wrong current password |
| `agent.service.ts`：停用時不改 `isActive` | 停用保留記錄與 email |
| `agent.routes.ts`：成員列表不過濾 `isActive` | 停用的成員不出現在成員列表 |
| `agent.routes.ts`：停用、刪除時不檢查是不是自己 | 不能停用自己、不能刪除自己 |
| `agent.service.ts`：不保護最後一位管理員 | 不能停用最後一位管理員、不能刪除最後一位管理員 |
| `agent.service.ts`：刪除改成停用 | 刪除釋放 email |
| `agent.service.ts`：刪除前不清通知 | 刪除清理會阻止刪除的關聯 |
| `agent.service.ts`：刪除時連工單一起刪 | 刪除保留歷史 |

「沒有 agent.role.assign 時被拒」原本只斷言 403，第一次突變驗證時沒有失敗：拿掉 `agent.role.assign` 的檢查之後，越權防護也回 403。測試已改成同時斷言 `error.details.requiredPermission`。

「email 已被其他租戶使用」不經過 `createAgent()` 的 email 檢查。原因是 app_tenant 連線的 RLS 看不到其他租戶的成員；衝突改由資料庫的唯一約束擋下，錯誤處理再轉成 409。重設與刪除其他租戶的成員回 404，同樣有 RLS 與 `tenantId` 條件兩層防護。

- [x] 1.1 對照情境與現有測試
- [x] 1.2 為每個情境新增測試，並以突變驗證確認
- [x] 1.3 現況違反的情境記在 `docs/ref/system/AUDIT.md`：新增 AUTH-09，RBAC-03 補上規格依據

## 2. 文件

- [x] 2.1 `docs/ref/features/tenant/MEMBERS.md` 註明停用目前無法復原
- [x] 2.2 `docs/ref/system/AUDIT-REVIEWS.md` 新增一筆紀錄

## 3. 完成檢查

- [x] 3.1 `openspec validate rewrite-agent-management-spec --strict` 通過
- [x] 3.2 以 `openspec archive` 歸檔本 change
- [x] 3.3 改寫 `agent-management` 與 `agent-lifecycle` 的 Purpose
- [x] 3.4 `openspec validate --specs --strict` 通過
- [x] 3.5 `pnpm test` 與 `pnpm --filter @open333crm/api test:feature` 通過
