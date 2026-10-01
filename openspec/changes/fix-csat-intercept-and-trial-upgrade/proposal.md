## Why

`docs/ref/system/AUDIT.md` 有兩個 P1 項目會在不需要特殊操作的情況下造成錯誤結果：

- **RLS-06**：進站的 CSAT 攔截器不檢查租戶與聯絡人。任何外部使用者傳 `csat:1:<工單 ID>` 給任一租戶的官方帳號，就能改寫其他租戶的工單評分，並讓對方租戶的渠道送出訊息。
- **TRIAL-01**：試用租戶經由升級申請改成付費方案後，`trialEndsAt` 沒有清除。到了原本的試用到期日，排程會停用這個已付費的租戶，之後再標記為已清除。

TRIAL-01 是兩個 change 之間的交接缺口。`trial-signup` 的設計把「試用轉正式」交給 plan-change-request，但 plan-change-request 的規格沒有接下這件事。

## What Changes

- CSAT 攔截器只在工單屬於收訊的租戶、而且工單的聯絡人就是傳訊的聯絡人時，才記錄評分。不符合時仍然攔截這則訊息，但不記錄評分、不送感謝訊息、不通知主管。攔截器仍然同時接受 postback 與文字訊息。
- 平台核准 `upgrade` 申請時，如果租戶仍在試用中，系統讓租戶脫離試用：清除 `trialEndsAt` 與 `purgedAt`，並設 `isActive = true`。
- 平台以「轉付費」操作（`convertToPaid()`）轉換租戶時，也清除 `purgedAt`。目前這個操作已經清除 `trialEndsAt` 並設 `isActive = true`。

不在本 change 的範圍：

- CSAT 攔截器只接受 postback。加上租戶與聯絡人條件之後，以文字送出 `csat:<分數>:<工單 ID>` 只能替自己的工單評分，不再是漏洞。
- 非 LINE 渠道的 CSAT 重新設計，另外記成 AUDIT 的新項目。
- 平台在租戶編輯頁改方案（`updateTenant()`）的行為。改方案不代表轉正式，租戶仍維持試用。
- 排程依方案判斷試用租戶。`trialEndsAt` 仍是唯一的試用標記。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `inbound-message-processing`：CSAT 攔截在記錄評分前，比對工單的租戶與聯絡人。
- `trial-lifecycle`：新增「租戶轉為付費方案時脫離試用」的要求，涵蓋核准升級申請與「轉付費」兩條路徑。

## Impact

- `apps/api/src/modules/webhook/inbound-postback-interceptors.ts`：`handleCsatResponse()`。
- `apps/api/src/modules/csat/csat.service.ts`：`recordCsatScore()` 的參數加上租戶與聯絡人。`case.routes.ts` 的 `POST /cases/:id/csat` 也呼叫這個函式，要一起修改。
- `apps/api/src/modules/platform/plan-change.service.ts`：`approveRequest()`。
- `apps/api/src/modules/platform/trial-admin.service.ts`：`convertToPaid()`。
- 正式環境可能已經有受影響的租戶。部署前要查詢並修復資料，見 design.md。
- 沒有 schema 變更，也沒有 migration。
