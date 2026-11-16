## MODIFIED Requirements

### Requirement: 自動化發券記錄發券的規則

規則發券 SHALL 以 design D32 的代碼記錄發放方式（關鍵字觸發為 `keyword`、加入好友為 `follow`、其他事件為 `automation`），`issuedRefId` 為規則 id，來源名稱為發券當下的規則名稱。序號明細 SHALL 以來源名稱為上行、發放方式為下行顯示。舊資料的 `keyword.matched` SHALL 顯示為「關鍵字」，其他舊的觸發事件名稱（#347～#364 期間 workers 寫入的自動化事件名稱）顯示為「自動化」，不顯示「其他方式」。整合程式自訂的代碼即使含「.」也不是舊事件名稱，SHALL 顯示「其他方式」。

#### Scenario: 關鍵字規則發券的歸因

- **WHEN** 規則「秋季領券」因關鍵字發出一張券
- **THEN** 這張券的 issuedVia 為 `keyword`、issuedRefId 為規則 id、來源名稱為「秋季領券」
- **AND** 序號明細上行顯示「秋季領券」，下行顯示「關鍵字」

#### Scenario: 規則改名後仍顯示當下名稱

- **GIVEN** 規則「秋季領券」發出一張券
- **WHEN** 規則改名為「冬季領券」
- **THEN** 這張券的序號明細仍顯示「秋季領券」

#### Scenario: 舊資料的觸發事件名稱

- **GIVEN** 一張券的 issuedVia 為 `keyword.matched`，另一張為 `message.received`
- **WHEN** 管理者查看序號明細
- **THEN** 前者的發放方式顯示「關鍵字」，後者顯示「自動化」

#### Scenario: 含點的自訂代碼不顯示為自動化

- **GIVEN** 一張券的 issuedVia 為 `partner.sync`
- **WHEN** 管理者查看序號明細
- **THEN** 發放方式顯示「其他方式」

### Requirement: 發券 API 不預設為對話發券

`POST /api/v1/coupons/:id/issue` SHALL 不送訊息；沒有帶發放方式時記為 `api`。帶入系統保留的發放方式時 SHALL 回 400（design D31）。系統保留的是 `inbox`、`keyword`、`follow`、`automation`、`broadcast`、`batch`、`public_link`，以及舊的觸發事件名稱（例如 `keyword.matched`、`message.received`）。其他符合格式的自訂代碼，即使含「.」，SHALL 照常發券並記下這個發放方式。

#### Scenario: 沒有帶發放方式

- **WHEN** 整合程式呼叫發券 API 沒有帶 issuedVia
- **THEN** 發出的券發放方式為「API」，不是「對話發券」

#### Scenario: 冒用對話發券

- **WHEN** 呼叫發券 API 帶 issuedVia 為 `inbox`
- **THEN** 系統回 400，不發券

#### Scenario: 冒用舊的觸發事件名稱

- **WHEN** 呼叫發券 API 帶 issuedVia 為 `message.received`
- **THEN** 系統回 400，不發券

#### Scenario: 含點的自訂發放方式

- **WHEN** 整合程式呼叫發券 API 帶 issuedVia 為 `partner.sync`
- **THEN** 系統發券，券的發放方式記為 `partner.sync`
