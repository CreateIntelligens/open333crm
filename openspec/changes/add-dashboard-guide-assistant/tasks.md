## 1. 導覽目錄與權限碼

- [x] 1.1 測試先寫（`packages/shared/tests/unit/guide/guide-catalog.test.ts`）：「目錄有關鍵字自動回覆的導覽」「最後一步是標示」「點開的目標以 .open 結尾」「權限碼存在於註冊表」，以及路徑以 `/dashboard/` 開頭、id 不重複。目錄是空陣列時，「目錄有關鍵字自動回覆的導覽」失敗在斷言上。
- [x] 1.2 實作 `packages/shared/src/guide/guide-catalog.ts`：12 條導覽與 `guidesForPermissions()`，從 `@open333crm/shared` 匯出。
- [x] 1.3 `permissions.ts` 新增 `assistant.use`（feature `knowledge`），`default-roles.ts` 的三個系統角色預設都有。

## 2. API

- [x] 2.1 測試先寫（`apps/api/tests/feature/modules/ai/guide-assistant.test.ts`，`app_tenant` 連線、真的 Redis、假的 Chat 與向量化 fetch）：「以知識庫回答」「只檢索本租戶的文章」「問題是空字串」「沒有 assistant.use」「有權限時回傳導覽」「沒有權限時不回傳導覽」「LLM 回傳不存在的導覽」「LLM 的回覆不是 JSON」「記錄助理的用量」「月額度已滿」。`tests/support/fake-chat.ts` 另外記錄送給 LLM 的訊息，讓測試檢查交給 LLM 的導覽清單。
- [x] 2.2 實作：`rbac.guard.ts` 新增 `getRequestPermissions()`（`isPermitted()` 改用它）；`guide-assistant.service.ts`（提示詞、知識庫內容、回覆解析）、`guide-assistant.flow.ts`（檢索 → `generateReply()` → 檢查導覽）、`guide-assistant.routes.ts`（Zod 與 `requirePermission('assistant.use')`）；`index.ts` 以 `/api/v1/ai/guide-assistant` 註冊；`AiFeature` 新增 `guide-assistant`。
- [x] 2.3 突變驗證（2.1 的測試在實作後才執行，逐項破壞實作，確認對應的測試失敗）：
  - 不以權限過濾導覽：「沒有權限時不回傳導覽」失敗。
  - 不檢查 `guideId` 是否在過濾後的導覽中：「沒有權限時不回傳導覽」失敗。
  - 沒有文章時仍呼叫 LLM：「只檢索本租戶的文章」失敗。
  - `feature` 改成 `unknown`：「記錄助理的用量」失敗。
  - 拿掉 `requirePermission('assistant.use')`：「沒有 assistant.use」失敗。

## 3. 前端

- [x] 3.1 測試先寫（`apps/web/tests/unit/lib/guide/guide-runner.test.ts`，jsdom）：「先切換頁面」「點開入口並標示欄位」「找不到欄位」，以及「已在功能頁時不切換頁面」「切換頁面後才找元素」。`runGuide()` 是空實作時，前三個測試失敗在斷言上。後兩個測試在空實作時通過，以突變驗證：拿掉「路徑變成功能頁之前不找元素」時「切換頁面後才找元素」失敗；一律切換頁面時「已在功能頁時不切換頁面」失敗。
- [x] 3.2 實作 `apps/web/src/lib/guide/guide-runner.ts` 的 `runGuide()`。
- [x] 3.3 測試（`apps/web/tests/unit/components/ai/guide-assistant-panel.test.tsx`，jsdom）：「回應有導覽時顯示帶我去」「回應沒有導覽時不顯示帶我去」「按下帶我去後執行導覽」「找不到欄位」「沒有權限的員工」。突變驗證：一律顯示「帶我去」時「回應沒有導覽時不顯示帶我去」失敗；拿掉權限判斷時「沒有權限的員工」失敗。
- [x] 3.4 實作 `GuideAssistantPanel.tsx`、`GuideSpotlight.tsx`，掛在 `app/dashboard/layout.tsx`。開發環境的按鈕位置避開 `SimulatorPanel`。沒有 emoji。
- [x] 3.5 導覽用到的元素加 `data-guide` 屬性；優惠券的 `TextField` 新增 `guide` prop。測試（`apps/web/tests/unit/lib/guide/guide-targets.test.ts`）檢查每個 `target` 在 `apps/web/src` 都找得到。突變驗證：拿掉 `tag.open` 的屬性時測試失敗。

## 4. PR 審查修正

- [x] 4.1 測試先寫：`guide-assistant.test.ts`「沒有 knowledge.view」；`guide-assistant-panel.test.tsx`「沒有 knowledge.view 的員工」「關閉面板後不顯示舊請求的回覆」「歷史訊息每則最多 2000 字」。修改前 4 個測試都失敗在斷言上。
- [x] 4.2 實作：路由另外要求 `knowledge.view`，`assistant.use` 的 `dependsOn` 是 `knowledge.view`；面板同時檢查兩個權限；關閉面板時以編號丟掉舊請求的回覆；`history` 每則截到 2000 字。

## 5. 平台層

- [x] 5.1 `assistant.use` 掛在 feature `knowledge`，路由以 `requirePermission()` 保護（1.3、2.2）。
- [x] 5.2 LLM 呼叫經 `generateReply()`：月額度、AI 隱私政策與 `recordLlmUsage()`（2.1 的「記錄助理的用量」「月額度已滿」）。
- [ ] 5.3 部署後在 UAT 執行 `scripts/grant-new-role-permissions.mjs assistant.use`，再清除 Redis 的 `perms:*` 快取。

## 6. 文件

- [x] 6.1 `docs/ref/features/tenant/KNOWLEDGE.md` 新增「後台助理」一節、模組表、入口表與權限表；`.claude/skills/feature-knowledge/SKILL.md` 的涵蓋範圍與回歸清單。
- [x] 6.2 `CHANGELOG.md` 的 `## [2026-11-20]` 新增條目。

## 7. 完成定義

- [x] 7.1 `pnpm test`：這個 change 的測試全部通過。`apps/api` 另有 4 個失敗在 main 上就存在，與這個 change 無關：`case-ui-source.test.ts`、`portal/datetime-timezone.test.ts`、`url-scheme-validation.test.ts`（讀的前端檔案已被改版刪除）與 `storage-presign-purpose.test.ts`（整批執行時 `beforeAll` 逾時）。
- [x] 7.2 `pnpm test:feature`：1912 個通過。1 個失敗在 main 上就存在：`scripts/dedupe-sla-events.test.ts`。`fake-chat.ts` 改成也記錄訊息後，`chat-settings.test.ts`「呼叫 LLM 不建立設定列」改成只比對模型。
- [x] 7.3 `pnpm build` 通過。
- [x] 7.4 `check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 沒有新增違規。
- [x] 7.5 `node scripts/feature-impact.mjs --check` 通過；`node scripts/validate-openspec.mjs add-dashboard-guide-assistant` 與 `--specs` 通過；`node scripts/check-doc-history.mjs --strict` 通過。
- [ ] 7.6 部署後在 UAT 的 Demo 租戶，用 admin 試 12 條導覽，用一般 agent 試沒有權限的導覽。
- [ ] 7.7 7.6 完成後，以 `pnpm exec openspec archive` 歸檔。
