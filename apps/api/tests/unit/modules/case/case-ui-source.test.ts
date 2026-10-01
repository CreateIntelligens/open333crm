import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function readSource(relativePath: string) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return readFile(resolve(here, relativePath), 'utf8');
}

async function testCasesDashboardDeleteWiring() {
  const pageSource = await readSource('../../../web/src/app/dashboard/cases/page.tsx');
  const listSource = await readSource('../../../web/src/components/case/CaseList.tsx');

  // 2026-09-23 更新：原本這裡斷言「工單頁不該有 CaseCreateModal」。
  // 那是 a5ec552a 修刪除功能時的權宜做法（提交訊息：hiding the standalone
  // create-case entry），副作用是「不來自對話」的工單永遠無法建立——
  // 後端的 POST /cases 在 UI 上沒有任何路徑可觸發，等於死碼。
  //
  // 已於 112cde5 重新加回入口。獨立建單端點本身沒問題
  // （UAT 實測 POST /cases 不帶 conversationId → 201）。
  // 改為驗證「建立入口與刪除功能並存」，確保加回入口沒有把刪除弄壞。
  assert.equal(pageSource.includes('CaseCreateModal'), true);
  assert.equal(pageSource.includes('setCreateOpen'), true);
  assert.equal(pageSource.includes('await api.delete(`/cases/${caseId}`)'), true);
  assert.equal(pageSource.includes('onDelete={handleDeleteCase}'), true);
  assert.equal(pageSource.includes('mutateStats'), true);

  assert.equal(listSource.includes('Trash2'), true);
  assert.equal(listSource.includes('event.stopPropagation()'), true);
  assert.equal(listSource.includes('window.confirm'), true);
  assert.equal(listSource.includes('onDelete(caseRecord.id)'), true);
}

async function testSlaPolicySelectWiring() {
  const modalSource = await readSource('../../../web/src/components/case/CaseCreateModal.tsx');
  const routesSource = await readSource('../modules/case/case.routes.ts');
  const serviceSource = await readSource('../modules/case/case.service.ts');

  assert.equal(modalSource.includes('selectedSlaPolicyId'), true);
  assert.equal(modalSource.includes('value={selectedSlaPolicyId}'), true);
  assert.equal(
    modalSource.includes('onChange={(e) => setSelectedSlaPolicyId(e.target.value)}'),
    true,
  );
  assert.equal(modalSource.includes('setSelectedSlaPolicyId(\'\')'), true);
  assert.equal(modalSource.includes('slaPolicyId: selectedSlaPolicyId || undefined'), true);

  assert.equal(routesSource.includes('slaPolicyId: z.string().uuid().optional()'), true);
  assert.equal(serviceSource.includes('data.slaPolicyId'), true);
  // 訊息已改由 shared/messages/resource.ts 集中產生（notFound('slaPolicy')），
  // 此處驗的是「查無 SLA 政策時有拋錯」這個行為，而非特定字串。
  assert.equal(serviceSource.includes("notFound('slaPolicy')"), true);
}

await testCasesDashboardDeleteWiring();
await testSlaPolicySelectWiring();

console.log('case-ui-source tests passed');
