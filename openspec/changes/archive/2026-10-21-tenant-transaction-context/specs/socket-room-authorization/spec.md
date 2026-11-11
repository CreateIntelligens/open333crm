## MODIFIED Requirements

### Requirement: 連線時加入的房間

成員以 access token 連上 Socket.IO 後，伺服器 SHALL 讓這個連線加入三個房間：`tenant:<租戶 ID>`、`agent:<成員 ID>`，以及帶租戶 ID 的成員房間 `tenant:<租戶 ID>:agent:<成員 ID>`。租戶 ID 與成員 ID 取自 token，不取自連線帶來的其他參數。

#### Scenario: 連線後加入自己的租戶與成員房間
- **WHEN** 租戶 T1 的成員 A1 連上 Socket.IO
- **THEN** 這個連線加入 `tenant:T1`、`agent:A1` 與 `tenant:T1:agent:A1`，不加入其他房間
