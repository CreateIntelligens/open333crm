## Purpose
定義 API 的啟動入口：`apps/api/src/index.ts` 是唯一的權威入口。開發與正式環境都從這個檔案或它的建置結果啟動 API，不另設其他啟動檔。

## Requirements

### Requirement: Single Authoritative API Entrypoint
The API service SHALL use `apps/api/src/index.ts` as its sole authoritative runtime bootstrap entrypoint.

#### Scenario: Development runtime starts API service
- **WHEN** a developer starts the API service in local development
- **THEN** the process SHALL bootstrap the server from `apps/api/src/index.ts`

#### Scenario: Production runtime starts API service
- **WHEN** the built API service starts in production
- **THEN** the process SHALL bootstrap the server from the build output generated from `apps/api/src/index.ts`

