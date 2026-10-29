# tenant-data-erasure Specification

## Purpose
規定怎麼刪除單一聯絡人的個人資料，對應個資法與 GDPR 的被遺忘權：發起申請、`anonymize` 與 `hard_delete` 兩種模式各處理哪些資料，以及完成後的稽核與通知。兩種模式沒有處理的資料記在 `docs/ref/system/AUDIT.md` 的 ERASE-01。

## Requirements

### Requirement: 發起聯絡人資料刪除

`POST /api/v1/tenant/data-erasure` SHALL 接受 `contactId`、`mode`（`anonymize` 或 `hard_delete`，預設 `anonymize`）與選填的 `reason`。`reason` SHALL 存在請求的 `reason` 欄位，SHALL NOT 寫進稽核的 `payload` 或佇列的工作內容。聯絡人 SHALL 屬於目前的租戶，否則系統回 HTTP 404 `CONTACT_NOT_FOUND`，不建立請求。

聯絡人屬於目前的租戶時，系統 SHALL 建立一筆 `status` 是 `pending` 的 `DataErasureRequest`，寫一筆 `data.erasure.request` 稽核，再把刪除工作放進 `data-erasure` 佇列。稽核 SHALL 記錄發起請求的來源 IP。呼叫的成員 SHALL 有 `data.erase`，沒有時系統回 HTTP 403。

#### Scenario: 發起匿名化
- **WHEN** 有 `data.erase` 的成員對本租戶的聯絡人發起刪除，帶 `reason`、沒有指定 `mode`
- **THEN** 系統建立 `mode` 是 `anonymize`、`status` 是 `pending` 的請求，`reason` 存在請求上，寫一筆 `data.erasure.request` 稽核，`payload` 只有 `contactId` 與 `mode`，佇列的工作內容不含 `reason`

#### Scenario: 發起刪除的稽核記錄來源 IP
- **WHEN** 有 `data.erase` 的成員從某個 IP 發起刪除
- **THEN** `data.erasure.request` 稽核的 `ip` 是該請求的來源 IP

#### Scenario: 其他租戶的聯絡人被拒
- **WHEN** 成員對其他租戶的聯絡人發起刪除
- **THEN** 系統回 HTTP 404，`error.code` 是 `CONTACT_NOT_FOUND`，不建立請求

#### Scenario: 沒有 data.erase 不能發起
- **WHEN** 沒有 `data.erase` 的成員送出 `POST /api/v1/tenant/data-erasure`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `data.erase`，不建立請求

### Requirement: 匿名化聯絡人

`anonymize` 模式 SHALL 在同一個交易內：

- 把聯絡人的 `displayName` 改成 `[已刪除]`，`avatarUrl`、`phone`、`email` 清成 `null`。
- 刪除該聯絡人的屬性、渠道身分、`IdentityMap` 與長期記憶。
- 把該聯絡人對話裡所有進站訊息的 `content` 改成 `{ redacted: true }`。

交易成功後，系統 SHALL 依「刪除頭像檔的範圍」刪除聯絡人的 `avatarUrl` 與渠道身分的 `profilePic` 在物件儲存的頭像檔；單一檔案刪除失敗時只記錄 log。

對話、工單、出站訊息與聯絡人本身 SHALL 保留，報表的數字因此不變。這個模式不處理的資料列在 `docs/ref/system/AUDIT.md` 的 ERASE-01。

#### Scenario: 匿名化後無法從聯絡人與進站訊息識別客人
- **WHEN** worker 以 `anonymize` 處理一位有渠道身分、屬性、對話與工單的聯絡人
- **THEN** 聯絡人的名稱是 `[已刪除]`，電話、email、頭像是 `null`，屬性、渠道身分、`IdentityMap` 與長期記憶已刪除，進站訊息的內容是 `{ redacted: true }`，對話、工單與出站訊息仍在

