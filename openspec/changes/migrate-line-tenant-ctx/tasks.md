## 1. 搬遷前補測試（現有行為）

- [x] 1.1 新增 `apps/api/tests/feature/modules/line/rich-menu-routes.test.ts`：以真實路由、`richmenu.manage` 與 `app_tenant` 連線測 CRUD 與複製：「建立草稿成功」、「拒絕跨 tenant 渠道」、列表要 `channelId`、已發布的選單不能修改或刪除、「成功複製」、沒有 `richmenu.manage` 回 403。在搬遷前的程式上通過（11 項），並以突變驗證，每個突變都讓對應的 1 項失敗：
  - 修改的 `existing.status !== 'draft'` 守衛改成 `false`：「已發布的選單不能修改」失敗
  - 刪除的守衛改成 `false`：「拒絕刪除已 publish」失敗
  - `channel.channelType !== 'LINE'` 改成 `false`：「拒絕非 LINE 渠道」失敗
  - 複製時 `status: 'draft'` 改成 `source.status`：「成功複製」失敗

  原本計畫的「拿掉 `tenantId` 條件」不做：測試走 `app_tenant` 連線，RLS 仍會擋下其他租戶的列，這個突變不會讓測試失敗。CRUD 不呼叫 LINE，不需要 mock `fetch`
- [x] 1.2 確認 `tests/unit/modules/line/line-profile.service.test.ts`、`tests/feature/modules/line/line-profile-sync.test.ts` 在搬遷前通過，搬遷後改呼叫 flow 仍通過。搬遷後 unit 測試改測兩個 service 函式（3 項）；feature 測試的 `fastify.prisma` 從 owner 改成 `app_tenant` 連線，讓 flow 的交易受 RLS 約束（12 項）

## 2. 拆開預設與展開（design D9）

- [x] 2.1 新增 migration：`rich_menus` 加 `"isDefault" boolean not null default false`，`UPDATE rich_menus SET "isDefault" = selected`；`selected` 的預設值改成 `true`。`schema.prisma` 的 `RichMenu` 加 `isDefault`，`selected` 的註解改成「聊天室打開時是否展開選單（LINE 的 selected）」
- [x] 2.2 在 1.1 的測試檔先寫會失敗的測試：「未傳入展開狀態」（建立時沒有 `selected`，回應的 `selected` 是 `true`）、建立與修改接受 `isDefault`、複製帶上 `isDefault`。新增 `apps/api/tests/feature/migrations/rich-menu-is-default.test.ts`：「既有選單的預設狀態」（對測試資料執行 migration 的 `UPDATE`，`selected = true` 的列 `isDefault` 是 `true`）。API 的 3 項修正前以 assertion 失敗；migration 測試要等欄位存在才能執行，所以以突變驗證：`UPDATE` 改成 `SET "isDefault" = false` 時失敗
- [x] 2.3 API 的 schema 與 service 加上 `isDefault`，`selected` 預設 `true`。2.2 通過

## 3. 搬遷 service 與 flow

- [x] 3.1 `rich-menu.service.ts` 的 CRUD、複製、列表改收 `TenantCtx`；新增 `rich-menu.flow.ts`（CRUD 用 `flowOf`），`rich-menu.routes.ts` 改呼叫 flow，route 不再使用 `request.tenantPrisma`。1.1、2.2 的測試通過。依 AGENTS.md 的 Validation，CRUD 的 `:id` 改以 Zod 檢查 UUID，新增測試「`:id` 不是 UUID 回 400 VALIDATION_ERROR」，以突變驗證（拿掉檢查時失敗）。發布、取消發布、綁定在第 4～7 節改寫，這之前以檔內的 `findRichMenu()` 共用查詢
- [x] 3.2 `line-profile.service.ts` 拆成交易 1 讀取、交易 2 寫入兩個 service 函式；新增 `line-profile.flow.ts`，LINE profile API 在交易外呼叫（design D7）。1.2 的測試通過。突變驗證：拿掉渠道查詢的 `tenantId`、拿掉寫入條件的 `tenantId`，各讓 1 項失敗；前者原本被身分查詢的同樣 404 蓋過，測試改成比對錯誤訊息

## 4. 發布：認領與並行（design D1、D3）

- [x] 4.1 新增 `apps/api/tests/feature/modules/line/rich-menu-publish.test.ts`（LINE 以 mock 的 `fetch` 取代，記錄呼叫次數），先寫會失敗的測試：「同一個選單同時發布兩次」、「同一個渠道的兩個選單同時發布」、「不同渠道的選單同時發布」、「重新發布中斷的選單」（以 SQL 把 `updatedAt` 改成 6 分鐘前）、「發布中的選單不能重新發布」。前兩項與最後一項修正前以 assertion 失敗（第一項 LINE 被呼叫兩次）；「不同渠道的選單同時發布」與「重新發布中斷的選單」是現有行為，以突變驗證：同渠道檢查拿掉 `channelId`、認領拿掉「超過 5 分鐘的 publishing」，各讓 1 項失敗
- [x] 4.2 實作交易 1：渠道的 advisory lock、同渠道 `publishing` 的檢查、條件更新認領（含超過 5 分鐘的 `publishing`）、回 409 `PUBLISH_IN_PROGRESS`。LINE 呼叫加 30 秒逾時，逾時或連不上時轉成 `LINE_API_ERROR`；LINE 的呼叫移到 `rich-menu.line-api.ts`。4.1 通過

