# tenant-transaction-context Specification

## Purpose
定義租戶資料存取的交易邊界：入口如何開一個綁定租戶的交易、交易內的寫入如何一起成功或一起失敗、推播與事件與佇列 job 在什麼時候送出、推播的房間由誰決定、交易內處理唯一約束與條件認領的共用函式，以及搬遷期間舊寫法不得增加的檢查。

## Requirements

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

### Requirement: 推播、事件與佇列 job 在 commit 之後才送出

交易內登記的 Socket 推播、業務事件與 BullMQ job MUST 在交易 commit 之後才送出，並依登記的順序送出。交易 rollback 時，登記的項目 MUST 全部丟棄，呼叫端 MUST 收到原本的錯誤。一項送出失敗時，系統 MUST 記錄錯誤並繼續送出其餘項目，MUST NOT 讓已經 commit 的結果變成失敗。系統 MUST NOT 等待 job 送進佇列完成才回傳交易內程式的結果，佇列沒有回應時，回傳也不受影響。

#### Scenario: commit 之前不送出

- **WHEN** 交易內登記一則推播、一個事件與一個 job，之後交易內的程式仍在執行
- **THEN** 在交易 commit 之前，前端 MUST NOT 收到該推播，事件訂閱者 MUST NOT 收到該事件，佇列 MUST NOT 收到該 job

#### Scenario: commit 之後依登記順序送出

- **WHEN** 交易內依序登記推播 P1、事件 E1、job J1、推播 P2，之後交易 commit
- **THEN** 系統 MUST 依 P1、E1、J1、P2 的順序送出

#### Scenario: rollback 時全部丟棄

- **WHEN** 交易內登記一則推播、一個事件與一個 job，之後交易內的程式丟出錯誤
- **THEN** 該推播、事件與 job MUST NOT 送出，呼叫端收到該錯誤

#### Scenario: 一項送出失敗不影響其他項

- **WHEN** 交易 commit 之後，登記的第一個 job 送進佇列時失敗
- **THEN** 系統 MUST 記錄該錯誤並送出其餘項目，呼叫端 MUST 收到交易內程式的回傳值

#### Scenario: 佇列沒有回應時不阻擋回傳

- **WHEN** 交易 commit 之後，登記的 job 送進佇列時，佇列一直沒有回應
- **THEN** 呼叫端 MUST 收到交易內程式的回傳值，MUST NOT 等待該 job

### Requirement: 推播的房間由系統決定

交易內登記推播時，呼叫端 MUST 只指定推播名稱與內容；給單一客服人員的推播，再指定該客服人員的 ID。呼叫端 MUST NOT 指定房間名稱。系統 MUST 依推播的種類決定房間：

- 全租戶推播：送到交易綁定租戶的房間 `tenant:<tenantId>`。
- 給客服人員的推播：送到帶交易綁定租戶 ID 的成員房間 `tenant:<tenantId>:agent:<agentId>`。

兩種房間的租戶 ID 都由交易綁定的租戶組成，所以推播不會送到別的租戶的連線。

#### Scenario: 全租戶推播

- **WHEN** 綁定租戶 A 的交易內登記推播 `case.updated`，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>`，MUST NOT 送到其他房間

#### Scenario: 給客服人員的推播

- **WHEN** 綁定租戶 A 的交易內，登記給客服人員 X 的推播 `notification.new`，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>:agent:<X 的 ID>`，MUST NOT 送到其他房間

#### Scenario: 給客服人員的推播用了別的租戶的客服人員 ID

