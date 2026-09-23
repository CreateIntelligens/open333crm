import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  E2E_PREFIX,
  newApiContext,
  gotoAndCheck,
  acceptNextDialog,
} from './helpers';

/**
 * 設定頁（/dashboard/settings）功能層測試：「人員與權限」「角色與權限」「標籤管理」三個 tab。
 *
 * ⚠️ 絕對紅線（session 是租戶 ADMIN，最高權限帳號）：
 * - 全程不修改/停用/刪除任何非自建的既有人員（尤其不動 ADMIN 自己的帳號）。
 * - 全程不對內建角色 ADMIN/SUPERVISOR/AGENT 的權限矩陣做勾選變更、不改名、不刪除。
 *   角色矩陣測試改用「建立一個全新的 [E2E] 測試角色」做勾選/儲存/改名/刪除的完整流程。
 * - 新增人員一律用 `[E2E]` 前綴姓名、角色選 AGENT（ADMIN 指派 AGENT/SUPERVISOR 皆不算越權，
 *   已讀碼確認 apps/api/src/modules/agent/agent.service.ts assertNoRoleEscalation：
 *   指派者若為租戶 admin system role 直接放行，不受限）。
 * - 標籤一律 `[E2E]` 前綴，afterAll 清理。
 *
 * 讀碼盤點（與任務描述不同處，以實際程式碼為準）：
 * - AgentManagement 的「篩選」不是 `<select>` 下拉，而是 ALL/ADMIN/SUPERVISOR/AGENT 四顆
 *   篩選按鈕（button group，各自帶目前計數，如「AGENT 12」）。
 * - AgentManagement 沒有分開的「新增人員」/「編輯角色」/「重設密碼」/「停用」四個獨立
 *   dialog；只有 CreateAgentDialog（新增）與 EditAgentDialog（編輯，同一顆「編輯」按鈕
 *   進去後，同時可改角色 + 重設密碼 + 停用帳號三合一）。停用帳號用原生 `confirm()`；
 *   新增/編輯儲存本身不觸發 confirm，也沒有 toast，靠 dialog 關閉 + 列表變化斷言。
 * - 新增人員的角色下拉（`Select`）選項來自 `/roles`（含 system + custom），value 是角色
 *   id 不是 legacy enum 字串；預設會自動選中 slug === 'agent' 的系統角色。
 * - 角色與權限 tab（RolePermissionMatrix）左側是角色清單（非下拉），右側依 group 折疊
 *   勾選 `<input type="checkbox">`。新增/改名角色走同一個 Dialog（`dialogMode`
 *   'create' | 'rename'，標題「新增角色」/「角色改名」），只有名稱欄位——新建角色一律是
 *   空白角色（0 權限），需另外在右側勾選權限、按「儲存變更」才會呼叫
 *   `PUT /roles/:id/permissions`。
 * - 刪除角色不是原生 `confirm()`，是另一個自製 `Dialog`（標題「刪除角色」，內文「確定要
 *   刪除角色「X」嗎？」，「刪除」按鈕），故用 `getByRole('dialog')` 定位斷言，不用
 *   `acceptNextDialog`。
 * - 標籤管理（TagManagement）刪除已讀碼確認是**硬刪**
 *   （apps/api/src/modules/tag/tagging.service.ts deleteTenantTag：依序刪光 ContactTag/
 *   CaseTag/ConversationTag 關聯後 `prisma.tag.delete`），非軟刪。刪除觸發原生
 *   `confirm('確定要刪除此標籤嗎？已套用在聯繫人、對話和案件上的標籤也會一併移除。')`。
 * - 標籤建立時可選「適用範圍」（CONTACT/CONVERSATION/CASE），編輯時範圍唯讀不可改
 *   （TagManagement.tsx `editingTag` 分支只顯示文字，無 Select）。
 * - Dialog 元件是原生 `<dialog>`（見 src/components/ui/dialog.tsx），Playwright
 *   `getByRole('dialog')` 可直接抓到；三個 tab 切換是同頁 client state（button 非
 *   ARIA tab role），非換路由。
 */
test.describe.configure({ mode: 'serial' });

