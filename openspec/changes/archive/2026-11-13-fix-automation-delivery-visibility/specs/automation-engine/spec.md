## MODIFIED Requirements

### Requirement: Send Material Action References An Existing Material
When an automation rule is created, or updated with new actions, every `send_material` action SHALL have a `materialId` that refers to an active material of the same tenant. Otherwise the system SHALL respond 400 and SHALL NOT save the rule.

When the conditions of the rule require `conversation.channelType` to equal a value (an `equal` condition in the top-level `all` group or in a nested `all` group), the `channelType` of every `send_material` material SHALL equal that value, compared without case. Otherwise the system SHALL respond 400 with code `VALIDATION_ERROR`, a message that names the channel of the material and the channel of the rule, and `details.issues[0].path` equal to `actions`, and SHALL NOT save the rule. The system SHALL run this check on create, and on update when the request changes `conditions` or `actions`. A condition inside an `any` group SHALL NOT trigger the check. An update that changes only the name, the priority or the active state SHALL NOT run the check.

#### Scenario: Material ID is not a UUID
- **WHEN** a user creates a keyword reply whose `send_material` action has `materialId = "not-a-uuid"`
- **THEN** the system SHALL respond 400 and SHALL NOT create the rule

#### Scenario: Material does not exist
- **WHEN** a user creates a rule whose `send_material` action refers to a UUID with no material in the tenant
- **THEN** the system SHALL respond 400 and SHALL NOT create the rule

#### Scenario: Material of another tenant
- **WHEN** a user creates a rule whose `send_material` action refers to an active material of another tenant
- **THEN** the system SHALL respond 400

#### Scenario: Existing active material
- **WHEN** a user creates a rule whose `send_material` action refers to an active material of the same tenant
- **THEN** the rule SHALL be created

#### Scenario: Material of another channel than the channel condition
- **WHEN** a user creates a rule with the condition `conversation.channelType equal LINE` and a `send_material` action whose material has `channelType = "fb"`
- **THEN** the system SHALL respond 400 with code `VALIDATION_ERROR`, the message names Facebook and LINE, `details.issues[0].path` is `actions`, and the rule SHALL NOT be created

#### Scenario: Material of the same channel in another case
- **WHEN** a user creates a rule with the condition `conversation.channelType equal LINE` and a material with `channelType = "line"`
- **THEN** the rule SHALL be created

#### Scenario: Channel condition inside an any group
- **WHEN** a user creates a rule whose only channel condition is inside an `any` group, with a material of another channel
- **THEN** the rule SHALL be created

#### Scenario: Update changes only the conditions
- **GIVEN** a rule with the condition `conversation.channelType equal FB` and a Facebook material
- **WHEN** a user updates only `conditions` to `conversation.channelType equal LINE`
- **THEN** the system SHALL respond 400 and the stored conditions SHALL stay `equal FB`

#### Scenario: Update changes only the name or the active state
- **GIVEN** a rule whose channel condition and material channel differ
- **WHEN** a user updates only the name, deactivates the rule, or activates it again
- **THEN** each update SHALL succeed

### Requirement: 關鍵字回覆頁保留規則上的其他動作與條件

「關鍵字回覆」頁儲存時 SHALL 只更換規則中的第一個「傳送素材」與第一個「發送優惠券」動作與關鍵字設定，並確保有條件「對話渠道等於規則的渠道」；規則上的其他動作（例如加標籤、第二個以後的同類動作）與其他條件 SHALL 原樣保留在原位。規則原本沒有傳送素材而這次加上時，素材 SHALL 排在第一個發送優惠券之前。規則傳送的素材不是規則渠道的啟用中素材（其他渠道、已刪除或已停用）且沒有改選時，這一頁 SHALL 擋下儲存並顯示原因，列表也 SHALL 標示原因；不可加上渠道條件讓規則靜默失效。

#### Scenario: 編輯含其他動作的關鍵字回覆

- **GIVEN** 關鍵字規則的動作為傳送 LINE 素材與加標籤「詢價」，另有條件「聯絡人標籤包含 VIP」
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則仍有加標籤「詢價」動作與「聯絡人標籤包含 VIP」條件，並多了條件「對話渠道等於 LINE」

#### Scenario: 傳送 Facebook 素材的規則不能在這頁存檔

- **GIVEN** 在一般自動化規則建立的關鍵字規則，條件為「對話渠道等於 LINE」，傳送的是 Facebook 素材
- **WHEN** 管理員在關鍵字回覆頁只改了關鍵字就儲存
- **THEN** 系統不儲存，顯示「這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯」，規則沒有被修改
- **AND** 列表的回覆素材欄標示「Facebook 素材，與規則渠道不符」並連到自動化規則編輯

#### Scenario: 素材已刪除或已停用的規則要改選素材才能存檔

- **GIVEN** 關鍵字規則傳送的素材已刪除或已停用
- **WHEN** 管理員沒有改選素材就儲存
- **THEN** 系統不儲存並說明原因；改選規則渠道的素材或拿掉素材只發券後可以儲存

