## ADDED Requirements

### Requirement: 建立工單時優先套用預設政策

建立工單時若沒有指定 `slaPolicyId`，系統 SHALL 在該租戶、該優先級的政策中，優先套用 `isDefault` 為 `true` 的政策；沒有預設政策時，套用最早建立的政策。

#### Scenario: 同優先級有多條政策時套用預設
- **WHEN** 租戶的 HIGH 優先級有政策 A（較早建立、不是預設）與政策 B（預設），建立 HIGH 工單時沒有指定政策
- **THEN** 工單的 SLA 政策是 B，到期時間依 B 的解決時限計算

#### Scenario: 沒有預設政策時套用最早建立的
- **WHEN** HIGH 優先級有政策 A（較早建立）與 C，兩條都不是預設，建立 HIGH 工單時沒有指定政策
- **THEN** 工單的 SLA 政策是 A

### Requirement: SLA 政策名稱不可重複

工單以政策名稱記錄套用的政策，所以同一租戶的政策名稱 SHALL 不重複。建立或改名成已存在的名稱時，系統 SHALL 回 HTTP 409，`error.code` 是 `DUPLICATE`，不建立也不修改政策。

#### Scenario: 建立同名政策被拒
- **WHEN** 租戶已有名為「VIP」的政策，有 `sla.manage` 的成員建立另一條名為「VIP」的政策
- **THEN** 系統回 HTTP 409，`error.code` 是 `DUPLICATE`

### Requirement: 政策改名時工單繼續計時

政策改名時，系統 SHALL 在同一個交易內，把本租戶工單上記錄的舊名稱改成新名稱，讓這些工單繼續受 SLA 監控。

#### Scenario: 改名後舊工單記錄新名稱
- **WHEN** 工單 K 套用政策「標準」，有 `sla.manage` 的成員把政策改名為「標準服務」
- **THEN** 工單 K 的 SLA 政策是「標準服務」

### Requirement: 使用中的政策不能刪除

政策仍被未結案（狀態不是 `RESOLVED` 或 `CLOSED`）的工單使用時，系統 SHALL 拒絕刪除，回 HTTP 409，`error.code` 是 `SLA_POLICY_IN_USE`，`error.details.openCaseCount` 是這些工單的數量，政策仍然存在。

#### Scenario: 有未結案工單的政策不能刪除
- **WHEN** 政策「標準」有 2 張未結案的工單使用，有 `sla.manage` 的成員刪除這條政策
- **THEN** 系統回 HTTP 409，`error.code` 是 `SLA_POLICY_IN_USE`，`error.details.openCaseCount` 是 2，政策仍然存在

#### Scenario: 只有已結案工單的政策可以刪除
- **WHEN** 政策「標準」只被已結案的工單使用，有 `sla.manage` 的成員刪除這條政策
- **THEN** 系統回 HTTP 200，政策不再存在
