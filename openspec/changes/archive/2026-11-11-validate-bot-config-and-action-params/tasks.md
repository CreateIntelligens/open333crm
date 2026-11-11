## 1. 讀取機器人設定（bot-handoff-config）

- [x] 1.1 測試 `packages/automation/tests/unit/bot-config.test.ts`：「轉接關鍵字有空字串」「欄位型別錯誤」「轉接訊息空白」與完整合法設定原樣讀出，在現有程式上斷言失敗
- [x] 1.2 `packages/automation` 加 `zod` 依賴；`bot-config.ts` 新增 `botConfigSchema`，`getBotConfig()` 逐欄以同一份定義讀取（design D1、D2）
- [x] 1.3 測試 `apps/api/tests/unit/modules/automation/bot-config-auto-handoff.test.ts`：「轉接關鍵字有空字串」走 `message.received` → 自動轉接，空字串不讓每則訊息都轉接，在現有程式上斷言失敗
- [x] 1.4 `kb-autoreply.service.ts` 刪除 `resolveBotConfig()` 改用 `getBotConfig()`；webhook 的 `getBotConfig(ctx)` 回傳 `getBotConfig()` 的結果，拿掉呼叫端的轉型（design D4）；既有 KB 轉接提示測試維持通過

## 2. 寫入機器人設定（channel-management）

- [x] 2.1 測試 `apps/api/tests/unit/modules/channel/bot-config-validation.test.ts`：「設定畫面送出的完整設定可以儲存」「轉接關鍵字有空白字串被拒」「型別錯誤的欄位被拒」「未改動的舊設定不阻擋其他設定」「未改動的舊值不阻擋其他設定」「建立渠道時超出範圍的值被拒」，走 `updateChannel()` 與建立渠道路由；「超出範圍的值被拒」「轉接關鍵字有空白字串被拒」「型別錯誤的欄位被拒」在現有程式上斷言失敗（「應回 400」）。兩個「未改動」情境在現有程式（service 不檢查）上寫好就通過，以突變驗證：拿掉 `assertBotConfigWritable()` 的相同比較時兩個都失敗，已還原
- [x] 2.2 `updateChannel()` 在 botConfig 改變時以 `botConfigSchema` 檢查，丟 `AppError(..., 'VALIDATION_ERROR', 400, { issues })`；建立渠道的路由改用 `botConfigSchema`；路由的 `validateBotConfigSettings()` 移除（design D3）
- [x] 2.3 「範圍內的值可以儲存」「超出範圍的值被拒」改為走 `updateChannel()`（檢查從路由移到 service，design D3）

## 3. 自動化動作參數型別（automation-contract-composer）

- [x] 3.1 測試 `packages/automation/tests/unit/contracts/validation.test.ts`：「Text parameter that is not a string rejected」在現有程式上斷言失敗；「Parameters sent by the rule editor accepted」「Parameters not in the contract are not checked」寫好就通過，以突變驗證（`paramTypeError()` 改成一律回傳「必須是文字」時，兩個測試都失敗，已還原）
- [x] 3.2 `validateActionParams()` 依 `param.type` 檢查型別（design D5）
- [x] 3.3 測試 `apps/api/tests/unit/modules/automation/automation-param-types.test.ts`：API 以 `text` 為物件建立規則回 400、不寫入；以規則編輯器送出的完整內容建立規則回 201

## 4. 完成定義

- [x] 4.1 `pnpm test`；另以 `TEST_DATABASE_NAME=open333crm_test_405` 跑 api feature 的 channel、automation、webhook（19 檔、167 個測試）
- [x] 4.2 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 4.3 `node scripts/validate-openspec.mjs --specs`、`node scripts/validate-openspec.mjs validate-bot-config-and-action-params`
- [x] 4.4 `pnpm build`
- [x] 4.5 `CHANGELOG.md` 的 `## [2026-11-11]` 加條目；`docs/ref/system/AUDIT.md` 沒有對應項目（不需更新）；`docs/ref/features/tenant/INBOX.md` 補上寫入與讀取規則
- [x] 4.6 歸檔：部署到 UAT 驗證後才歸檔（部署前以 design.md「Risks」的 SQL 查 UAT 既有的 botConfig）。2026-11-11 已查：UAT 9 個渠道的 botConfig 都合法，220 條自動化規則沒有非字串參數；PR #512 部署後，渠道設定存檔回 200，LINE、FB 的 AI 照常回覆
