## ADDED Requirements

### Requirement: 租戶表啟用 Row-Level Security

系統 MUST 對每一張含 `tenantId` 的租戶表（見 `scripts/check-tenant-scoping.mjs` 的 `TENANT_MODELS`，並涵蓋同期 `add-tenant-audit-gdpr` 新增的租戶表）啟用 `ENABLE ROW LEVEL SECURITY` 與 `FORCE ROW LEVEL SECURITY`，並建立隔離 policy：讀取（`USING`）與寫入（`WITH CHECK`）皆 MUST 為 `tenantId = current_setting('app.current_tenant', true)::uuid`。當 session 變數 `app.current_tenant` 未設定（為 NULL）時，受 RLS 約束的連線 MUST 讀不到、也寫不進任何租戶表的列（fail-closed）。任何一張含 `tenantId` 的租戶表 MUST NOT 遺漏 RLS policy。

#### Scenario: 受約束連線設定當前租戶後只見自己的列

- **GIVEN** app_tenant（受 RLS 約束）連線，且當前交易內 `app.current_tenant` 設為租戶 A 的 UUID
- **WHEN** 對某租戶表執行 `SELECT`（不論 app 端 where 是否帶 tenantId）
- **THEN** 回傳的列 MUST 全部屬於租戶 A，MUST NOT 出現任何其他租戶的列

#### Scenario: 未設 session 變數時 fail-closed

- **GIVEN** app_tenant 連線，且 `app.current_tenant` 未設定（NULL）
- **WHEN** 對某租戶表執行 `SELECT`/`UPDATE`/`DELETE`
- **THEN** 系統 MUST 回傳 0 列 / 影響 0 列，MUST NOT 回傳或改動任何租戶的資料

#### Scenario: 寫入不能偽造成別租戶

- **GIVEN** app_tenant 連線，`app.current_tenant` 設為租戶 A
- **WHEN** 嘗試 `INSERT` 或 `UPDATE` 一列，其 `tenantId` 為租戶 B
- **THEN** 該寫入 MUST 因 `WITH CHECK` 失敗而被拒絕

#### Scenario: 每張租戶表都有 RLS 覆蓋

- **WHEN** 檢查資料庫中所有含 `tenantId` 欄位的表
- **THEN** 每一張 MUST 已 `ENABLE` 且 `FORCE ROW LEVEL SECURITY` 並具備隔離 policy；MUST NOT 有任何含 `tenantId` 的表未被覆蓋

### Requirement: 交易內注入租戶身分（連線池安全）

系統 MUST 以「交易內設定 local session 變數」的方式注入租戶身分：帶租戶身分的 DB 操作 MUST 包在單一交易內，並在交易起始以 `set_config('app.current_tenant', <tenantId>, true)`（即 `SET LOCAL` 語意，`is_local=true`）設定當前租戶，之後該交易內所有 query MUST 使用同一交易連線。租戶身分 MUST NOT 以 session 級（非 local）方式設定於受 RLS 約束的連線上，以避免連線歸還連線池後殘留造成跨租戶洩漏。傳入的 `tenantId` MUST 先驗證為合法 UUID，且 MUST 以參數化方式傳入（MUST NOT 字串拼接進 SQL）。

#### Scenario: 交易結束後 session 變數自動清除

- **GIVEN** 一條連線曾在某交易內為租戶 A 設定 `app.current_tenant`
- **WHEN** 該交易 `COMMIT` 或 `ROLLBACK`、連線歸還連線池、下一個為租戶 B 的操作取得同一條連線
- **THEN** 該連線的 `app.current_tenant` MUST NOT 殘留租戶 A 的值；租戶 B 的操作 MUST 只在自己的交易內重新設定並只見租戶 B 的資料

#### Scenario: 未經注入 helper 直接查詢受 RLS 約束

- **GIVEN** 某程式碼未透過注入 helper（未設 `app.current_tenant`）、直接以 app_tenant 連線查租戶表
- **THEN** 因 fail-closed，MUST 回 0 列 / 影響 0 列（MUST NOT 靜默回傳跨租戶資料）

#### Scenario: 惡意 tenantId 不能注入 SQL

- **GIVEN** 注入 helper 收到非合法 UUID 的 tenantId
- **THEN** 系統 MUST 拒絕（驗證失敗），MUST NOT 將其拼接進 SQL 執行

### Requirement: 合法跨租戶操作走 BYPASSRLS 連線