#### Scenario: 匿名化刪除頭像檔
- **WHEN** worker 以 `anonymize` 處理一位聯絡人，聯絡人與他的渠道身分的頭像存在本租戶的 `avatars` 目錄
- **THEN** 這些頭像檔已從物件儲存刪除

### Requirement: 硬刪除聯絡人

`hard_delete` 模式 SHALL 在同一個交易內刪除該聯絡人的對話與訊息、工單、活動提交、積分紀錄，以及聯絡人本身。聯絡人的屬性、渠道身分、`IdentityMap`、長期記憶、標籤與聯絡人關係隨聯絡人一起刪除。交易成功後，系統 SHALL 刪除這些訊息在物件儲存的媒體檔，以及依「刪除頭像檔的範圍」刪除聯絡人與渠道身分的頭像檔；單一檔案刪除失敗時只記錄 log。

硬刪除 SHALL 只刪除目標聯絡人的資料。目標與其他聯絡人之間的關係只刪除關係本身，其他聯絡人與他們的資料保留。

#### Scenario: 硬刪除連帶刪除對話與工單
- **WHEN** worker 以 `hard_delete` 處理一位有對話、訊息（含媒體檔）、工單、活動提交與積分紀錄的聯絡人
- **THEN** 聯絡人、他的對話、訊息、工單、活動提交、積分紀錄、屬性、渠道身分、`IdentityMap`、長期記憶與標籤都已從資料庫刪除，訊息的媒體檔已從物件儲存刪除

#### Scenario: 硬刪除刪除頭像檔
- **WHEN** worker 以 `hard_delete` 處理一位聯絡人，聯絡人與他的渠道身分的頭像存在本租戶的 `avatars` 目錄
- **THEN** 這些頭像檔已從物件儲存刪除

#### Scenario: 硬刪除不影響其他聯絡人
- **WHEN** 被硬刪除的聯絡人與另一位聯絡人之間有聯絡人關係
- **THEN** 關係已刪除，另一位聯絡人與他的對話仍在

### Requirement: 刪除頭像檔的範圍

兩種模式刪除頭像檔時，系統 SHALL 只刪除同時符合下列條件的檔案：

- 網址的來源等於 workers 的 `S3_PUBLIC_URL` 的來源，路徑是 `{S3_PUBLIC_URL 的路徑}/{bucket}/{tenantId}/avatars/{uuid}.{jpg|png|webp|gif}`。查詢字串與 fragment 不算在路徑內。
- 同租戶沒有其他聯絡人的 `avatarUrl` 或其他聯絡人的渠道身分的 `profilePic` 還在用這個網址。

系統 SHALL 在讀取頭像時鎖住聯絡人與渠道身分，讓刪除期間背景補存寫回的頭像也被刪除。`S3_PUBLIC_URL` 沒有設定或來源不同時，系統 SHALL NOT 刪除格式符合的檔案，並把筆數記在 `affected.avatarObjectsSkipped`；其他人還在用而保留的筆數記在 `affected.avatarObjectsShared`。

#### Scenario: 刪除期間才寫回的頭像檔也會刪除
- **WHEN** worker 開始刪除時，背景補存正要把渠道身分的頭像改成剛上傳的檔案
- **THEN** 刪除等補存寫完，再刪除這個新的頭像檔

#### Scenario: 不刪物件儲存以外或其他租戶的檔案
- **WHEN** 聯絡人的頭像是平台的網址、來源不是 `S3_PUBLIC_URL`、指向其他租戶的檔案，或不是 `{uuid}.{jpg|png|webp|gif}` 格式的檔案
- **THEN** 系統不刪除這個檔案

#### Scenario: 其他聯絡人仍在用的頭像檔保留
- **WHEN** 同租戶另一位聯絡人的 `avatarUrl` 與被刪除聯絡人的頭像是同一個檔案（例如合併時沿用）
- **THEN** 系統不刪除這個檔案，`affected.avatarObjectsShared` 記一筆

