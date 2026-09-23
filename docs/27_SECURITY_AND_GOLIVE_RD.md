# 公開測試前 — 資安 + 就緒度技術清單（給 RD 討論）

> **對象**：RD / 技術討論用。含檔案:行號證據、實作方向、驗證方式。
> **日期**：2026-09-01
> **搭配文件**：給總經理版 `docs/26_GO_LIVE_READINESS_FOR_GM.md`（同一份工作，不含技術細節）、先前就緒度評估 `docs/25_COMMERCIAL_READINESS_TECH_ASSESSMENT.md`
> **檢測方法**：基礎設施層由外部網路實測 UAT（`52.24.248.167`）；程式碼層逐檔盤點（read-only）。
> **人力假設**：1 位全職 RD（AI 輔助）為開發主力，PM 負責上機驗證/協調；天數為 AI 輔助口徑、含部署驗證緩衝。

---

## 目錄

- [S. 資安（獨立一項，最優先）](#s-資安獨立一項最優先)
  - [S0 基礎設施暴露面（P0，實測確認）](#s0-基礎設施暴露面p0實測確認)
  - [S1 客戶上傳檔案](#s1-客戶上傳檔案)
  - [S2 金鑰/憑證](#s2-金鑰憑證)
  - [S3 認證強化](#s3-認證強化)
  - [S4 Web 層防護](#s4-web-層防護)
  - [S5 依賴漏洞](#s5-依賴漏洞)
  - [S6 已驗證良好、不用動](#s6-已驗證良好不用動)
- [O. 其他就緒度項目](#o-其他就緒度項目)
- [排程總表](#排程總表)

---

## S. 資安（獨立一項，最優先）

### S0 基礎設施暴露面（P0，實測確認）

**這是全清單最嚴重的一項，且與「等不等公開測試」無關 — UAT 現有真實資料，應立即修。**

從外部網路實測 `52.24.248.167`，14 個 port 全部可達：

| Port | 服務 | 實測結果 | 風險 |
|---|---|---|---|
| 6380 | Redis | **無密碼**，`PING`/`INFO` 直接回應 | 讀寫全部 session/queue，竊登入態、竄改資料 |
| 5433 | PostgreSQL | 公網 TCP 可連 | 客戶 DB 直接暴露，只差密碼 |
| 9000/9001 | MinIO + console | HTTP 200 | 客戶上傳檔案 + 管理台暴露 |
| 11434 | Ollama | **無認證** `/api/tags` 可查、可呼叫 | 白嫖算力、探測 |
| 3000/3001 | web/api | 繞過 nginx 直達 | 繞過反向代理層防護 |
| 22/80/443 | ssh/nginx | 應保留（22 建議限來源 IP） | — |

根因：AWS Security Group 放行全部 port ＋ docker-compose 用 `0.0.0.0` 綁定。

**修法**：
1. Security Group：對外只留 `443/80/22`，其餘全移除公網 inbound。22 建議限公司/VPN 來源 IP。
2. docker-compose：`5433/6380/9000/9001/11434/3000/3001` 的 port 綁定改 `127.0.0.1:xxxx:xxxx`（雙保險，即使 SG 誤放也不外露）。
3. Redis 設 `requirepass`；確認 Postgres 非弱密碼。
4. 清掉 `/tmp/.env.api.bak`（含密碼舊備份）；主機裝 `fail2ban`。

**附帶發現**：對外實為 **nginx**（非記憶中的 caddy；caddy 容器只綁 8888）；主機另跑 5 個 `tatung-linebot`/`aitago` 舊容器擠磁碟（見 O5）。

**驗證**：修後重跑外部 port 掃描，只剩 22/80/443；`nc 6380` 應被拒。

**天數：0.5**

---

### S1 客戶上傳檔案

| 項 | 現況 | 證據 | 級別 |
|---|---|---|---|
| 上傳類型驗證 | ❌ 主端點信任前端 `file.mimetype`，無白名單、無圖片內容驗證 | `storage.routes.ts:16-39`、`storage.service.ts:59-72` | 高 |
| 檔案存取 | ❌ 一律 `ACL:'public-read'`（`S3_SET_ACL` 預設 1），回公開 URL 非 presigned；A 租戶拿到 B 租戶 URL 即可讀，無 auth gate | `s3.provider.ts:55-59`、`storage.service.ts:25`、`config/env.ts:47` | 高 |
| webchat media | ⚠️ 公開上傳端點無認證（僅驗 visitorToken 是 UUID 格式），同樣無 MIME 白名單 | `webchat.routes.ts:72-103` | 中高 |
| 大小上限 | ⚠️ 只有全域 multipart 25MB，無 per-type | `index.ts:109` | 中 |
| 路徑穿越 | ✅ key 用 `randomUUID()`，只取 `extname()` | `storage.service.ts:35-46,67-69` | — |

**修法**：
- 關 public ACL（`S3_SET_ACL=0`）；下載改 presigned URL（provider 已有 `getSignedUrl`，`s3.provider.ts:62-71`）或帶 auth 的代理端點 + 租戶前綴檢查（DELETE 已有此檢查 `storage.routes.ts:89`，讀取比照）。
- 上傳加 MIME/副檔名白名單（比照 imagemap 已做的 `storage.routes.ts:48`）+ 圖片 magic bytes 驗證 + per-type 大小上限。
- webchat media 評估是否需認證/限流。
- （選）接 ClamAV 掃毒。

**天數：1.5**

---

### S2 金鑰/憑證

| 項 | 現況 | 證據 | 級別 |
|---|---|---|---|
| 渠道憑證加密 | ✅ AES-256-GCM + 隨機 IV + authTag（正確的認證加密） | `channel.service.ts:10-41` | — |
| **硬編碼 fallback 金鑰** | ⚠️ `CREDENTIAL_ENCRYPTION_KEY ?? 'fallback-open333crm-key'`，env 漏設即用原始碼裡的公開金鑰加密 | `channel.service.ts:17`、`workers/src/lib/credentials.ts:6` | 高 |
| scrypt 靜態 salt | ⚠️ salt 固定字串 `'open333crm-credentials'` | `channel.service.ts:18` | 中 |
| 租戶 BYOK Gemini key | ✅ 同組 GCM 加密，查詢遮罩 | `ai-key.service.ts:15-81` | — |
| 平台 AI key | ⚠️ 明文於 env `GEMINI_API_KEY` | `ai-key.service.ts:44-45`、`config/env.ts:40` | 中 |
| 硬編碼 secret 進版控 | ✅ 無（`.env*` 已 gitignore，僅 `.example` 進版控） | `.gitignore` | — |

**修法**：移除 fallback，改「未設 `CREDENTIAL_ENCRYPTION_KEY` 即啟動失敗（fail-loud）」；prod 確認已設高熵金鑰；scrypt salt 改隨機並隨密文存（需相容既有資料的遷移，注意舊資料解密路徑）。

**天數：0.5**（fallback + fail-loud；salt 遷移若要做另計 0.5）

---

### S3 認證強化

| 項 | 現況 | 證據 | 級別 |
|---|---|---|---|
| 密碼 hash | ⚠️ bcryptjs rounds=10（純 JS，偏低） | `shared/utils/password.ts:1-11` | 中 |
| **帳號鎖定** | ❌ 無 `failedAttempts/lockedUntil`，只靠 IP 限流，分散 IP 可繞 | `auth.service.ts:5-52` | 中 |
| 登入限流 | ✅ 10/min per IP；平台/trial 亦有 | `auth.routes.ts:136-141` | — |
| JWT | ✅ 租戶/平台 secret 分離、平台未設回 503、access 15m/refresh 30d、HttpOnly cookie | `auth.plugin.ts:105-147`、`auth.routes.ts:43-53` | — |
| Portal token | ⚠️ 用租戶 JWT_SECRET 手簽、24h、無 refresh/撤銷 | `portal-auth.service.ts:21-30` | 中 |
| **Partner API key** | ⚠️ 有 bcrypt hash+prefix+過期，但無 scope，認證後一律賦 `SUPERVISOR` | `partner-api-key.service.ts:97-135`、`auth.plugin.ts:252-258` | 中高 |

**修法**：補帳號鎖定（連續失敗 N 次鎖 M 分鐘）；bcrypt rounds 10→12 或改 argon2id（換演算法需相容既有 hash，登入時偵測舊格式重 hash）；Partner API key 加 scope 機制（比照 CLI session token 已有 scopes，`auth.plugin.ts:72-80`）。

**天數：1.5**

---

### S4 Web 層防護

| 項 | 現況 | 證據 | 級別 |
|---|---|---|---|
| **CORS** | ⚠️ 寫死 `origin:true` + `credentials:true`（反射任何來源並允許帶憑證）；`CORS_ORIGIN` 有定義但 plugin 沒讀 | `cors.plugin.ts:6-11`、`config/env.ts:20` | 中高 |
| **Security headers** | ❌ 未裝 `@fastify/helmet`，無 HSTS/CSP/X-Frame-Options/X-Content-Type-Options | `index.ts:110-116` | 中 |
| Cookie | ✅ refresh cookie httpOnly + sameSite strict + secure(prod) | `auth.routes.ts:69-77` | — |
| XSS | ✅ 前端無 `dangerouslySetInnerHTML`、無 md→HTML 庫，React 自動轉義；widget 僅靜態 innerHTML 不含客戶輸入 | `apps/widget/src/ui.ts:88,105` | 低 |
| Zod 覆蓋 | ✅ 42 route 檔中 37 用 `.parse()` | — | — |

**修法**：`cors.plugin.ts` 改讀 `CORS_ORIGIN` 白名單（正式網域清單）；裝 `@fastify/helmet` 設 HSTS + 合理 CSP。

**天數：1.5**（含 CSP 調整驗證，避免擋到前端）

---

### S5 依賴漏洞

`pnpm audit --prod`：**0 critical / 24 high / 13 moderate**。

優先升級（依攻擊面）：
- **`next`** — App Router DoS、Server Actions SSRF、rewrites SSRF（多筆，最高優先）
- **`sharp`/libvips** — 圖片處理，直接在上傳攻擊面上
- `engine.io`/`socket.io-parser` — polling DoS
- `xlsx` — 原型污染 + ReDoS（**無修補版**，評估改 `exceljs` 或加輸入限制）
- `fast-uri`（Fastify）、`brace-expansion`、`postcss`、`nanoid`、`find-my-way`、`fast-xml-parser`（aws-sdk）

**修法**：優先 `next`/`sharp`/socket.io；`xlsx` 無 patch 需替換或圍堵。升級後跑 e2e 回歸（已有 Playwright 套件 `feat/figma-design-system`）。

**天數：1.5**（升級 + 回歸；`xlsx` 替換若做另計）

**後續**：`pnpm audit` 加進 CI 品質閘（見 O 段 / docs/25 D9）。

---

### S6 已驗證良好、不用動

- Raw SQL 全參數化（`$queryRawUnsafe`/`$executeRawUnsafe` 皆 `$1,$2` 綁定）：`embedding.service.ts:103,161,199`、`knowledge.service.ts:79,237`、`tenant-db.ts:72-79` 等。
- Webhook HMAC 驗簽 fail-closed：LINE `timingSafeEqual`（`line/index.ts:176-183`）、FB/IG `x-hub-signature-256`（`facebook/index.ts:10-20`），缺 header 一律 `return false`。
- 無命令注入活躍路徑：`MarkitdownService.ts:29` 的 `execAsync` 字串內插是 dead code（無呼叫端），建議順手移除或改 `execFile` 防未來被接上。
- 前端無 XSS sink、JWT 分離、secret 未進版控。
- Postgres RLS 已於 UAT 真正啟用（app_tenant 連線、69/69 表 FORCE、無 BYPASSRLS）— 對應 docs/25 D5「上線前實測連線身分」的硬條件**已達成**。

---

## O. 其他就緒度項目

（詳細決策背景見 docs/25，此處為執行清單）

| # | 項目 | 現況 / 缺口 | 天數 |
|---|---|---|---|
| O1 | **每日備份 + 還原演練** | ❌ 完全無（無 crontab、無備份目錄）。pg_dump 每日 + 異地保存 + 演練還原一次 | 1 |
| O2 | **可觀測性 / 告警** | ❌ 只有本地文字 log、無集中、無告警；`/health` 只是固定 ok。裝 Sentry（含 PII `beforeSend` 過濾）+ `/ready`(檢查 DB/Redis) + Slack 告警 | 1.5 |
| O3 | **修部署管線 + 追版** | ⚠️ UAT 落後 main：有 #155 檔案卻無 #157 `scheduler-lock.ts`，main 已到 #158；自動部署 8/28 後疑中斷且無人知（正是 O2 缺告警的實例）。查 runner log、追上 main、決定 PR #160 是否納首波 | 1 |
| **O4** | **環境分層：拆 dev / prod（見下方詳述）** | ⚠️ **只有一個環境**。`deploy.yml` push main→self-hosted runner rsync 到唯一 UAT（`.github/workflows/deploy.yml:4-18`）。無 staging/prod 分離。開發部署 = 客戶測試環境被覆蓋 | 2 |
| O5 | **Per-tenant 限流** | ⚠️ 已登入租戶 API（conversations/contacts/cases…）零限流，`keyGenerator` 只用 IP。補粗粒度 per-tenant quota | 1 |
| O6 | **UAT 環境清理** | ⚠️ 5 個 tatung-linebot/aitago 舊容器 + Ollama 擠 40G（66% 用量）。清理或搬遷 + 加磁碟監控 | 0.5 |
| O7 | **WAF（選）** | 無。AWS WAF 或 Cloudflare proxy，擋 SQLi/XSS/掃描 + DDoS 緩解 | 1 |

#### O4 環境分層 — 技術現況與方向（docs/25 D4 問題 A）

**現況**：
- 唯一環境（實體上是 UAT 那台 EC2）。`deploy.yml` 觸發 `on: push: branches:[main]` → `runs-on:[self-hosted, uat]` → `rsync -av --delete` 覆蓋部署（`.github/workflows/deploy.yml:4-18`）。
- 素材已有但未啟用：repo 內有 `docker-compose.prod.yml`、`docker-compose.dev.yml`、`.env.prod.example`，代表原本就規劃過分層，只是沒真的跑起兩套。
- DB/Redis/MinIO 都是這台上的單一 instance，開發與（未來的）客戶測試資料同庫。

**問題**：一旦客戶在這台公開測試，`push main` 的每次開發部署都會 `--delete` 覆蓋掉客戶正在用的版本 + 混用同一份資料。無「先驗證再放行」的 gate。

**方向（沿用現有技術棧，不換 IaC）**：
- 最小可行：**主機/容器層面分兩套** — 開發／測試環境（工程師日常）與 客戶測試環境（穩定版，對應「prod」語意）。各自 `docker-compose` + `.env` + 獨立 DB/Redis/MinIO。
- 部署分流：`develop`（或 feature 分支）→ dev 環境；`main`（或 tag / release 分支）→ prod 環境。調整 `deploy.yml` 的 branch→runner 對應，`docker-compose.prod.yml` 已備可直接用。
- 資源選擇待討論：**同一台機器跑兩套 compose（省成本、隔離較弱）** vs **另開一台 EC2（隔離乾淨、多一份成本）**。建議客戶測試環境獨立機器，避免開發把機器資源吃滿影響客戶。
- ⚠️ 與 O6 連動：現在這台已被舊專案容器 + Ollama 吃到 66% 磁碟，若要同機跑兩套，得先清理或加容量。

**不在此範圍**：docs/25 D4 問題 B 的「大客戶各自獨立部署（IaC/K8s，解讀③）」— 需求驅動、之後再評估。現階段只需 dev/prod 兩層（解讀①的環境紀律）。

**天數：2**（多備一套 + 部署分流 + 驗證）。若決定另開機器，加機器 provisioning 時間。

**未列入公開測試範圍（下一階段）**：金流/訂閱/發票（docs/25 D1/D2，最大牆）、成員 email 邀請（D8）、CI lint gate（D9）、官網/Help Center/SSO（成長軸）、WhatsApp 渠道。

---

## 排程總表（依優先序）

以 1 位全職 RD（AI 輔助）主線推算。順序即建議執行順序；「累計」為做到該項的工作天總和。與總經理版 `docs/26` 的 P1–P12 一一對應。

| 順序 | 技術項 | 內容 | 排序理由 | 天數 | 累計 |
|---|---|---|---|---|---|
| **P1** | S0 | 基礎設施暴露面收斂（SG + port 綁定 + Redis 密碼） | 最高 CP、不需等決策、現有資料就受惠 | 0.5 | 0.5 |
| **P2** | O3 | 修部署管線 + UAT 追上 main | 後面每項都要部署驗證，管線先修 | 1 | 1.5 |
| **P3** | O4 | 環境分層（拆 dev/prod） | 開放客戶測試的前提，避免開發覆蓋客戶版本 | 2 | 3.5 |
| **P4** | O1 | 每日備份 + 還原演練 | 真資料進來前要有救援機制 | 1 | 4.5 |
| **P5** | O2 | 監控告警 + readiness（Sentry/Slack/`/ready`） | 讓前面的部署/備份「出事有人知道」 | 1.5 | 6 |
| **P6** | S1 | 上傳非公開化 + MIME/大小驗證 | 上傳半公開且不驗類型，開放前必收斂 | 1.5 | 7.5 |
| **P7** | S2 | 金鑰 fallback 移除 + fail-loud | 避免用到硬編碼公開金鑰 | 0.5 | 8 |
| **P8** | S3+S4 | 帳號鎖定 + bcrypt/argon2 + CORS 收斂 + helmet | 認證與 Web 層防護 | 3 | 11 |
| **P9** | S5 | 高危依賴升級（next/sharp/socket.io）+ 回歸 | 需回歸、依賴前面環境就緒，放最後 | 1.5 | 12.5 |
| P10 | O5 | Per-tenant 限流 | 防單租戶拖垮全系統 | 1 | 13.5 |
| P11 | O6 | UAT 環境清理 + 磁碟監控 | 舊容器擠磁碟；與 P3 同機方案連動 | 0.5 | 14 |
| P12 | O7 | WAF | 擋常見攻擊/掃描 | 1 | 15 |

> 註：此表把 S3（1.5）+S4（1.5）合併為 P8（共 3 天），與總經理版拆成 P8「登入防護」1.5 + 併入的網頁防護對應；總經理版必做小計 ~11 是 P1–P9，本表 P1–P9 累計 12.5 因額外含 P8 的 CORS/helmet 全額——**以本 RD 表為工時實算依據**（必做 P1–P9 ≈ 12.5 人日，含建議 ≈ 15 人日）。總經理版取整為「必做 ~11 / 含建議 ~13.5」作對外溝通概數。

**里程碑**：
1. 本週：P1（S0，不等決策，最高 CP）。
2. ~2.5 週：P1–P9 → 達公開測試技術門檻。
3. 視時程：P10–P12 建議項。

**討論待決**：
- S2 scrypt salt / S3 演算法遷移要不要現在做（涉既有資料相容，各 +0.5）。
- S5 `xlsx` 無 patch → 替換 `exceljs` 或圍堵？
- O3 PR #160（素材/貼標一大包）是否納入首波公開測試版本。
- 維運告警的 on-call 責任歸屬（Louis 離職後無正式接手）。
