## Why

主規格 `api-bootstrap` 有三條需求，其中兩條描述的是已經不存在的狀態：

- 「Transitional Entrypoints Must Delegate」規定 `apps/api/src/main.ts` 等過渡入口要委派給 `index.ts`。但 `10a80f8c`（2026-03-31）已經刪除 `main.ts`，`apps/api/src/` 也沒有其他建立 Fastify server 的檔案。
- 「Bootstrap Consolidation Preserves Active Runtime Behavior」記錄的是一次性的入口整併。整併已經完成。

issue #217 盤點主規格時，決定保留「唯一入口」，拿掉過渡入口的描述。

## What Changes

- 以 REMOVED 刪除上述兩條需求。
- 保留「Single Authoritative API Entrypoint」。
- 這個 change 不修改程式。

## Capabilities

### Modified Capabilities

- `api-bootstrap`：只剩「`apps/api/src/index.ts` 是唯一的 API 啟動入口」這條需求。

## Impact

- `openspec/specs/api-bootstrap/spec.md`。歸檔之後，這份主規格的 Purpose 也要改寫，拿掉「其他過渡入口只能委派給它」的描述；delta spec 無法修改 Purpose。
