## MODIFIED Requirements

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

## ADDED Requirements

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
