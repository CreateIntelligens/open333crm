# Design

## Context

見 proposal.md 的 Why。現況：`requestTrial()` 在申請時雜湊密碼並寫入 `trial_signups.passwordHash`；待驗證的申請再送一次時覆寫 `siteName`、`passwordHash` 並換 token 寄信，不受節流。`GET /trial/verify` 打開即開通，管理員密碼取自 `passwordHash`。驗證連結指向前端頁 `/trial/verify?token=`，前端頁再呼叫 API。

## Goals / Non-Goals

**Goals:**
- 管理員密碼只能由收得到驗證信的人設定。
- 待驗證的申請不能被第二次申請改動，也不能用申請繞過重寄節流。
- 改版前寄出的連結仍可完成開通。

**Non-Goals:**
- 不改密碼規則（沿用至少 8 碼）。
- 不改防枚舉的回應、速率限制與 gmail 別名正規化。
- 不處理 TRIAL-07（手動開通預設試用方案）。

## Decisions

### 驗證拆成兩個端點

- `GET /api/v1/trial/verify?token=`：只讀。回 `{ email, siteName, status: 'pending' | 'provisioned', loginUrl }`。無效 410 `TRIAL_TOKEN_INVALID`、過期 410 `TRIAL_TOKEN_EXPIRED`、failed 409 `EMAIL_IN_USE`。
- `POST /api/v1/trial/verify`：body `{ token, password, siteName? }`，Zod 驗證（`password` 至少 8 碼，`siteName` 1–100 字）。通過後才雜湊密碼、進 transaction。

保留 `GET /verify` 的路徑但改語意，而不另取路徑：驗證信的連結指向前端頁，不直接打 API，所以舊信的連結不受影響；新前端與 API 一起部署。替代方案「GET 打開仍開通、事後強制改密碼」被否決：開通前沒有本人設定的密碼，開通瞬間仍是攻擊者決定的狀態。

### 原子消耗沿用狀態閘

transaction 內 `updateMany({ id, status: 'pending_verification', verifyTokenHash: hash })` 搶佔為 `provisioning`，`count=0` 時走既有的「對方已開通 → 冪等成功／處理中 → 409」。條件加上 `verifyTokenHash`，避免讀取之後被重寄換掉 token 時，舊 token 仍搶佔成功。已開通的 token 再送一次回 `alreadyProvisioned: true`，不改密碼。

### 待驗證的申請再送一次 → 交給重寄

`requestTrial()` 遇到 `pending_verification` 時直接呼叫 `resendTrial()`（同一套冷卻與上限），不寫任何申請欄位。`failed` 的申請（email 衝突或平台作廢）沿用既有行為：重設為待驗證、以新的站台名稱與 token 重寄，寄送次數重算為 1。`failed` 要回到這條路，必須先通過「已是 Agent → 靜默」的檢查，所以不會形成無限寄信的迴圈。

### 申請時的 `password` 忽略

Zod 的 `z.object` 預設丟掉未定義的欄位。`signupSchema` 拿掉 `password` 之後，舊頁面送來的密碼不會進入 service，也不會存。選忽略而不回 400：部署當下仍開著舊申請頁的使用者照樣能送出，之後在驗證頁設定密碼。

### 移除 `trial_signups.passwordHash`

新流程不寫也不讀這個欄位。已存的值可能是攻擊者設定的密碼，保留沒有用途，所以以 migration `DROP COLUMN` 移除。已開通的租戶密碼存在 `agents.passwordHash`，不受影響。

## Risks / Trade-offs

- [部署期間舊程式仍在跑，欄位已被移除] → migration 在新容器啟動前執行，舊程式寫入 `passwordHash` 會失敗；試用申請量低，影響限於部署的幾分鐘，申請者可重送。
- [待驗證的申請已用完 5 次寄送] → 再申請不會寄信（與 `/resend` 相同），平台管理員可從 `/admin/trial` 手動重寄（繞過節流）。
- [拿到驗證連結的人可以改站台名稱] → 連結只寄到申請的信箱，持有者就是信箱本人；這正是讓本人修正他人填的名稱。

## Migration Plan

1. 部署：migration `DROP COLUMN "passwordHash"`，API 與 Web 一起更新。
2. 改版前寄出、仍在效期的連結：打開後進入設定密碼頁，照新流程開通。
3. 回滾：還原程式並以 migration 加回可為 null 的欄位；改版期間開通的租戶不需要這個欄位。