- **WHEN** 綁定租戶 A 的交易內，登記給客服人員 Y 的推播，Y 屬於租戶 B，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>:agent:<Y 的 ID>`；Y 的連線只加入 `tenant:<B 的 ID>:agent:<Y 的 ID>`，所以 MUST NOT 收到該推播

### Requirement: route 的回應在 commit 之後才送出

讀寫租戶資料的 route MUST 經由 flow 開啟綁定租戶的交易，租戶 ID MUST 取自已登入請求的租戶身分。route MUST 在 flow 回傳之後，才設定狀態碼與 header 並送出回應。flow 回傳時，交易已經 commit，commit 之後的動作也已經完成。flow 丟出錯誤或 commit 失敗時，回應 MUST 是錯誤回應，MUST NOT 是成功回應，也 MUST NOT 帶成功時才設定的 header。請求沒有租戶身分時，系統 MUST 回應 401，MUST NOT 開啟交易。

#### Scenario: 成功時回應交易內程式的結果

- **WHEN** 已登入的請求呼叫一個 route，route 呼叫的 flow 在交易內寫入一筆資料並回傳，route 把狀態碼設為 201
- **THEN** 回應的狀態碼 MUST 是 201，內容 MUST 是 flow 回傳的資料，送出回應時交易 MUST 已經 commit

#### Scenario: 交易內程式丟出錯誤

- **WHEN** flow 在交易內寫入一筆資料、登記一則推播之後，丟出狀態碼 409 的應用程式錯誤
- **THEN** 回應的狀態碼 MUST 是 409，資料庫中 MUST NOT 有該筆資料，該推播 MUST NOT 送出

#### Scenario: 交易失敗時不帶交易內設定的 header

- **WHEN** flow 的交易 commit 失敗，route 原本會在成功時設定狀態碼 201 與 `Location` header
- **THEN** 回應 MUST 是錯誤回應，MUST NOT 帶該 `Location` header

#### Scenario: 請求沒有租戶身分

- **WHEN** 沒有租戶身分的請求呼叫一個讀寫租戶資料的 route
- **THEN** 回應的狀態碼 MUST 是 401，flow MUST NOT 開啟交易

### Requirement: 舊寫法的數量不得增加

repo MUST 提供一個檢查腳本，計算下列寫法在 `apps/api/src` 中出現的次數，並與 repo 內的基準檔比較：`TenantDb` 型別、`request.tenantPrisma`，以及 service 檔內的 `withTenant(`、`$transaction(` 與開啟綁定租戶交易的呼叫。service 不自己開交易，所以最後一種寫法的基準是 0。以 `--strict` 執行時，任一寫法的次數比基準多，腳本 MUST 以 exit code 1 結束，並列出該寫法與出現的檔案。次數相同或減少時 MUST 以 exit code 0 結束；減少時 MUST 提示更新基準檔。不帶 `--strict` 時，腳本 MUST 只輸出報告並以 exit code 0 結束。腳本以文字比對計數，涵蓋名稱後面接空白或簡單泛型參數的呼叫，不涵蓋刻意繞過的寫法，例如泛型參數內含括號。

#### Scenario: 新增一處舊寫法

- **WHEN** 掃描目錄中 `TenantDb` 的次數比基準多 1，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含 `TenantDb` 與新增該寫法的檔案路徑

#### Scenario: 舊寫法減少

- **WHEN** 掃描目錄中 `request.tenantPrisma` 的次數比基準少，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 0 結束，輸出 MUST 提示更新基準檔

#### Scenario: 不帶 strict 只輸出報告

- **WHEN** 任一寫法的次數比基準多，不帶 `--strict` 執行腳本
- **THEN** 腳本 MUST 輸出報告並以 exit code 0 結束

### Requirement: 寫入撞到唯一鍵時改用既有資料

repo MUST 提供一個共用函式，在綁定租戶的交易內寫入一筆資料。資料違反唯一約束時，函式 MUST NOT 丟出錯誤，改為查出既有的那一筆。函式 MUST 回報回傳的資料是否由本次寫入。函式執行之後，同一個交易 MUST 仍可繼續查詢與寫入。寫入被略過、但查不到既有資料時，函式 MUST 丟出錯誤。

#### Scenario: 沒有衝突

- **WHEN** 交易內以共用函式寫入一筆唯一鍵還不存在的資料
- **THEN** 函式 MUST 回傳新寫入的資料，並回報這筆資料由本次寫入

#### Scenario: 與已存在的資料衝突

- **WHEN** 交易內以共用函式寫入一筆資料，資料庫已有相同唯一鍵的資料
- **THEN** 函式 MUST 回傳既有的資料，並回報這筆資料不是本次寫入；之後同一個交易內的查詢 MUST 成功

#### Scenario: 兩個交易同時寫入同一個唯一鍵

- **WHEN** 兩個交易以共用函式寫入相同唯一鍵的資料，第一個交易先寫入，之後才 commit
- **THEN** 第二個交易 MUST 回傳第一個交易寫入的資料，並回報這筆資料不是本次寫入，MUST NOT 丟出錯誤

### Requirement: 條件更新認領

repo MUST 提供一個共用函式，執行一次條件更新，並回報是否認領成功。更新筆數是 1 時，函式 MUST 回報認領成功；更新筆數是 0 時，MUST 回報認領失敗。認領的條件只能對應一筆資料，所以更新筆數大於 1 時，函式 MUST 丟出錯誤，讓交易 rollback。

#### Scenario: 認領成功

- **WHEN** 條件更新更新了 1 筆資料
- **THEN** 函式 MUST 回報認領成功

#### Scenario: 已經被認領

- **WHEN** 條件更新更新了 0 筆資料
- **THEN** 函式 MUST 回報認領失敗

#### Scenario: 條件對應多筆資料

- **WHEN** 條件更新更新了 2 筆資料
- **THEN** 函式 MUST 丟出錯誤

### Requirement: 事件與佇列 job 至少送出一次

交易內登記的事件與佇列 job MUST 經 outbox 送出（見 `event-delivery`）。交易 commit 之後，行程在送出之前結束時，系統 MUST 補送。補送時，job 的 id MUST 與第一次送出相同。登記 job 時，選項 MUST 只能是 `attempts`、`backoff`、`delay`、`priority`、`removeOnComplete`、`removeOnFail`，其他選項 MUST 丟錯。其他選項可能讓佇列不建立這個 job，或不用 outbox 的 id 當 job id，例如 `jobId`、`deduplication`、`debounce`、`repeat`。

推播 MUST 維持最多一次：行程在推播送出之前結束時，系統 MUST NOT 補送推播。

#### Scenario: 行程在送出 job 之前結束

- **WHEN** 交易登記 job J 並 commit，API 行程在 J 送進佇列之前結束，之後補送排程執行
- **THEN** 佇列 MUST 收到 J，J 的 id MUST 等於它在 outbox 的 id

#### Scenario: job 選項不在白名單內

- **WHEN** 交易登記 job 時帶 `deduplication`、`debounce`、`repeat` 或 `jobId` 選項
- **THEN** 登記 MUST 丟錯，交易 MUST rollback

#### Scenario: 行程在推播之前結束

- **WHEN** 交易登記推播 P 並 commit，API 行程在 P 送出之前結束
- **THEN** 系統 MUST NOT 補送 P

### Requirement: commit 之後、回傳之前執行的動作

交易內的程式 MUST 能登記一個「commit 之後執行」的動作。系統 MUST 在交易 commit 之後執行這個動作，並與推播、事件、job 依登記的順序執行。系統 MUST 等待動作完成，才回傳交易內程式的結果；以綁定租戶交易執行的 route，MUST 在動作完成之後才送出回應。交易 rollback 時，登記的動作 MUST NOT 執行。動作失敗時，系統 MUST 記錄錯誤並繼續執行其餘項目，MUST NOT 讓已經 commit 的結果變成失敗。動作 MUST 最多執行一次：行程在動作執行之前結束時，系統 MUST NOT 補做。

#### Scenario: commit 之後執行，回傳之前完成

- **WHEN** 交易內登記動作 A，A 要 50 毫秒才完成，之後交易 commit
- **THEN** A MUST 在 commit 之後才開始執行，呼叫端收到回傳值時 A MUST 已經完成

#### Scenario: rollback 時不執行

- **WHEN** 交易內登記動作 A，之後交易內的程式丟出錯誤
- **THEN** A MUST NOT 執行，呼叫端收到該錯誤

#### Scenario: 動作失敗不影響回傳

- **WHEN** 交易 commit 之後，登記的動作 A 丟出錯誤，A 之後還登記了推播 P
- **THEN** 系統 MUST 記錄該錯誤並送出 P，呼叫端 MUST 收到交易內程式的回傳值

#### Scenario: 與推播依登記順序執行

- **WHEN** 交易內依序登記推播 P1、動作 A1、推播 P2，之後交易 commit
- **THEN** 系統 MUST 依 P1、A1、P2 的順序執行

### Requirement: service 直接使用 Redis 與 LLM 的數量不得增加

「舊寫法的數量不得增加」的檢查腳本 MUST 另外計算兩種寫法在 service 檔中出現的次數，並與同一個基準檔比較：引用 Redis client（`@open333crm/core` 的 `redis` 或整個模組、`ioredis`），以及引用 LLM 模組（`ai/llm.service.js`、`ai/providers/` 底下除了 `types.js` 之外的檔案）。腳本 MUST 解析 TypeScript 語法計數：靜態 import、re-export、動態 `import()` 與 `require()` 都 MUST 計入，與註解、空白、換行的寫法無關。只引用型別的 import、註解與字串裡的文字 MUST NOT 計入，flow 檔與 route 檔 MUST NOT 計入。比較方式與結束碼和「舊寫法的數量不得增加」相同。

#### Scenario: service 檔新增 Redis client 的 import

- **WHEN** 一個 service 檔新增 `import { redis } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含該寫法與該檔案路徑

#### Scenario: service 檔新增 LLM 入口的 import

- **WHEN** 一個 service 檔新增 `import { generateReply } from '../ai/llm.service.js'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含該寫法與該檔案路徑

#### Scenario: 只引入型別，或在 flow 檔引入

- **WHEN** 一個 service 檔新增 `import type { Redis } from 'ioredis'`，一個 flow 檔新增 `import { redis } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 0 結束

#### Scenario: import 內含註解、前置空白，或以動態 import 引用

- **WHEN** 一個 service 檔新增 `import { /* cache */ redis } from '@open333crm/core'`，另一個 service 檔新增 `await import('ioredis')`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含這兩個檔案路徑

#### Scenario: 註解裡的 import 不算

- **WHEN** 一個 service 檔新增一行註解 `// import { redis } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 0 結束

#### Scenario: 以 namespace import 或直接 import provider 檔

- **WHEN** 一個 service 檔新增 `import * as IORedis from 'ioredis'`，另一個 service 檔新增 `import { openaiProvider } from '../ai/providers/openai.js'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含這兩個檔案路徑
