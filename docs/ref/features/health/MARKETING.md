# 行銷活動、素材與優惠券 健檢

- 核對日期：2026-10-29
- 程式版本：5fa12f0f
- 環境：本機（web 3000 production build、API 3001、workers；資料庫 open333crm_advisor）／UAT Demo 租戶（a0000000-0000-0000-0000-000000000001，只做瀏覽、預估與草稿）
- 測試角色：admin、supervisor、agent（seed）；本機另建三個自訂角色：
  - 健檢行銷唯讀（`marketing.view`、`coupon.view`、`contact.view`、`inbox.view`），帳號 hc-mkt-ro
  - 健檢行銷無券（`marketing.view`、`marketing.manage`、`marketing.broadcast`、`contact.view`），帳號 hc-mkt-nc
  - 健檢行銷僅管理（`marketing.view`、`marketing.manage`），帳號 hc-mkt-mg

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 10 份規格、508 個 scenario：約 22 個缺實作或只做一部分、約 73 個缺測試、約 29 個缺前端入口（估計，見「完備度對照」）。另有後端有、前端沒有的端點：後台核銷、移除序號、修改領券連結、追加序號、分群編輯、活動改名與改日期、取消發送中群發、member-binding |
| 自動測試 | unit：api 33 檔 208 案例、web 47 檔 356 案例、workers 8 檔 29 案例，全部通過，0 skip。feature：`test:feature` 的檔名過濾沒有生效，跑了整套 99 檔 920 案例，全部通過，0 skip |
| 實際操作 | 23 條流程：正常 9（2、6、8、12、13、14、15、17、23），異常 7（1、3、4、5、7、9、16），部分驗證 3（19、20、21），待真機驗 3（10、18、22），未驗 1（11） |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-MARKETING-01 | P1 | 只有 `marketing.manage`、沒有 `marketing.broadcast` 的人可以送出群發：建立時帶 `scheduledAt`，排程器到期直接執行，不檢查建立者權限 | 本機用 hc-mkt-mg（`marketing.view`＋`marketing.manage`）建立附券群發，`scheduledAt` = 75 秒後。「立即發送」回 403 `marketing.broadcast`，但約 80 秒後排程器把群發送出：`completed`、送達 3、發券 3 | `apps/api/src/modules/marketing/marketing.routes.ts:278`（建立只要 `marketing.manage`）、`apps/api/src/modules/marketing/broadcast.scheduler.ts:24-45` | MKT-02 |
| HC-MARKETING-02 | P1 | 附券群發繞過 `coupon.issue`（疑點 3）：沒有任何 coupon 權限的人可以建立並送出附券群發 | 本機 hc-mkt-nc（無 `coupon.view`、`coupon.issue`）呼叫 `POST /marketing/broadcasts` 帶 `couponId` → 201；`/send` → 202；結果 `completed`、發券 3 張。前端附券選單因 `GET /coupons` 403 會顯示載入失敗，但 API 照收。`audience-preview` 也把券的剩餘名額回給沒有 `coupon.view` 的人 | `apps/api/src/modules/marketing/marketing.service.ts:227-228`（`assertBroadcastCoupon` 只檢查券狀態）、`marketing.routes.ts:290-294` | MKT-03 |
| HC-MARKETING-03 | P1 | 群發不套用渠道可見範圍：成員可以對看不到的渠道預估人數、建立群發；排程後由排程器送出 | hc-mkt-mg 只綁定「健檢行銷 WebChat」，對看不到的「健檢 FB」呼叫 `audience-preview` → 200（matched 1），`POST /marketing/broadcasts` → 201。群發列表也列出所有渠道的群發。行銷模組沒有任何 `assertChannelVisible` 呼叫（批次發券有） | `apps/api/src/modules/marketing/marketing.service.ts:205-341`、`marketing.routes.ts:263-294` | MKT-04（RBAC-04 同類） |
| HC-MARKETING-04 | P1 | 網站客服（WebChat）群發與批次發券「成功」，顧客卻收不到任何訊息：WebChat plugin 的 `sendMessage` 只寫 log、回 success，附券流程沒有推 socket 也沒寫訊息 | 本機在 WebChat 渠道建附券群發（受眾：標籤 3 人）→ `completed`、成功 3、發券 3；`messages` 表沒有任何外送訊息，對話裡只有顧客自己的訊息。群發頁的渠道選單列出 WebChat；批次發券 UI 不列 WebChat（`COUPON_PUSH_CHANNEL_TYPES`），但 API 照收並同樣「成功」。UAT Demo 也有 WebChat 渠道「tatung」可以選 | `packages/channel-plugins/src/webchat/index.ts:48-56`、`apps/web/src/app/dashboard/marketing/page.tsx:285`（未過濾渠道類型）、`apps/web/src/lib/marketing/coupon-broadcast.ts:89` | CHAN-02（已併入，調為 P1） |
| HC-MARKETING-05 | P2 | 行銷活動、分群、群發、素材頁的建立/發送/刪除按鈕不依權限隱藏（疑點 1） | 本機 hc-mkt-ro（只有 `marketing.view`）看到「新增活動」「新增分群」「建立廣播」「從版型建立」「啟動」全部可按；素材編輯頁也有「存為素材」。按下才 403 | `apps/web/src/app/dashboard/marketing/page.tsx:114,428,516-536,927`、`apps/web/src/app/dashboard/marketing/materials/page.tsx:95-98`、`campaigns/[campaignId]/page.tsx:127-145` | RBAC-11 |
| HC-MARKETING-06 | P2 | 沒有權限時頁面顯示成「沒有資料」：SWR 錯誤不處理 | 本機 agent（無 `marketing.view`）開 `/dashboard/marketing/campaigns` 顯示「尚無行銷活動」，旁邊還有可按的「新增活動」；活動詳情顯示「找不到該行銷活動」。沒有 `channel.view` 的 hc-mkt-ro、hc-mkt-mg 開「建立廣播」，渠道選單是空的、沒有任何說明（`GET /channels` 403）；分群對話框的標籤選單同樣是空的（`GET /tags` 403） | `apps/web/src/app/dashboard/marketing/page.tsx:75,124-125,239,831` | RBAC-11 |
| HC-MARKETING-07 | P2 | 素材複製、刪除失敗沒有任何提示（疑點 5），而且是未攔截的 promise rejection | hc-mkt-ro 在素材列表按「複製」「刪除」→ 403，畫面沒有訊息，console 出現 `Request failed with status code 403`。刪除確認文字寫「軟刪，可在後台復原」，但沒有復原 UI | `apps/web/src/app/dashboard/marketing/materials/page.tsx:76-84` | APP-11 |
| HC-MARKETING-08 | P2 | 一般群發卡在 `sending` 時 UI 沒有任何操作（疑點 4） | 本機把一則一般群發設成 `sending`（`updatedAt` 20 分鐘前）→ 群發列 0 個按鈕；API `POST /cancel` 可以取消（200） | `apps/web/src/app/dashboard/marketing/page.tsx:497-560`（只有附券群發有逾時重送）；後端 `marketing.service.ts:353` 允許 cancel sending | MKT-01（已補註） |
| HC-MARKETING-09 | P2 | 分群的「建立日期」條件用 UTC 午夜：台灣時間 00:00–07:59 建立的聯絡人被算到前一天 | 本機把一位帶標籤的聯絡人 `createdAt` 設為台灣 10/29 03:00，條件「建立日期（之後）2026-10-29」回 2 人（應 3 人），「建立日期（之前）2026-10-29」回 1 人（應 0 人） | `apps/api/src/modules/marketing/segment.service.ts:176-185` | MKT-05 |
| HC-MARKETING-10 | P2 | 群發素材選單要 200 筆、後端上限 100；分群下拉只拿第一頁 50 筆（疑點 2） | `GET /marketing/materials?limit=200` 回 `meta.limit=100`；`GET /marketing/segments` 回 `meta.limit=50`，`useSegments()` 沒有分頁 | `apps/web/src/app/dashboard/marketing/page.tsx:290-294`、`apps/web/src/hooks/useMarketing.ts:41`、`apps/api/src/modules/marketing/material.routes.ts:258` | MKT-06 |
| HC-MARKETING-11 | P2 | 刪除分群不檢查是否被排程群發引用（疑點 9）。到期時群發 fail-closed（不會發給全部人），但失敗原因寫「選擇『受眾分群』時必須指定一個分群」，看不出是分群被刪 | 本機建分群→建附券排程群發（受眾＝該分群）→刪分群（200，沒有警告）→`broadcasts.segmentId` 變 null→到期後 `failed`，原因如左。`assertSegmentUsable` 的「所選分群已不存在」訊息因為 FK 已設成 null 永遠走不到 | `apps/api/src/modules/marketing/segment.service.ts:131-138`、`marketing.service.ts:42-44,53-56` | MKT-07 |
| HC-MARKETING-12 | P2 | LINE 素材建立/修改時，租戶最新的啟用中 LINE 渠道憑證解不開會回 500 | 本機 LINE 渠道憑證無法解密，`POST /marketing/materials`（`line_text`）→ 500 `INTERNAL_ERROR`；FB 素材正常。群發已把同一種錯誤包成 `CHANNEL_CREDENTIAL_DECRYPT_FAILED`，素材這裡沒有。UAT（憑證正常）建立 LINE 草稿素材正常 | `apps/api/src/modules/marketing/material.service.ts:178-194` | MKT-08 |
| HC-MARKETING-13 | P2 | 會員綁定（member-binding）規格有 5 條需求，web 完全沒有呼叫 `/member-binding` 或 `/fan/member-binding`，也沒有圖文選單／關鍵字入口 | `grep -rn "member-binding" apps/web/src` 沒有結果 | `apps/api/src/modules/member-binding/*.routes.ts`、`openspec/specs/member-binding/spec.md:78-95` | MKT-09 |
| HC-MARKETING-14 | P2 | 優惠券與行銷操作沒有租戶稽核（疑點 14） | 本機建立、發布、暫停、恢復、複製、刪除優惠券，建立群發與分群後，`tenant_audit_logs` 最近一小時沒有任何 coupon、marketing 動作 | `apps/api/src/modules/coupon/`、`apps/api/src/modules/marketing/` 都沒有 `recordTenantAudit`／`writeTenantAudit` | AUD-01（已補列） |
| HC-MARKETING-15 | P3 | Flex 兩種版型在選擇器隱藏，UI 建不出新 Flex 素材（疑點 6） | `/materials/new` 的 LINE 只有 5 種，沒有「精選範本」「匯入 Flex JSON」；FB 的「大圖／影片廣告」也隱藏（有註解說明原因） | `apps/web/src/components/materials/TemplatePickerGrid.tsx:81-82,92` | 新 |
| HC-MARKETING-16 | P3 | 序號明細匯出不套用畫面篩選（疑點 10）；CSV 的狀態、發放來源是英文代碼，時間是 UTC | `GET /coupons/:id/instances/export?status=REDEEMED` 仍回全部 CLAIMED 的列；欄位如 `"CLAIMED"`、`"broadcast"`、`2026-10-29T09:03:42.103Z` | `apps/web/src/hooks/useCoupons.ts:211-213`、`apps/api/src/modules/coupon/coupon-instance.routes.ts:71-88`、`coupon-stats.service.ts:94,205` | 新 |
| HC-MARKETING-17 | P3 | 素材版本還原 versionNo 不合法回 400，但回應缺 `success:false`（疑點 11） | `POST /materials/:id/versions/abc/restore` → `{"error":{"code":"INVALID_VERSION",…}}` | `apps/api/src/modules/marketing/material.routes.ts:363-366` | 新 |
| HC-MARKETING-18 | P3 | 後台核銷 `POST /coupons/redeem` 沒有 web 入口，`coupon.redeem` 權限在 UI 沒有作用（疑點 12） | web 沒有任何呼叫 `/coupons/redeem` 或判斷 `coupon.redeem` 的程式 | `apps/api/src/modules/coupon/coupon.routes.ts:318` | 新 |
| HC-MARKETING-19 | P3 | 活動詳情頁的 `useBroadcasts(campaignId)` 結果沒有使用；有發送中的群發時每 3–5 秒多一個請求，而畫面上的資料（`useCampaign`）不會更新（疑點 13） | 本機活動底下有一則 `sending` 群發，詳情頁 16 秒內發出 5 次 `/marketing/broadcasts?campaignId=…` | `apps/web/src/app/dashboard/marketing/campaigns/[campaignId]/page.tsx:41` | 新 |
| HC-MARKETING-20 | P3 | 活動狀態轉換錯誤訊息是英文 | `PATCH /marketing/campaigns/:id {"status":"completed"}`（草稿）→ `Cannot transition from draft to completed` | `apps/api/src/modules/marketing/campaign.service.ts:148-152` | 新 |
| HC-MARKETING-21 | P3 | 分群渠道選項有 WhatsApp（沒有 plugin）、沒有 Instagram（THREADS）（疑點 8） | 「新增分群」渠道下拉：LINE、Facebook、WebChat、WhatsApp | `apps/web/src/app/dashboard/marketing/page.tsx:916-921` | 新 |
| HC-MARKETING-22 | P3 | 文件過時：MARKETING.md 寫分群無條件等於全部聯絡人（程式是 0 人）（疑點 7）；EVENTS.md 沒有 `coupon-broadcast` 佇列與 `coupon-stale-pending-issue` 排程（疑點 15） | — | `docs/ref/features/tenant/MARKETING.md:78`、`docs/ref/modules/EVENTS.md:218` | 新 |
| HC-MARKETING-23 | P3 | 群發 API 收到不帶時區的 `scheduledAt`（例如 `2026-12-31T23:59`）時依伺服器時區解讀 | 本機（伺服器時區台北）存成 `2026-12-31T15:59:00Z`；容器時區若是 UTC 會差 8 小時。web 送 ISO 不受影響，影響 API／MCP 呼叫端 | `apps/api/src/modules/marketing/marketing.routes.ts:92`、`marketing.service.ts:244-252` | 新 |
| HC-MARKETING-24 | P3 | 分群下拉顯示的人數是建立當下的全租戶快照，不是所選渠道的人數 | WebChat 渠道群發選分群顯示「(6 人)」，實際該渠道符合 3 人 | `apps/web/src/app/dashboard/marketing/page.tsx:721`、`segment.service.ts:95` | 新 |
| HC-MARKETING-25 | P3 | 領券頁在連結尚未開始時只寫「這個領券活動目前無法領取」，沒有說何時開始 | 領券連結期間 10/29 18:00 起，17:15 開 `/coupon/claim/T2GUQ78S` | `apps/api/src/modules/coupon/coupon-claim-code.ts:112` | 新 |
| HC-MARKETING-26 | P2 | 素材的 uri 動作沒有協定檢查：`actionSchema` 定義了但沒有套到 body，`javascript:` 等網址只有在租戶有可用 LINE 渠道時才會被 LINE validate 擋下（讀程式，子代理對照，未實測） | 讀 `material.routes.ts:103,123-139` | `apps/api/src/modules/marketing/material.routes.ts:103` | MKT-10 |
| HC-MARKETING-27 | P2 | 系統從不把券寫成 `EXPIRED`：序號明細「已過期」篩選永遠 0 筆，過期券顯示「已領取」，成效的過期數永遠 0（讀程式，子代理對照） | 讀 `packages/core/src/coupon/issue.ts:42` 的註解與 `coupon-stats.service.ts:45-52,131-133` | `apps/api/src/modules/coupon/coupon-stats.service.ts:131-133` | MKT-11 |
| HC-MARKETING-28 | P2 | 已發布的序號包券沒有追加序號的 UI；序號用完後一旦暫停，恢復會重跑發布檢查而被「須先匯入可用序號」擋下，再也恢復不了（讀程式，子代理對照） | 讀 `CouponForm.tsx:852-855`、`coupon-lifecycle.service.ts:81-88,122-124` | `apps/api/src/modules/coupon/coupon-lifecycle.service.ts:122-124` | MKT-12 |
| HC-MARKETING-29 | P3 | 券夾「剩幾天」用毫秒差無條件進位，2 天後到期會顯示「餘 3 天」（讀程式，子代理對照） | 讀 `coupon-fan.service.ts:38-41` | `apps/api/src/modules/coupon/coupon-fan.service.ts:38-41` | 新 |
| HC-MARKETING-30 | P3 | 送出時把網址換短連結只處理 LINE 的 `uri`，FB 的 `web_url` 按鈕與圖片不轉，FB 素材沒有點擊歸因（讀程式，子代理對照） | 讀 `marketing.service.ts:370-417` | `apps/api/src/modules/marketing/marketing.service.ts:370-417` | 新 |
| HC-MARKETING-31 | P3 | 規格與程式衝突：LINE 影片結束畫面規格要求補送一則，程式不送且編輯器已移除；FB 示範圖轉換方向與規格相反。需決定改規格或改程式（讀程式，子代理對照） | — | `packages/channel-plugins/src/line/builders.ts:297-319`、`apps/api/src/modules/marketing/material-sample-urls.ts:32` | 新 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 建立活動 | 本機 UI＋UAT API/UI | 正常：名稱、描述、日期存入，重新整理讀回一致（顯示 2026/11/1–2026/11/30） | 正常：空名稱按鈕停用；結束早於開始 alert「結束日期不可早於開始日期」；日期 `abc` 回 400 | 異常：ro 看得到可按的「新增活動」（HC-05）；ro 建立回 403；agent 看到「尚無行銷活動」（HC-06） | UAT 草稿建立、讀回、刪除正常 |
| 2 活動狀態 | 本機 UI | 正常：草稿→進行中→已完成，重新整理一致 | 草稿→已完成回 400，訊息英文（HC-20） | ro 看得到「啟動」 | — |
| 3 建立分群 | 本機 UI＋UAT API | 正常：標籤條件預覽 6、建立後列表 6 人 | 正常：空值條件按鈕停用並提示；`tag` 非 UUID、日期 `abc` 回 400 | 異常：ro 看得到「新增分群」；無 `tag.view` 時標籤選單空白 | 時區 HC-09；WhatsApp/THREADS HC-21；無編輯 UI |
| 4 建立群發 | 本機 UI | 正常：WebChat＋附券＋標籤＋排程，`datetime-local` 17:11 送出 `09:11:00Z`，列表顯示「排程: 下午5:11:00」 | 正常：沒素材沒附券按鈕停用並顯示原因；過去時間、素材渠道不符回 400 | 異常：HC-01、02、03、05、06 | UAT 只開對話框預估（LINE OA 20 人、素材 10、分群 2），未建立 |
| 5 立即發送/重送/取消 | 本機 API＋UI | 附券立即發送 202→`completed`；取消 failed／scheduled 正常 | `sending` 時 UI 無操作（HC-08） | `/send` 對 mg 回 403 正常，但排程可繞過（HC-01） | 一般群發（LINE/FB）本機無渠道金鑰，未實發 |
| 6 附券結果 | 本機 UI | 正常：👁 開出「發券 3」 | — | — | 失敗/略過明細需真實失敗資料，未驗 |
| 7 素材列表 | 本機 UI | 正常：列表、篩選 | 異常：複製/刪除失敗無提示（HC-07） | 異常：按鈕不隱藏 | 無分頁 UI |
| 8 分類管理 | 本機 API | 建立分類 201 | — | — | UI 未逐項操作 |
| 9 建立/編輯素材 | 本機 UI（FB）、UAT API（LINE 草稿） | 正常：FB 純文字存入，跳到編輯頁，重新整理內容一致；PATCH 產生第 2 版 | 本機 LINE 建立 500（HC-12） | ro 看得到「存為素材」 | 影片直傳未驗 |
| 10 點擊貼標 | — | 未驗 | — | — | 需真機點擊（待真機驗） |
| 11 Flex AI / 匯入 | — | 未驗 | — | — | Flex 版型隱藏（HC-15）；AI 需租戶 AI 金鑰 |
| 12 成效、版本還原 | 本機 API | 還原第 1 版成功（產生新版） | `abc`、`0` 回 400 缺 success:false（HC-17）；99 回 404 | — | — |
| 13 券列表與狀態 | 本機 API＋UI | 發布、暫停、恢復正常；狀態篩選「草稿」正常 | 已發布刪除 409 `NOT_DRAFT`；改鎖定欄位 409 `COUPON_LOCKED` | 正常：supervisor 暫停 403；「建立優惠券」對 supervisor/agent 停用、對 nc 顯示「你沒有查看此頁面的權限」 | — |
| 14 建立/草稿/發布 | 本機 UI＋API | UI 只填券名存草稿成功；API 三種效期模式皆可發布；FIXED `2026-10-29`–`2026-11-30` 存成台灣當天起訖 | 空白發布出現「請確認」提示；店員碼 `1234` 回 400「請避免使用連續或重複的數字」；券名 31 字 400 | supervisor 開 `/coupons/new` 無表單 | UAT 草稿券建立、讀回、刪除正常 |
| 15 詳情、序號、匯出 | 本機 UI＋API | 詳情、統計、序號明細正常 | 匯出不套用篩選（HC-16） | — | 「已領取」篩選含 OPENED，屬設計 |
| 16 批次發送 | 本機 API | WebChat、LINE 以外渠道：API 202→`completed` 發券 3 | — | — | UI 不列 WebChat（HC-04）；LINE/FB 待真機驗 |
| 17 領券連結 | 本機 UI | 正常：`datetime-local` 18:00–23:59 存成 `10:00Z`–`15:59Z`，重新整理顯示一致；QR 產生 | 渠道沒有公開帳號 ID 時顯示警告 | — | 顧客送代碼領券要 LINE/FB/IG（待真機驗） |
| 18 對話發券 | 本機 API | 未完成：WebChat 對話是 BOT_HANDLED，回 `blocked`，可選券 0 張 | — | — | 待真機驗（LINE/FB 對話）；feature 測試通過 |
| 19 領券頁 → 傳訊領券 | 本機 UI | 領券頁正常顯示券內容；連結未開始時顯示不能領取（HC-25） | 不存在的代碼未驗 | — | 傳訊領券只支援 LINE/FB/THREADS（待真機驗） |
| 20 關鍵字領券、加好友禮 | 本機排程 | `coupon-stale-pending-issue`：把一張券的 `deliveryPendingAt` 設成 10 分鐘前，約 3 分鐘內被作廢 | — | — | 關鍵字與加好友需 LINE webhook（待真機驗） |
| 21 開票券 | 本機 UI | 部分：票券連結導向 email 登記（`verification_required`）；假權杖顯示「連結已失效」 | — | — | 本機寄信模式是 SMTP，沒有寄驗證碼；LIFF 待真機驗；feature 測試 `coupon-wallet*` 通過 |
| 22 券夾、核銷 | 本機 UI | `/coupon/wallet` 未登入時提示從對話開啟 | — | — | 自助核銷需先開票券（同 21） |
| 23 門市核銷台 | 本機 UI | 正常：門市帳號登入、手動輸入序號、確認核銷、顯示核銷結果（STAFF_SCAN 券） | 錯誤密碼顯示「帳號或密碼錯誤」；STAFF_CODE 券顯示「需在顧客手機上核銷」 | — | 本機 http 無相機 |

