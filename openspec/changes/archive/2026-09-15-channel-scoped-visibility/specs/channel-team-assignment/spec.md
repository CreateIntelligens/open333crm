## ADDED Requirements

### Requirement: 渠道與團隊指派

系統 SHALL 提供將渠道指派給團隊、以及撤銷指派的能力，資料以 `ChannelTeamAccess`（`channelId × teamId`）持久化於資料庫。指派 MUST 在當前租戶邊界內進行，且 channel 與 team MUST 同屬一租戶。

#### Scenario: 指派渠道給團隊
- **WHEN** 管理員把渠道 CH-A 指派給 team「分店A」
- **THEN** 建立一筆 ChannelTeamAccess（CH-A, 分店A），該 team 成員即取得 CH-A 可見性

#### Scenario: 重複指派不產生重複列
- **WHEN** 對已存在的（CH-A, 分店A）再次指派
- **THEN** 系統以 upsert 處理，不新增重複列（`@@id([channelId, teamId])` 保證唯一）

#### Scenario: 撤銷指派
- **WHEN** 管理員撤銷（CH-A, 分店A）指派
- **THEN** 該筆 ChannelTeamAccess 移除，分店A 成員（若無其他來源）失去 CH-A 可見性

#### Scenario: 跨租戶指派被拒
- **WHEN** 嘗試把租戶X 的渠道指派給租戶Y 的團隊
- **THEN** 操作被拒（RLS / 租戶檢查擋下）

### Requirement: 指派資料的連動清理

刪除渠道或刪除團隊時，其相關的 `ChannelTeamAccess` 列 SHALL 一併移除（`onDelete: Cascade`），MUST NOT 留下指向已不存在渠道／團隊的孤兒授權。

#### Scenario: 刪渠道連帶清理授權
- **WHEN** 刪除渠道 CH-A
- **THEN** 所有 (CH-A, *) 的 ChannelTeamAccess 一併刪除

#### Scenario: 刪團隊連帶清理授權
- **WHEN** 刪除 team「分店A」
- **THEN** 所有 (*, 分店A) 的 ChannelTeamAccess 一併刪除

### Requirement: 指派管理 API 需權限

渠道↔團隊的指派與撤銷 API SHALL 要求對應管理權限（如 `channel.manage` 或 team 管理權限），一般 agent MUST NOT 能自行變更自己的渠道可見性。

#### Scenario: 無權限者不能改指派
- **WHEN** 不具渠道管理權限的 agent 呼叫指派／撤銷 API
- **THEN** 回傳 403，指派不變更

### Requirement: 後台指派介面

後台 SHALL 提供渠道設定頁指派團隊、以及在人員／團隊設定檢視渠道對應的介面。介面 MUST 僅顯示當前租戶的渠道與團隊。

#### Scenario: 渠道設定頁指派團隊
- **WHEN** 管理員在渠道 CH-A 設定頁選擇要指派的團隊並儲存
- **THEN** 對應 ChannelTeamAccess 建立／更新，UI 反映最新指派狀態
