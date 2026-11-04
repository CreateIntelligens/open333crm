## MODIFIED Requirements

### Requirement: service 直接使用 Redis 與 LLM 的數量不得增加

「舊寫法的數量不得增加」的檢查腳本 MUST 另外計算兩種寫法在 service 檔中出現的次數，並與同一個基準檔比較：自己取得 Redis 連線的引用，以及引用 LLM 模組（`ai/llm.service.js`、`ai/providers/` 底下除了 `types.js` 之外的檔案）。自己取得 Redis 連線的引用包括 `ioredis`、API 的共用連線模組，以及 `@open333crm/core` 匯出的 Redis 連線、建立連線的函式或整個模組。腳本 MUST 解析 TypeScript 語法計數：靜態 import、re-export、動態 `import()` 與 `require()` 都 MUST 計入，與註解、空白、換行的寫法無關。只引用型別的 import、註解與字串裡的文字 MUST NOT 計入，flow 檔與 route 檔 MUST NOT 計入。比較方式與結束碼和「舊寫法的數量不得增加」相同。

#### Scenario: service 檔新增 Redis client 的 import

- **WHEN** 一個 service 檔新增 `import { redis } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含該寫法與該檔案路徑

#### Scenario: service 檔新增建立 Redis 連線的函式的 import

- **WHEN** 一個 service 檔新增 `import { createRedisClient } from '@open333crm/core'`，另一個 service 檔新增 `import { createRedisClient as mk } from '@open333crm/core'`，以 `--strict` 執行腳本
- **THEN** 腳本 MUST 以 exit code 1 結束，輸出 MUST 包含這兩個檔案路徑

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
