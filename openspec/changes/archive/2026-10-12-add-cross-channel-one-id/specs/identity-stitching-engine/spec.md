## ADDED Requirements

### Requirement: 綁定代碼歸戶來源 (Binding Code Stitch Source)
`StitchSource` SHALL 包含 `BINDING_CODE`。經綁定代碼兌換成功的渠道身分 SHALL 以 `BINDING_CODE`、信心值 1.0 寫入 `IdentityMap`，並視為已驗證的歸戶，不需產生合併建議即自動合併。

#### Scenario: 兌換後寫入 IdentityMap
- **WHEN** 顧客在 IG 兌換 LINE 發出的綁定代碼成功
- **THEN** `IdentityMap` SHALL 有一筆 `channelType = THREADS`、該 IGSID、`source = BINDING_CODE`、`confidence = 1.0`、指向合併後聯絡人的紀錄

#### Scenario: 解除後撤銷對應
- **WHEN** 該次綁定被解除
- **THEN** 該 IGSID 的 `IdentityMap` 紀錄 SHALL 指回被恢復的聯絡人

### Requirement: 合併建議核准須在租戶邊界內執行
核准合併建議 SHALL 驗證建議屬於操作者的租戶，並透過統一合併引擎（來源 `SUGGESTION`）在租戶綁定的交易中執行。

#### Scenario: 核准他租戶的建議
- **WHEN** A 租戶的管理員嘗試核准 B 租戶的合併建議 id
- **THEN** 系統 SHALL 回傳找不到，且不進行任何合併