## 疑點 1–15 結論

| # | 結論 | 說明 |
| --- | --- | --- |
| 1 | 確認 | HC-MARKETING-05；優惠券頁有依權限停用 |
| 2 | 確認 | HC-MARKETING-10 |
| 3 | 確認，且比描述嚴重 | 不只是繞過 `coupon.issue`：實際用無券權限帳號發出 3 張券（HC-MARKETING-02） |
| 4 | 確認 | HC-MARKETING-08 |
| 5 | 確認 | 無分頁 UI、複製/刪除無提示、無復原 UI（HC-MARKETING-07） |
| 6 | 確認 | HC-MARKETING-15 |
| 7 | 確認 | 文件過時（HC-MARKETING-22）；`createdBefore`／`createdAfter` 都受 UTC 午夜影響（HC-MARKETING-09） |
| 8 | 確認 | HC-MARKETING-21 |
| 9 | 確認（實測） | 到期時群發 `failed`，沒有發給任何人；但刪除時沒警告、失敗原因誤導（HC-MARKETING-11） |
| 10 | 部分確認 | 匯出不套用篩選確認；沒有 OPENED 選項是設計（「已領取」= CLAIMED＋OPENED，`coupon-stats.service.ts:132`） |
| 11 | 確認 | HC-MARKETING-17 |
| 12 | 確認 | HC-MARKETING-18 |
| 13 | 確認 | 只在有發送中或已到期排程時輪詢；結果未使用（HC-MARKETING-19） |
| 14 | 確認（實測） | HC-MARKETING-14 |
| 15 | 確認 | HC-MARKETING-22 |

