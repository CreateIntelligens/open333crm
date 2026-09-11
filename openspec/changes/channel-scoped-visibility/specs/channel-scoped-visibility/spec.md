## ADDED Requirements

### Requirement: 可見渠道解析

系統 SHALL 針對每個 agent 解析其「可見渠道集合」，規則為：agent 所屬的所有 team（`AgentTeamMember`）→ 這些 team 被授權的渠道（`ChannelTeamAccess`）→ 去重後的 channelId 集合。持有「全渠道可見」權限（`channel.view_all`）的 agent SHALL 視為可見本租戶全部渠道，不受上述限制。解析 MUST 在當前租戶邊界內（RLS session 之上）進行。

#### Scenario: 分店 agent 只解析到被授權渠道
- **WHEN** agent 屬於 team「分店A」，該 team 經 ChannelTeamAccess 被授權渠道 CH-A
- **THEN** 該 agent 的可見渠道集合為 {CH-A}，不含其他分店渠道

#### Scenario: 屬多團隊取聯集
- **WHEN** agent 同時屬於 team「分店A」（授權 CH-A）與 team「分店B」（授權 CH-B）
- **THEN** 可見渠道集合為 {CH-A, CH-B}

#### Scenario: 總店角色可見全部
- **WHEN** agent 持有 `channel.view_all` 權限
- **THEN** 可見渠道集合為本租戶全部渠道，忽略 team 授權限制

### Requirement: 列表查詢套用渠道過濾

收件匣、對話列表、案件列表等 list 類查詢 SHALL 僅回傳「可見渠道集合」內渠道的資料。不在可見集合內的資料 MUST 不出現在結果中。

#### Scenario: 對話列表只含可見渠道
- **WHEN** 分店A agent（可見 {CH-A}）查詢對話列表，而系統存在 CH-A 與 CH-B 的對話
- **THEN** 結果只含 CH-A 的對話，不含 CH-B

#### Scenario: 案件列表只含可見渠道
- **WHEN** 分店A agent 查詢案件列表
- **THEN** 只回傳關聯渠道屬於可見集合的案件

### Requirement: 單筆讀取與操作的存取檢查

對單一對話／案件的讀取、指派、回覆等操作 SHALL 先檢查該資源的渠道是否在當前 agent 的可見渠道集合內；不在集合內 MUST 拒絕（讀取回 404，操作回 403），且不得洩漏該資源存在與否以外的資訊。

#### Scenario: 讀取未授權渠道對話被拒
- **WHEN** 分店A agent（可見 {CH-A}）以 ID 直接讀取 CH-B 的對話
- **THEN** 回傳 404（資源不可見），不回傳對話內容

#### Scenario: 對未授權渠道對話操作被拒
- **WHEN** 分店A agent 嘗試回覆或指派 CH-B 的對話
- **THEN** 回傳 403，操作不執行

### Requirement: Fail-closed 預設

當 agent 既未持有 `channel.view_all`、其所屬 team 亦無任何 ChannelTeamAccess 授權時，其可見渠道集合 SHALL 為空，列表結果 MUST 為空，而非退回「可見全部」。

#### Scenario: 無授權且非總店 → 空收件匣
- **WHEN** agent 不屬任何有渠道授權的 team，且無 `channel.view_all`
- **THEN** 其對話／案件列表為空（不是全部）

### Requirement: 與即時推播一致

REST 查詢的渠道可見性 SHALL 與 socket 即時推播的授權判斷使用同一「可見渠道」事實來源，兩者結果 MUST 一致：REST 看不到的渠道，其 socket 事件亦不得推送給該 agent。

#### Scenario: socket 與列表一致
- **WHEN** 分店A agent 不可見 CH-B，CH-B 產生新訊息
- **THEN** 該 agent 既不會在列表看到、也不會收到該訊息的 socket 推播

### Requirement: 進站訊息分派不受 agent 可見性限制

渠道訊息進站（inbound webhook 分派、建立對話／訊息）SHALL 依渠道本身設定處理，MUST NOT 因「無 agent 具該渠道可見性」而被丟棄；agent 可見性僅作用於「讀取／列表／操作」階段。

#### Scenario: 進站訊息正常建立
- **WHEN** CH-B 收到外部訊息，而當下沒有任何在線 agent 具 CH-B 可見性
- **THEN** 訊息仍正常寫入並建立對話，稍後具 CH-B 可見性的 agent 可讀取
