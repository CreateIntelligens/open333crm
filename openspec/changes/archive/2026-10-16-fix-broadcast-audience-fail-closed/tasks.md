## 1. 建立廣播時檢查受眾（Broadcast Audience Selection Is Required）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/marketing/broadcast-audience.test.ts`「Tags target without tags」「Contacts target without contacts」「Segment target without segment」「Segment without conditions」「Tags target with tags」
- [x] 1.2 實作：`marketing.service.ts` 的 `createBroadcast()` 在查資料庫前檢查受眾欄位；分群要有有效條件

## 2. 發送時受眾無法解析就停止（Broadcast Send Stops When The Audience Cannot Be Resolved）

- [x] 2.1 測試先行：`broadcast-audience.test.ts`「Segment deleted before a scheduled send」「Legacy broadcast with an empty tag list」「Segment without conditions at send time」
- [x] 2.2 實作：`resolveAudience()` 找不到分群、分群沒有有效條件、名單為空時拋 `INVALID_AUDIENCE`，由 `executeBroadcast()` 外層標 `failed`

## 2A. 受眾解析後零人（Broadcast Send Fails When The Resolved Audience Is Empty，review #283）

- [x] 2A.1 測試：`broadcast-audience.test.ts` 三個「Resolved audience is empty」（標籤沒人、聯絡人已刪除、分群查不到人）。程式已有此行為，測試寫好即通過，改用 mutation 驗證：拿掉 `executeBroadcast()` 的 `identities.length === 0` 檢查，三個測試都失敗；拿掉 `resolveAudience()` 分群 0 人時的 `return []`，分群案例失敗（會改查渠道全部身分）。驗證後已還原
- [x] 2A.2 實作：不需改程式。`executeBroadcast()` 在 0 位收件人時拋 `BROADCAST_NO_RECIPIENTS`（中文原因），外層 catch 標 `failed`

## 3. 分群條件要有值（Segment Conditions Have Values）

- [x] 3.1 測試先行：`apps/api/tests/unit/modules/marketing/segment-rules.test.ts`「Create a segment with an empty condition value」「Create a segment with no conditions」「Preview rules without conditions」
- [x] 3.2 實作：`segment.service.ts` 的 `createSegment()`、`updateSegment()` 檢查條件；`calculateSegmentContacts()` 沒有有效條件時回 0
- [x] 3.3 前端：分群對話框條件值空白時不能建立（`apps/web/tests/unit/app/dashboard/marketing/broadcast-tab.test.tsx`「分群條件值空白時不能建立」）

## 4. 同一則廣播只發送一次（A Broadcast Is Sent Once At A Time）

- [x] 4.1 測試先行：`broadcast-audience.test.ts`「Send a broadcast that is sending」「Two send requests at the same time」「Retry a failed broadcast」
- [x] 4.2 實作：`executeBroadcast()` 以 `updateMany` 條件更新搶占 `sending`，搶不到回 409
- [x] 4.3 測試先行：`apps/web/tests/unit/app/dashboard/marketing/broadcast-tab.test.tsx`「Send button while sending」
- [x] 4.4 實作：廣播列表的「立即發送」在請求期間停用

## 5. 素材與渠道相符（Broadcast Material Matches The Channel）

- [x] 5.1 測試先行：`broadcast-audience.test.ts`「FB material on a LINE channel」；`broadcast-tab.test.tsx`「Material list follows the channel」
- [x] 5.2 實作：`createBroadcast()` 比對素材與渠道；前端用 `LINE`／`FB` 對應素材渠道

## 6. 前端受眾欄位

- [x] 6.1 測試先行：`broadcast-tab.test.tsx` 選「依標籤篩選」出現標籤多選且未選時不能建立；選項中沒有「手動選擇」；選「受眾分群」未選分群時不能建立
- [x] 6.2 實作：`marketing/page.tsx` 加標籤多選、隱藏「手動選擇」、送出 `targetConfig.tagIds`

## 7. 完成檢查

- [x] 7.1 `CHANGELOG.md` 新增 Fixed 條目
- [x] 7.2 `pnpm test` 通過
- [x] 7.3 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 7.4 `node scripts/validate-openspec.mjs fix-broadcast-audience-fail-closed` 通過

## 備註

- 每個新測試都先確認因斷言失敗（`Missing expected rejection`、按鈕未停用、選項仍有「手動選擇」）再實作。
- 既有測試只補 mock：`broadcast.service.test.ts` 的 prisma mock 加 `broadcast.updateMany`；`broadcast-schedule.test.ts` 的素材與渠道補 `channelType`。斷言未改。
- UAT E2E `tenant-fields-marketing-line.spec.ts` 的分群名稱長度案例原本用空條件建立分群，現在會被 `INVALID_SEGMENT_RULES` 擋下，改成帶一條有值的條件，讓案例仍只測名稱長度。
- 已知未處理：發送程序中途當機時廣播會停在「發送中」，不能再按立即發送，只能取消後重建。
