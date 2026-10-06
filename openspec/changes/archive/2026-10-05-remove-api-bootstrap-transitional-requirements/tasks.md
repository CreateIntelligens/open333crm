## 1. 確認現況

這個 change 只刪除不再描述任何行為的需求，不修改程式，因此沒有測試任務。

- [x] 1.1 確認 `apps/api/src/main.ts` 不存在（`10a80f8c` 刪除），`apps/api/src/` 只有 `index.ts` 建立 Fastify server
- [x] 1.2 確認 dev（`tsx watch src/index.ts`）、start（`node dist/index.js`）與 Docker（`docker-entrypoint.sh`）都直接執行 `index.ts` 或它的建置結果

## 2. 完成檢查

- [x] 2.1 `openspec validate remove-api-bootstrap-transitional-requirements --strict` 通過
- [x] 2.2 以 `openspec archive` 歸檔本 change，把 REMOVED 套用到主規格
- [x] 2.3 主規格 `api-bootstrap` 的 Purpose 拿掉過渡入口的描述
- [x] 2.4 `openspec validate --specs --strict` 通過
