## Why

#337 階段 4 的第二批：把 `canvas` 模組的管理路由改成入口開交易（AGENTS.md 結構規則 2）。`canvas.service.ts` 只被自己的路由 import，所以可以先搬。

搬遷前的手動觸發（`POST /api/v1/canvas/:id/trigger`）有下列問題：

- 建立 execution 之後，在同一個請求裡馬上呼叫 `FlowRunner.run()`，不等結果。搬進交易之後，引擎會在 commit 之前讀這筆 execution，讀不到。
- 草稿（`DRAFT`）與封存（`ARCHIVED`）的流程也能觸發（AUDIT AUTO-11）。
- 不存在的 `contactId` 也回 202（AUDIT AUTO-11）。
- 流程與聯絡人的 id 都由呼叫端指定，觸發不檢查它們屬於哪個租戶：
  - PostgreSQL 的外鍵檢查不套用 RLS。所以傳入另一個租戶的流程 id，也能在自己的租戶建立 execution。引擎的 singleton 連線繞過 RLS 時，引擎會執行另一個租戶的流程節點。
  - `flow_executions.contactId` 沒有外鍵，任何 UUID 都能寫入。
  - AUDIT RLS-01 寫「進入 Canvas 的路徑都不接受外部指定的 ID」，這句不正確。

`canvas.routes.ts` 也放了身分合併建議的 3 條路由（`/api/v1/identity/suggestions`）。合併建議是第二種資源（結構規則 3）。合併引擎在 `contact` 模組，所以這 3 條路由搬到 `contact` 模組。

## What Changes

- 流程管理的 8 條路由改成呼叫 flow，service 改收 `TenantCtx`。除了下面列出的差異，路由的回應不變。
- 執行紀錄的列表先確認流程屬於本租戶，與其他流程端點一樣回 404。
- 執行紀錄的 `status` 篩選改收 execution 的狀態（`RUNNING`、`WAITING`、`COMPLETED`、`FAILED`）。搬遷前收的是流程的狀態（`DRAFT`、`ACTIVE`、`ARCHIVED`），任何篩選值都會失敗。
- 手動觸發：
  - 在交易內檢查流程屬於本租戶而且是 `ACTIVE`，也檢查聯絡人屬於本租戶。檢查通過才建立 execution。
  - 流程不存在或屬於另一個租戶時，回 404。流程不是 `ACTIVE` 時，回 409 `FLOW_NOT_ACTIVE`。聯絡人不存在或屬於另一個租戶時，回 404。
  - 引擎在 execution commit 之後才開始執行，每次觸發最多開始一次。
- 身分合併建議的 3 條路由搬到 `contact` 模組，改成呼叫 flow。核准後的 `contact.merged` 推播改用 `notifyTenant()`，在 commit 之後送出。路徑、權限與回應不變。
- 不在範圍：
  - Canvas 引擎（`packages/core/src/canvas/`）與 `canvas.webhook.ts` 的 singleton 連線（RLS-01、APP-07，階段 6）。
  - 收到訊息時的自動觸發（`triggerType = 'webhook'`，`canvas.webhook.ts`）。它的行為不變，仍用 singleton 建立 execution，建立之後馬上開始執行。這一批把「建立 execution」與「commit 之後開始執行」寫成自動觸發之後也能用的函式（design D6）。
  - 節點無法串接、`agent` 預設有 `canvas.use`、`API_FETCH` 沒有網址檢查（AUTO-11 的其他項目）。
  - JSON 欄位 `config`、`triggerConfig`、`vars` 的 schema（#405）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `interaction-canvas`：
  - 新增「流程管理只作用在本租戶的流程」（ADDED）。
  - 新增「執行紀錄依執行狀態篩選」（ADDED）。
  - 新增「手動觸發只接受本租戶啟用中的流程與本租戶的聯絡人」（ADDED）。
  - 新增「手動觸發在 execution commit 之後才開始執行」（ADDED）。

`identity-stitching-engine` 的「合併建議核准須在租戶邊界內執行」行為不變，沒有 delta。

## Impact

- 後端：
  - `apps/api/src/modules/canvas/`：新增 `canvas.flow.ts`。`canvas.service.ts` 改收 `TenantCtx`。`canvas.routes.ts` 只留流程管理的路由。
  - `apps/api/src/modules/contact/`：新增 `merge-suggestion.routes.ts`，合併建議的 flow 加進 `contact.flow.ts`。
  - `apps/api/src/index.ts`：`identityRoutes` 改從 `contact` 模組 import。
- API：
  - `POST /api/v1/canvas/:id/trigger`：新增 404 與 409 `FLOW_NOT_ACTIVE`。搬遷前，不存在的流程回 400（外鍵錯誤），不存在的聯絡人回 202。沒有前端呼叫 Canvas 的路由。
  - `GET /api/v1/canvas/:id/executions`：流程不存在或屬於另一個租戶時，改回 404。搬遷前回 200 與空陣列。`status` 改收 execution 的狀態。
  - 其他路由的路徑、權限與回應不變。`:id` 不是 UUID 時回 400。
- 測試：`tests/feature/modules/canvas/`、`tests/unit/modules/canvas/` 新增。`tests/feature/modules/contact/contact-merge-same-channel.test.ts` 改從新的路由檔 import。
- 文件：`docs/ref/features/feature-map.json`、`docs/ref/modules/CANVAS-FLOW-ENGINE.md`、`docs/ref/system/AUDIT.md`（AUTO-11、RLS-01）。
- 資料庫：不變。
