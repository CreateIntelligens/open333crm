# socket-room-authorization Specification

## Purpose
定義成員的 Socket.IO 連線加入哪些房間：連線時自動加入的租戶與成員房間，`subscribe`／`unsubscribe` 的目標格式，依租戶、成員與 `channel.view_all` 的授權，以及每個連線的次數限制。訪客的 `/visitor` 連線見 `webchat-secure-session`。

## Requirements

### Requirement: 連線時加入的房間

成員已停用或已不存在時，伺服器 SHALL 拒絕連線，即使 access token 還沒過期。成員以 access token 連上 Socket.IO 後，伺服器 SHALL 讓這個連線加入三個房間：`tenant:<租戶 ID>`、`agent:<成員 ID>`，以及帶租戶 ID 的成員房間 `tenant:<租戶 ID>:agent:<成員 ID>`。租戶 ID 與成員 ID 取自 token，不取自連線帶來的其他參數。

伺服器 SHALL 另外依成員的可見渠道（`channel-visibility-defaults`）加入渠道房間，並在連線完成之前加入：

- 有 `channel.view_all`：加入總店房間 `tenant:<租戶 ID>:channels:all`，不加入個別渠道的房間。
- 沒有 `channel.view_all`：每個看得到的渠道加入 `tenant:<租戶 ID>:channel:<渠道 ID>`；沒有任何看得到的渠道時不加入渠道房間。

#### Scenario: 連線後加入自己的租戶與成員房間
- **WHEN** 租戶 T1 的成員 A1 連上 Socket.IO，A1 沒有 `channel.view_all`，也沒有看得到的渠道
- **THEN** 這個連線加入 `tenant:T1`、`agent:A1` 與 `tenant:T1:agent:A1`，不加入其他房間

#### Scenario: 停用的成員連線被拒
- **WHEN** 已停用的成員以還沒過期的 access token 連上 Socket.IO
- **THEN** 伺服器拒絕連線，這個連線不加入任何房間

#### Scenario: 連線後加入看得到的渠道房間
- **WHEN** 租戶 T1 的成員 A1 連上 Socket.IO，A1 沒有 `channel.view_all`，渠道 C1 直接綁定給 A1
- **THEN** 這個連線也加入 `tenant:T1:channel:C1`，不加入 `tenant:T1:channels:all` 與其他渠道的房間

#### Scenario: 總店連線後加入總店房間
- **WHEN** 租戶 T1 有 `channel.view_all` 的成員連上 Socket.IO
- **THEN** 這個連線也加入 `tenant:T1:channels:all`

### Requirement: 訂閱目標的格式

`subscribe` 與 `unsubscribe` 事件 SHALL 只接受兩種格式：`<類型>:<ID>` 字串，或 `{ type, id }` 物件。類型是 `tenant`、`agent`、`team`、`channel`、`conversation` 其中之一，ID 是 UUID。

格式不符時，伺服器回 `{ ok: false, code: 'INVALID_TARGET' }`，不加入也不離開任何房間。授權通過時，伺服器回 `{ ok: true, room }`，`room` 是 `<類型>:<ID>`；`subscribe` 加入這個房間，`unsubscribe` 離開這個房間。

#### Scenario: 不認得的房間名稱
- **WHEN** 成員送出 `subscribe`，內容是 `tenant:arbitrary-room`
- **THEN** 伺服器回 `{ ok: false, code: 'INVALID_TARGET' }`，連線不加入任何房間

#### Scenario: 以物件格式訂閱
- **WHEN** 成員送出 `subscribe`，內容是 `{ type: 'conversation', id: <權限範圍內的對話 ID> }`
- **THEN** 伺服器回 `{ ok: true, room: 'conversation:<對話 ID>' }`，連線加入這個房間

#### Scenario: 取消訂閱
- **WHEN** 成員送出 `unsubscribe`，內容是權限範圍內的對話房間
- **THEN** 伺服器回 `{ ok: true, room }`，連線離開這個房間

### Requirement: 訂閱房間的授權

伺服器 SHALL 依連線的租戶、成員與 `channel.view_all` 權限授權每個訂閱目標：

- `tenant`：只能是自己的租戶。
- `agent`：自己；有 `channel.view_all` 時，也可以是同一租戶的其他成員。
- `team`：同一租戶的團隊；沒有 `channel.view_all` 時，成員必須屬於這個團隊。
- `channel`：同一租戶、啟用中的渠道；沒有 `channel.view_all` 時，成員必須看得到這個渠道（`channel-visibility-defaults`）。
- `conversation`：同一租戶的對話。沒有 `channel.view_all` 時，成員必須看得到對話的渠道，而且符合下列其中一項：
  - 成員是對話的被指派人。
  - 對話沒有團隊。
  - 成員屬於對話的團隊。

目標不存在與沒有權限 SHALL 得到相同的回應 `{ ok: false, code: 'FORBIDDEN' }`，連線不加入房間。

#### Scenario: 訂閱自己的租戶房間
- **WHEN** 租戶 T1 的成員訂閱 `tenant:T1`
- **THEN** 伺服器回 `{ ok: true, room: 'tenant:T1' }`

