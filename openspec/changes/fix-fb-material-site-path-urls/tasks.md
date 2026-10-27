## 1. FB 素材儲存時把站內路徑換成公開網址

- [x] 1.1 測試 `apps/api/tests/unit/modules/marketing/material-sample-urls.test.ts`：「FB 素材的示範圖換成公開網址」「FB 素材的其他站內路徑也換成公開網址」「更新 FB 素材時一樣轉換」，在現有程式上斷言失敗（原本的「FB 素材不轉換」測試隨需求移除）
- [x] 1.2 `material-sample-urls.ts`：`resolveLineSampleImageUrls()` 改名 `resolveSampleImageUrls()`，FB 版型換所有站內路徑；共用 `packages/channel-plugins/src/site-path-urls.ts`（design D1）
- [x] 1.3 LINE 情境（「圖片、影片與卡片訊息的示範圖換成公開網址」「圖文訊息的舊示範底圖換成示範底圖端點」「不是示範圖的網址不變」「更新素材時一樣轉換」）的既有測試在改寫後仍通過

## 2. FB 素材發送時把站內路徑換成公開網址

- [x] 2.1 測試 `packages/channel-plugins/tests/unit/facebook-site-path-urls.test.ts`：「已存成站內路徑的商品輪播發送成功」（含圖片、媒體、優惠券版型）「沒有設定網站公開網址」，在現有程式上斷言失敗；「公開網址與文字欄位不變」在現有程式上就通過，以突變驗證（把 `isSitePath()` 改成不排除 `//` 時失敗）
- [x] 2.2 `FbPlugin` 加建構參數 `siteBaseUrl`（預設讀 `WEB_BASE_URL`），`sendMessage()` 送出前轉換，沒有公開網址時回傳看得到的錯誤（design D2、D3）
- [x] 2.3 `.env.workers.example` 加上 `WEB_BASE_URL`

## 3. 完成定義

- [x] 3.1 `pnpm test`（api、web、workers、channel-plugins unit）
- [x] 3.2 三種 tsc
- [ ] 3.2a web build（2026-10-27 本機磁碟已滿 ENOSPC 未能完成，push 前要補跑）
- [x] 3.3 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 3.4 `node scripts/validate-openspec.mjs fix-fb-material-site-path-urls`
- [x] 3.5 `CHANGELOG.md` 的 `## [2026-10-27]` Fixed 加條目；`docs/ref/features/tenant/MARKETING.md` 更新示範圖說明