#### Scenario: 編輯含發券動作的關鍵字回覆

- **GIVEN** 關鍵字規則的動作為傳送素材與發送優惠券
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則仍有發送優惠券動作，`couponId` 不變

#### Scenario: 編輯 Facebook 的關鍵字回覆

- **GIVEN** 關鍵字規則有條件「對話渠道等於 FB」，傳送 Facebook 素材
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則的條件仍只有一個「對話渠道等於 FB」，沒有被加上 LINE 條件

#### Scenario: 有兩個傳送素材的規則

- **GIVEN** 關鍵字規則的動作依序為傳送素材 m-1、加標籤「詢價」、傳送素材 m-2
- **WHEN** 管理員在關鍵字回覆頁把素材改成 m-3 並儲存
- **THEN** 規則的動作依序為傳送素材 m-3、加標籤「詢價」、傳送素材 m-2

#### Scenario: 只發券的規則加上素材

- **GIVEN** 關鍵字規則的動作依序為加標籤、發送優惠券、傳送通知
- **WHEN** 管理員在關鍵字回覆頁選了素材 m-1 並儲存
- **THEN** 規則的動作依序為加標籤、傳送素材 m-1、發送優惠券、傳送通知

## ADDED Requirements

### Requirement: 自動化送出失敗的紀錄讓對話浮到收件匣上方

workers 執行自動化的送出（傳送訊息、傳送素材、發券）失敗而在對話寫入失敗紀錄時，系統 SHALL 把該對話的 `lastMessageAt` 更新為這則紀錄的時間，並推送 `message.new`，推送的訊息時間 SHALL 與 `lastMessageAt` 相同。

#### Scenario: 傳送訊息被渠道拒收
- **WHEN** 關鍵字規則的 `send_message` 被 LINE 拒收
- **THEN** 對話多一則 `metadata.deliveryFailed` 為 true 的系統訊息，對話的 `lastMessageAt` 等於這則訊息的 `createdAt`，`message.new` 推送的 `createdAt` 相同

#### Scenario: 發券產生票券連結失敗
- **WHEN** 自動化發券在送出前產生票券連結失敗
- **THEN** 對話多一則 `metadata.deliveryFailed` 為 true 的系統訊息，對話的 `lastMessageAt` 等於這則訊息的 `createdAt`

### Requirement: 渠道已停用時自動化送出留下看得到的紀錄

workers 執行自動化的送出時，對話存在但對話的渠道已停用，系統 SHALL NOT 呼叫渠道外掛，SHALL 在該對話寫入一則 `metadata.deliveryFailed` 為 true、`deliveryError` 說明渠道已停用的系統訊息。發券的送出由送出層寫這則紀錄，發券 SHALL NOT 再寫第二則。

#### Scenario: 渠道停用時傳送訊息
- **WHEN** 規則在渠道已停用的對話執行 `send_message`
- **THEN** 渠道外掛沒有被呼叫，對話多一則 `deliveryError` 含「渠道已停用」的系統訊息，對話的 `lastMessageAt` 已更新

#### Scenario: 渠道停用時發券
- **WHEN** 規則在渠道已停用的對話執行 `issue_coupon`
- **THEN** 券被作廢，對話只多一則系統訊息，帶 `metadata.deliveryFailed` 與 `metadata.couponIssueFailed`

### Requirement: 自動化動作失敗寫進規則執行紀錄

workers 執行一條規則的動作時，`send_message` 或 `send_material` 沒有送出（找不到對話、渠道停用、渠道拒收、找不到素材、素材渠道與對話不符），或動作執行時發生錯誤，系統 SHALL 把該動作標成失敗，並在這次執行結束後寫一筆 `automation_logs`：`tenantId` 與 `ruleId` 為規則的租戶與 id，`success` 為 false，`errorMsg` 列出失敗的動作與原因，`actionsRan` 列出每個動作的序號、類型、結果（`ok`、`failed`、`duplicate`）與失敗原因。所有動作都成功時 SHALL NOT 寫這筆紀錄。

#### Scenario: 對話不存在時傳送訊息
- **WHEN** 規則執行 `send_message`，事件的對話已不存在
- **THEN** 沒有呼叫渠道外掛，`automation_logs` 多一筆 `success = false`、`errorMsg` 含「找不到對話」、`actionsRan = [{ index: 0, type: "send_message", status: "failed", error: "找不到對話" }]` 的紀錄

#### Scenario: 對話不存在時傳送素材
- **WHEN** 規則執行 `send_material`，事件的對話已不存在
- **THEN** `automation_logs` 多一筆 `success = false` 的紀錄，`actionsRan` 的 `send_material` 動作為 `failed`

#### Scenario: 動作都成功
- **WHEN** 規則的 `send_message` 與 `send_material` 都送出成功
- **THEN** 沒有新增 `automation_logs`，兩個動作的結果都是 `ok`
