## 1. 測試

- [x] 1.1 `apps/api/tests/feature/modules/route-permission-guards.test.ts`：沒有任何權限的角色、缺少該路由需要的權限碼、具備需要的權限碼（逐條路由）、只有編輯權限時改負責人／升級工單／改標題、只能檢視的角色送訊息

## 2. 實作

- [x] 2.1 工單、對話、標籤、短連結路由依對照表掛 `requirePermission`；工單 PATCH 的條件檢查

## 3. 完成檢查

- [x] 3.1 `pnpm test`、`pnpm test:feature` 通過；`tsc` 通過
- [x] 3.2 `check-tenant-scoping.mjs --strict` 通過
- [x] 3.3 `CHANGELOG.md` 新增條目
- [x] 3.4 部署後在 UAT 確認：一般客服的收件匣、工單、標籤、短連結操作正常（2026-10-02 實測：補上角色的 admin 帳號操作收件匣、送訊息、轉接、工單、標籤、短連結，21 個請求全部成功、0 個 403）
