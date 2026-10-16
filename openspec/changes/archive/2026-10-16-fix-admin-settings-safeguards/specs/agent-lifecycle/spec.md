## MODIFIED Requirements

### Requirement: 重新啟用成員

停用是可以復原的動作。有 `agent.deactivate` 的成員 SHALL 能以 `GET /api/v1/agents/inactive` 查詢本租戶停用的成員，並以 `POST /api/v1/agents/:id/reactivate` 把停用的成員重新啟用，成功時回 HTTP 204。重新啟用之後，成員 SHALL 能以原本的 email 與密碼登入，角色維持停用前的角色。

重新啟用 SHALL 套用方案的客服人數上限：啟用中的成員已達上限時，系統回 HTTP 403，`error.code` 是 `PLAN_LIMIT_EXCEEDED`，成員維持停用。成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。人員管理頁 SHALL 對有 `agent.deactivate` 的成員列出停用的成員與「重新啟用」按鈕。

#### Scenario: 管理員看得到停用的成員
- **WHEN** 成員 M 被停用之後，有 `agent.deactivate` 的成員查詢本租戶停用的成員
- **THEN** 結果含 M

#### Scenario: 重新啟用後可以登入
- **WHEN** 有 `agent.deactivate` 的成員重新啟用停用的成員 M
- **THEN** M 的 `isActive` 是 `true`，M 以原本的 email 與密碼登入成功，角色與停用前相同

#### Scenario: 重新啟用需權限
- **WHEN** 沒有 `agent.deactivate` 的成員查詢停用的成員或重新啟用成員 M
- **THEN** 系統回 HTTP 403，M 維持停用

#### Scenario: 重新啟用受方案人數上限限制
- **WHEN** 方案的客服人數上限是 3，租戶已有 3 位啟用中的成員，有 `agent.deactivate` 的成員重新啟用停用的成員 M
- **THEN** 系統回 HTTP 403，`error.code` 是 `PLAN_LIMIT_EXCEEDED`，M 維持停用
