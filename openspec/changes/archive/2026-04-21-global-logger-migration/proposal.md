## Why

`console.log/warn/error` 散落在 40+ 個後端檔案（164 處），無法用 `LOG_LEVEL` 過濾、沒有 timestamp 結構，也無法在不重啟服務的情況下切換輸出目標。現有 `packages/core/src/logger` 已用 winston，但只有少數幾個 worker 檔案使用，大多數模組仍用 `console.*`。需要統一成一個可配置的 logger，讓使用者自己決定要輸出到 stdout 或寫入 daily rotation log 檔。

## What Changes

- **強化 `packages/core/src/logger/index.ts`**：支援透過環境變數配置 transport；新增 `LOG_TRANSPORT=console|file|both`、`LOG_DIR`（log 目錄）、`LOG_MAX_FILES`（保留天數）；使用 `winston-daily-rotate-file` 實作 daily rotation
- **掃描並替換全部後端 `console.*`**：`apps/api`、`apps/workers`、`packages/channel-plugins`、`packages/brain`、`packages/automation`（共 40 個檔案）全部改用 `import { logger } from '@open333crm/core'`
- **前端 / widget 的 `console.*` 不動**：`apps/web`、`apps/widget` 是瀏覽器端，保留原樣
- **`packages/database/prisma/seed.ts` 不動**：seed script 是開發工具，`console.log` 可接受

## Capabilities

### New Capabilities

- `structured-logging`: 統一的後端 logger，支援 LOG_TRANSPORT / LOG_DIR / LOG_MAX_FILES 環境變數；daily rotation 寫檔與 console stdout 皆可選

### Modified Capabilities

_(無現有 spec 需要更新)_

## Impact

- `packages/core/src/logger/index.ts` — 重寫 logger 初始化邏輯，加入 file transport
- `packages/core/package.json` — 加入 `winston-daily-rotate-file` 依賴
- `apps/api/src/**/*.ts`（~30 檔）— `console.*` → `logger.*`
- `apps/workers/src/**/*.ts`（~1 檔）— `console.*` → `logger.*`
- `packages/channel-plugins/src/**/*.ts`（~3 檔）— `console.*` → `logger.*`
- `packages/brain/src/**/*.ts`（~3 檔）— `console.*` → `logger.*`
- `packages/automation/src/**/*.ts`（~1 檔）— `console.*` → `logger.*`
- 新增 `.env` 文件說明三個新環境變數
