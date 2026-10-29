## MODIFIED Requirements

### Requirement: 權限註冊表是權限點的唯一來源

系統 SHALL 在 `packages/shared/src/rbac/permissions.ts` 的權限註冊表（`PERMISSIONS`）定義所有可以授予的權限點。`@open333crm/core` SHALL 轉出同一份註冊表，MUST NOT 另外定義權限點。每個權限點 SHALL 有下列欄位：

- `code`：權限碼。
- `group`：畫面上的分群。分群 MUST NOT 影響授權判斷。
- `feature`：權限點所屬的方案功能，方案的功能天花板依這個欄位計算。
- `label`、`description`：給使用者看的名稱與說明。

權限點 MAY 另外宣告 `dependsOn`、`implies`、`adminLock` 與 `selfLock`。

權限點 MUST NOT 存在資料庫；資料庫只存角色與權限碼的對應。設定角色權限時，系統 SHALL 以 HTTP 422（`VALIDATION_ERROR`）拒絕不在註冊表內的權限碼，MUST NOT 修改角色的權限。

#### Scenario: 每個權限點的必要欄位都有值
- **WHEN** 系統載入權限註冊表
- **THEN** 每個權限點的 `code`、`group`、`feature`、`label` 與 `description` 都不是空字串

#### Scenario: 不在註冊表的權限碼不能授予
- **WHEN** 有 `role.manage` 的成員以 `PUT /api/v1/roles/:id/permissions` 送出含 `unknown.code` 的權限清單
- **THEN** 系統回 HTTP 422，`error.code` 是 `VALIDATION_ERROR`，角色的權限不變

### Requirement: 啟動時驗證註冊表

API 啟動時 SHALL 驗證權限註冊表。有下列任一種錯誤時，驗證 SHALL 失敗，API SHALL 停止啟動，錯誤訊息 SHALL 指出有問題的權限碼：

- 兩個權限點有同一個 `code`。
- `dependsOn` 或 `implies` 指向註冊表內不存在的權限碼。
- `implies` 形成循環。
- 同一個權限碼同時出現在某個權限點的 `dependsOn` 與 `implies`。
- `feature` 不是功能註冊表（`packages/core/src/rbac/features.ts`）內的功能。
- 沒有任何權限點標記 `selfLock`。沒有 `selfLock` 時，防止成員把自己鎖在角色管理之外的檢查會失效。

#### Scenario: 指向不存在的權限碼
- **WHEN** 某個權限點的 `dependsOn` 含註冊表內不存在的 `nonexistent.code`
- **THEN** 驗證失敗，錯誤訊息含 `nonexistent.code`

#### Scenario: implies 形成循環
- **WHEN** `a.x` 的 `implies` 含 `b.y`，`b.y` 的 `implies` 含 `a.x`
- **THEN** 驗證失敗，錯誤訊息含 `a.x` 與 `b.y`

#### Scenario: 同一個權限碼同時是前置與隱含權限
- **WHEN** 某個權限點的 `dependsOn` 與 `implies` 都含 `tag.view`
- **THEN** 驗證失敗，錯誤訊息含 `tag.view`

#### Scenario: 不存在的功能
- **WHEN** 某個權限點的 `feature` 是功能註冊表內不存在的值
- **THEN** 驗證失敗，錯誤訊息含該權限碼

#### Scenario: 沒有 selfLock 的權限點
- **WHEN** 註冊表內沒有任何權限點標記 `selfLock`
- **THEN** 驗證失敗

#### Scenario: 正式的註冊表通過驗證
- **WHEN** 驗證 `packages/shared/src/rbac/permissions.ts` 的註冊表
- **THEN** 驗證沒有錯誤
