# 功能健檢總表

- 核對日期：2026-10-29～2026-10-30
- 環境：本機（獨立資料庫 `open333crm_advisor`，寄信為 log 模式）＋ UAT Demo 租戶（以唯讀為主）
- 範圍：25 個功能領域，每個領域一份報告，對應的 Skill 在 `.claude/skills/feature-<id>/SKILL.md`
- 做法：規格、程式、前端入口三方對照；跑該領域的 unit 與 feature 測試；逐條實際操作前端流程（正向往返、錯誤案例、非 admin 角色）。步驟見 `.claude/agents/feature-health-checker.md`。
- 健檢只記錄問題，沒有改程式。新問題編號 `HC-<領域>-NN`；P1 與 P2 已寫入 `docs/ref/system/AUDIT.md`（新增 90 項，見 `docs/ref/system/AUDIT-REVIEWS.md` 2026-10-30 的紀錄），各報告的 AUDIT 欄是對應編號。P3 只留在健檢報告。

本次跑過的自動測試全部通過，沒有失敗也沒有 skip。測試全綠，不代表下面的問題不存在：大部分問題落在沒有測試的情境。

## 各領域問題數

數字是報告「問題清單」裡嚴重度欄以 P0～P3 開頭的列數，包含引用 AUDIT 既有項目的列、和其他領域重複的列，以及 main 之後已修好的列（例如 HC-ANALYTICS-01）。嚴重度欄寫「依 AUDIT」的列不計。

| 領域 | 報告 | P0 | P1 | P2 | P3 |
| --- | --- | --- | --- | --- | --- |
| 聯絡人與標籤 | [CONTACTS](CONTACTS.md) | 0 | 0 | 11 | 9 |
| 行銷活動、素材與優惠券 | [MARKETING](MARKETING.md) | 0 | 4 | 13 | 14 |
| 收件匣與對話 | [INBOX](INBOX.md) | 0 | 1 | 7 | 15 |
| 工單 | [CASES](CASES.md) | 0 | 0 | 14 | 15 |
| 通知 | [NOTIFICATIONS](NOTIFICATIONS.md) | 0 | 0 | 7 | 9 |
| 自動化規則 | [AUTOMATION](AUTOMATION.md) | 0 | 1 | 8 | 6 |
| 知識庫與 AI 回覆 | [KNOWLEDGE](KNOWLEDGE.md) | 0 | 3 | 3 | 10 |
| LINE 專屬功能 | [LINE](LINE.md) | 0 | 1 | 7 | 10 |
| 會員入口 | [PORTAL](PORTAL.md) | 0 | 1 | 7 | 10 |
| 短連結 | [SHORTLINKS](SHORTLINKS.md) | 0 | 0 | 3 | 11 |
| 數據分析與報表 | [ANALYTICS](ANALYTICS.md) | 0 | 3 | 2 | 11 |
| 渠道管理 | [CHANNELS](CHANNELS.md) | 0 | 1 | 6 | 19 |
| 成員、角色與權限 | [MEMBERS](MEMBERS.md) | 0 | 1 | 6 | 9 |
| 租戶設定 | [SETTINGS](SETTINGS.md) | 0 | 2 | 5 | 11 |
| 治理：稽核、匯出與資料刪除 | [GOVERNANCE](GOVERNANCE.md) | 0 | 1 | 9 | 7 |
| SLA 與營業時間 | [SLA](SLA.md) | 0 | 0 | 6 | 11 |
| 登入與身分驗證 | [PLATFORM-AUTH](PLATFORM-AUTH.md) | 0 | 0 | 6 | 9 |
| 平台：租戶管理 | [PLATFORM-TENANTS](PLATFORM-TENANTS.md) | 0 | 1 | 6 | 12 |
| 方案與上限 | [PLATFORM-PLANS](PLATFORM-PLANS.md) | 0 | 1 | 2 | 10 |
| 方案異動申請與審核 | [PLATFORM-PLAN-CHANGES](PLATFORM-PLAN-CHANGES.md) | 0 | 0 | 6 | 8 |
| 用量統計與 AI 成本 | [PLATFORM-USAGE](PLATFORM-USAGE.md) | 0 | 0 | 8 | 8 |
| 平台帳號管理 | [PLATFORM-USERS](PLATFORM-USERS.md) | 0 | 0 | 3 | 8 |
| 平台設定 | [PLATFORM-SETTINGS](PLATFORM-SETTINGS.md) | 0 | 1 | 3 | 6 |
| 試用申請與到期處理 | [PLATFORM-TRIALS](PLATFORM-TRIALS.md) | 0 | 2 | 5 | 13 |
| 佇列監控 | [PLATFORM-QUEUE-MONITORING](PLATFORM-QUEUE-MONITORING.md) | 0 | 0 | 3 | 6 |

