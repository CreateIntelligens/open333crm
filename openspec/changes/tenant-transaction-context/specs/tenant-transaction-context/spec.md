## Purpose

定義租戶資料存取的交易邊界：入口如何開一個綁定租戶的交易、交易內的寫入如何一起成功或一起失敗、推播與事件在什麼時候送出，以及搬遷期間舊寫法不得增加的檢查。

## ADDED Requirements

### Requirement: 入口開一個綁定租戶的交易

入口（route handler 或背景工作）MUST 能以一個租戶 ID 開啟一個交易，並在交易開始時設定該租戶的身分。交易內的所有查詢 MUST 使用這個交易。交易內任何一步丟出錯誤時，整個交易 MUST rollback，交易內已執行的寫入 MUST NOT 留在資料庫。租戶 ID 不是合法 UUID 時，系統 MUST 拒絕，MUST NOT 開啟交易。

#### Scenario: 第二筆寫入失敗時第一筆也不留下

- **WHEN** 入口在同一個交易內先建立一筆資料，接著執行的第二步丟出錯誤
- **THEN** 呼叫端收到該錯誤，資料庫中 MUST NOT 有第一筆資料

#### Scenario: 交易內只看得到綁定租戶的資料

- **WHEN** 以受 RLS 約束的連線，綁定租戶 A 開啟交易，並查詢同時有租戶 A 與租戶 B 資料的租戶表，查詢條件不帶 `tenantId`
- **THEN** 結果 MUST 只有租戶 A 的資料

#### Scenario: 不合法的租戶 ID

- **WHEN** 入口以 `not-a-uuid` 作為租戶 ID 開啟交易
- **THEN** 系統 MUST 丟出錯誤，交易內的程式 MUST NOT 執行

### Requirement: 推播與事件在 commit 之後才送出

交易內登記的 Socket 推播與業務事件 MUST 在交易 commit 之後才送出，並依登記的順序送出。交易 rollback 時，登記的推播與事件 MUST 全部丟棄，呼叫端 MUST 收到原本的錯誤。推播的房間以 `tenant:` 開頭、但不是交易綁定租戶的房間時，系統 MUST 在交易內丟出錯誤，讓交易 rollback。一項推播或事件送出失敗時，系統 MUST 記錄錯誤並繼續送出其餘項目，MUST NOT 讓已經 commit 的結果變成失敗。

#### Scenario: commit 之前不送出

- **WHEN** 交易內登記一則推播與一個事件，之後交易內的程式仍在執行
- **THEN** 在交易 commit 之前，前端 MUST NOT 收到該推播，事件訂閱者 MUST NOT 收到該事件

#### Scenario: commit 之後依登記順序送出

- **WHEN** 交易內依序登記推播 P1、事件 E1、推播 P2，之後交易 commit
- **THEN** 系統 MUST 依 P1、E1、P2 的順序送出

#### Scenario: rollback 時全部丟棄

- **WHEN** 交易內登記一則推播與一個事件，之後交易內的程式丟出錯誤
- **THEN** 該推播與事件 MUST NOT 送出，呼叫端收到該錯誤

#### Scenario: 推播到別的租戶房間

- **WHEN** 綁定租戶 A 的交易內，登記一則推播到租戶 B 的房間 `tenant:<B 的 ID>`
- **THEN** 系統 MUST 在交易內丟出錯誤，交易 rollback，交易內登記的推播與事件 MUST NOT 送出

#### Scenario: 一項送出失敗不影響其他項

- **WHEN** 交易 commit 之後，登記的第一則推播送出時丟出錯誤
- **THEN** 系統 MUST 記錄該錯誤並送出其餘項目，呼叫端 MUST 收到交易內程式的回傳值

### Requirement: 事件最多送出一次

業務事件在 commit 之後交給 API 行程內的事件匯流排。行程在 commit 之後、事件送出之前結束時，該事件 MUST NOT 補送。推播也一樣，MUST NOT 補送。這是規格接受的行為：事件的保證是最多一次，與事件直接交給行程內事件匯流排的寫法相同。

#### Scenario: 事件不重複送出

- **WHEN** 交易內登記一個事件，交易 commit，事件送出成功
- **THEN** 事件訂閱者 MUST 只收到該事件一次

### Requirement: route 的回應在 commit 之後才送出

以綁定租戶的交易執行的 route，MUST 從已登入請求的租戶身分取得租戶 ID。route 的回應 MUST 在交易 commit 之後才送出，回應內容是交易內程式的回傳值，狀態碼與 header 依交易內程式的設定，並在 commit 之後才套用到回應。交易內的程式丟出錯誤或 commit 失敗時，回應 MUST 是錯誤回應，MUST NOT 是成功回應。請求沒有租戶身分時，系統 MUST 回應 401，MUST NOT 開啟交易。

#### Scenario: 成功時回應交易內程式的結果

- **WHEN** 已登入的請求呼叫一個以綁定租戶交易執行的 route，交易內的程式把狀態碼設為 201 並回傳一筆資料
- **THEN** 回應的狀態碼 MUST 是 201，內容 MUST 是該筆資料

#### Scenario: 交易內程式丟出錯誤

- **WHEN** 交易內的程式寫入一筆資料後，丟出狀態碼 409 的應用程式錯誤
- **THEN** 回應的狀態碼 MUST 是 409，資料庫中 MUST NOT 有該筆資料，登記的推播 MUST NOT 送出

#### Scenario: 交易失敗時不帶交易內設定的 header

- **WHEN** 交易內的程式設定狀態碼 201 與 `Location` header，之後交易內的程式丟出錯誤，或 commit 失敗
- **THEN** 回應 MUST 是錯誤回應，MUST NOT 帶該 `Location` header

#### Scenario: 請求沒有租戶身分

- **WHEN** 沒有租戶身分的請求呼叫一個以綁定租戶交易執行的 route
- **THEN** 回應的狀態碼 MUST 是 401，交易內的程式 MUST NOT 執行

### Requirement: 舊寫法的數量不得增加

repo MUST 提供一個檢查腳本，計算下列寫法在 `apps/api/src` 中出現的次數，並與 repo 內的基準檔比較：`TenantDb` 型別、`request.tenantPrisma`，以及 service 檔內的 `withTenant(`、`$transaction(` 與開啟綁定租戶交易的呼叫。service 不自己開交易，所以最後一種寫法的基準是 0。以 `--strict` 執行時，任一寫法的次數比基準多，腳本 MUST 以 exit code 1 結束，並列出該寫法與出現的檔案。次數相同或減少時 MUST 以 exit code 0 結束；減少時 MUST 提示更新基準檔。不帶 `--strict` 時，腳本 MUST 只輸出報告並以 exit code 0 結束。

#### Scenario: 新增一處舊寫法

- **WHEN** 掃描目錄中 `TenantDb` 的次數比基準多 1，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含 `TenantDb` 與新增該寫法的檔案路徑

#### Scenario: 舊寫法減少

- **WHEN** 掃描目錄中 `request.tenantPrisma` 的次數比基準少，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 0 結束，輸出 MUST 提示更新基準檔

#### Scenario: 不帶 strict 只輸出報告

- **WHEN** 任一寫法的次數比基準多，不帶 `--strict` 執行腳本
- **THEN** 腳本 MUST 輸出報告並以 exit code 0 結束
