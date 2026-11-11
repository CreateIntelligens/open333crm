## MODIFIED Requirements

### Requirement: 重設其他成員的密碼

`PATCH /api/v1/agents/:id/password` SHALL 重設本租戶成員的密碼，不需要原本的密碼，要求 `agent.password.reset`。新密碼至少 8 個字元。成員不存在或屬於其他租戶時，系統 SHALL 回 HTTP 404。目標的權限比操作者高時，系統 SHALL 回 HTTP 403（`TARGET_OUTRANKS_ACTOR`），見 `role-management` 的「對其他成員的操作不能用在權限比自己高的成員」。

#### Scenario: 重設後以新密碼登入
- **WHEN** 有 `agent.password.reset` 的成員以 `{ newPassword }` 重設另一位成員的密碼
- **THEN** 系統回 HTTP 200，該成員的密碼變成新密碼

#### Scenario: 沒有 agent.password.reset 時被拒
- **WHEN** 沒有 `agent.password.reset` 的成員重設另一位成員的密碼
- **THEN** 系統回 HTTP 403，該成員的密碼不變

#### Scenario: 重設其他租戶的成員回 404
- **WHEN** 租戶 A 有 `agent.password.reset` 的成員，重設租戶 B 的成員的密碼
- **THEN** 系統回 HTTP 404，該成員的密碼不變