## 5. 發布：補償、預設與展開（design D2、D4、D9）

- [x] 5.1 新增 `apps/api/tests/unit/modules/line/rich-menu-publish.flow.test.ts`（mock scope 與 `fetch`），先寫會失敗的測試：
  - 「上傳背景圖失敗」：呼叫 LINE 刪除，`status=error`，`lineRichMenuId` 是 null
  - 「寫入發布結果失敗」：交易 2 丟錯誤時呼叫 LINE 刪除；設預設已成功時，先把 LINE 的預設設回舊選單
  - 「建立選單失敗」：不呼叫刪除
  - 「重新發布失敗的選單」
  - 「Set default」：不呼叫 `DELETE /v2/bot/user/all/richmenu`，同渠道其他選單 `isDefault=false`
  - 「設預設失敗」：新選單 `isDefault=false`，舊選單不變，`warnings` 含 `DEFAULT_NOT_SET`
  - 「設預設成功」
  - 「預設選單設為收合」、「非預設選單設為展開」：LINE 建立選單 API 的 `selected` 等於選單的 `selected`
  - 背景圖下載失敗：不呼叫 LINE，狀態回到發布前（design D8）

  先以暫時的 flow（交易內呼叫舊的 `publishRichMenu()`）確認 6 項以 assertion 失敗。上傳失敗、建立失敗、背景圖下載失敗、重新發布失敗的選單是現有行為，以突變驗證：不補償刪除、失敗一律記成 `draft`、下載失敗記成 `error`、認領不收 `error`，各讓對應的測試失敗
- [x] 5.2 實作交易外的 LINE 呼叫、補償刪除、交易 2 的條件更新；刪除 `unsetCurrentDefault()`；建立選單時送 `selected`，設預設看 `isDefault`；回應帶 `warnings`。5.1 通過
- [x] 5.3 `tests/unit/modules/line/rich-menu-default.test.ts` 的兩個發布測試與 5.1 的「Set default」「非預設選單設為展開」重複，移除；取消發布的兩個測試在 6.1 改寫

## 6. 取消發布（design D5）

- [x] 6.1 在 `rich-menu-publish.flow.test.ts` 新增測試：
  - 先寫會失敗的「Cancel default」（LINE 目前的預設是這個選單才取消）與「取消發布時 LINE 的預設是別的選單」（不取消）
  - LINE 刪除回 404 仍寫回 `draft`：現有行為，以突變驗證（把 404 視為失敗）
  - 交易 2 的條件更新 `count = 0` 時回傳目前的選單、不丟錯誤
  - 取消發布非預設的選單不查也不取消 LINE 的預設；取消發布保留 `isDefault`

  先以暫時的 flow 確認「LINE 的預設是別的選單」「非預設的選單」以 assertion 失敗。404 與 `count = 0` 以突變驗證（404 視為失敗、`count = 0` 丟錯誤），各讓 1 項失敗。`rich-menu-default.test.ts` 的取消發布測試由這些測試取代，刪除該檔
- [x] 6.2 實作取消發布的三段寫法與查詢 LINE 目前的預設。6.1 通過。實作時修正 design：取消發布保留 `isDefault`、設預設成功只清其他已發布選單的 `isDefault`，草稿的 `isDefault` 是「發布時設成預設」的設定

## 7. 分眾綁定經 outbox（design D6）

- [x] 7.1 新增 `apps/api/tests/unit/modules/line/rich-menu-bind.flow.test.ts`，先寫會失敗的測試：「Redis 無法使用時發起綁定」（綁定寫進 outbox，`queue.add()` 沒有被呼叫，回傳排入人數）；工作的 payload 含 `richMenuId`；工作選項的保留期限是完成 24 小時、失敗 7 天；草稿綁定回 400 `NOT_PUBLISHED`（現有行為）。先以暫時的 flow 確認前 3 項以 assertion 失敗
- [x] 7.2 實作 bind 與 unbind 的 flow，以 `enqueueJob()` 送出；刪除自建的 `Queue` 與 `closeRichMenuBindQueue()`。刪除 `tests/unit/modules/line/rich-menu-bind-queue-options.test.ts`，保留期限改由 7.1 檢查。7.1 通過。service 不再收 `TenantDb`，`line` 模組的舊寫法是 0
- [x] 7.3 在 `apps/workers/tests/unit/handlers/rich-menu-bind.test.ts` 先寫會失敗的測試：「綁定工作晚於取消發布執行」、「綁定工作晚於重新發布執行」不呼叫 LINE；「選單仍在發布中」呼叫 LINE；`op=unlink` 不查選單；payload 沒有 `richMenuId` 時照舊執行（既有的 4 項，payload 本來就沒有 `richMenuId`）；另加「選單已刪除」不呼叫 LINE。前 3 項以 assertion 失敗；「選單仍在發布中」與「解除綁定不查選單」以突變驗證（一律跳過、解除綁定也檢查）
- [x] 7.4 實作 workers 的檢查。7.3 通過

