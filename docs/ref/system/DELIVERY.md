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

各種測試的寫法（mock、元件測試、資料隔離）見[撰寫測試](./TESTING.md)。

## CI

目前沒有 CI workflow 執行建置、測試、lint 或租戶隔離檢查。`.github/workflows/` 只有 `deploy.yml`，這個 workflow 只負責部署。

原本的 `ci.yml` 以 `--strict` 執行兩個租戶隔離靜態檢查，也執行 RLS 隔離測試 `apps/api/tests/feature/rls-isolation.test.ts`。commit `4b384b7` 刪除了 `ci.yml`。之後 commit `323deeb` 只恢復了 `deploy.yml`，這個 workflow 不執行任何檢查。

在 `ci.yml` 恢復之前，開發者必須在建立 Pull Request 前手動執行三個靜態檢查：

```bash
node scripts/check-tenant-scoping.mjs --strict
node scripts/check-prisma-admin-usage.mjs --strict
node scripts/check-workspace-esm.mjs --strict
```

前兩支檢查租戶隔離。第三支檢查 workspace 的 ESM 設定：套件少了 `"type": "module"` 會被編成 CJS，轉出式 re-export 在執行時變成 `undefined`，而且編譯不會報錯。規則見 `AGENTS.md` 的「Conventions」一節。

## 部署

`.github/workflows/deploy.yml` 將程式碼 rsync 到 UAT，確認環境檔存在，清理 Docker build cache，重新建置並啟動容器，最後驗證部署結果。

同一時間只跑一個部署（`concurrency: deploy-uat`）。每次部署 checkout 觸發它的 commit，所以接連合併多個 PR 時，排隊中的部署只保留最新一個，較舊的會自動取消；進行中的部署不中斷，避免做到一半留下半套版本。

## OpenSpec 與文件

- OpenSpec change 位於 `openspec/changes/`，完成後移到 `openspec/changes/archive/`。
- `AGENTS.md` 是專案開發規則的單一真實來源。
- Feature、Fix、架構變更及完成 OpenSpec change 時，必須更新 `CHANGELOG.md`。
- `docs/ref/` 描述目前實作；`docs/` 中的編號文件可能包含早期規劃。

### 封存 change

以 `pnpm exec openspec archive` 或 `openspec-archive-change` skill 封存 change。不要手動把 change 移進 `archive/`，也不要手動把 spec 複製到 `openspec/specs/`。手動複製可能留下 CLI 讀不了的主規格格式。

封存建立新的主規格時，CLI 把 `## Purpose` 寫成「TBD - created by archiving change …」。把這段改成這份規格的目的。下一節的驗證會拒絕這段文字。

### 驗證規格

`node scripts/validate-openspec.mjs --specs` 驗證所有主規格。`node scripts/validate-openspec.mjs <change-name>` 驗證一個 change。`main` 上的所有主規格都通過驗證。

腳本執行 `pnpm exec openspec validate --strict`。加了 `--strict`，警告也會讓指令失敗。常見的警告是 `## Purpose` 少於 50 字元。

腳本只忽略一種警告，而且只在主規格忽略：requirement 的文字超過 500 字元。許多主規格有這種 requirement，在拆開之前，`--strict` 一定會失敗。change 裡的這種警告不忽略，新的 requirement 太長時要拆開。

### 移除整份主規格

移除 `openspec/specs/<name>/` 之前，先確認這個能力是否還在規劃中：

1. 這個能力還在規劃中：把主規格的 requirement 複製到規劃這個能力的 change，寫成 `ADDED` delta spec。
2. 不在規劃中：只有下列情況可以移除主規格：
   - 產品沒有主規格描述的能力。
   - 另一份規格或文件已經涵蓋這個能力。
   - 主規格記錄的是一次性的工作，不是系統持續維持的行為。

不要手動刪除主規格的目錄。以一個 change 移除主規格，這個 change 包含：

- 一份 delta spec，在 `## REMOVED Requirements` 下列出主規格的每個 requirement。
- change 的 `.openspec.yaml` 寫 `retire_capabilities: true`。沒有這一行時，`pnpm exec openspec archive` 移除主規格的最後一個 requirement 時會失敗。

封存這個 change 時，CLI 刪除主規格的目錄。在 change 的 `proposal.md` 寫出移除每份主規格的原因。有規格或文件取代移除的主規格時，寫出該規格或文件的名稱。

CI 與測試目前的缺口列在[實作落差與驗證紀錄](./AUDIT.md)。