#### Scenario: 沒有設定 S3_PUBLIC_URL 時不刪頭像檔
- **WHEN** workers 沒有設定 `S3_PUBLIC_URL`，被刪除的聯絡人有本租戶 `avatars` 目錄的頭像
- **THEN** 刪除照常完成，頭像檔不刪，`affected.avatarObjectsSkipped` 記一筆

### Requirement: 刪除完成時記錄結果

刪除成功後，系統 SHALL 把請求改為 `completed`，`affected` 記錄各類資料的筆數，並寫一筆 `data.erasure.complete` 稽核，`actorId` 是發起的成員。稽核的 `payload` SHALL 只有 `contactId`、`mode` 與 `affected`，SHALL NOT 包含被刪除的個人資料。成功時系統 SHALL 通知發起的成員。

處理失敗時，請求 SHALL 改為 `failed` 並記錄 `error`。

#### Scenario: 完成稽核不含個人資料
- **WHEN** worker 完成一位聯絡人的刪除
- **THEN** 請求是 `completed`，稽核的 `payload` 只有 `contactId`、`mode` 與 `affected`，不含聯絡人的名稱、電話與 email

#### Scenario: 聯絡人已不存在時記錄失敗
- **WHEN** worker 開始處理時，請求指定的聯絡人已經不存在
- **THEN** 請求改為 `failed`，`error` 記錄原因

### Requirement: worker 不重新處理已結束的刪除請求

worker 開始處理刪除工作時，MUST 以條件更新把請求從 `pending` 或 `processing` 改成 `processing`。請求是 `completed` 或 `failed` 時，worker MUST 直接結束，MUST NOT 刪除資料、改變請求狀態、寫稽核或通知。請求是 `processing` 時，代表上一次執行中途結束，worker MUST 重新處理。同一個請求的刪除 MUST 最多 commit 一次。

#### Scenario: 已完成的請求再執行一次

- **WHEN** 硬刪除請求已經是 `completed`，同一個刪除工作再執行一次
- **THEN** 請求 MUST 仍是 `completed`，`error` MUST 是空值，系統 MUST NOT 寫新的稽核或通知

#### Scenario: 上一次執行中途結束

- **WHEN** 匿名化請求是 `processing`，聯絡人的資料還沒有匿名化，同一個刪除工作再執行一次
- **THEN** 聯絡人 MUST 被匿名化，請求 MUST 是 `completed`

#### Scenario: 兩次同時執行

- **WHEN** 同一個硬刪除工作同時執行兩次
- **THEN** 請求 MUST 是 `completed`，`error` MUST 是空值，發起的成員 MUST 只收到一則完成通知

### Requirement: 發起刪除的寫入一起成立

發起刪除時，系統 MUST 在同一個交易寫入請求、`data.erasure.request` 稽核與刪除工作。其中一項寫不進去時，系統 MUST NOT 留下另外兩項，並回錯誤。刪除工作 MUST 在交易 commit 之後才送進 `data-erasure` 佇列，至少送出一次。commit 之後送不進佇列時，系統 MUST 仍回成功，請求維持 `pending`，刪除工作 MUST 留在 outbox，由補送排程送出。

#### Scenario: 刪除工作寫不進 outbox 時不留下請求與稽核

- **WHEN** 成員發起刪除，刪除工作寫不進 outbox
- **THEN** 系統回錯誤，該聯絡人沒有刪除請求，也沒有 `data.erasure.request` 稽核

#### Scenario: 稽核寫不進去時不送出刪除工作

- **WHEN** 成員發起刪除，`data.erasure.request` 稽核寫不進去
- **THEN** 交易 rollback，刪除工作 MUST NOT 送進佇列

#### Scenario: commit 之後送不進佇列時，請求仍然成立

- **WHEN** 成員發起刪除，交易 commit 之後刪除工作送不進佇列
- **THEN** 系統回 HTTP 200，請求是 `pending`，刪除工作留在 outbox，還沒有標記已送出
