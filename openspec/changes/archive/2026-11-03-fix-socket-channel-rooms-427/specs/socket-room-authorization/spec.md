## MODIFIED Requirements

### Requirement: 連線時加入的房間

成員以 access token 連上 Socket.IO 後，伺服器 SHALL 讓這個連線加入三個房間：`tenant:<租戶 ID>`、`agent:<成員 ID>`，以及帶租戶 ID 的成員房間 `tenant:<租戶 ID>:agent:<成員 ID>`。租戶 ID 與成員 ID 取自 token，不取自連線帶來的其他參數。

伺服器 SHALL 另外依成員的可見渠道（`channel-visibility-defaults`）加入渠道房間，並在連線完成之前加入：

- 有 `channel.view_all`：加入總店房間 `tenant:<租戶 ID>:channels:all`，不加入個別渠道的房間。
- 沒有 `channel.view_all`：每個看得到的渠道加入 `tenant:<租戶 ID>:channel:<渠道 ID>`；沒有任何看得到的渠道時不加入渠道房間。

#### Scenario: 連線後加入自己的租戶與成員房間
- **WHEN** 租戶 T1 的成員 A1 連上 Socket.IO，A1 沒有 `channel.view_all`，也沒有看得到的渠道
- **THEN** 這個連線加入 `tenant:T1`、`agent:A1` 與 `tenant:T1:agent:A1`，不加入其他房間

#### Scenario: 連線後加入看得到的渠道房間
- **WHEN** 租戶 T1 的成員 A1 連上 Socket.IO，A1 沒有 `channel.view_all`，渠道 C1 直接綁定給 A1
- **THEN** 這個連線也加入 `tenant:T1:channel:C1`，不加入 `tenant:T1:channels:all` 與其他渠道的房間

#### Scenario: 總店連線後加入總店房間
- **WHEN** 租戶 T1 有 `channel.view_all` 的成員連上 Socket.IO
- **THEN** 這個連線也加入 `tenant:T1:channels:all`

## ADDED Requirements

### Requirement: 授權變更時重新計算房間

下列變更 commit 之後，伺服器 SHALL 重新計算已連線 socket 的渠道房間：成員的可用渠道、成員的角色（只算該成員）；角色的權限、渠道的新增、停用、重新啟用與刪除、渠道的團隊授權、以 Facebook 連結粉專新增渠道（算整個租戶）。重新計算時，連線離開不再看得到的渠道房間、加入新看得到的渠道房間，並重新授權 `subscribe` 加入的房間，不再符合「訂閱房間的授權」的房間 SHALL 離開。重新計算失敗時，變更本身 SHALL 仍然成功，成員重新連線後依新的授權加入房間。

#### Scenario: 新授權的渠道開始收到推播
- **WHEN** 已連線的成員 A1 被加上渠道 C1 的可用渠道
- **THEN** A1 的連線加入 `tenant:T1:channel:C1`，之後 C1 的 `message.new` 送達 A1，A1 不必重新連線

#### Scenario: 撤銷後離開渠道房間與已訂閱的對話房間
- **WHEN** 已連線的成員 A1 訂閱了 C1 的對話房間，之後 A1 的 C1 可用渠道被移除
- **THEN** A1 的連線離開 `tenant:T1:channel:C1` 與該對話房間，之後 C1 的推播不再送達 A1
