## 1. 搬遷前補測試（現有行為）

- [ ] 1.1 新增 `apps/api/tests/feature/modules/line/rich-menu-routes.test.ts`：以真實路由、`richmenu.manage` 與 `app_tenant` 連線測 CRUD 與複製：「建立草稿成功」、「拒絕跨 tenant 渠道」、列表要 `channelId`、已發布的選單不能修改或刪除、「成功複製」、沒有 `richmenu.manage` 回 403。LINE 以 mock 的 `fetch` 取代。在搬遷前的程式上通過，並以突變驗證（拿掉 `existing.status !== 'draft'` 的守衛、拿掉 `tenantId` 條件），突變記在本節
- [ ] 1.2 確認 `tests/unit/modules/line/line-profile.service.test.ts`、`tests/feature/modules/line/line-profile-sync.test.ts` 在搬遷前通過，搬遷後改呼叫 flow 仍通過

## 2. 拆開預設與展開（design D9）

- [ ] 2.1 新增 migration：`rich_menus` 加 `is_default boolean not null default false`，`UPDATE rich_menus SET is_default = selected`；`selected` 的預設值改成 `true`。`schema.prisma` 的 `RichMenu` 加 `isDefault`，`selected` 的註解改成「聊天室打開時是否展開選單（LINE 的 selected）」
- [ ] 2.2 在 1.1 的測試檔先寫會失敗的測試：「未傳入展開狀態」（建立時沒有 `selected`，回應的 `selected` 是 `true`）、建立與修改接受 `isDefault`、複製帶上 `isDefault`。新增 `apps/api/tests/feature/migrations/rich-menu-is-default.test.ts`：「既有選單的預設狀態」（對測試資料執行 migration 的 `UPDATE`，`selected = true` 的列 `is_default` 是 `true`）
- [ ] 2.3 API 的 schema 與 service 加上 `isDefault`，`selected` 預設 `true`。2.2 通過

## 3. 搬遷 service 與 flow

- [ ] 3.1 `rich-menu.service.ts` 的 CRUD、複製、列表改收 `TenantCtx`；新增 `rich-menu.flow.ts`（CRUD 用 `flowOf`），`rich-menu.routes.ts` 改呼叫 flow，route 不再使用 `request.tenantPrisma`。1.1、2.2 的測試通過
- [ ] 3.2 `line-profile.service.ts` 拆成交易 1 讀取、交易 2 寫入兩個 service 函式；新增 `line-profile.flow.ts`，LINE profile API 在交易外呼叫（design D7）。1.2 的測試通過

## 4. 發布：認領與並行（design D1、D3）

- [ ] 4.1 新增 `apps/api/tests/feature/modules/line/rich-menu-publish.test.ts`（LINE 以 mock 的 `fetch` 取代，記錄呼叫次數），先寫會失敗的測試：「同一個選單同時發布兩次」、「同一個渠道的兩個選單同時發布」、「不同渠道的選單同時發布」、「重新發布中斷的選單」（以 SQL 把 `updatedAt` 改成 6 分鐘前）、「發布中的選單不能重新發布」
- [ ] 4.2 實作交易 1：渠道的 advisory lock、同渠道 `publishing` 的檢查、條件更新認領（含超過 5 分鐘的 `publishing`）、回 409 `PUBLISH_IN_PROGRESS`。LINE 呼叫加 30 秒逾時。4.1 通過

## 5. 發布：補償、預設與展開（design D2、D4、D9）

- [ ] 5.1 新增 `apps/api/tests/unit/modules/line/rich-menu-publish.flow.test.ts`（mock scope 與 `fetch`），先寫會失敗的測試：
  - 「上傳背景圖失敗」：呼叫 LINE 刪除，`status=error`，`lineRichMenuId` 是 null
  - 「寫入發布結果失敗」：交易 2 丟錯誤時呼叫 LINE 刪除；設預設已成功時，先把 LINE 的預設設回舊選單
  - 「建立選單失敗」：不呼叫刪除
  - 「重新發布失敗的選單」
  - 「Set default」：不呼叫 `DELETE /v2/bot/user/all/richmenu`，同渠道其他選單 `isDefault=false`
  - 「設預設失敗」：新選單 `isDefault=false`，舊選單不變，`warnings` 含 `DEFAULT_NOT_SET`
  - 「設預設成功」
  - 「預設選單設為收合」、「非預設選單設為展開」：LINE 建立選單 API 的 `selected` 等於選單的 `selected`
- [ ] 5.2 實作交易外的 LINE 呼叫、補償刪除、交易 2 的條件更新；刪除 `unsetCurrentDefault()`；建立選單時送 `selected`，設預設看 `isDefault`；回應帶 `warnings`。5.1 通過
- [ ] 5.3 `tests/unit/modules/line/rich-menu-default.test.ts` 改呼叫 flow、改用 `isDefault`，仍通過