## 8. 前端（spec「發布中斷或失敗的選單可以重新發布」「圖文選單展開狀態」「Default Rich Menu」）

- [x] 8.1 新增 `apps/web/tests/unit/app/dashboard/line/rich-menus-status.test.tsx`（jsdom），先寫會失敗的測試：「列表頁顯示發布中與發布失敗」；發布回應帶 `DEFAULT_NOT_SET` 時顯示提示
- [x] 8.2 在 `apps/web/tests/unit/components/line/rich-menu-default.test.tsx` 先寫會失敗的測試：編輯頁有「聊天室打開時展開選單」選項，新建時預設勾選；「設為所有好友的預設選單」寫入 `isDefault`。既有的「New draft is not the default」「Check the default option」「Publish a default menu」「Unpublish a default menu」改用 `isDefault` 後仍通過
- [x] 8.3 `useRichMenus.ts` 加上 `isDefault` 與 `publishing`；`RichMenuEditor.tsx` 拆成兩個選項，說明文字拿掉「好友開啟對話時也會自動展開」；新建、編輯、列表頁與 `rich-menu-confirm.ts` 改看 `isDefault`；列表頁加上「發布中」標籤，`error` 的選單顯示「發布」按鈕，顯示 `DEFAULT_NOT_SET` 的提示。8.1、8.2 通過。編輯頁另外加上「發布中」標籤，發布中時鎖住編輯並隱藏按鈕（API 本來就拒絕這兩個操作，spec 沒有對應的情境，沒有另寫測試）

## 9. 完成條件

- [x] 9.1 `pnpm test` 通過。第一次跑有 2 個讀原始碼字串的測試失敗：`error-messages.test.ts`、`line-media-limits.test.ts` 讀的程式移到 `rich-menu.line-api.ts`、`line-profile.flow.ts`（本 change 刻意搬移，行為不變），改成讀新路徑後通過
- [x] 9.2 `pnpm test:feature` 通過（128 個檔案、1253 項）
- [x] 9.3 `pnpm build` 通過（改了 `apps/web` 與 `packages/database`）
- [x] 9.4 `node scripts/check-tenant-ctx.mjs --strict` 通過，`--update-baseline` 後 `line` 模組的舊寫法是 0；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增的違規
- [x] 9.5 `node scripts/feature-impact.mjs` 列出受影響的領域，逐項檢查 `feature-line`、`feature-marketing` 的回歸清單；`feature-map.json` 需要時更新，`--check` 通過。`feature-map.json` 的路徑都還成立，不用改；`--check` 只看已加入 git 的檔案，commit 之後通過。回歸清單的自動測試都通過；`feature-line` 第 4 項（UAT 實際操作圖文選單）要部署後才能做
- [x] 9.6 CHANGELOG 的 `Changed` 新增一條，寫明可觀察的差異：發布的 409、設預設不再先取消全體預設與失敗時的警告、`isDefault` 與 `selected` 分開、Redis 無法使用時綁定改回 200
- [x] 9.7 更新 `docs/ref/features/`、`docs/ref/DATABASE-ERD.md` 與 `.claude/skills/feature-line/` 中描述圖文選單發布、預設與綁定的段落；另外更新 `docs/ref/modules/EVENTS.md`、`CHANNEL-PLUGINS.md` 與 AUDIT 中程式的位置
- [x] 9.8 `node scripts/validate-openspec.mjs migrate-line-tenant-ctx` 通過；歸檔前後比較「略過 N 則」
- [x] 9.9 開對帳排程的 issue：#457。design 的非目標、D2 與 D8 改成指向 #457

## 10. review-loop 第 1 輪的修正

- [x] 10.1 在 `rich-menu-publish.test.ts` 新增「中斷的請求恢復後不改到新的認領」。認領把 `updatedAt` 寫成 `claimedAt`，交易 2 與放掉認領以 `updatedAt = claimedAt` 為條件。突變驗證：放掉認領拿掉 `updatedAt` 條件、交易 2 拿掉 `updatedAt` 條件，各讓這項失敗
- [x] 10.2 先寫會失敗的測試：`rich-menus-status.test.tsx` 新增「發布中斷的選單」；新增 `rich-menu-edit-status.test.tsx`，編輯頁發布中斷時有「發布到 LINE」、沒有「儲存草稿」，還在發布中時兩個按鈕都沒有。新增 `apps/web/src/lib/rich-menu-status.ts`，列表頁與編輯頁把超過 5 分鐘的 `publishing` 顯示成「發布中斷」並顯示發布按鈕
- [x] 10.3 `DEFAULT_NOT_SET` 的提示改成「取消發布，重新勾選預設並儲存，再發布」：設預設失敗時 `isDefault` 記成 `false`，取消發布保留 `false`，只取消發布再發布不會再設預設。`rich-menus-status.test.tsx` 先加上提示內容的檢查，修正前以 assertion 失敗