## 完備度對照

以 requirement 為單位對照；material-system、line-flex-material-import、material-action-tagging 與三份優惠券規格由兩個唯讀子代理逐條讀程式與測試（只比對測試名稱與檔案，未逐條檢查 assert），其餘四份由健檢員自己對照。數字是估計，誤差約 ±5。

| Spec | Scenario | 缺實作（含部分） | 缺測試（含部分） | 缺前端入口 | 主要缺口 |
| --- | --- | --- | --- | --- | --- |
| broadcast-audience | 30 | 0 | 0 | 0 | 實作與測試齊全（`tests/unit/modules/marketing/broadcast-audience.test.ts`、`broadcast-messaging-window.test.ts`、`segment-rules.test.ts`）。「Segment deleted before a scheduled send」實測通過（`failed`、`INVALID_AUDIENCE`），但原因文字誤導（HC-11） |
| broadcast-failure-reason | 8 | 0 | 0 | 0 | `broadcast-failure-reason.test.ts`；UI 顯示原因與重送、取消正常 |
| marketing-scheduling | 7 | 0 | 0 | 0 | `campaign-dates.test.ts`、`broadcast-schedule.test.ts`；實測過去時間 400 |
| member-binding | 10 | 0（後端有 routes、service） | 約 4 | 10 | web 沒有任何入口，也沒有圖文選單／關鍵字觸發（HC-13） |
| material-system | 108 | 約 11 | 約 41 | 約 5 | uri 協定檢查沒有接上（`actionSchema` 定義在 `material.routes.ts:103` 但沒套到 body，沒有 `INVALID_URI_SCHEME`）；影片結束畫面 CTA 規格要求補送，程式已不送（`packages/channel-plugins/src/line/builders.ts:297-319`），測試反向斷言；FB 示範圖轉換方向與規格相反（`material-sample-urls.ts:32`）；送出時轉短連結不處理 FB 的 `web_url`／`image_url`（`marketing.service.ts:370-417`），FB 素材沒有點擊歸因；分類沒有搬移 UI、刪父分類會連帶刪子分類（schema Cascade）；版本歷史不顯示編輯者；deprecated contentType 回 `VALIDATION_ERROR` 而非規格的錯誤碼；分類、標籤、篩選排序、成效、點擊歸因幾乎沒有行為測試 |
| line-flex-material-import | 11 | 0 | 約 6 | 11（版型隱藏，HC-15） | `/line-flex/import` 不打 LINE validate（`material.service.ts:244`） |
| material-action-tagging | 10 | 約 3 | 約 9（5 條只比對原始碼） | 2 | 點擊貼標只有卡片 action 與結尾頁有 UI，快速回覆、Flex、影片結束畫面沒有；短連結複用時拿掉標籤不會清掉舊 tagId（`shortlink.service.ts:191`） |
| coupon-management | 222 | 6（部分） | 約 8 | 1 | 已發布的序號包券沒有追加序號 UI（`CouponForm.tsx:852-855`），序號用完後暫停就無法恢復（恢復重跑發布檢查，`coupon-lifecycle.service.ts:81-88,122-124`）；系統從不把券寫成 `EXPIRED`，「已過期」篩選永遠 0 筆、過期券顯示「已領取」（`coupon-stats.service.ts:45-52,131-133`）；附券廣播、批次發券不推 `coupon.instance.updated`；附券廣播過期失敗原因沒寫日期；背景匯出是行程內 promise，重啟就消失且無通知；領券連結時間依瀏覽器時區顯示；後台券列表張數含「發送中」的券 |
| coupon-redemption | 75 | 部分 2 | 約 5 | 0 | 券夾「剩幾天」用毫秒差進位，2 天後到期顯示「餘 3 天」（`coupon-fan.service.ts:38-41`）；規格「未指定核銷方式時採店員驗證碼」與發布必選互相矛盾；401、email 登記合併、AFTER_OPEN 逾時缺測試 |
| store-redemption | 27 | 0 | 0 | 0 | 實作、測試、前端齊全；只核銷 STAFF_SCAN 券（實測） |
| **合計** | **508** | **約 22** | **約 73** | **約 29** | |

