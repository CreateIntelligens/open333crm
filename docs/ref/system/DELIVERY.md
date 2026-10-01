# 開發與交付

本文件說明 workspace、建置、測試、CI、部署及文件規則。

## Workspace 與建置

`pnpm-workspace.yaml` 納入 `packages/*` 與 `apps/*`。Turborepo 定義 `build`、`dev`、`lint`、`test`、`test:feature`、`db:generate`、`db:migrate`、`db:seed`。

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

## 測試

測試由 Vitest 執行。每個套件把測試放在 `tests/` 底下，分成兩組：

| 組別 | 位置 | 需要什麼 |
| --- | --- | --- |
| unit | `tests/unit/`，目錄對應 `src/` | 不需要外部服務；相依以 mock 注入 |
| feature | `tests/feature/`，目前只有 `apps/api` 有 | PostgreSQL 與 Redis，即 `docker-compose.dev.yml` 的 `postgres`、`redis` |

```bash
pnpm test                                      # 所有套件的 unit
pnpm test:feature                              # feature，需先啟動 PostgreSQL 與 Redis
pnpm test:all                                  # 兩組都跑
pnpm --filter @open333crm/api test -- case     # 只跑檔名含 case 的測試檔
```

兩組的設定在各套件的 `vitest.config.ts`。測試以 `#src/` 引用原始碼，對應 `package.json` 的 `imports`。

feature 組不使用開發資料庫。`apps/api/tests/setup/` 會做下列準備：

- 建立獨立的測試資料庫，套用全部 migration；
- 替沒有密碼的 `app_tenant`、`app_admin` 設定測試用密碼；
- 建立兩個固定的測試租戶；
- 清空 Redis 的測試專用資料庫。

連線的預設值與覆寫方式寫在 `feature-config.ts`。

`apps/api/tests/manual/` 放對執行中的服務發請求的腳本。Vitest 不會執行這些腳本，需要手動執行。

## CI

目前沒有 CI workflow 執行建置、測試、lint 或租戶隔離檢查。`.github/workflows/` 只有 `deploy.yml`，這個 workflow 只負責部署。

原本的 `ci.yml` 執行兩個租戶隔離靜態檢查與 RLS 隔離測試，之後有 commit 刪除了這個檔案。刪除經過見 `AGENTS.md` 的「CI gates」一節。

在 `ci.yml` 恢復之前，開發者必須在建立 Pull Request 前手動執行三個靜態檢查：

```bash
node scripts/check-tenant-scoping.mjs --strict
node scripts/check-prisma-admin-usage.mjs --strict
node scripts/check-workspace-esm.mjs --strict
```

前兩支檢查租戶隔離。第三支檢查 workspace 的 ESM 設定：套件少了 `"type": "module"` 會被編成 CJS，轉出式 re-export 在執行時變成 `undefined`，而且編譯不會報錯。規則見 `AGENTS.md` 的「Conventions」一節。

## 部署

`.github/workflows/deploy.yml` 將程式碼 rsync 到 UAT，確認環境檔存在，清理 Docker build cache，重新建置並啟動容器，最後驗證部署結果。

## OpenSpec 與文件

- OpenSpec change 位於 `openspec/changes/`，完成後移到 `openspec/changes/archive/`。
- `AGENTS.md` 是專案開發規則的單一真實來源。
- Feature、Fix、架構變更及完成 OpenSpec change 時，必須更新 `CHANGELOG.md`。
- `docs/ref/` 描述目前實作；`docs/` 中的編號文件可能包含早期規劃。

CI 與測試目前的缺口列在[實作落差與驗證紀錄](./AUDIT.md)。

