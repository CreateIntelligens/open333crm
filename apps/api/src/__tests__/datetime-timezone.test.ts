/**
 * datetime-local 的時區換算 + 活動端點的日期驗證。
 *   npx tsx src/__tests__/datetime-timezone.test.ts
 *
 * 背景（2026-09-23，PR #181 部署後實測發現）：
 * 短連結到期時間差 8 小時。送 `2026-12-31T23:59` 進去，DB 存成
 * `2026-12-31T23:59:00.000Z`——被當成 UTC 23:59 而非台北 23:59。
 * UAT 容器跑 UTC，所以使用者選「12/31 23:59 到期」，
 * 實際上要到隔天早上 07:59（台北）才失效。
 *
 * 兩端都沒處理時區，而且剛好互相抵消，所以畫面上看起來「正常」：
 *   送出端：原樣送本地時間字串，不帶時區，UTC 伺服器就當成 UTC
 *   回填端：slice(0,16) 把 ISO 的 Z 直接砍掉，再當本地時間顯示
 * 來回一致但語意是錯的，只有跟真實世界對時才看得出來。
 *
 * 官網活動的 startsAt/endsAt 是同一個寫法，且後端原本**完全沒有驗證**。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const webSrc = (rel: string) =>
  readFileSync(join(here, '../../../../apps/web/src', rel), 'utf8');

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(err as Error).message}`);
    fail += 1;
  }
}

// ─── 時區換算的正確性 ─────────────────────────────────────────────────────

/** 與 apps/web/src/lib/datetime-local.ts 同邏輯，在此獨立驗證語意 */
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInputValue = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIsoForApi = (v: string, clearable = false): string | null | undefined => {
  if (!v) return clearable ? null : undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return clearable ? null : undefined;
  return d.toISOString();
};

t('本地時間 → ISO → 回填，來回一致（這是舊寫法會差 8 小時的地方）', () => {
  const userPicked = '2026-12-31T23:59';
  const sent = toIsoForApi(userPicked) as string;
  assert.strictEqual(
    toLocalInputValue(sent),
    userPicked,
    '來回不一致——使用者看到的時間會跟他選的不同',
  );
});

t('送出的 ISO 帶時區，語意是「使用者當地的那一刻」', () => {
  const sent = toIsoForApi('2026-12-31T23:59') as string;
  // 帶 Z（UTC 表示法），後端 new Date()/coerce.date() 解析後是正確的絕對時間
  assert.ok(sent.endsWith('Z'), `送出的值應帶時區，實際為 ${sent}`);
  assert.strictEqual(
    new Date(sent).getTime(),
    new Date('2026-12-31T23:59').getTime(),
    '送出的絕對時間應與使用者選的本地時間相同',
  );
});

t('舊寫法 slice(0,16) 會在非 UTC 時區產生偏差', () => {
  // 這個測試用固定 UTC 值反推：DB 存 15:59Z，在 UTC+8 應顯示 23:59
  const fromDb = '2026-12-31T15:59:00.000Z';
  const offsetMin = -new Date(fromDb).getTimezoneOffset(); // 台北 = +480
  const legacy = fromDb.slice(0, 16); // 舊寫法：砍掉 Z 直接用
  const correct = toLocalInputValue(fromDb);
  if (offsetMin === 0) {
    // 在 UTC 環境跑（例如 CI）兩者本來就相同，不構成反證
    assert.strictEqual(legacy, correct);
  } else {
    assert.notStrictEqual(
      legacy,
      correct,
      '在非 UTC 時區，舊寫法應與正確值不同（否則這個 bug 的前提不成立）',
    );
  }
});

t('空值與亂填不會產生 Invalid Date 字串', () => {
  assert.strictEqual(toLocalInputValue(null), '');
  assert.strictEqual(toLocalInputValue(undefined), '');
  assert.strictEqual(toLocalInputValue('not-a-date'), '');
  // 清空：編輯時送 null（清除），建立時送 undefined（不帶這欄）
  assert.strictEqual(toIsoForApi('', true), null);
  assert.strictEqual(toIsoForApi('', false), undefined);
});

// ─── 前端兩個對話框都要用共用模組 ────────────────────────────────────────