test.describe('@settings-team 設定頁：人員與權限／角色與權限／標籤管理', () => {
  let api: APIRequestContext;

  const runId = randomUUID().slice(0, 6);
  const agentName = `${E2E_PREFIX} 測試人員 ${runId}`;
  const agentEmail = `e2e-test-${runId}@example.com`;
  const roleName = `${E2E_PREFIX} 測試角色 ${runId}`;
  const roleRenamedName = `${E2E_PREFIX} 測試角色改名 ${runId}`;
  const tagName = `${E2E_PREFIX} 測試標籤 ${runId}`;
  const tagRenamedName = `${E2E_PREFIX} 測試標籤改名 ${runId}`;

  /** 建立過程中蒐集的 id，afterAll 依序清理（try/catch 不炸測試） */
  let testAgentId = '';
  let testRoleId = '';
  let testTagId = '';

  test.beforeAll(async () => {
    api = await newApiContext();
  });

  test.afterAll(async () => {
    if (!api) return;
    // 測試人員：只做停用（軟刪），不硬刪——與人員管理刪除語意一致
    if (testAgentId) {
      try {
        await api.delete(`agents/${testAgentId}`);
      } catch {
        // 可能測試流程中已停用，失敗略過
      }
    }
    // 測試角色：刪除（若測試流程已刪除，這裡會 404，略過即可）
    if (testRoleId) {
      try {
        await api.delete(`roles/${testRoleId}`);
      } catch {
        // 已在測試流程刪除或刪除失敗，略過
      }
    }
    // 測試標籤：硬刪（若測試流程已刪除，這裡會 404，略過即可）
    if (testTagId) {
      try {
        await api.delete(`tags/${testTagId}`);
      } catch {
        // 已在測試流程刪除或刪除失敗，略過
      }
    }
    await api.dispose();
  });

  async function gotoSettings(page: Page) {
    await gotoAndCheck(page, '/dashboard/settings');
  }

  async function gotoAgentsTab(page: Page) {
    await gotoSettings(page);
    await page.getByRole('button', { name: '人員與權限' }).click();
    await expect(page.getByRole('button', { name: '新增人員' })).toBeVisible({ timeout: 10_000 });
  }

  async function gotoRolesTab(page: Page) {
    await gotoSettings(page);
    await page.getByRole('button', { name: '角色與權限' }).click();
    await expect(page.getByRole('heading', { name: '角色與權限' })).toBeVisible({ timeout: 10_000 });
  }

  async function gotoTagsTab(page: Page) {
    await gotoSettings(page);
    await page.getByRole('button', { name: '標籤管理' }).click();
    await expect(page.getByRole('button', { name: '新增標籤' })).toBeVisible({ timeout: 10_000 });
  }

  // ── 1. 人員管理 tab 載入：篩選按鈕 + 既有人員列表 ──────────────────────
  test('@settings-team 人員與權限 tab 載入：篩選按鈕（ALL/ADMIN/SUPERVISOR/AGENT）與既有人員列表可見', async ({ page }) => {
    await gotoAgentsTab(page);

    // 篩選是 button group（非 <select>），各自帶目前計數文字，例如「全部 12」
    await expect(page.getByRole('button', { name: /^全部\s*\d+$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^ADMIN\s*\d+$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^SUPERVISOR\s*\d+$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^AGENT\s*\d+$/ })).toBeVisible();

    // 既有人員列表至少有一筆（目前登入的 ADMIN 帳號自己就會出現在列表中）
    await expect(page.locator('div.grid', { hasText: '姓名' }).first()).toBeVisible();

    // 篩選切換：點 ADMIN 只顯示 ADMIN 角色
    await page.getByRole('button', { name: /^ADMIN\s*\d+$/ }).click();
    await page.waitForTimeout(500);
    // 切回全部，避免影響後續測試
    await page.getByRole('button', { name: /^全部\s*\d+$/ }).click();
  });

  // ── 2. 新增人員 ────────────────────────────────────────────────────────
  test('@settings-team 新增人員：[E2E] 姓名 + 唯一 email + 角色 AGENT + 密碼 → 建立成功', async ({ page }) => {
    await gotoAgentsTab(page);
    await page.getByRole('button', { name: '新增人員' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增人員')).toBeVisible();

    await dialog.getByPlaceholder('王小明').fill(agentName);
    await dialog.getByPlaceholder('agent@example.com').fill(agentEmail);
    // 角色下拉預設已選中 agent 系統角色（見元件 useEffect），此處不特別切換，直接確認即為預期
    await dialog.getByPlaceholder('至少 8 個字元').fill('Test12345!');

    const createRes = page.waitForResponse(
      (res) => res.url().includes('/agents') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立' }).click();
    const res = await createRes;
    expect(res.ok(), `建立人員失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    testAgentId = body?.data?.id;
    expect(testAgentId, '建立回應應含人員 id').toBeTruthy();
    expect(body?.data?.role, '未特別切換角色，預設應為 AGENT').toBe('AGENT');

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(agentName, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 3. 編輯剛建的測試人員：AGENT → SUPERVISOR（ADMIN 指派不算越權）───────
  test('@settings-team 編輯人員：角色 AGENT 改為 SUPERVISOR → 儲存成功', async ({ page }) => {
    expect(testAgentId, '前置測試 2 應已建立 testAgentId').toBeTruthy();
    await gotoAgentsTab(page);

    const row = page.locator('div.border-b', { hasText: agentName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: '編輯' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`編輯人員 — ${agentName}`)).toBeVisible();

    // 角色 Select 選項 label 為系統角色的 name（後端 seed 通常為 Supervisor / Agent / Admin）
    const roleSelect = dialog.locator('select').first();
    await roleSelect.selectOption({ label: 'Supervisor' });

    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/agents/${testAgentId}/role`) && res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '儲存' }).click();
    const res = await patchRes;
    expect(res.ok(), `編輯人員角色失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(body?.data?.role, 'ADMIN 指派 SUPERVISOR 不算越權，應成功改為 SUPERVISOR').toBe('SUPERVISOR');

    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  // ── 4. 重設該測試人員密碼 ──────────────────────────────────────────────
  test('@settings-team 重設密碼：對測試人員設定新密碼 → 成功', async ({ page }) => {
    expect(testAgentId, '前置測試 2 應已建立 testAgentId').toBeTruthy();
    await gotoAgentsTab(page);

    const row = page.locator('div.border-b', { hasText: agentName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: '編輯' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`編輯人員 — ${agentName}`)).toBeVisible();

    await dialog.getByPlaceholder('至少 8 個字元').fill('Reset12345!');

    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/agents/${testAgentId}/password`) && res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '儲存' }).click();
    const res = await patchRes;
    expect(res.ok(), `重設密碼失敗：${await res.text()}`).toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  // ── 5. 停用該測試人員（confirm，軟刪）──────────────────────────────────
  test('@settings-team 停用人員：確認後從啟用列表消失（軟刪 isActive=false）', async ({ page }) => {
    expect(testAgentId, '前置測試 2 應已建立 testAgentId').toBeTruthy();
    await gotoAgentsTab(page);

    const row = page.locator('div.border-b', { hasText: agentName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button', { name: '編輯' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`編輯人員 — ${agentName}`)).toBeVisible();

    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/agents/${testAgentId}`) && res.request().method() === 'DELETE',
    );
    await dialog.getByRole('button', { name: '停用帳號' }).click();
    const msg = await dialogPromise;
    expect(msg).toContain('確定要停用');
    const res = await deleteRes;
    expect(res.ok(), `停用人員失敗：${await res.text()}`).toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // GET /agents 只回 isActive: true 的人員（見 agent.routes.ts where: { isActive: true }），
    // 停用後應從（啟用）列表消失
    await expect(page.getByText(agentName, { exact: true })).toBeHidden({ timeout: 10_000 });
  });

  // ── 6. 角色與權限 tab：建立一個 [E2E] 測試角色 ──────────────────────────
  test('@settings-team 建立角色：[E2E] 名稱 → 成功出現在角色清單', async ({ page }) => {
    await gotoRolesTab(page);
    await page.getByRole('button', { name: '＋ 新增角色' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('新增角色')).toBeVisible();

    await dialog.getByPlaceholder('例如：客服組長、行銷專員').fill(roleName);

    const createRes = page.waitForResponse(
      (res) => res.url().endsWith('/roles') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '建立並設定權限' }).click();
    const res = await createRes;
    expect(res.ok(), `建立角色失敗：${await res.text()}`).toBeTruthy();
    const body = await res.json();
    testRoleId = body?.data?.id;
    expect(testRoleId, '建立回應應含角色 id').toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // 建立後自動選中該角色，右欄標題應顯示其名稱，且左欄清單出現
    await expect(page.getByText(roleName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible();
  });

  // ── 7. 對該 [E2E] 角色勾選 1-2 個權限 → 儲存 → reload 驗證持久化 ─────────
  test('@settings-team 角色權限：勾選 1-2 項權限 → 儲存 → reload 後仍保留', async ({ page }) => {
    expect(testRoleId, '前置測試 6 應已建立 testRoleId').toBeTruthy();
    await gotoRolesTab(page);

    // 確認目前選中的就是測試角色（新建角色會自動選中；此處保險起見手動點一次）
    const permMatrixRes = page.waitForResponse(
      (res) => res.url().includes(`/roles/${testRoleId}/permissions`) && res.request().method() === 'GET',
      { timeout: 10_000 },
    ).catch(() => null); // 若因快取沒重新發請求也無妨，靠下面的 checkbox 穩定性斷言把關
    await page.locator('div.cursor-pointer', { hasText: roleName }).first().click();
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible({ timeout: 10_000 });
    await permMatrixRes;

    // 勾選前兩個可見權限 checkbox（一律用 tag.view / contact.view 這類唯讀查看類權限最安全，
    // 但矩陣內容為動態載入，直接取前兩個 checkbox 即可，不特別挑 code）
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 10_000 });
    const count = await checkboxes.count();
    expect(count, '權限矩陣應至少有可勾選項目').toBeGreaterThan(0);
    // 矩陣資料非同步載入完成後 checkbox 數量才會穩定，heading 顯示不代表矩陣已就緒；
    // 用短暫等待讓 React state 穩定，避免勾選動作與資料載入完成的 race
    await page.waitForTimeout(500);

    const toCheck = Math.min(2, count);
    for (let i = 0; i < toCheck; i++) {
      const cb = checkboxes.nth(i);
      if (!(await cb.isChecked())) {
        await cb.check();
      }
    }

    await expect(page.getByText(/未儲存 \d+ 項變更/)).toBeVisible({ timeout: 5_000 });

    const saveRes = page.waitForResponse(
      (res) => res.url().includes(`/roles/${testRoleId}/permissions`) && res.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '儲存變更' }).click();
    const res = await saveRes;
    expect(res.ok(), `儲存角色權限失敗：${await res.text()}`).toBeTruthy();
    await expect(page.getByText('✓ 已儲存')).toBeVisible({ timeout: 5_000 });

    // reload 驗證持久化：重新進頁、重新選中該角色，checkbox 應維持勾選狀態
    await gotoRolesTab(page);
    await page.locator('div.cursor-pointer', { hasText: roleName }).first().click();
    await expect(page.getByRole('heading', { name: roleName })).toBeVisible({ timeout: 10_000 });
    const checkboxesAfterReload = page.locator('input[type="checkbox"]');
    await expect(checkboxesAfterReload.first()).toBeVisible({ timeout: 10_000 });
    let checkedCount = 0;
    const afterCount = await checkboxesAfterReload.count();
    for (let i = 0; i < afterCount; i++) {
      if (await checkboxesAfterReload.nth(i).isChecked()) checkedCount++;
    }
    expect(checkedCount, 'reload 後應仍有已勾選的權限（持久化成功）').toBeGreaterThan(0);
  });

  // ── 8. 改該 [E2E] 角色名稱 ─────────────────────────────────────────────
  test('@settings-team 角色改名：[E2E] 測試角色 → [E2E] 測試角色改名 → 儲存成功', async ({ page }) => {
    expect(testRoleId, '前置測試 6 應已建立 testRoleId').toBeTruthy();
    await gotoRolesTab(page);

    const roleRow = page.locator('div.group', { hasText: roleName }).first();
    await expect(roleRow).toBeVisible({ timeout: 10_000 });
    // hover 才會顯示改名/刪除按鈕（group-hover），用 hover() 觸發
    await roleRow.hover();
    await roleRow.getByTitle('改名').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('角色改名')).toBeVisible();
    const nameInput = dialog.locator('input').first();
    await nameInput.fill(roleRenamedName);

    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/roles/${testRoleId}`) && res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '儲存' }).click();
    const res = await patchRes;
    expect(res.ok(), `角色改名失敗：${await res.text()}`).toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(roleRenamedName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  // ── 9. 刪除該 [E2E] 角色（自製 Dialog confirm，非原生）────────────────
  test('@settings-team 刪除角色：確認後從清單消失', async ({ page }) => {
    expect(testRoleId, '前置測試 6 應已建立 testRoleId').toBeTruthy();
    await gotoRolesTab(page);

    const roleRow = page.locator('div.group', { hasText: roleRenamedName }).first();
    await expect(roleRow).toBeVisible({ timeout: 10_000 });
    await roleRow.hover();
    await roleRow.getByTitle('刪除').click();

    // 刪除是自製 Dialog，非原生 confirm——用 getByRole('dialog') 定位斷言
    const dialog = page.getByRole('dialog');
    // 「刪除角色」子字串同時命中標題與內文的「確定要刪除角色…」，用 heading 精確定位
    await expect(dialog.getByRole('heading', { name: '刪除角色' })).toBeVisible();
    await expect(dialog.getByText(`確定要刪除角色「${roleRenamedName}」嗎？`)).toBeVisible();

    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/roles/${testRoleId}`) && res.request().method() === 'DELETE',
    );
    await dialog.getByRole('button', { name: '刪除' }).click();
    const res = await deleteRes;
    expect(res.ok(), `刪除角色失敗：${await res.text()}`).toBeTruthy();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(roleRenamedName, { exact: true })).toBeHidden({ timeout: 10_000 });
    testRoleId = ''; // 已刪除，afterAll 不必再清理
  });

  // ── 10. 標籤管理 tab：建立 [E2E] 標籤 → 編輯 → 刪除（confirm，硬刪）───
  test('@settings-team 標籤管理：建立 → 編輯 → 刪除（原生 confirm，硬刪）', async ({ page }) => {
    await gotoTagsTab(page);

    // 建立
    await page.getByRole('button', { name: '新增標籤' }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog.getByText('新增標籤')).toBeVisible();
    await createDialog.getByPlaceholder('例：VIP').fill(tagName);
    // 顏色：預設第一個色塊即為 formColor 初始值，這裡明確點第二個色塊驗證可切換
    await createDialog.locator('button[style*="background-color"]').nth(1).click();

    const createRes = page.waitForResponse(
      (res) => res.url().endsWith('/tags') && res.request().method() === 'POST',
    );
    await createDialog.getByRole('button', { name: '儲存' }).click();
    const cRes = await createRes;
    expect(cRes.ok(), `建立標籤失敗：${await cRes.text()}`).toBeTruthy();
    const cBody = await cRes.json();
    testTagId = cBody?.data?.id;
    expect(testTagId, '建立回應應含標籤 id').toBeTruthy();

    await expect(createDialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(tagName, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 編輯：改名
    const tagCard = page.locator('div.rounded-lg.border', { hasText: tagName }).first();
    await tagCard.getByRole('button').first().click(); // Pencil（編輯）按鈕
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByText('編輯標籤')).toBeVisible();
    const nameInput = editDialog.getByPlaceholder('例：VIP');
    await nameInput.fill(tagRenamedName);

    const patchRes = page.waitForResponse(
      (res) => res.url().includes(`/tags/${testTagId}`) && res.request().method() === 'PATCH',
    );
    await editDialog.getByRole('button', { name: '儲存' }).click();
    const pRes = await patchRes;
    expect(pRes.ok(), `編輯標籤失敗：${await pRes.text()}`).toBeTruthy();

    await expect(editDialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(tagRenamedName, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 刪除：原生 confirm，讀碼確認為硬刪
    const renamedCard = page.locator('div.rounded-lg.border', { hasText: tagRenamedName }).first();
    const dialogPromise = acceptNextDialog(page);
    const deleteRes = page.waitForResponse(
      (res) => res.url().includes(`/tags/${testTagId}`) && res.request().method() === 'DELETE',
    );
    await renamedCard.getByRole('button').last().click(); // Trash2（刪除）按鈕
    const msg = await dialogPromise;
    expect(msg).toContain('確定要刪除此標籤嗎');
    const res = await deleteRes;
    expect(res.ok(), `刪除標籤失敗：${await res.text()}`).toBeTruthy();

    await expect(page.getByText(tagRenamedName, { exact: true })).toBeHidden({ timeout: 10_000 });

    // 硬刪驗證：tag.routes.ts 只有 GET /tags（清單）、無單筆 GET /tags/:id，
    // 改用清單確認已刪除的標籤不再出現（tagging.service.ts deleteTenantTag 為硬刪）
    const listRes = await api.get('tags');
    expect(listRes.ok(), `查詢標籤清單失敗：${await listRes.text()}`).toBeTruthy();
    const listBody = await listRes.json();
    const items: Array<Record<string, unknown>> = listBody?.data ?? [];
    expect(items.some((t) => t.id === testTagId), '硬刪後標籤清單不應再含已刪除的標籤').toBeFalsy();
    testTagId = ''; // 已刪除，afterAll 不必再清理
  });
});
