import { test, expect, Page, APIRequestContext } from '@playwright/test';
import {
  E2E_PREFIX,
  newApiContext,
  seedWebchatConversation,
  gotoAndCheck,
  SeededConversation,
} from './helpers';

/**
 * 聯絡人功能層測試（@contacts）
 *
 * 資料紀律：
 * - 「列表頁」以 excludeChannelType=WEBCHAT 過濾，自種的 webchat 訪客不會出現在列表
 *   → 列表相關測試（1、2）只用既有真實資料做「唯讀」驗證。
 * - 「詳情頁」可直接以 URL 開自種訪客 → 詳情/時間軸/標籤/合併測試（3-8）
 *   全部只操作 beforeAll 自種的兩個 [E2E] webchat 訪客。
 * - 破壞性操作（合併）只做在兩個自種訪客之間，絕不合併真實資料；
 *   合併 Modal 的搜尋 GET /contacts?q= 不排除 WEBCHAT，所以搜得到自種訪客。
 * - 標籤測試用 API 先建 [E2E] 專用 CONTACT 標籤，afterAll 刪除。
 *
 * 已知行為（讀 contact.service.ts 確認）：
 * - 合併後次要聯絡人被 isArchived=true + mergedIntoId 封存，列表查詢過濾
 *   isArchived:false，但 getContact（詳情 API）「不」過濾 → 直開封存聯絡人
 *   詳情頁仍會正常載入（非 404），僅渠道身份已被搬走。測試 8 以此實際行為斷言。
 */

test.describe.configure({ mode: 'serial' });

