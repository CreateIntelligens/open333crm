import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function readSource(relativePath: string) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return readFile(resolve(here, relativePath), 'utf8');
}

async function testMarkReadContract() {
  const sharedWsSource = await readSource('../../../../packages/shared/src/types/ws.types.ts');
  const serviceSource = await readSource('../modules/conversation/conversation.service.ts');
  const routesSource = await readSource('../modules/conversation/conversation.routes.ts');

  assert.equal(sharedWsSource.includes('export interface ConversationUpdatedPayload'), true);
  assert.equal(sharedWsSource.includes('updatedAt: string'), true);
  assert.equal(sharedWsSource.includes('export type WsConversationUpdated = ConversationUpdatedPayload'), true);
  assert.equal(serviceSource.includes('type ConversationUpdatedPayload'), true);
  assert.equal(serviceSource.includes('export async function markConversationRead'), true);
  assert.equal(serviceSource.includes('where: { id, tenantId }'), true);
  assert.equal(serviceSource.includes('data: { unreadCount: 0 }'), true);
  assert.equal(serviceSource.includes('io.to(`conversation:${id}`).emit(\'conversation.updated\''), true);
  assert.equal(serviceSource.includes('io.to(`tenant:${tenantId}`).emit(\'conversation.updated\''), true);
  assert.equal(serviceSource.includes('updatedAt: updated.updatedAt.toISOString()'), true);

  assert.equal(routesSource.includes('markConversationRead'), true);
  assert.equal(routesSource.includes("fastify.post<{ Params: { id: string } }>('/:id/read'"), true);
}

async function testUpdatedAtOrderingAndPayloads() {
  const serviceSource = await readSource('../modules/conversation/conversation.service.ts');
  const webhookSource = await readSource('../modules/webhook/webhook.service.ts');
  const simulatorSource = await readSource('../channels/simulator/simulator.service.ts');
  const automationWorkerSource = await readSource('../modules/automation/automation.worker.ts');
  const actionExecutorSource = await readSource('../modules/automation/engine/action-executor.ts');

  assert.equal(serviceSource.includes("orderBy: { updatedAt: 'desc' }"), true);
  assert.equal(serviceSource.includes('updatedAt: updated.updatedAt.toISOString()'), true);
  assert.equal(serviceSource.includes('updatedAt: now.toISOString()'), true);
  assert.equal(webhookSource.includes('updatedAt: updatedConv.updatedAt.toISOString()'), true);
  assert.equal(simulatorSource.includes('updatedAt: updatedConv.updatedAt.toISOString()'), true);
  assert.equal(automationWorkerSource.includes('ConversationUpdatedPayload'), true);
  assert.equal(actionExecutorSource.includes('ConversationUpdatedPayload'), true);
}

async function testFrontendSocketLocalUpdates() {
  const hookSource = await readSource('../../../web/src/hooks/useConversations.ts');
  const listSource = await readSource('../../../web/src/components/inbox/ConversationList.tsx');

  assert.equal(hookSource.includes("import type { ConversationUpdatedPayload } from '@open333crm/shared'"), true);
  assert.equal(hookSource.includes('interface ConversationUpdatedPayload'), false);
  assert.equal(hookSource.includes('function sortByUpdatedAtDesc'), true);
  assert.equal(hookSource.includes('function updateRows'), true);
  assert.equal(hookSource.includes('{ revalidate: false }'), true);
  assert.equal(hookSource.includes('const handleNewMessage = () =>'), false);
  assert.equal(hookSource.includes('const handleConversationUpdated = () =>'), false);
  assert.equal(hookSource.includes('const selected = selectedId === conversationId'), true);
  assert.equal(hookSource.includes('? selected'), true);
  assert.equal(hookSource.includes('api.post(`/conversations/${conversationId}/read`)'), true);
  assert.equal(listSource.includes('markConversationRead(conversation.id)'), true);
}

await testMarkReadContract();
await testUpdatedAtOrderingAndPayloads();
await testFrontendSocketLocalUpdates();

console.log('inbox-realtime-source tests passed');
