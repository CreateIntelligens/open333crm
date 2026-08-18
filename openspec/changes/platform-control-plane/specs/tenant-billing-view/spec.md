## ADDED Requirements

### Requirement: 租戶方案檢視為唯讀且只綁定自身租戶
系統 SHALL 提供租戶 admin 在自己 open333 站台內的「方案與用量」頁，僅供檢視自身租戶的方案、功能與用量。租戶 MUST NOT 登入平台層 control plane；所有讀取的 tenantId MUST 一律取自登入 token，不得由 request 參數指定；此頁 MUST NOT 提供任何修改平台方方案設定的能力。

#### Scenario: 租戶檢視自身方案頁
- **GIVEN** 一位租戶 admin 已用一般租戶 JWT 登入自己的 open333 站台
- **WHEN** 該 admin 開啟「方案與用量」頁並呼叫 `GET /me/plan`
- **THEN** 系統回傳其所屬租戶的方案名稱（Free/Pro/Enterprise）與方案含哪些功能
- **AND** 回應中所有資料的 tenantId 皆等於 token 內的 tenantId

#### Scenario: tenantId 一律來自 token 不受參數影響
- **GIVEN** 租戶 A 的 admin 持有租戶 A 的 token
- **WHEN** 該 admin 在請求中夾帶另一個租戶 B 的 tenantId 參數呼叫 `GET /me/plan` 或 `GET /me/usage`
- **THEN** 系統忽略請求中的 tenantId 參數，只回傳租戶 A 自己的資料
- **AND** 系統 MUST NOT 回傳任何屬於租戶 B 的方案或用量資料

#### Scenario: 租戶頁不得修改平台方方案設定
- **GIVEN** 租戶 admin 位於「方案與用量」頁
- **WHEN** 該 admin 嘗試變更方案或 entitlement 設定
- **THEN** 系統 MUST NOT 提供任何改方案/改 entitlement 的可寫入操作
- **AND** 頁面 MUST 以「洽詢平台方 / 升級引導」CTA 取代直接改方案的入口

#### Scenario: 租戶無法存取平台層端點
- **WHEN** 租戶 admin 以一般租戶 JWT 呼叫平台後台 `/admin/*` 端點
- **THEN** 系統 MUST 拒絕該請求（不授權存取 control plane）
- **AND** 租戶僅能存取 data-plane 的 `/me/*` 端點

### Requirement: 功能清單呈現已開功能與鎖定升級引導
系統 SHALL 在租戶方案頁依同一份 entitlement（`entitlement:tenant:{id}`）呈現功能清單。已開功能 MUST 正常列出；未開（entitlement 未含）的功能 MUST 顯示 🔒 鎖定態、標示需升級解鎖並提供洽詢入口。此清單的 feature 定義 MUST 來自平台 FEATURE registry，與平台後台同源，且鎖定態 MUST 與租戶權限頁一致。

#### Scenario: 已開功能正常列出
- **GIVEN** 某租戶 entitlement 含 feature X
- **WHEN** 該租戶 admin 檢視功能清單
- **THEN** 系統 MUST 將 feature X 列為已開啟狀態且不顯示鎖定標記

#### Scenario: 未開功能顯示鎖定與升級引導
- **GIVEN** 某租戶 entitlement 未含 feature Y
- **WHEN** 該租戶 admin 檢視功能清單
- **THEN** 系統 MUST 顯示 feature Y 並附帶 🔒 鎖定標記
- **AND** 系統 MUST 顯示「升級 Pro 解鎖」文案與洽詢入口
- **AND** feature Y 的鎖定態 MUST 與租戶權限頁對同一 feature 的呈現一致

#### Scenario: 功能清單與平台 registry 同源
- **GIVEN** 平台 FEATURE registry 定義了完整 feature 集合
- **WHEN** 系統組出租戶功能清單
- **THEN** 清單中的 feature 定義 MUST 全部來自平台 FEATURE registry
- **AND** 開啟/鎖定的判定 MUST 依 `entitlement:tenant:{id}` 這份 entitlement 資料，不另行定義

### Requirement: 本月用量唯讀摘要與額度提示
系統 SHALL 在租戶方案頁提供本月用量的唯讀摘要，數字 MUST 讀自 `DailyStat`/`AiUsage` 彙總，涵蓋 AI token 用量、訊息發送量與 AI 呼叫次數等關鍵數字。當方案設有額度（limits）時，系統 MUST 以「已用 X / 額度 Y（Z%）」形式顯示，並在接近上限時提示。此頁 MUST 為唯讀，不得提供修改用量或額度的操作。

#### Scenario: 顯示本月用量關鍵數字
- **GIVEN** 某租戶本月已累積 AI token 用量、訊息發送量與 AI 呼叫次數
- **WHEN** 該租戶 admin 呼叫 `GET /me/usage`
- **THEN** 系統 MUST 回傳讀自 `DailyStat`/`AiUsage` 彙總的本月累計數字
- **AND** 回傳資料 MUST 僅涵蓋該租戶自身用量

#### Scenario: 有額度時顯示用量比例
- **GIVEN** 某租戶方案對某項用量設有額度 Y 且本月已用 X
- **WHEN** 該租戶 admin 檢視用量摘要
- **THEN** 系統 MUST 以「已用 X / 額度 Y（Z%）」形式顯示，其中 Z 為 X÷Y 的百分比

