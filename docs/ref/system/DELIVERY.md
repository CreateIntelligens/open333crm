# 開發與交付

本文件說明 workspace、建置、測試、CI、部署及文件規則。

## Workspace 與建置

`pnpm-workspace.yaml` 納入 `packages/*` 與 `apps/*`。Turborepo 定義 `build`、`dev`、`lint`、`db:generate`、`db:migrate`、`db:seed`。

`build` 使用 `dependsOn: ["^build"]`，因此先建置被相依的 package，再建置 app。

常用指令：

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm db:generate
pnpm db:migrate -- --name <name>
pnpm db:seed
```

CI 建置必須設定 `SKIP_ENV_VALIDATION=true`。

## 測試

API 測試檔使用 Vitest 的 API，但目前由 `tsx` 個別執行。專案沒有 Vitest 設定檔，也沒有根層級 `pnpm test`。

```bash
pnpm --filter @open333crm/api test:case
tsx apps/api/src/__tests__/smoke.test.ts
```

其他可用 script 定義在 `apps/api/package.json`。

## CI

`.github/workflows/ci.yml` 在推送到 `main` 或建立 Pull Request 時執行兩個 job：

| job | 內容 |
| --- | --- |
| `build` | 安裝依賴、Prisma generate、建置、嚴格 tenant scoping 檢查、嚴格 `prismaAdmin` 使用檢查 |
| RLS 隔離測試 | 啟動 PostgreSQL、套用 migration、建立資料庫角色、Seed 兩個租戶，再驗證 RLS |

兩個靜態檢查使用 `--strict`，違規會使 CI 失敗：

```bash
node scripts/check-tenant-scoping.mjs --strict
node scripts/check-prisma-admin-usage.mjs --strict
```

## 部署

`.github/workflows/deploy.yml` 將程式碼 rsync 到 UAT，確認環境檔存在，清理 Docker build cache，重新建置並啟動容器，最後驗證部署結果。

## OpenSpec 與文件

- OpenSpec change 位於 `openspec/changes/`，完成後移到 `openspec/changes/archive/`。
- `AGENTS.md` 是專案開發規則的單一真實來源。
- Feature、Fix、架構變更及完成 OpenSpec change 時，必須更新 `CHANGELOG.md`。
- `docs/ref/` 描述目前實作；`docs/` 中的編號文件可能包含早期規劃。

CI 與測試目前的缺口列在[實作落差與驗證紀錄](./AUDIT.md)。

