## Purpose
定義跨渠道身分整合引擎：處理 LIFF 登入時的身分碰撞，以及由 AI 產生聯絡人合併建議。進站訊息依渠道 UID 找聯絡人的規則見 `inbound-contact-resolution`；管理員手動合併聯絡人見 `contact-management`。

## Requirements

### Requirement: LIFF 身分碰撞 (LIFF Identity Collision)
系統 SHALL 在 LIFF 頁面載入時，自動比對瀏覽器 Cookie 與 LINE UID。若發現匹配的已知 Email/手機，必須自動建立關聯。

#### Scenario: 自動綁定 LINE 與 Email
- **WHEN** 已留過 Email 的用戶從 FB 連結點入 LINE LIFF 頁面
- **THEN** 系統偵測到 Cookie 中的 Email，並自動將當前的 LINE UID 與該 Email 聯繫人合併

### Requirement: AI 合併建議 (AI Merge Suggestions)
當系統發現多個聯繫人具備高度相似的資料（如：手機號碼相同但通路不同）時，系統 SHALL 產生一條合併建議。

#### Scenario: 提示管理員合併
- **WHEN** 系統偵測到兩個不同通路的聯繫人擁有相同手機號碼
- **THEN** 系統在管理後台顯示「身分合併建議」，等待管理員手動核准

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
