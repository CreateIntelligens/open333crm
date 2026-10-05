import { test, expect, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_PREFIX, newApiContext, gotoAndCheck, seedWebchatConversation } from './helpers';

/**
 * PR #221（OpenSpec fix-automation-editor-bugs）部署後驗證 @automation
 *
 * 1. 規則列表顯示全部規則（原本只取第一頁 20 條）
 * 2. workers 會整條略過的規則在列表標示「規則不會執行」
 * 3. 編輯頁載入時移除契約外的動作，並說明整條規則目前不會執行
 * 4. 契約驗證錯誤訊息為中文
 * 5. 自動化規則實際自動建立工單（add-automation-create-case tasks 4.3）
 *
 * 案例 02、03 讀取 Demo Tenant 既有的「一般問題自動開案」：它含契約沒有的 auto_assign。
 * 只讀不存——存檔會讓規則開始對每位沒有未結案工單的聯絡人開單，要由使用者決定。
 * 若使用者已存過（auto_assign 已移除），這兩個案例跳過。
 *
 * 案例 05 建立 [E2E] 規則：條件限定訊息含本次執行的唯一代碼、優先度 999 且命中即停止，
 * 不會被其他規則搶先，也不會被其他訊息觸發。afterAll 刪除規則。
 */

const RUN = randomUUID().slice(0, 8);
const LEGACY_RULE_ID = 'b6adeecc-5c87-40e2-9cd9-dec655385687';
const LEGACY_RULE_NAME = '一般問題自動開案';
const TOKEN = `E2EAUTOCASE${RUN}`;
const CASE_TITLE = `${E2E_PREFIX} 自動建單 ${RUN}`;

let api: APIRequestContext;
const createdRuleIds: string[] = [];

test.beforeAll(async () => {
  api = await newApiContext();
});

test.afterAll(async () => {
  for (const id of createdRuleIds) {
    try {
      await api.delete(`automation/rules/${id}`);
    } catch {
      // 清理失敗不影響測試結果
    }
  }
  await api.dispose();
});

async function legacyRuleHasAutoAssign(): Promise<boolean> {
  const res = await api.get(`automation/rules/${LEGACY_RULE_ID}`);
  if (!res.ok()) return false;
  const actions = ((await res.json())?.data?.actions ?? []) as Array<{ type?: string }>;
  return actions.some((a) => a.type === 'auto_assign');
}

test.describe('PR #221 自動化規則頁修正 @automation', () => {
  test('01 規則列表顯示全部規則（超過 20 條）', async ({ page }) => {
    const meta = (await (await api.get('automation/rules', { params: { limit: '1' } })).json())?.meta;
    const total = Number(meta?.total);
    expect(total, 'Demo Tenant 規則數應超過原本的單頁 20 條，才驗得到分頁').toBeGreaterThan(20);

    await gotoAndCheck(page, '/dashboard/automation');
    await expect(page.locator('tbody tr')).toHaveCount(total, { timeout: 30_000 });
  });

  test('02 workers 會整條略過的規則：列表標示「規則不會執行」', async ({ page }) => {
    test.skip(!(await legacyRuleHasAutoAssign()), '「一般問題自動開案」已不含 auto_assign（已重新儲存）');

    await gotoAndCheck(page, '/dashboard/automation');
    const row = page.locator('tbody tr', { hasText: LEGACY_RULE_NAME });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const badge = row.getByText('規則不會執行', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', /第 2 個動作「auto_assign」不是系統提供的動作，請刪除/);
  });

  test('03 編輯頁移除 auto_assign，說明整條規則目前不會執行（不存檔）', async ({ page }) => {
    test.skip(!(await legacyRuleHasAutoAssign()), '「一般問題自動開案」已不含 auto_assign（已重新儲存）');

    await gotoAndCheck(page, `/dashboard/automation/${LEGACY_RULE_ID}`);
    const notice = page.getByText(/此規則含有不適用於這個觸發事件的動作/);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('「未知動作（auto_assign）」');
    await expect(notice).toContainText('目前整條規則都不會執行');
    // 「尚未支援」那一段不應出現：這條規則沒有尚未支援的動作
    await expect(page.getByText(/系統尚未支援自動執行的動作/)).toHaveCount(0);
  });

  test('04 契約驗證錯誤訊息為中文', async () => {
    const base = {
      name: `${E2E_PREFIX} 錯誤訊息 ${RUN}`,
      trigger: { type: 'message.received' },
      priority: 0,
      isActive: false,
      stopOnMatch: false,
      conditions: { all: [{ fact: 'message.text', operator: 'contains', value: TOKEN }] },
    };

    const missingParam = await api.post('automation/rules', {
      data: { ...base, actions: [{ type: 'add_tag', params: {} }] },
    });
    expect(missingParam.status()).toBe(400);
    expect(JSON.stringify(await missingParam.json())).toContain('第 1 個動作「新增標籤」必須填寫「標籤名稱」');

    const unknownAction = await api.post('automation/rules', {
      data: {
        ...base,
        actions: [
          { type: 'add_tag', params: { tagName: 'E2E' } },
          { type: 'auto_assign', params: {} },
        ],
      },
    });
    expect(unknownAction.status()).toBe(400);
    const body = JSON.stringify(await unknownAction.json());
    expect(body).toContain('第 2 個動作「auto_assign」不是系統提供的動作，請刪除');
    expect(body).not.toContain('is not allowed');
  });

  test('05 規則命中時自動建立工單，並關聯觸發的對話', async () => {
    test.setTimeout(120_000);
    const created = await api.post('automation/rules', {
      data: {
        name: `${E2E_PREFIX} 自動建單 ${RUN}`,
        description: 'E2E：PR #221 部署驗證，測後刪除',
        trigger: { type: 'message.received' },
        priority: 999,
        isActive: true,
        stopOnMatch: true,
        conditions: { all: [{ fact: 'message.text', operator: 'contains', value: TOKEN }] },
        actions: [{ type: 'create_case', params: { title: CASE_TITLE, priority: 'MEDIUM' } }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const ruleId: string = (await created.json())?.data?.id;
    createdRuleIds.push(ruleId);

    const seeded = await seedWebchatConversation(api, `自動建單 ${TOKEN}`);

    // workers 非同步執行規則，輪詢最多 60 秒
    let hit: Record<string, unknown> | undefined;
    for (let i = 0; i < 30 && !hit; i++) {
      const res = await api.get('cases', { params: { limit: '50' } });
      if (res.ok()) {
        const data = (await res.json())?.data ?? {};
        const items: Array<Record<string, unknown>> = data.items ?? data.cases ?? (Array.isArray(data) ? data : []);
        hit = items.find((c) => c.title === CASE_TITLE);
      }
      if (!hit) await new Promise((r) => setTimeout(r, 2000));
    }
    expect(hit, `60 秒內沒有自動建立標題為「${CASE_TITLE}」的工單`).toBeTruthy();

    const detail = (await (await api.get(`cases/${hit!.id}`)).json())?.data ?? {};
    const detailText = JSON.stringify(detail);
    expect(detailText, '工單應關聯觸發的對話').toContain(seeded.conversationId);
    expect(detail.priority).toBe('MEDIUM');
  });
});