t('短連結與活動對話框都改用共用的時區換算', () => {
  for (const rel of [
    'components/shortlink/LinkFormDialog.tsx',
    'components/portal/ActivityFormDialog.tsx',
  ]) {
    const code = webSrc(rel);
    assert.ok(
      code.includes("from '@/lib/datetime-local'"),
      `${rel} 未使用共用的 datetime-local 模組`,
    );
    assert.ok(
      !/\(editData\.\w+ as string\)\.slice\(0, 16\)/.test(code),
      `${rel} 仍有 slice(0, 16) 的舊寫法——時區會差 8 小時`,
    );
  }
});

t('活動儲存失敗會顯示訊息（原本只 console.error）', () => {
  const code = webSrc('components/portal/ActivityFormDialog.tsx');
  assert.ok(code.includes('getApiErrorMessage'), '未解析後端錯誤訊息');
  assert.ok(/role="alert"/.test(code), '錯誤訊息未標記 role="alert"');
});

// ─── 後端：活動端點原本完全沒驗證 ────────────────────────────────────────

t('活動建立／更新端點有 schema 驗證', () => {
  const code = apiSrc('modules/portal/portal.routes.ts');
  // createActivityBody = createActivitySchema + superRefine（先後順序檢查）
  assert.ok(
    code.includes('createActivityBody.parse(request.body)'),
    '建立端點仍直接 as body——亂填日期會變 Invalid Date 送進 Prisma → 500',
  );
  assert.ok(
    code.includes('updateActivitySchema.parse(request.body)'),
    '更新端點仍直接 as body',
  );
});

t('活動日期依慣例使用 z.coerce.date()', () => {
  const code = apiSrc('modules/portal/portal.routes.ts');
  for (const field of ['startsAt', 'endsAt']) {
    assert.ok(
      new RegExp(`${field}: z\\.coerce\\.date\\(`).test(code),
      `${field} 未使用 z.coerce.date()`,
    );
  }
});

t('活動 service 收 Date 而非 string（不再自己 new Date）', () => {
  const code = apiSrc('modules/portal/portal.service.ts');
  assert.ok(
    !/startsAt: data\.startsAt \? new Date\(/.test(code),
    'service 仍在自己轉型——驗證層已給 Date，重複轉換只是雜訊',
  );
});

// ─── schema 行為實測 ──────────────────────────────────────────────────────

t('活動 schema：合法日期收、亂填擋、null 可清除', () => {
  const schema = z.object({
    startsAt: z.coerce.date({ invalid_type_error: '開始時間格式不正確' }).nullish(),
  });
  assert.ok(schema.safeParse({ startsAt: '2026-12-31T15:59:00.000Z' }).success, 'ISO 應通過');
  assert.ok(schema.safeParse({ startsAt: '2026-12-31T23:59' }).success, 'datetime-local 應通過');
  assert.ok(schema.safeParse({ startsAt: null }).success, 'null 應通過（清除）');
  assert.ok(schema.safeParse({ startsAt: undefined }).success, 'undefined 應通過（不動）');
  assert.ok(!schema.safeParse({ startsAt: 'not-a-date' }).success, '亂填應被擋下');
});

t('活動類型限定 enum（原本直接 as 成 union）', () => {
  const code = apiSrc('modules/portal/portal.routes.ts');
  assert.ok(
    /type: z\.enum\(\['POLL', 'FORM', 'QUIZ'\]/.test(code),
    'type 未用 enum 擋下非法值',
  );
});

t('結束早於開始應被擋下（原本 P2 已知 bug）', () => {
  // 無效區間：活動永遠不會開放，但畫面上看起來像設定成功
  const code = apiSrc('modules/portal/portal.routes.ts');
  assert.ok(
    /superRefine\(endsAfterStarts\)/.test(code),
    '未檢查結束時間是否晚於開始時間',
  );
  // 實測語意
  const base = z.object({
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
  });
  const schema = base.superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: '結束時間必須晚於開始時間' });
    }
  });
  assert.ok(
    !schema.safeParse({ startsAt: '2026-12-31T00:00:00.000Z', endsAt: '2020-01-01T00:00:00.000Z' }).success,
    '結束早於開始應被擋下',
  );
  assert.ok(
    schema.safeParse({ startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' }).success,
    '正常區間應通過',
  );
  // 只設其中一個是合法的（不限開始 / 不限結束）
  assert.ok(schema.safeParse({ startsAt: '2026-01-01T00:00:00.000Z' }).success, '只設開始應通過');
  assert.ok(schema.safeParse({ endsAt: '2026-01-01T00:00:00.000Z' }).success, '只設結束應通過');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
