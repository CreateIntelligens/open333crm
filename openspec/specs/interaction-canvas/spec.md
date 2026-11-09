## Purpose
定義互動流程畫布（Canvas）：流程節點的執行引擎、依顧客互動時間窗口排程的智慧發送，以及呼叫外部 API 取得資料的節點。

## Requirements

### Requirement: 節點執行引擎 (Node Execution Engine)
系統 SHALL 具備一套能解析 JSON 節點並按順序執行的引擎。引擎必須支援「等待 (Wait)」節點，且能處理非同步事件。

#### Scenario: 執行簡單的訊息發送流
- **WHEN** 聯繫人觸發流程且當前節點為「發送訊息」
- **THEN** 系統必須呼叫對應通路的 API 發送訊息，並將聯繫人狀態更新至下一個節點

### Requirement: 智慧時間窗口 (Smart Window Scheduling)
系統 SHALL 允許在發送訊息前檢查用戶的「智慧窗口」。若當前時間為深夜（預設 22:00~08:00），發送任務必須推遲至下一個活躍時段。

#### Scenario: 避開深夜發送
- **WHEN** 任務預定在凌晨 02:00 執行且開啟了智慧窗口
- **THEN** 系統必須將執行時間推遲至當天早上 09:00

### Requirement: API 資料抓取節點 (API Fetch Node)
系統 SHALL 支援在畫布中呼叫外部 HTTP API，並將回傳的 JSON 資料映射至流程變數中。

#### Scenario: 抓取折價券碼
- **WHEN** 流程執行到 API Fetch 節點
- **THEN** 系統發送 POST 請求至指定 URL，並將回傳的 `coupon_code` 存入 `{{ext.coupon_code}}` 變數中

### Requirement: 流程管理只作用在本租戶的流程
流程的查詢、修改、啟用、分析與執行紀錄 SHALL 只作用在操作者租戶的流程。流程不存在或屬於另一個租戶時，系統 SHALL 回 404，而且 MUST NOT 修改任何流程。

#### Scenario: 列出流程
- **WHEN** A 租戶的成員呼叫 `GET /api/v1/canvas`，A、B 兩個租戶都有流程
- **THEN** 回應只包含 A 租戶的流程，`total` 只計算 A 租戶的流程

#### Scenario: 讀取另一個租戶的流程
- **WHEN** A 租戶的成員以 B 租戶的流程 id 呼叫 `GET /api/v1/canvas/:id`、`GET /api/v1/canvas/:id/analytics` 或 `GET /api/v1/canvas/:id/executions`
- **THEN** 三個端點都回 404

#### Scenario: 修改另一個租戶的流程
- **WHEN** A 租戶的成員以 B 租戶的流程 id 呼叫 `PATCH /api/v1/canvas/:id` 或 `POST /api/v1/canvas/:id/activate`
- **THEN** 系統回 404，B 租戶的流程的名稱與狀態不變

#### Scenario: 流程 id 格式錯誤
- **WHEN** 成員以不是 UUID 的值當作 `:id` 呼叫任一個流程端點
- **THEN** 系統回 400 `VALIDATION_ERROR`

### Requirement: 執行紀錄依執行狀態篩選
`GET /api/v1/canvas/:id/executions` 的 `status` 參數 SHALL 接受 execution 的狀態 `RUNNING`、`WAITING`、`COMPLETED`、`FAILED`，回應 SHALL 只包含這個狀態的 execution。其他值 SHALL 回 400 `VALIDATION_ERROR`。

#### Scenario: 依執行狀態篩選
- **WHEN** 流程有 `COMPLETED` 與 `FAILED` 的 execution，成員以 `status=COMPLETED` 呼叫執行紀錄
- **THEN** 系統回 200，回應只包含 `COMPLETED` 的 execution，`total` 只計算這些 execution

#### Scenario: 篩選值不是執行狀態
- **WHEN** 成員以 `status=ACTIVE` 呼叫執行紀錄
- **THEN** 系統回 400 `VALIDATION_ERROR`

### Requirement: 手動觸發只接受本租戶啟用中的流程與本租戶的聯絡人
`POST /api/v1/canvas/:id/trigger` SHALL 先檢查流程屬於操作者的租戶、流程狀態是 `ACTIVE`，以及聯絡人屬於操作者的租戶。任一項檢查失敗時，系統 MUST NOT 建立 execution，MUST NOT 開始執行流程。

#### Scenario: 觸發啟用中的流程
- **WHEN** A 租戶的成員以 A 租戶 `ACTIVE` 的流程與 A 租戶的聯絡人呼叫觸發
- **THEN** 系統回 202，回應帶 `executionId`；這筆 execution 屬於 A 租戶，狀態是 `RUNNING`

#### Scenario: 觸發另一個租戶的流程
- **WHEN** A 租戶的成員以 B 租戶的流程 id 呼叫觸發
- **THEN** 系統回 404，A、B 兩個租戶都沒有新的 execution

#### Scenario: 觸發不存在的流程
- **WHEN** 成員以不存在的流程 id 呼叫觸發
- **THEN** 系統回 404，沒有新的 execution

#### Scenario: 觸發草稿或封存的流程
- **WHEN** 成員觸發本租戶狀態是 `DRAFT` 或 `ARCHIVED` 的流程
- **THEN** 系統回 409 `FLOW_NOT_ACTIVE`，沒有新的 execution

#### Scenario: 聯絡人屬於另一個租戶
- **WHEN** A 租戶的成員以 A 租戶 `ACTIVE` 的流程與 B 租戶的聯絡人 id 呼叫觸發
- **THEN** 系統回 404，沒有新的 execution

#### Scenario: 聯絡人不存在
- **WHEN** 成員以不存在的聯絡人 id 呼叫觸發
- **THEN** 系統回 404，沒有新的 execution

#### Scenario: 沒有權限
- **WHEN** 沒有 `canvas.use` 的成員呼叫觸發
- **THEN** 系統回 403，沒有新的 execution

### Requirement: 手動觸發在 execution commit 之後才開始執行
手動觸發 SHALL 在 execution 寫入的交易 commit 之後，才開始執行流程。每次觸發 SHALL 最多開始執行一次。交易 rollback 時，系統 MUST NOT 開始執行。回應 SHALL 在開始執行之後送出，但 MUST NOT 等待流程執行完。

開始執行之前處理程序結束時，execution 停在 `RUNNING`，之後沒有程式會再執行它。這是已知的限制。

#### Scenario: commit 之後開始執行
- **WHEN** 手動觸發的交易 commit
- **THEN** 流程引擎以這筆 execution 的 id 開始執行一次，而且開始時讀得到這筆 execution

#### Scenario: rollback 時不開始執行
- **WHEN** 手動觸發的交易在 execution 寫入之後 rollback
- **THEN** 流程引擎沒有開始執行，資料庫沒有這筆 execution

#### Scenario: 流程執行失敗不影響回應
- **WHEN** 流程引擎開始執行之後失敗
- **THEN** 觸發的回應仍是 202，失敗寫進 log
