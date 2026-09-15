## 1. 修正 packages/core 模組格式（根因）

- [x] 1.1 在 `packages/core/package.json` 補上 `"type": "module"`（對齊 `packages/database`、`packages/shared`）
- [x] 1.2 `pnpm --filter @open333crm/core build`，逐一修正 `NodeNext` 在編譯期報出的相對匯入缺副檔名問題（補 `.js`）
- [x] 1.3 檢查 `packages/core/package.json` 的 `exports` 條件：目前 `import` 與 `require` 同指 `./dist/index.js`，轉 ESM 後移除 `require` 條件或確認其不被使用
- [x] 1.4 確認四個無 consumer 的檔案（`contacts/contact-service.ts`、`inbox/inbox-service.ts`、`identity/merge-suggestion-service.ts`、`canvas/flow-runner.ts`）在轉換後仍可編譯；若阻塞則於本 change 內僅做最小修正使其通過，不改商業邏輯

## 2. identity-stitcher 改為注入式 Prisma executor

- [x] 2.1 在 `packages/core/src/identity/identity-stitcher.ts` 移除 `import { prisma } from '@open333crm/database'`
- [x] 2.2 `resolveUidToContact(tenantId, channelType, uid)` 改為 `resolveUidToContact(db, tenantId, channelType, uid)`，第一參數型別比照 `tagging.service.ts` 的 `PrismaExecutor` 慣例
- [x] 2.3 同檔其餘 6 處 `prisma.*` 呼叫（`stitchByLiffCookie`、`stitchByPhone`、`detectPhoneDuplicates`、`upsertIdentityMap`）一併改為使用注入的 executor
- [x] 2.4 保留 `import type { ChannelType } from '@prisma/client'`（型別匯入不受執行期影響）

## 3. 呼叫端接線（apps/api）

- [x] 3.1 `apps/api/src/modules/webhook/inbound-contact-resolver.ts` 的 `resolveInboundContact` 傳入租戶綁定的 prisma（非 `prismaAdmin`）
- [x] 3.2 全域搜尋 `resolveUidToContact` 與其他 identity-stitcher 匯出符號的呼叫點，逐一補上 executor 參數
- [x] 3.3 `pnpm typecheck` 全綠，確認無遺漏呼叫點

## 4. 可觀測性：應用層 log 輸出 stdout（部署設定，非程式碼）

- [x] 4.1 ~~新增 stdout transport~~ — 查證後確認 logger 程式碼已支援 `console`/`file`/`both`，無需修改
- [x] 4.2 確認 UAT 現況為 `LOG_TRANSPORT=file`（容器內實測），這是應用層 log 不進 `docker logs` 的真正原因
- [ ] 4.3 部署設定改為 `LOG_TRANSPORT=both`（保留檔案輸出與輪替，同時輸出 stdout）
- [ ] 4.4 部署後驗證 `docker logs open333crm-api` 看得到 `[Webhook]` 系列應用層 log

## 5. 防迴歸測試

- [x] 5.1 新增整合測試：新 UID 首次進站 → 建立聯絡人 + 對話 + 訊息落地（對應 spec Scenario「全新使用者第一次傳訊息」）
- [x] 5.2 新增測試：已綁定身分的 UID 進站 → 歸戶既有聯絡人，不建立重複
- [x] 5.3 新增測試：跨租戶相同 UID 不互相污染（對應 spec Requirement「UID 解析須在租戶邊界內進行」）
- [ ] 5.4 （後續）於 RLS 啟用環境跑一次真 DB 整合測試；目前測試以 stub executor 覆蓋契約層

## 6. 驗證與收尾

- [x] 6.1 本機 `pnpm build` 全綠（api / workers / channel-plugins 三個 core consumer 皆須通過）
- [ ] 6.2 本機以 WEBCHAT 渠道驗證新訪客首次進站可正常建檔（LINE/FB 本機收不到 webhook，見專案既有限制）
- [x] 6.3 更新 `CHANGELOG.md`（`Fixed` 分類，date-only heading `## [YYYY-MM-DD]`）
- [x] 6.4 修正 `openspec/config.yaml` 與 `AGENTS.md` 的 Prisma 匯入規則，補上「套件內部不得依賴全域 prisma 單例，需 DB 存取的共用函式由呼叫端注入 executor」
- [ ] 6.5 部署 UAT 後，請原回報者（jiarongm）以其 LINE 帳號重新發送訊息，確認聯絡人自動建立且訊息出現在收件匣

## 7. 額外守門（實作中新增）

- [x] 7.1 新增 `scripts/check-workspace-esm.mjs`：偵測 CJS 套件匯入 ESM 套件的轉出式 re-export 符號（此類退化編譯期不報錯）
- [x] 7.2 以「還原 bug → 檢查回報 7 處且 --strict exit 1 → 修復後 exit 0」驗證守門有效
- [~] 7.3 ~~將 `check-workspace-esm.mjs --strict` 接進 CI workflow~~ — **本次不做（2026-09-15 決議）**。專案目前無測試型 CI workflow（`.github/workflows/` 僅 `deploy.yml`），守門腳本先以手動執行為主；待日後建置 CI 時再掛入。