前端送出值與後端 Zod：

- 活動 `type=date` 送 `YYYY-MM-DD`，後端 `parseCampaignDate` 接受（實測）。
- 群發 `datetime-local` 轉 ISO 送出，後端接受（實測 17:11 → `09:11:00Z`）；後端收到不帶時區的字串時依伺服器時區（HC-23）。
- 分群 `createdAfter/Before` 送 `YYYY-MM-DD`，後端以 UTC 午夜解讀（HC-09）。
- 優惠券 FIXED 的 `startAt/endAt` 送 `YYYY-MM-DD`，後端換算成台灣當天起訖（實測 `2026-10-28T16:00Z`–`2026-11-30T15:59:59.999Z`）。
- 領券連結 `datetime-local` 轉 ISO，後端 `z.coerce.date()` 接受（實測）。
- 分群渠道選項 `WHATSAPP` 被接受但永遠 0 人；`THREADS` 後端接受、前端沒有選項（HC-21）。

## 待真機驗

- LINE、FB 一般群發（multicast、逐人送出、素材網址換短連結、FB 24 小時視窗略過）。本機渠道金鑰不存在。
- 點擊貼標（postback `tag:`、uri `tagOnClick`）。
- 顧客在 LINE／FB／IG 傳送領券代碼領券、關鍵字領券、加好友禮、封鎖再加入。
- 對話發券（LINE／FB 對話，需真人客服接手的對話）。
- 開票券的 email 驗證碼與 LIFF 登入、券夾自助核銷、店員碼核銷。
- Flex AI 產生（需要租戶 AI 金鑰）、LINE 影片 200MB 直傳。