## 6. 取消發布（design D5）

- [ ] 6.1 在 `rich-menu-publish.flow.test.ts` 新增測試：
  - 先寫會失敗的「Cancel default」（LINE 目前的預設是這個選單才取消）與「取消發布時 LINE 的預設是別的選單」（不取消）
  - LINE 刪除回 404 仍寫回 `draft`：現有行為，以突變驗證（把 404 視為失敗）
  - 交易 2 的條件更新 `count = 0` 時回傳目前的選單、不丟錯誤
- [ ] 6.2 實作取消發布的三段寫法與查詢 LINE 目前的預設；取消發布時寫回 `isDefault=false`。6.1 通過

## 7. 分眾綁定經 outbox（design D6）

- [ ] 7.1 新增 `apps/api/tests/unit/modules/line/rich-menu-bind.flow.test.ts`，先寫會失敗的測試：「Redis 無法使用時發起綁定」（綁定寫進 outbox，`queue.add()` 沒有被呼叫，回傳排入人數）；工作的 payload 含 `richMenuId`；工作選項的保留期限是完成 24 小時、失敗 7 天
- [ ] 7.2 實作 bind 與 unbind 的 flow，以 `enqueueJob()` 送出；刪除自建的 `Queue` 與 `closeRichMenuBindQueue()`。刪除 `tests/unit/modules/line/rich-menu-bind-queue-options.test.ts`，保留期限改由 7.1 檢查。7.1 通過
- [ ] 7.3 在 `apps/workers/tests/unit/handlers/rich-menu-bind.test.ts` 先寫會失敗的測試：「綁定工作晚於取消發布執行」、「綁定工作晚於重新發布執行」不呼叫 LINE；「選單仍在發布中」呼叫 LINE；`op=unlink` 不查選單；payload 沒有 `richMenuId` 時照舊執行
- [ ] 7.4 實作 workers 的檢查。7.3 通過

## 8. 前端（spec「發布中斷或失敗的選單可以重新發布」「圖文選單展開狀態」「Default Rich Menu」）

- [ ] 8.1 新增 `apps/web/tests/unit/app/dashboard/line/rich-menus-status.test.tsx`（jsdom），先寫會失敗的測試：「列表頁顯示發布中與發布失敗」；發布回應帶 `DEFAULT_NOT_SET` 時顯示提示
- [ ] 8.2 在 `apps/web/tests/unit/components/line/rich-menu-default.test.tsx` 先寫會失敗的測試：編輯頁有「聊天室打開時展開選單」選項，新建時預設勾選；「設為所有好友的預設選單」寫入 `isDefault`。既有的「New draft is not the default」「Check the default option」「Publish a default menu」「Unpublish a default menu」改用 `isDefault` 後仍通過
- [ ] 8.3 `useRichMenus.ts` 加上 `isDefault` 與 `publishing`；`RichMenuEditor.tsx` 拆成兩個選項，說明文字拿掉「好友開啟對話時也會自動展開」；新建、編輯、列表頁與 `rich-menu-confirm.ts` 改看 `isDefault`；列表頁加上「發布中」標籤，`error` 的選單顯示「發布」按鈕，顯示 `DEFAULT_NOT_SET` 的提示。8.1、8.2 通過

## 9. 完成條件

- [ ] 9.1 `pnpm test` 通過
- [ ] 9.2 `pnpm test:feature` 通過
- [ ] 9.3 `pnpm build` 通過（改了 `apps/web` 與 `packages/database`）
- [ ] 9.4 `node scripts/check-tenant-ctx.mjs --strict` 通過，`--update-baseline` 後 `line` 模組的舊寫法是 0；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增的違規
- [ ] 9.5 `node scripts/feature-impact.mjs` 列出受影響的領域，逐項檢查 `feature-line`、`feature-marketing` 的回歸清單；`feature-map.json` 需要時更新，`--check` 通過
- [ ] 9.6 CHANGELOG 的 `Changed` 新增一條，寫明可觀察的差異：發布的 409、設預設不再先取消全體預設與失敗時的警告、`isDefault` 與 `selected` 分開、Redis 無法使用時綁定改回 200
- [ ] 9.7 更新 `docs/ref/features/`、`docs/ref/DATABASE-ERD.md` 與 `.claude/skills/feature-line/` 中描述圖文選單發布、預設與綁定的段落
- [ ] 9.8 `node scripts/validate-openspec.mjs migrate-line-tenant-ctx` 通過；歸檔前後比較「略過 N 則」
- [ ] 9.9 開對帳排程的 issue（草稿在 `tmp/圖文選單對帳-issue-草稿.md`，發出前給使用者確認），在 design 的已知限制補上 issue 編號
