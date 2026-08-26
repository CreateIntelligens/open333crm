## ADDED Requirements

### Requirement: 稽核與合規權限點
權限點 registry SHALL 新增三個 `resource.action` 權限碼，歸屬 feature `core`、分群「稽核與合規」：`audit.view`（檢視租戶操作稽核）、`data.export`（發起資料可攜匯出與下載）、`data.erase`（對聯絡人執行匿名化或硬刪）。`data.erase` MUST 宣告 `dependsOn: ['contact.view']`。三個權限點預設 SHALL 僅授予 ADMIN 角色。

#### Scenario: 新權限點納入 registry
- **WHEN** 系統載入權限點 registry
- **THEN** registry 包含 `audit.view`、`data.export`、`data.erase` 三碼，且每碼 `feature=core`

#### Scenario: data.erase 依賴 contact.view
- **WHEN** 角色被指派 `data.erase`
- **THEN** 系統依 `dependsOn` 機制確保 `contact.view` 一併具備（勾選連動）

#### Scenario: 預設僅 ADMIN 具備
- **WHEN** 檢視預設角色種子
- **THEN** 三個新權限點僅出現在 ADMIN 角色，SUPERVISOR 與 AGENT 預設不具備