## 環境與測試資料

- 本機留下的測試資料都以「健檢-2026-10-29-」或「健檢行銷」開頭：渠道「健檢行銷 WebChat」、6 位聯絡人、標籤「健檢行銷」、優惠券 A/B/C/F/S 與草稿券、群發、分群、素材、分類、門市「健檢-2026-10-29-門市」、三個自訂角色與成員 hc-mkt-ro／hc-mkt-nc／hc-mkt-mg。
- 本機有一位聯絡人的 `createdAt` 為了重現 HC-MARKETING-09 改過，已改回。
- UAT：建立 4 筆（活動、分群、草稿券、LINE 草稿素材），全部刪除，見 `uat-ledger.md` 的 marketing 段落。素材只能軟刪。

## 建議新增到 AUDIT.md 的項目

- HC-MARKETING-01、02、03：群發的權限與渠道可見範圍。建立群發應同時檢查 `marketing.broadcast`（有排程時）、`coupon.issue`（有附券時）與渠道可見範圍；排程器執行時應以建立者的當下權限重新檢查。
- HC-MARKETING-04：WebChat 群發假成功。群發頁應只列支援推送的渠道（與批次發券相同），後端也要拒絕。
- HC-MARKETING-09：分群日期條件改以台灣時間的當天起訖計算（優惠券已有 `parseDateOnly`）。
- HC-MARKETING-12：素材建立時的憑證解密錯誤要包成 AppError。
- HC-MARKETING-13：member-binding 沒有前端入口，確認是否仍在規劃中。
- HC-MARKETING-26、27、28：素材 uri 協定檢查、券的過期狀態、序號包券無法恢復（讀程式得到，建議先補測試重現）。
