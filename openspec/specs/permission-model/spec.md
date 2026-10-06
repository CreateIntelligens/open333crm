# permission-model Specification

## Purpose
定義權限碼本身：權限註冊表的欄位、命名規則、前置權限與隱含權限，以及 API 啟動時對註冊表與路由的驗證。

## Requirements

### Requirement: 權限註冊表是權限點的唯一來源

系統 SHALL 在 `packages/core/src/rbac/permissions.ts` 的權限註冊表（`PERMISSIONS`）定義所有可以授予的權限點。每個權限點 SHALL 有下列欄位：

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

### Requirement: 權限碼命名

權限碼 SHALL 由兩段以上的小寫片段組成，片段之間以 `.` 分隔。第一段是資源名稱。片段 MAY 含 `-` 與 `_`，例如 `channel.view_all`、`analytics.view.self`。權限碼 MUST 在註冊表內唯一。

#### Scenario: 註冊表的權限碼都符合命名規則
- **WHEN** 系統載入權限註冊表
- **THEN** 每個權限碼都符合「兩段以上的小寫片段，以 `.` 分隔，片段可含 `-` 與 `_`」

#### Scenario: 重複的權限碼讓驗證失敗
- **WHEN** 註冊表有兩個權限點宣告同一個 `code`
- **THEN** 註冊表的驗證失敗，錯誤訊息含重複的權限碼

### Requirement: 前置權限（dependsOn）

權限點 MAY 以 `dependsOn` 宣告同一個功能流程內的前置權限碼，例如 `inbox.reply` 的前置權限是 `inbox.view`。前置權限碼存成角色的權限資料列，在設定畫面上可以看到。

角色持有某個權限碼時，MUST 同時持有它的所有前置權限碼。設定角色權限時，送出的清單含某個權限碼、但缺少它的前置權限碼，系統 SHALL 回 HTTP 422（`DEPENDENCY_UNMET`），`error.details.missing` 是缺少的前置權限碼。系統 MUST NOT 自動補上前置權限碼，也 MUST NOT 自動移除依賴它的權限碼。

#### Scenario: 缺少前置權限時被拒
- **WHEN** 有 `role.manage` 的成員設定角色權限，送出的清單含 `inbox.reply`、不含 `inbox.view`
- **THEN** 系統回 HTTP 422，`error.code` 是 `DEPENDENCY_UNMET`，`error.details.missing` 是 `inbox.view`，角色的權限不變

#### Scenario: 同時授予前置權限時接受
- **WHEN** 有 `role.manage` 的成員設定角色權限，送出的清單含 `inbox.reply` 與 `inbox.view`
- **THEN** 系統接受這次設定，角色持有 `inbox.reply` 與 `inbox.view`

### Requirement: 隱含權限（implies）

權限點 MAY 以 `implies` 宣告其他模組的權限碼。這些是程式實作上需要、使用者不必自己管理的權限，例如指派工單要讀取成員清單。系統 SHALL 在計算有效權限集合時加入 `implies` 的遞迴閉包。`implies` 的權限碼 MUST NOT 因為隱含關係而存成角色的權限資料列。

#### Scenario: 隱含權限不存成資料列
- **WHEN** 有 `role.manage` 的成員把角色的權限設定為 `case.view` 與 `case.assign`，`case.assign` 的 `implies` 含 `agent.view`
- **THEN** `GET /api/v1/roles/:id/permissions` 回傳 `case.view` 與 `case.assign`，不含 `agent.view`

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
- **WHEN** 驗證 `packages/core/src/rbac/permissions.ts` 的註冊表
- **THEN** 驗證沒有錯誤

### Requirement: 路由與註冊表一致

所有路由註冊完成後，API SHALL 檢查權限檢查的 guard 用到的每個權限碼都在註冊表內。有不在註冊表的權限碼時，API SHALL 停止啟動，錯誤訊息 SHALL 含該權限碼。

#### Scenario: 路由用了不在註冊表的權限碼
- **WHEN** 一條路由以 `requirePermission('newfeature.action')` 檢查，`newfeature.action` 不在註冊表內
- **THEN** 檢查失敗，錯誤訊息含 `newfeature.action`

#### Scenario: 路由用的權限碼都在註冊表內
- **WHEN** 路由用到的權限碼都在註冊表內
- **THEN** 檢查沒有錯誤

### Requirement: 稽核與合規權限點

權限註冊表 SHALL 有三個屬於 `core` 功能的權限碼：

- `audit.view`：查詢租戶的操作稽核紀錄。
- `data.export`：匯出租戶資料。
- `data.erase`：將聯絡人資料匿名化或刪除。`data.erase` MUST 以 `dependsOn` 宣告 `contact.view`。

在系統角色的預設權限中，這三個權限碼 SHALL 只授予 `admin`。

#### Scenario: 三個權限碼屬於 core 功能
- **WHEN** 系統載入權限註冊表
- **THEN** 註冊表含 `audit.view`、`data.export` 與 `data.erase`，三者的 `feature` 都是 `core`

#### Scenario: data.erase 依賴 contact.view
- **WHEN** 系統載入權限註冊表
- **THEN** `data.erase` 的 `dependsOn` 含 `contact.view`

#### Scenario: 預設只有 admin 有
- **WHEN** 讀取系統角色的預設權限
- **THEN** `admin` 有這三個權限碼，`supervisor` 與 `agent` 都沒有

