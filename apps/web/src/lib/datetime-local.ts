/**
 * `<input type="datetime-local">` 與後端 ISO 字串之間的轉換。
 *
 * 背景（2026-09-23）：短連結的到期時間實測差 8 小時。使用者在台灣選
 * 「12/31 23:59 到期」，DB 存成 `2026-12-31T23:59:00.000Z`——被當成 UTC 23:59，
 * 實際上要到隔天早上 07:59（台北）才失效。
 *
 * 成因是兩端都沒處理時區，而且剛好互相抵消，所以畫面上看起來「正常」：
 *
 *   送出端：欄位的值是本地時間字串（`2026-12-31T23:59`），不帶時區資訊，
 *           原樣送出後，跑 UTC 的伺服器就當成 UTC。
 *   回填端：把 ISO 的 `Z` 用 `slice(0, 16)` 直接砍掉，再當本地時間顯示。
 *
 * 來回一致但語意是錯的，只有跟真實世界對時才看得出來。
 *
 * ⚠️ 時區只有瀏覽器知道（伺服器容器跑 UTC），所以換算一定要在前端做，
 * 不能指望後端猜使用者在哪個時區。
 *
 * 後端對應的慣例是一律用 `z.coerce.date()` 收，它能正確解析這裡送出的
 * 帶時區 ISO 字串。
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 後端 ISO 字串 → `<input type="datetime-local">` 的 value（使用者本地時間）。
 *
 * 用本地時間各欄位組字串，而不是 `toISOString().slice(0, 16)`
 * ——後者會轉回 UTC，等於沒修。
 *
 * @returns 空值或無法解析時回空字串，可直接餵給受控元件。
 */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `<input type="datetime-local">` 的 value → 帶時區的 ISO 字串，供後端存檔。
 *
 * @param clearable 欄位清空時要送什麼。編輯既有資料時傳 `true` 會送 `null`
 *                  （後端的「清除這個欄位」語意）；建立新資料時省略，
 *                  送 `undefined` 讓後端當作沒帶這欄。
 *
 *                  ⚠️ 這個區分是必要的：後端普遍用 `=== null` 判斷清除，
 *                  送 `undefined` 會被當成「這欄不動」，欄位就永遠清不掉。
 */
export function toIsoForApi(
  localValue: string,
  clearable = false,
): string | null | undefined {
  if (!localValue) return clearable ? null : undefined;
  const d = new Date(localValue);
  // 擋不住的值就不要硬送，交給後端 schema 回報錯誤
  if (Number.isNaN(d.getTime())) return clearable ? null : undefined;
  return d.toISOString();
}