## P1 清單

沒有 P0。以下 22 個是新發現的 P1，HC-ANALYTICS-01 已在 main 修正，其餘 21 個未修（試用報告引用的 HC-PLATFORM-TENANTS-01 只算一次）。最後 4 個原列 P2，2026-10-30 經使用者決定升為 P1。「驗證」欄寫明是實際操作重現，還是只讀程式。

| 編號 | AUDIT | Issue | 問題 | 驗證 |
| --- | --- | --- | --- | --- |
| HC-MARKETING-01 | [MKT-02](../../system/AUDIT.md#mkt-02) | #409 | 沒有 `marketing.broadcast` 的人，建立帶排程時間的群發，到期照樣送出 | 本機實測 |
| HC-MARKETING-02 | [MKT-03](../../system/AUDIT.md#mkt-03) | #409 | 附券群發繞過 `coupon.issue`，沒有優惠券權限也能發券 | 本機實測（發出 3 張） |
| HC-MARKETING-03 | [MKT-04](../../system/AUDIT.md#mkt-04) | #409 | 群發不套用渠道可見範圍，分店帳號可對看不到的渠道群發 | 本機實測 |
| HC-MARKETING-04 | [CHAN-02](../../system/AUDIT.md#chan-02) | #415 | WebChat 群發與批次發券顯示成功，顧客實際收不到 | 本機實測 |
| HC-CHANNELS-01 | [RBAC-07](../../system/AUDIT.md#rbac-07) | #408 | 單筆渠道的讀取、修改、停用、刪除、換權杖都不檢查渠道可見範圍 | 本機實測 |
| HC-MEMBERS-01 | [RBAC-08](../../system/AUDIT.md#rbac-08) | #413 | 主管可以把管理員降級；改角色沒有最後一位管理員保護 | 降級實測；無法復原只讀程式 |
| HC-GOVERNANCE-01 | [AUD-03](../../system/AUDIT.md#aud-03) | #414 | 永久刪除成員後，他的稽核紀錄全部變成沒有操作者（`onDelete: SetNull`） | 本機實測 |
| HC-PLATFORM-TENANTS-01 | [AUTH-11](../../system/AUDIT.md#auth-11) | #410 | 停用的租戶仍收得到 WebChat 訊息，違反主規格 | 本機實測 |
| HC-PLATFORM-TRIALS-01 | [TRIAL-05](../../system/AUDIT.md#trial-05) | 已修正（本 PR） | 同一 email 待驗證時再申請一次，會覆寫密碼，申請人點信後站台以他人密碼開通 | 本機實測；UAT 的 `trial.enabled` 為 true，正式環境可被利用。修正（`e90e9849`，change `trial-set-password-after-verify`）：申請不收密碼，點驗證連結後在驗證頁設定密碼才開通；待驗證再申請不改資料、走重寄節流（同修 TRIAL-06）。feature 測試涵蓋搶先申請與覆寫 |
| HC-PLATFORM-PLANS-01 | [PLAN-14](../../system/AUDIT.md#plan-14) | #411 | seed 的試用、輕量版方案不含 `channels` 功能，管理員看不到也建不了渠道 | 本機實測；UAT 方案內容相同（2026-10-30 平台 API 唯讀確認） |
| HC-LINE-01 | [CASE-03](../../system/AUDIT.md#case-03) | #416 | LINE 滿意度問卷送出空白文字（沒有 `flex` 分支），失敗沒人知道，也不重寄 | 函式實測；LINE 是否拒收待真機驗 |
| HC-KNOWLEDGE-01 | [KB-01](../../system/AUDIT.md#kb-01) | #419 | 追問次數用完時回「已為您轉接」，實際沒有轉接 | 假 LLM 實測，未經 workers 與真實渠道 |
| HC-KNOWLEDGE-02 | [KB-02](../../system/AUDIT.md#kb-02) | #420 | 型號守門不分大小寫，`Wi-Fi`、`e-mail` 被當成查不到的型號 | 假 LLM 實測 |
| HC-KNOWLEDGE-03 | [KB-03](../../system/AUDIT.md#kb-03) | #421 | 沒有 BOM 的 UTF-8 CSV 匯入後中文變亂碼，英文表頭時還會直接發布 | 本機實測 |
| HC-AUTOMATION-01 | [AUTO-06](../../system/AUDIT.md#auto-06) | #418 | 規則編輯器把純數字條件值存成數字，文字欄位條件永遠不成立 | 本機實測 |
| HC-ANALYTICS-01 | 未收錄 | — | 訊息趨勢的日期全部是 0（報表與 CLI） | 本機與 UAT 實測；main 的 `093b7e75` 已修正 |
| HC-PORTAL-01 | [PORTAL-03](../../system/AUDIT.md#portal-03) | #424 | 編輯草稿活動不帶出原選項，只改標題就清掉選項與正確答案 | 本機與 UAT 實測；main 仍存在 |
| HC-SETTINGS-01 | [HOURS-01](../../system/AUDIT.md#hours-01) | #425 | 營業時間設定為 `{}` 的租戶，按「啟用」整頁崩潰 | 本機實測 |
| HC-PLATFORM-SETTINGS-02 | [RLS-10](../../system/AUDIT.md#rls-10) | #412 | `rls_roles_and_grants` migration 把整個 schema 授權給 `app_tenant`：租戶連線能讀平台帳號的密碼雜湊、改價目表與其他租戶的平台設定。要先有注入點才能利用，但 RLS 少了一道防線 | 本機實測（交易內，已 ROLLBACK） |
| HC-INBOX-01 | [CONV-04](../../system/AUDIT.md#conv-04) | #422 | 收件匣只載入前 50 段對話，沒有分頁；篩選與搜尋都只在這 50 段裡找 | 本機與 UAT 實測 |
| HC-ANALYTICS-02 | [CASE-04](../../system/AUDIT.md#case-04) | #417 | 直接關閉的工單不寫 `resolvedAt`、重開保留舊值，已解決數與 SLA 達成率失真 | 本機實測；UAT 3 張已關閉工單有 2 張缺值 |
| HC-ANALYTICS-04 | [ANA-03](../../system/AUDIT.md#ana-03) | #423 | 匯出 CSV 沒有跳脫，顧客暱稱含逗號會錯位、以 `=` 開頭會被 Excel 當公式 | 本機實測 |

Issue 欄的 #408～#425 是 2026-10-30 依「同根因合成一張」開的單；TRIAL-05 的重現步驟可直接用來攻擊正式環境，當時暫不開公開 issue；2026-11-02 已修正（`e90e9849`），部署到正式環境之前仍可被利用。

另外，AUDIT 既有的 P1 RBAC-02（agent 用 CLI 登入就能讀全租戶報表）在本機實測重現。

## 跨領域的共同問題

同一類問題在多個領域出現，修的時候一起處理比較省事：

- **渠道可見範圍沒套到**：群發（HC-MARKETING-03）、單筆渠道（HC-CHANNELS-01）、報表與匯出（HC-ANALYTICS-03）、資料匯出與刪除（HC-GOVERNANCE-02）、新訊息通知（HC-NOTIFICATIONS-01）、工單連結對話與指派（HC-CASES-03、04）、對話詳情的身分（HC-INBOX-05）、聯絡人（RBAC-04）。
- **按鈕不依權限隱藏，403 顯示成「沒有資料」**：幾乎每個後台頁面都有。
- **失敗只寫 log**：LINE 問卷、短連結點擊貼標、圖文選單綁定、下游轉發、週期工作吞錯（HC-PLATFORM-QUEUE-MONITORING-01）、寄信失敗仍顯示成功。
- **時區**：分群日期、報表趨勢、用量月份都用 UTC 切日，台灣 00:00～08:00 的資料算到前一天。
- **稽核缺口**：行銷、優惠券、渠道換憑證、Webhook 訂閱、匯出下載、平台登入與重設密碼都沒有寫稽核。
- **非 UUID 的 id 回 400 `DATABASE_ERROR`**：多個模組都有。

## 需要決定的事

1. 聯絡人列表排除只有 WebChat 身分的客人（規格明訂；UAT Demo 170 位只列 27 位），要不要改。
2. SLA 以日曆時間連續計算、不扣營業時間（HC-SLA-01），是產品決定還是缺陷。
3. 「通知偏好、靜音」前後端都沒有，要不要排。

UAT Demo 有一筆 2026-09-16 起待審的加購申請，是 BD 在測試使用的，不要審核或清除。它會擋住 Demo 送出新的方案申請，相關 E2E（`cross-plan-request.spec.ts`）在 Demo 上跑不了。

## 待真機驗

本機收不到 LINE、FB、IG 的 webhook，也不能對真實帳號發訊。各報告「待真機驗」一節列出這些流程，重點有：LINE 滿意度問卷是否送達、群發與發券的實際投遞、LIFF 與 LINE Login、Passkey、正式寄信模式下的開通信與驗證信。

## 健檢留下的資料

- UAT：見 [uat-ledger.md](uat-ledger.md)。這一輪只建立 1 筆，已刪除。前一輪留下 2 位帶前綴的 WebChat 測試聯絡人，系統沒有刪除聯絡人的 API，目前保留。
- 本機 `open333crm_advisor`：各領域以 `hc-<領域>-` 為前綴建立的租戶、成員、角色、渠道與聯絡人，有些因為沒有刪除 API 而保留。這是獨立的資料庫，不影響開發庫。
