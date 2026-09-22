# inbound-contact-resolution Specification

## Purpose

將 inbound webhook 攜帶的渠道 UID 解析為系統聯絡人的行為契約。涵蓋既有身分命中、新 UID 首次進站，以及失敗時的可觀測性要求。

## Requirements

### Requirement: 新 UID 首次進站必須建立聯絡人並落地訊息

當 inbound webhook 通過驗簽並解析出訊息，且其 `contactUid` 在該租戶／渠道下尚無對應的身分綁定與 IdentityMap 記錄時，系統 SHALL 完成聯絡人建立、對話建立與訊息落地，使該訊息出現在前台收件匣。

#### Scenario: 全新使用者第一次傳訊息

- **GIVEN** 租戶啟用中、渠道啟用中、webhook 驗簽通過
- **AND** 該 `contactUid` 在系統中不存在任何身分綁定或 IdentityMap 記錄
- **WHEN** 該使用者傳送一則文字訊息
- **THEN** 系統建立對應的聯絡人
- **AND** 建立對話並將訊息落地
- **AND** 該訊息可於前台收件匣查得

#### Scenario: 已綁定身分的使用者傳訊息

- **GIVEN** 該 `contactUid` 已有身分綁定
- **WHEN** 該使用者傳送訊息
- **THEN** 訊息歸戶至既有聯絡人，不建立重複聯絡人

### Requirement: UID 解析須在租戶邊界內進行

解析渠道 UID 的資料存取 SHALL 使用呼叫端傳入的、已綁定租戶的 Prisma executor，不得依賴套件層級的全域 Prisma 單例。

#### Scenario: 跨租戶相同 UID 不互相污染

- **GIVEN** 兩個租戶各自存在相同字面值的 `contactUid`
- **WHEN** 其中一個租戶收到該 UID 的 inbound 訊息
- **THEN** 僅解析到該租戶自己的聯絡人
- **AND** 不讀取或寫入另一租戶的資料

### Requirement: 解析失敗不得靜默丟棄訊息

當 UID 解析或後續落地流程拋出例外時，系統 SHALL 將錯誤（含例外訊息與堆疊）輸出至容器標準輸出，使其可經由容器 log 檢視。

#### Scenario: 解析過程拋出例外

- **GIVEN** inbound 訊息處理過程中發生未預期例外
- **WHEN** 例外被最外層捕捉
- **THEN** 錯誤訊息與堆疊寫入標準輸出
- **AND** 該筆錯誤可在不進入容器檔案系統的情況下被查得

#### Scenario: webhook 回應不因處理失敗而改變

- **GIVEN** 訊息處理階段發生例外
- **WHEN** 平台端等待 webhook 回應
- **THEN** 仍回傳 200（維持既有 fire-and-forget 行為，避免平台重送風暴）
- **AND** 失敗事實透過標準輸出的錯誤 log 呈現
