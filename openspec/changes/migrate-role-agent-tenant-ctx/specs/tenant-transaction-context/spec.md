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

「舊寫法的數量不得增加」的檢查腳本 MUST 另外計算兩種寫法在 service 檔中出現的次數，並與同一個基準檔比較：值的 import 引入 Redis client（`@open333crm/core` 的 `redis`、`ioredis`），以及值的 import 引入 LLM 入口（`generateReply`、`getChatProvider`）。只引入型別的 import MUST NOT 計入，flow 檔與 route 檔的 import MUST NOT 計入。比較方式與結束碼和「舊寫法的數量不得增加」相同。

#### Scenario: service 檔新增 Redis client 的 import

- **WHEN** 一個 service 檔新增 `import { redis } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含該寫法與該檔案路徑

#### Scenario: service 檔新增 LLM 入口的 import

- **WHEN** 一個 service 檔新增 `import { generateReply } from '../ai/llm.service.js'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含該寫法與該檔案路徑

#### Scenario: 只引入型別，或在 flow 檔引入

- **WHEN** 一個 service 檔新增 `import type { Redis } from 'ioredis'`，一個 flow 檔新增 `import { redis } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 0 結束
