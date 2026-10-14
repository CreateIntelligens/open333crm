## 1. 號碼格式

- [x] 1.1 單元測試 `apps/api/tests/unit/modules/identity-binding/phone-registration.test.ts`：「國際格式」「市話」與其他接受／拒絕的格式（先確認失敗）
- [x] 1.2 實作 `normalizeTaiwanMobile()`

## 2. 共用登記流程與手機登記服務

- [x] 2.1 把 `email-registration.service.ts` 抽成共用核心 `identifier-registration.ts`，email 的匯出名稱與行為不變；跑既有 email 單元與 feature 測試確認全過
- [x] 2.2 feature 測試 `apps/api/tests/feature/modules/identity-binding/phone-registration.test.ts`：「連結使用後失效」「連結過期」「開啟登記頁」「國際格式」「市話」「沒有相同號碼」「其他租戶有相同號碼」「既有電話是其他格式」「多位聯絡人使用相同號碼」「登記方本身就是最早使用該號碼的聯絡人」「已封存的聯絡人不列入比對」「含分機的電話不列入比對」「同一個 LINE OA 的兩個帳號」「雙邊收到通知」「對方沒有對話」「登記方解除」「超過 7 天」（先確認失敗）
- [x] 2.3 實作 `phone-registration.service.ts`（手機種類設定、SQL 統一格式比對、通知不含對方名稱）、合併來源 `PHONE`、解除時納入 `PHONE`
- [x] 2.4 feature 測試 `phone-registration-concurrency.test.ts`：「兩位聯絡人同時以不同格式登記同一支新手機」（advisory lock 以統一格式為 key）

## 3. 關鍵字與設定

- [x] 3.1 單元測試 `phone-registration.test.ts`：「未啟用時關鍵字不攔截」「顧客輸入關鍵字」「一般對話提到關鍵字」「超過發連結次數」；`identity-binding-settings-schema.test.ts`：「與 email 關鍵字相同」（先確認失敗）
- [x] 3.2 feature 測試 `identity-binding-settings-route.test.ts`：「設定頁沒送手機欄位」（先確認失敗）
- [x] 3.3 實作 `phoneEnabled`／`phoneKeywords` 設定、入站關鍵字攔截、只啟用手機登記時也處理解除關鍵字

## 4. 端點

- [x] 4.1 feature 測試 `phone-registration-routes.test.ts`：「關閉後已發出的連結失效」「短時間大量送出」與 400／410 回應（先確認失敗）
- [x] 4.2 feature 測試 `contact-routes-permission.test.ts`：「未啟用時客服無法傳送連結」「缺少權限」「客服傳送連結」（先確認失敗）
- [x] 4.3 實作公開路由 `/api/v1/public/phone-registration`（與 email 共用路由產生器）、`POST /contacts/:id/phone-registration-link`、狀態端點回 `phoneEnabled`、log 遮蔽 token

## 5. 前端

- [x] 5.1 元件測試：手機登記頁（顯示帳號、送出號碼、410 顯示失效）、設定頁手機開關與關鍵字、收件匣「傳送手機登記連結」（先確認失敗）
- [x] 5.2 實作 `/bind/phone/[token]`、設定頁、收件匣按鈕、合併紀錄來源標籤「手機登記」

## 7. 另一種識別不一致時交給客服（design D6）

- [x] 7.1 feature 測試 `phone-registration.test.ts`：「兩邊的 email 不同」「兩邊的 email 相同」「一邊已經用 email 歸戶過」；`email-registration.test.ts`：「兩邊的手機不同」「兩邊的手機寫法不同但是同一支」（先確認失敗）
- [x] 7.2 實作：合併前比較另一種識別，不一致時回 `identity_conflict`、不寫入、回覆顧客
- [x] 7.3 元件測試：登記頁顯示 `identity_conflict` 的說明（先確認失敗），再實作

## 6. 完成檢查

- [x] 6.1 `pnpm test`、`pnpm test:feature`、web 型別檢查
- [x] 6.2 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 6.3 更新 `CHANGELOG.md`、`docs/ref/features/tenant/CONTACTS.md`、`INBOX.md`
- [x] 6.4 `node scripts/validate-openspec.mjs add-phone-identity-merge` 與 `--specs` 通過
- [ ] 6.5 部署後在 UAT 啟用手機登記實測：不同格式的同一支手機自動合併、雙邊通知、自助解除
