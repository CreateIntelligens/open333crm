## ADDED Requirements

### Requirement: 轉為付費方案時脫離試用
試用租戶是 `trialEndsAt` 不是 null 的租戶。下列兩個操作 MUST 讓試用租戶脫離試用：

- 平台核准該租戶 `type=upgrade` 的方案異動申請（`approveRequest()`）。
- 平台以「轉付費」操作轉換該租戶（`convertToPaid()`）。

脫離試用時，系統 MUST 在同一次更新中把 `trialEndsAt` 設為 null、`purgedAt` 設為 null、`isActive` 設為 true。脫離試用之後，到期排程與軟刪排程 MUST NOT 再處理這個租戶。

其他操作 MUST NOT 改變試用狀態：核准 `token_topup` 申請，以及平台在租戶編輯頁改方案（`updateTenant()`）。

`trialEndsAt` 已經是 null 的租戶，核准 `upgrade` 申請時 MUST NOT 改變 `isActive` 與 `purgedAt`。

#### Scenario: 核准試用租戶的升級申請
- **WHEN** 平台核准一筆 `type=upgrade` 的申請，申請的租戶 `trialEndsAt` 不是 null、`isActive=true`
- **THEN** 該租戶的 `planId` MUST 是申請的目標方案，`trialEndsAt` MUST 是 null，`isActive` MUST 是 true

#### Scenario: 申請審核期間試用已到期並被軟刪
- **WHEN** 平台核准一筆 `type=upgrade` 的申請，申請的租戶 `trialEndsAt` 已過、`isActive=false`、`purgedAt` 不是 null
- **THEN** 該租戶的 `trialEndsAt` MUST 是 null，`purgedAt` MUST 是 null，`isActive` MUST 是 true

#### Scenario: 核准非試用租戶的升級申請
- **WHEN** 平台核准一筆 `type=upgrade` 的申請，申請的租戶 `trialEndsAt` 是 null、`isActive=false`
- **THEN** 該租戶的 `planId` MUST 是申請的目標方案，`isActive` MUST 仍是 false

#### Scenario: 核准試用租戶的加購申請
- **WHEN** 平台核准一筆 `type=token_topup` 的申請，申請的租戶 `trialEndsAt` 不是 null
- **THEN** 該租戶的 `trialEndsAt` MUST 不變

#### Scenario: 轉付費清除軟刪標記
- **WHEN** 平台對一個 `trialEndsAt` 不是 null、`isActive=false`、`purgedAt` 不是 null 的租戶執行「轉付費」
- **THEN** 該租戶的 `trialEndsAt` MUST 是 null，`purgedAt` MUST 是 null，`isActive` MUST 是 true

#### Scenario: 平台在編輯頁改方案不脫離試用
- **WHEN** 平台以租戶編輯頁把一個 `trialEndsAt` 不是 null 的租戶改成其他方案
- **THEN** 該租戶的 `trialEndsAt` MUST 不變

#### Scenario: 脫離試用後不被到期排程停用
- **WHEN** 一個租戶經由核准升級申請脫離試用，之後到期排程在原本的試用到期日之後執行
- **THEN** 該租戶的 `isActive` MUST 仍是 true，且系統 MUST NOT 寄出試用到期信

### Requirement: 試用方案不能當成升級或轉正式的目標
試用方案是試用政策 `trial.planSlug` 指定的方案。下列操作的目標方案是試用方案時，系統 MUST 回應 400，而且 MUST NOT 改變任何租戶或申請：

- 租戶建立 `type=upgrade` 的方案異動申請（`createPlanChangeRequest()`）。
- 平台核准 `type=upgrade` 的方案異動申請（`approveRequest()`）。這涵蓋規則上線前就已建立的申請。
- 平台以「轉正式」轉換租戶（`convertToPaid()`）。

系統 MUST 以當下的 `trial.planSlug` 判斷，MUST NOT 寫死方案的 slug。

#### Scenario: 租戶申請升級到試用方案
- **WHEN** 租戶建立 `type=upgrade` 的申請，`targetPlanSlug` 是 `trial.planSlug` 指定的方案
- **THEN** 系統 MUST 回應 400，而且 MUST NOT 建立申請

#### Scenario: 平台核准目標為試用方案的升級申請
- **WHEN** 平台核准一筆 `type=upgrade`、`status=pending` 的申請，目標方案是 `trial.planSlug` 指定的方案，申請的租戶 `trialEndsAt` 不是 null
- **THEN** 系統 MUST 回應 400；該租戶的 `planId` 與 `trialEndsAt` MUST 不變，申請的 `status` MUST 仍是 `pending`

#### Scenario: 轉正式到試用方案
- **WHEN** 平台對試用租戶執行「轉正式」，目標方案是 `trial.planSlug` 指定的方案，而這個方案的 slug 不是 `trial`
- **THEN** 系統 MUST 回應 400，而且該租戶的 `trialEndsAt` MUST 不變
