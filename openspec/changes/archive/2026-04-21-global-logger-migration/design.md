## Context

`packages/core/src/logger/index.ts` 已有 winston logger，但 transport 寫死為 Console，且 console format 用 `colorize + simple`（不是 JSON），而 file format 用 JSON。需要讓這兩個行為都可透過 env 控制。`winston-daily-rotate-file` 已可用（npm 5.0.0）。

現有 env 已有 `LOG_LEVEL`（由 `packages/core` 讀取）。新增三個 env：
- `LOG_TRANSPORT`: `console`（預設）| `file` | `both`
- `LOG_DIR`: log 檔目錄，預設 `./logs`
- `LOG_MAX_FILES`: daily rotation 保留天數，預設 `14d`

## Goals / Non-Goals

**Goals:**
- 新增 `LOG_TRANSPORT` / `LOG_DIR` / `LOG_MAX_FILES` env 支援
- `console` transport：colorize + simple（開發友善）
- `file` transport：JSON + daily rotation，檔名 `app-YYYY-MM-DD.log`，自動壓縮舊檔（`zippedArchive: true`）
- `both`：同時輸出 console + file
- 掃描替換所有後端 `console.log/warn/error/debug/info` → `logger.info/warn/error/debug`
- `console.log` → `logger.info`，`console.error` → `logger.error`，`console.warn` → `logger.warn`，`console.debug` → `logger.debug`

**Non-Goals:**
- 前端 / widget 的 console（瀏覽器端）
- `packages/database/prisma/seed.ts`（開發工具）
- 動態切換（不重啟）transport
- 集中式 log 服務（Elasticsearch、Loki 等）

## Decisions

### D1 — logger 在 `packages/core` 初始化，全 app 共用單例
logger 已是 `packages/core` 的 singleton export。保持不變，只改初始化邏輯讀 `LOG_TRANSPORT` env。

### D2 — console transport format 維持 simple（非 JSON）
開發時 JSON 難讀。`file` transport 才用 JSON，方便 log 工具（grep、jq）解析。

### D3 — daily rotation 參數
```
filename: `${LOG_DIR}/app-%DATE%.log`
datePattern: 'YYYY-MM-DD'
zippedArchive: true
maxFiles: LOG_MAX_FILES   // e.g. '14d'
```

### D4 — `winston-daily-rotate-file` 安裝在 `packages/core`
不需要各 app 個別安裝，透過 workspace 共享。

### D5 — 替換策略：直接 sed / 手動改，不用 codemod 工具
檔案數可控（40 個），pattern 一致，直接改比引入新工具安全。

## Risks / Trade-offs

- **現有 `logger.info(msg, err)` 呼叫**：winston 接受 `(message, meta)` 或 `(message, error)`，無破壞性變更
- **多 process 同時寫同一 log 檔**：`apps/api` 與 `apps/workers` 是獨立 process，若 `LOG_DIR` 相同會有兩個 process 寫同一檔。建議各 app 設不同 `LOG_DIR`（或用 `LOG_DIR=./logs/api`、`./logs/workers`），或依賴 OS-level file locking（winston-daily-rotate-file 預設支援）
