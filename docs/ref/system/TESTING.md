# 撰寫測試

本文件說明各種測試的寫法：單元測試怎麼替換相依、為什麼單元測試連不到 Redis、元件測試的限制、feature 測試怎麼隔離資料，以及 mock 能做到什麼程度。測試的分組、指令與 feature 測試的環境準備，見[開發與交付](./DELIVERY.md#測試)。先寫測試再寫程式的流程、以 mutation 驗證測試、既有測試失敗時的處理，見 `AGENTS.md` 的 Step 2。

- **資料來源**：`apps/api/tests/setup/`、`apps/api/tests/support/`、`apps/api/tests/unit/`、`apps/api/tests/feature/`、`apps/web/tests/unit/`、`packages/automation/tests/unit/`
- **核對日期**：2026-11-18

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| 單元測試怎麼測一個會查資料庫的 service？ | [單元測試注入相依](#單元測試注入相依) |
| 單元測試為什麼連不到 Redis？要自己 mock Redis 時要注意什麼？ | [單元測試不連 Redis](#單元測試不連-redis) |
| 斷言要用哪個模組？ | [斷言](#斷言) |
| React 元件怎麼測？為什麼測試 worker 會記憶體不足？ | [元件測試](#元件測試) |
| feature 測試的資料怎麼跟其他測試分開？ | [feature 測試的資料隔離](#feature-測試的資料隔離) |
| 什麼時候可以讀原始碼、比對字串？ | [測行為，不測原始碼文字](#測行為不測原始碼文字) |
| mock 可以丟出什麼錯誤？ | [mock 只做真實程式做得到的事](#mock-只做真實程式做得到的事) |

## 單元測試注入相依

service 以參數接收 Prisma executor（`AGENTS.md` 結構規則 2），所以單元測試可以傳入一個 mock 物件。mock 只實作 service 會呼叫的 model 方法。範例是 `apps/api/tests/unit/modules/case/case.service.test.ts`。

`apps/api/tests/support/mock-tenant-ctx.ts` 提供兩種物件：

- service 測試用的 `TenantCtx`。
- flow 測試用的 `TenantScope`。

## 單元測試不連 Redis

`apps/api/tests/setup/unit.setup.ts` 為 `apps/api` 的所有單元測試替換 `ioredis`。每個 Redis 指令都立刻失敗，結果與 Redis 停機時相同。這個 mock 也替換 `@open333crm/core` 的 `redis` client。

測試可以用自己的 `vi.mock('ioredis')` 取代這個 mock。自己寫的 mock class 要有 `on()` 方法，並回傳 `this`。原因是 `@open333crm/core` 載入時會呼叫 `redis.on()`。

這個 mock 能替換到 `@open333crm/core`，前提是整個 repo 只安裝一個版本的 `ioredis`：

- `apps/api`、`apps/workers` 與 `packages/core` 固定使用 `bullmq` 指定的 `ioredis` 版本。
- 更新 `bullmq` 時，三個套件的 `ioredis` 版本要一起改。
- `pnpm why ioredis -r` 必須只列出一個版本。
- 出現第二個版本時，`apps/api/tests/unit/no-redis-connection.test.ts` 會失敗。

## 斷言

斷言用 `node:assert/strict`，多數既有測試都用這個模組。部分舊測試 import `node:assert`，它的 `assert.equal` 用 `==` 比較。不要照抄那些測試。

## 元件測試

只有 `apps/web` 有元件測試。元件測試以 `@testing-library/react` 在 jsdom 中渲染 React。其他單元測試在 Node 中執行。

- 檔名用 `*.test.tsx`，第一行寫 `// @vitest-environment jsdom`。
- 以 `vi.mock()` 替換 `#src/lib/api.js`。元件測試不送出 HTTP 請求。
- 檢查元素不存在時，用 `assert.ok(element === null)`。不要把 DOM 節點傳給 `assert.equal()`：斷言失敗時，`node:assert` 會序列化整棵 jsdom 樹，測試 worker 會記憶體不足。
- 被 mock 的 hook 每次渲染都要回傳同一個函式，與真實 provider 的 `useCallback` 相同。每次回傳新函式時，依賴這個函式的 effect 會無限重跑。

範例是 `apps/web/tests/unit/components/settings/role-permission-matrix.test.tsx`。

## feature 測試的資料隔離

feature 測試使用獨立的測試資料庫。`apps/api/tests/setup/` 建立資料庫、套用 migration、建立固定的測試租戶。連線指向非本機的主機時，setup 會中止整個測試。

每個測試建立的資料要與其他測試分開。使用下列兩種做法之一：

| 做法 | 範例 |
| --- | --- |
| 測試在一個交易內執行，結束時 rollback | `tests/feature/modules/identity-binding/identity-binding.test.ts` |
| 測試建立的每筆資料都帶唯一標記，在 `afterAll` 刪除帶標記的資料 | `tests/feature/modules/tenant-audit/tenant-audit.test.ts` |

## 測行為，不測原始碼文字

有些測試讀取原始碼檔案，斷言檔案裡有某個字串。改名或搬移之後，即使行為不變，這類測試也會失敗。

只有行為測試無法驗證的保證，才寫這類測試。例如「這個 route 在 `withTenant` 內呼叫 service」。

## mock 只做真實程式做得到的事

讓 mock 丟出錯誤之前，先讀真實的函式。真實函式如果捕捉錯誤並回傳備用結果，mock 丟錯測到的是不存在的路徑。

要測失敗的情況，讓最底層的邊界失敗，例如 LLM 呼叫或 HTTP 請求。邊界與受測程式之間的真實程式要保留。

範例：`analyzeSentimentFlow()` 捕捉 LLM 的錯誤，改回傳關鍵字判斷的結果。所以 `apps/api/tests/unit/modules/automation/sentiment-llm-fallback.test.ts` mock 的是 LLM，不是 `analyzeSentimentFlow()`。