test.describe('@contacts 聯絡人功能', () => {
  let api: APIRequestContext;
  /** 合併測試的主要聯絡人（保留方） */
  let visitorA: SeededConversation;
  /** 合併測試的次要聯絡人（會被永久封存——這正是我們要的隔離） */
  let visitorB: SeededConversation;
  /** [E2E] 專用 CONTACT 標籤（beforeAll 建、afterAll 刪） */
  let e2eTagId = '';
  let e2eTagName = '';

  test.beforeAll(async () => {
    // 種兩條 webchat 對話 + 建標籤：chatbox sessions 有 10 次/分 rate limit，
    // 一次 beforeAll 種完（本 spec 只需 2 次 sessions 呼叫），落庫輪詢最多各 20 秒
    test.setTimeout(150_000);
    api = await newApiContext();
    visitorA = await seedWebchatConversation(api, '聯絡人主要方');
    visitorB = await seedWebchatConversation(api, '聯絡人次要方');
    expect(visitorA.contactId, '種出的主要訪客沒有 contactId').toBeTruthy();
    expect(visitorB.contactId, '種出的次要訪客沒有 contactId').toBeTruthy();
    expect(visitorA.contactId, '兩次種資料竟拿到同一個聯絡人，無法做合併測試').not.toBe(
      visitorB.contactId,
    );

    // 建 [E2E] 專用 CONTACT 標籤（TagManager 只列 scope=CONTACT 的標籤）
    e2eTagName = `${E2E_PREFIX} 標籤 ${Date.now().toString(36)}`;
    const tagRes = await api.post('tags', {
      data: { name: e2eTagName, color: '#6366f1', type: 'MANUAL', scope: 'CONTACT' },
    });
    expect(tagRes.status(), `[E2E] 標籤建立失敗：${await tagRes.text()}`).toBe(201);
    e2eTagId = (await tagRes.json())?.data?.id;
    expect(e2eTagId, 'tags API 回應中沒有標籤 id').toBeTruthy();
  });

  test.afterAll(async () => {
    // 清掉 [E2E] 標籤；自種訪客不刪（次要方已封存、主要方留作可追溯的測試痕跡）
    if (api) {
      if (e2eTagId) {
        await api.delete(`tags/${e2eTagId}`).catch(() => {});
      }
      await api.dispose();
    }
  });

  /** 開自種訪客的詳情頁並等主要內容渲染完（Topbar + 聯絡人資訊卡） */
  async function gotoContactDetail(page: Page, contactId: string) {
    await gotoAndCheck(page, `/dashboard/contacts/${contactId}`);
    await expect(page.getByText('聯繫人詳情').first()).toBeVisible({ timeout: 15_000 });
  }

  // ── 1. 列表頁載入（唯讀，用既有真實資料） ─────────────────────────────
  test('@contacts 列表頁載入：表格有資料列、分頁資訊存在', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/contacts');
    await expect(page.getByText('聯繫人').first()).toBeVisible();

    // 等 loading spinner 結束：出現資料列或空狀態其中之一
    const rows = page.locator('tbody tr');
    await expect(
      rows.first().or(page.getByText('找不到聯繫人')),
      '列表既沒有資料列也沒有空狀態',
    ).toBeVisible({ timeout: 15_000 });

    if (await page.getByText('找不到聯繫人').isVisible().catch(() => false)) {
      test.skip(true, 'UAT 聯絡人列表為空（excludeChannelType=WEBCHAT 後無資料），無法做唯讀驗證');
    }

    expect(await rows.count(), '表格應至少有一列聯絡人').toBeGreaterThan(0);

    // 分頁資訊列（total > 0 必渲染）：「第 X-Y / 共 N 筆」
    const counter = page.getByText(/第 \d+-\d+ \/ 共 \d+ 筆/);
    await expect(counter, '分頁資訊列（第 X-Y / 共 N 筆）應存在').toBeVisible();

    // Pagination 元件在 totalPages <= 1 時刻意回傳 null——只有多頁時才斷言按鈕
    const total = Number((await counter.innerText()).match(/共 (\d+) 筆/)?.[1] ?? '0');
    if (total > 20) {
      await expect(page.getByRole('button', { name: '上一頁' })).toBeVisible();
      await expect(page.getByRole('button', { name: '下一頁' })).toBeVisible();
    } else {
      test
        .info()
        .annotations.push({ type: 'note', description: `共 ${total} 筆僅一頁，分頁按鈕依設計不渲染` });
    }
  });

  // ── 2. 列表搜尋（唯讀，用既有真實資料） ───────────────────────────────
  test('@contacts 列表搜尋：以第一列聯絡人名前兩字搜尋，結果包含該名', async ({ page }) => {
    await gotoAndCheck(page, '/dashboard/contacts');
    const rows = page.locator('tbody tr');
    await expect(rows.first().or(page.getByText('找不到聯繫人'))).toBeVisible({ timeout: 15_000 });
    if (await page.getByText('找不到聯繫人').isVisible().catch(() => false)) {
      test.skip(true, 'UAT 聯絡人列表為空，無法做搜尋驗證');
    }

    // 第一欄是「聯繫人」名（Avatar + span）
    const firstName = (await rows.first().locator('td').first().innerText()).trim();
    expect(firstName, '第一列取不到聯絡人名').toBeTruthy();
    const keyword = firstName.slice(0, 2);

    await page.getByPlaceholder('搜尋聯繫人...').fill(keyword);
    // SearchInput debounce 300ms + API 往返，等含關鍵字的結果列出現
    await expect(
      page.locator('tbody tr', { hasText: keyword }).first(),
      `搜尋「${keyword}」後結果應包含「${firstName}」`,
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── 3. 詳情頁（自種訪客） ─────────────────────────────────────────────
  test('@contacts 詳情頁：直開自種訪客，顯示名稱與 WebChat 渠道身份', async ({ page }) => {
    await gotoContactDetail(page, visitorA.contactId);

    // 聯絡人資訊卡的名稱（Chatbox Visitor xxxxxx）
    await expect(
      page.getByRole('heading', { name: visitorA.contactName }),
      `詳情頁應顯示聯絡人名「${visitorA.contactName}」`,
    ).toBeVisible();

    // 渠道身份卡應有 WebChat 徽章（ChannelBadge 的 WEBCHAT label 是「WebChat」）
    await expect(page.getByText('渠道身份')).toBeVisible();
    await expect(page.getByText('WebChat').first(), '渠道身份應包含 WebChat').toBeVisible();
    await expect(page.getByText('沒有渠道身份')).toBeHidden();
  });

  // ── 4. 詳情頁時間軸（自種訪客，剛種的訊息會產生對話事件） ─────────────
  test('@contacts 詳情頁時間軸：有活動事件（新對話）', async ({ page }) => {
    await gotoContactDetail(page, visitorA.contactId);

    await expect(page.getByText('活動時間軸')).toBeVisible();
    await expect(page.getByText('尚無活動記錄')).toBeHidden();
    // 種資料時建立的 webchat 對話 → timeline 應有「新對話 · WebChat」事件
    await expect(
      page.getByText(/新對話 · WebChat/).first(),
      '時間軸應包含剛種的 WebChat 對話事件',
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── 5. 標籤：新增 → chip 出現 → 移除 → 消失（自種訪客 + [E2E] 標籤） ──
  test('@contacts 標籤：新增 [E2E] 標籤後 chip 出現，移除後消失', async ({ page }) => {
    await gotoContactDetail(page, visitorA.contactId);
    await expect(page.getByText('標籤', { exact: true }).first()).toBeVisible();

    // 自種訪客沒有既有標籤 → TagManager 顯示「沒有標籤」+ 選擇器
    await expect(page.getByText('沒有標籤')).toBeVisible();

    // TagManager 的 Select 是原生 <select>（placeholder「選擇標籤...」），
    // 詳情頁上只有這一個 select；用建好的 [E2E] 標籤 id 選取
    const select = page.locator('select');
    await expect(select, 'TagManager 的標籤選擇器應存在（需有可加的 CONTACT 標籤）').toBeVisible({
      timeout: 15_000,
    });
    await select.selectOption(e2eTagId);
    await select.locator('xpath=following-sibling::button').click();

    // 新增成功 → chip（帶「移除標籤」按鈕）出現、「沒有標籤」消失
    const removeBtn = page.getByTitle('移除標籤');
    await expect(
      page.getByText(e2eTagName).first(),
      `標籤 chip「${e2eTagName}」應出現`,
    ).toBeVisible({ timeout: 15_000 });
    await expect(removeBtn.first()).toBeVisible();
    await expect(page.getByText('沒有標籤')).toBeHidden();

    // 移除 → chip 消失、回到「沒有標籤」
    await removeBtn.first().click();
    await expect(page.getByText('沒有標籤')).toBeVisible({ timeout: 15_000 });
    await expect(removeBtn).toHaveCount(0);
  });

  /** 走合併精靈 Step 1（搜尋+選取次要方）→ Step 2（預覽），停在預覽畫面 */
  async function openMergeWizardToPreview(page: Page) {
    await page.getByRole('button', { name: '合併聯繫人' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('合併聯繫人').first()).toBeVisible();
    await expect(dialog.getByText('主要聯繫人（保留）')).toBeVisible();

    // 用次要方名稱的尾碼搜尋（Chatbox Visitor 的最後 6 碼較唯一）；
    // 合併 Modal 的 /contacts?q= 不排除 WEBCHAT，搜得到自種訪客
    const suffix = visitorB.contactName.split(' ').pop() ?? visitorB.contactName;
    await dialog.getByPlaceholder('搜尋聯繫人...').fill(suffix);
    await dialog
      .locator('button', { hasText: visitorB.contactName })
      .first()
      .click();

    // 選取後右卡顯示次要方 + 可「變更」
    await expect(dialog.getByText(visitorB.contactName).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: '變更' })).toBeVisible();

    // 進 Step 2：預覽 diff 表
    await dialog.getByRole('button', { name: '下一步' }).click();
    await expect(dialog.getByText('渠道身份')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('歷史對話')).toBeVisible();
    await expect(dialog.getByText('歷史案件')).toBeVisible();
    await expect(dialog.getByText('主要（保留）')).toBeVisible();
    await expect(dialog.getByText('來源（合併入）')).toBeVisible();
    return dialog;
  }

  // ── 6. 合併精靈 Step 1-2（只預覽，不執行） ────────────────────────────
  test('@contacts 合併精靈：搜尋選取次要訪客後可看到預覽 diff', async ({ page }) => {
    await gotoContactDetail(page, visitorA.contactId);
    const dialog = await openMergeWizardToPreview(page);

    // 次要方種了一則訊息 → 預覽應顯示合併入的對話數
    await expect(dialog.getByText(/件（合併入）= 共 \d+ 件/).first()).toBeVisible();

    // 本測試只驗到預覽，不執行合併——取消收場
    await dialog.getByRole('button', { name: '上一步' }).click();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toBeHidden();
  });

  // ── 7. 合併執行（破壞性：只在兩個自種訪客之間） ───────────────────────
  test('@contacts 合併執行：確認後完成合併，主聯絡人詳情頁仍可開', async ({ page }) => {
    await gotoContactDetail(page, visitorA.contactId);
    const dialog = await openMergeWizardToPreview(page);

    // Step 3：警示 + 勾選確認 + 執行
    await dialog.getByRole('button', { name: '下一步' }).click();
    await expect(dialog.getByText(/將永久封存，此操作無法復原/)).toBeVisible();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: '確認合併' }).click();

    // 成功後 Modal 關閉（合併 API 完成才會 onOpenChange(false)）
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // 主聯絡人詳情頁仍可開，且次要方的 WebChat 渠道身份已併入（共 2 個徽章）。
    // 用 exact match 只數渠道身份的 ChannelBadge——時間軸的「新對話 · WebChat · …」
    // 是整段文字，exact 不會誤中
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: visitorA.contactName })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('WebChat', { exact: true })).toHaveCount(2, { timeout: 15_000 });

    // API 佐證：次要方已被封存並指向主要方
    const res = await api.get(`contacts/${visitorB.contactId}`);
    expect(res.status(), '封存後的次要聯絡人詳情 API 仍應可查（實際行為）').toBe(200);
    const merged = (await res.json())?.data;
    expect(merged?.isArchived, '次要聯絡人應為 isArchived=true').toBe(true);
    expect(merged?.mergedIntoId, '次要聯絡人 mergedIntoId 應指向主要方').toBe(visitorA.contactId);
  });

  // ── 8. 合併後驗證：直開次要方 contactId 的實際行為 ────────────────────
  test('@contacts 合併後驗證：被封存的次要聯絡人詳情頁仍可載入但渠道身份已清空', async ({
    page,
  }) => {
    // 實際行為（讀 contact.service.ts getContact 確認）：詳情 API 不過濾
    // isArchived → 不會 404 也不會導回列表，頁面照常載入封存的聯絡人；
    // 只有列表查詢會過濾掉。此處依實際行為斷言。
    await gotoContactDetail(page, visitorB.contactId);

    // 不是「找不到聯繫人」錯誤畫面，名稱照常顯示
    await expect(page.getByText('找不到聯繫人')).toBeHidden();
    await expect(page.getByRole('heading', { name: visitorB.contactName })).toBeVisible();

    // 渠道身份已全部搬到主要方 → 顯示「沒有渠道身份」
    await expect(page.getByText('沒有渠道身份')).toBeVisible();
    // 對話也已搬走 → 時間軸不再有屬於它的新對話事件（顯示尚無活動記錄）
    await expect(page.getByText('尚無活動記錄')).toBeVisible();
  });
});