系統 MUST 提供一個具 `BYPASSRLS` 的 DB role 與對應連線，供合法且必要的跨租戶操作使用——即 `scripts/check-tenant-scoping.mjs` 的 `WHITELIST_FILES` 所列情境（平台層跨租戶統計、登入以 email 全域解析 agent、partner API key 以 keyPrefix 解析、scheduler 掃全租戶、建租戶（尚無 tenantId）、chatbox 以 publicKey 解析、trial gmail 去重、inbound-router）以及 RLS migration 本身。一般請求 MUST 使用受 RLS 約束（非 BYPASSRLS）的 app_tenant 連線。BYPASSRLS 連線 MUST 僅供白名單情境使用，MUST NOT 供一般租戶請求路徑使用。

#### Scenario: 登入以 email 全域解析不被 RLS 誤擋

- **GIVEN** 使用者以 email 登入，系統需在未知 tenantId 的情況下全域查該 email 對應的 agent
- **WHEN** 該查詢透過 BYPASSRLS 連線執行
- **THEN** 查詢 MUST 能跨租戶找到對應 agent，MUST NOT 因 RLS fail-closed 而查無

#### Scenario: 平台層跨租戶統計不被 RLS 誤擋

- **GIVEN** 平台 superuser 檢視跨租戶用量統計
- **WHEN** 統計查詢透過 BYPASSRLS 連線執行
- **THEN** MUST 能讀取多個租戶的資料以彙總

#### Scenario: 一般租戶請求不得使用 BYPASSRLS 連線

- **GIVEN** 一個帶租戶 JWT 的一般業務請求
- **WHEN** 其資料存取執行
- **THEN** MUST 走受 RLS 約束的 app_tenant 連線（經交易內注入），MUST NOT 走 BYPASSRLS 連線

### Requirement: 分階段上線與可回滾

RLS 上線 MUST 分階段：先完成 app 端注入機制且不改變 DB 行為，再 `ENABLE` 並以可觀察（不阻擋或 permissive）方式驗證所有正常流量都正確設定租戶身分，最後才 `FORCE` 真正強制（可按表分批）。系統 MUST 提供快速回滾手段：MUST 能在不重建 DB 結構的前提下停用 RLS（如將受約束連線暫時切至 BYPASSRLS role，或 `DISABLE ROW LEVEL SECURITY` / `DROP POLICY`）。app-layer 的租戶隔離（每 query 帶 `tenantId` 與 `check-tenant-scoping.mjs --strict`）MUST 保留，MUST NOT 因導入 RLS 而移除，使回滾後仍不裸奔。

#### Scenario: 觀察階段不阻擋正常流量

- **GIVEN** RLS 處於 ENABLE + 觀察（permissive / 監控）階段
- **WHEN** 正常租戶流量與白名單流量執行
- **THEN** 現有功能 MUST 照常運作；系統 SHOULD 能記錄「受約束連線觸及租戶表但未設 `app.current_tenant`」的漏接情況供修正

#### Scenario: 出問題時快速回滾且不裸奔

- **GIVEN** FORCE 後出現合法查詢被誤擋或租戶查詢異常回空
- **WHEN** 執行回滾（切 BYPASSRLS 連線或 DISABLE RLS）
- **THEN** RLS MUST 立即失效恢復現況；因 app-layer 隔離仍在，MUST NOT 產生跨租戶洩漏

### Requirement: RLS 隔離驗證

系統 MUST 具備對真實 Postgres（含 RLS role）的整合測試，同時涵蓋正向與負向：正向 MUST 證明綁定租戶 A 的連線讀不到、也改不到租戶 B 的資料（含 `deleteMany`/`updateMany` 不跨租戶影響）；負向 MUST 證明白名單的合法跨租戶查詢不被 RLS 誤擋。RLS policy 對每張含 `tenantId` 的租戶表的覆蓋 MUST 可被自動化檢查驗證（無遺漏）。

#### Scenario: 跨租戶讀取被隔離

- **GIVEN** DB 內有租戶 A 與租戶 B 的資料，測試以 app_tenant 連線綁定租戶 A
- **WHEN** 對各租戶表查詢與 `updateMany`/`deleteMany`
- **THEN** MUST 只讀到/只影響租戶 A 的列，租戶 B 的列 MUST 完全不受影響

#### Scenario: 合法跨租戶查詢通過

- **GIVEN** 白名單情境（如以 email 全域查 agent）以 BYPASSRLS 連線執行
- **THEN** MUST 能正常跨租戶取得結果

#### Scenario: 覆蓋完整性檢查

- **WHEN** 執行 RLS 覆蓋檢查
- **THEN** MUST 確認每一張含 `tenantId` 的租戶表都有 RLS policy；若有遺漏 MUST 使檢查失敗
