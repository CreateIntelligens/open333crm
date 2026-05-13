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

  assert.equal(pageSource.includes('CaseCreateModal'), false);
  assert.equal(pageSource.includes('setShowCreateModal'), false);
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
  assert.equal(serviceSource.includes('SLA policy not found'), true);
}

await testCasesDashboardDeleteWiring();
await testSlaPolicySelectWiring();

console.log('case-ui-source tests passed');
