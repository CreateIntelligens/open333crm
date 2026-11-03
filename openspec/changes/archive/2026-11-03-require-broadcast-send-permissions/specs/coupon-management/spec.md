## ADDED Requirements

### Requirement: 附券廣播需要發券權限

從廣播頁建立帶 `couponId` 的廣播時，系統 SHALL 另外要求 `coupon.issue`；「立即發送」附券廣播時，系統 SHALL 同時要求 `marketing.broadcast` 與 `coupon.issue`。缺少 `coupon.issue` 時回 403，`error.details.requiredPermission` 為 `coupon.issue`，不建立廣播、不發出任何券。建立廣播表單在沒有 `coupon.issue` 時 SHALL 停用附券欄位並說明原因。

#### Scenario: 沒有發券權限建立附券廣播

- **WHEN** 有 `marketing.manage`、沒有 `coupon.issue` 的成員建立帶 `couponId` 的廣播
- **THEN** 系統回 403，`error.details.requiredPermission` 為 `coupon.issue`，沒有建立廣播

#### Scenario: 有發券權限建立附券廣播

- **WHEN** 有 `marketing.manage` 與 `coupon.issue` 的成員建立帶進行中行銷券的廣播
- **THEN** 廣播建立成功

#### Scenario: 沒有發券權限立即發送附券廣播

- **WHEN** 有 `marketing.broadcast`、沒有 `coupon.issue` 的成員對附券廣播按「立即發送」
- **THEN** 系統回 403，`error.details.requiredPermission` 為 `coupon.issue`，廣播狀態不變，沒有發出任何券

#### Scenario: 表單停用附券欄位

- **WHEN** 沒有 `coupon.issue` 的成員開啟建立廣播表單
- **THEN** 附券欄位停用，並說明附上優惠券需要「發放優惠券」權限

### Requirement: 附券廣播的受眾預覽需要檢視優惠券權限

`POST /marketing/broadcasts/audience-preview` 帶 `couponId` 時，系統 SHALL 要求 `coupon.view`；缺少時回 403，`error.details.requiredPermission` 為 `coupon.view`，不回傳券的剩餘名額。不帶 `couponId` 的預覽不需要優惠券權限。

#### Scenario: 沒有檢視優惠券權限預覽附券廣播

- **WHEN** 沒有 `coupon.view` 的成員以 `couponId` 預覽廣播受眾
- **THEN** 系統回 403，`error.details.requiredPermission` 為 `coupon.view`，回應不含剩餘名額

#### Scenario: 不附券的預覽

- **WHEN** 沒有任何優惠券權限的成員不帶 `couponId` 預覽廣播受眾
- **THEN** 系統回傳符合條件與可送達人數