#### Scenario: 接近上限時提示
- **GIVEN** 某租戶某項用量已達額度 Y 的接近上限門檻
- **WHEN** 該租戶 admin 檢視用量摘要
- **THEN** 系統 MUST 顯示接近上限的提示

### Requirement: 金額顯示依 AI key 來源決定
系統 SHALL 依租戶當前 AI key 來源決定用量頁是否顯示金額。當 AI key 來源為「平台提供」時，系統 MUST 顯示平台換算的成本/計費金額。當 AI key 來源為「自備（BYOK）」時，系統 MUST 只顯示 token 用量、MUST NOT 顯示任何金額，以避免誤導為向租戶收取 AI 費用。切換來源後金額顯示規則 MUST 即時反映。

#### Scenario: 平台提供 key 顯示金額
- **GIVEN** 某租戶 AI key 來源為「平台提供」
- **WHEN** 該租戶 admin 檢視本月用量摘要
- **THEN** 系統 MUST 顯示平台換算的成本/計費金額
- **AND** 系統 MUST 同時顯示對應的 token 用量

#### Scenario: BYOK 只顯示用量不顯示金額
- **GIVEN** 某租戶 AI key 來源為「自備（BYOK）」
- **WHEN** 該租戶 admin 檢視本月用量摘要
- **THEN** 系統 MUST 只顯示 token 用量
- **AND** 系統 MUST NOT 顯示任何 AI 費用金額

#### Scenario: 切換來源即時反映金額規則
- **GIVEN** 某租戶原本使用平台提供的 key 且用量頁顯示金額
- **WHEN** 該租戶 admin 將 AI key 來源切換為 BYOK
- **THEN** 系統 MUST 即時停止顯示金額，改為只顯示 token 用量

### Requirement: AI API key 來源自選為唯一自助設定
系統 SHALL 讓租戶 admin 在方案頁自選 AI key 來源為「平台提供」或「自己提供（BYOK）」，此為租戶頁唯一的自助可寫入設定。選「平台提供」時 MUST 走平台代設/env key 之 fallback。選「自己提供」時 MUST 將各 provider key 寫入 `TenantSettings.aiKeysEncrypted` 並設 `aiKeySource='tenant'`。key MUST 一律加密儲存並遮罩顯示，切換來源 MUST 更新 `AiUsage.keySource` 以正確歸屬計費。存取此設定 MUST 要求 `settings.manage` 權限。

#### Scenario: 選擇平台提供的金鑰
- **GIVEN** 具 `settings.manage` 權限的租戶 admin 位於 AI key 來源設定
- **WHEN** 該 admin 選擇「使用平台提供的金鑰」並呼叫 `PUT /me/ai-keys`
- **THEN** 系統 MUST 將該租戶 AI 呼叫改走平台代設/env key 的 fallback
- **AND** 系統 MUST 將 token 成本計入該租戶方案

#### Scenario: 選擇自己提供的金鑰並加密遮罩
- **GIVEN** 具 `settings.manage` 權限的租戶 admin 位於 AI key 來源設定
- **WHEN** 該 admin 選擇 BYOK 並填入某 provider 的 key 後呼叫 `PUT /me/ai-keys`
- **THEN** 系統 MUST 將 key 加密寫入 `TenantSettings.aiKeysEncrypted` 並設 `aiKeySource='tenant'`
- **AND** 之後 `GET /me/ai-keys` 回傳的 key MUST 為遮罩形式（如 `AIza…4b2c`），MUST NOT 回傳明文

#### Scenario: 切換來源更新計費歸屬
- **WHEN** 租戶 admin 切換 AI key 來源
- **THEN** 系統 MUST 更新後續 `AiUsage.keySource` 以反映新的計費歸屬

#### Scenario: 無權限者不得修改 key
- **GIVEN** 一位不具 `settings.manage` 權限的使用者
- **WHEN** 該使用者呼叫 `PUT /me/ai-keys`
- **THEN** 系統 MUST 拒絕該請求

### Requirement: 發起升級或加購申請
系統 SHALL 讓租戶 admin 從方案頁或功能鎖定態發起升級/加購申請。本階段的申請 MUST 以洽詢（聯絡我們）方式送出，MUST NOT 直接變更該租戶的方案或 entitlement。發起申請 MUST 帶入發起租戶的 tenantId（取自 token）與所欲升級/加購的標的，供平台方後續於 control plane 處理。

#### Scenario: 從鎖定功能發起升級申請
- **GIVEN** 某租戶 admin 看到某鎖定 feature 的「升級解鎖」引導
- **WHEN** 該 admin 點擊升級並送出洽詢申請
- **THEN** 系統 MUST 建立一筆帶有發起租戶 tenantId 與目標 feature 的洽詢申請
- **AND** 系統 MUST NOT 直接變更該租戶的方案或 entitlement

#### Scenario: 申請帶入正確租戶識別
- **GIVEN** 租戶 A 的 admin 持有租戶 A 的 token
- **WHEN** 該 admin 送出升級/加購申請
- **THEN** 申請中的 tenantId MUST 取自 token 且等於租戶 A
- **AND** 系統 MUST NOT 允許以其他租戶身分發起申請