#### Scenario: 訂閱其他租戶的房間
- **WHEN** 租戶 T1 的成員訂閱 `tenant:T2`
- **THEN** 伺服器回 `{ ok: false, code: 'FORBIDDEN' }`

#### Scenario: 沒有 channel.view_all 時訂閱其他成員的房間
- **WHEN** 沒有 `channel.view_all` 的成員 A1 訂閱同一租戶的成員 A2 的房間 `agent:A2`
- **THEN** 伺服器回 `{ ok: false, code: 'FORBIDDEN' }`

#### Scenario: 有 channel.view_all 時訂閱其他成員的房間
- **WHEN** 有 `channel.view_all` 的成員 A1 訂閱同一租戶的成員 A2 的房間 `agent:A2`
- **THEN** 伺服器回 `{ ok: true, room: 'agent:A2' }`

#### Scenario: 訂閱不屬於自己的團隊
- **WHEN** 沒有 `channel.view_all` 的成員訂閱同一租戶、自己不屬於的團隊
- **THEN** 伺服器回 `{ ok: false, code: 'FORBIDDEN' }`

#### Scenario: 訂閱權限範圍內的對話
- **WHEN** 成員訂閱一個對話房間，對話沒有團隊，對話的渠道直接綁定給這位成員
- **THEN** 伺服器回 `{ ok: true, room: 'conversation:<對話 ID>' }`

#### Scenario: 訂閱其他租戶或不存在的對話
- **WHEN** 成員訂閱的對話房間，對話屬於其他租戶，或對話不存在
- **THEN** 兩種情況都回 `{ ok: false, code: 'FORBIDDEN' }`

#### Scenario: 對話的渠道看不到
- **WHEN** 成員訂閱一個對話房間，對話的渠道沒有綁定任何團隊或成員
- **THEN** 伺服器回 `{ ok: false, code: 'FORBIDDEN' }`

#### Scenario: 團隊對話不因渠道看得到而放行
- **WHEN** 成員看得到對話的渠道，但對話屬於一個成員不屬於的團隊，成員也不是被指派人
- **THEN** 伺服器回 `{ ok: false, code: 'FORBIDDEN' }`

### Requirement: 訂閱次數的限制

每個連線的 `subscribe` 與 `unsubscribe` SHALL 合計每 60 秒最多 60 次。超過時，伺服器回 `{ ok: false, code: 'RATE_LIMITED' }`，寫一筆 warn 等級的日誌，不檢查授權，連線的房間不變。60 秒的計算區間結束後，次數重新計算。

#### Scenario: 超過訂閱次數
- **WHEN** 一個連線在 60 秒內送出第 61 次 `subscribe`，目標是權限範圍內的對話
- **THEN** 伺服器回 `{ ok: false, code: 'RATE_LIMITED' }`，寫一筆 warn 日誌，連線不加入這個房間

#### Scenario: 計算區間結束後恢復
- **WHEN** 一個連線達到 60 次的上限，60 秒的計算區間結束後再送出 `subscribe`
- **THEN** 伺服器依授權結果處理這次訂閱

### Requirement: 授權變更時重新計算房間

下列變更 commit 之後，伺服器 SHALL 重新計算已連線 socket 的渠道房間：成員的可用渠道、成員的角色、成員的停用與永久刪除（只算該成員）；角色的權限、渠道的新增、停用、重新啟用與刪除、渠道的團隊授權、以 Facebook 連結粉專新增渠道（算整個租戶）；平台改租戶的方案、核准升級申請、試用轉正式方案（算該租戶）；方案的功能或權限設定改變（算使用這個方案的每個租戶）。成員已停用或已不存在時，伺服器 SHALL 斷開他的連線，不只離開渠道房間。重新計算時，連線離開不再看得到的渠道房間、加入新看得到的渠道房間，並重新授權 `subscribe` 加入的房間，不再符合「訂閱房間的授權」的房間 SHALL 離開。重新計算失敗時，變更本身 SHALL 仍然成功，成員重新連線後依新的授權加入房間。

#### Scenario: 新授權的渠道開始收到推播
- **WHEN** 已連線的成員 A1 被加上渠道 C1 的可用渠道
- **THEN** A1 的連線加入 `tenant:T1:channel:C1`，之後 C1 的 `message.new` 送達 A1，A1 不必重新連線

#### Scenario: 撤銷後離開渠道房間與已訂閱的對話房間
- **WHEN** 已連線的成員 A1 訂閱了 C1 的對話房間，之後 A1 的 C1 可用渠道被移除
- **THEN** A1 的連線離開 `tenant:T1:channel:C1` 與該對話房間，之後 C1 的推播不再送達 A1

#### Scenario: 停用的成員被斷線
- **WHEN** 已連線的成員 A1 被停用或永久刪除
- **THEN** 伺服器斷開 A1 的連線，之後租戶房間與渠道房間的推播都不再送達 A1

#### Scenario: 方案拿掉 channel.view_all
- **WHEN** 租戶 T1 的方案改成不含 `channel.view_all` 的方案，已連線的成員 A1 原本因這個權限在 `tenant:T1:channels:all`
- **THEN** A1 的連線離開 `tenant:T1:channels:all`，只留在看得到的渠道房間，A1 不必重新連線
