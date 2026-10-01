import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MarkitdownService } from '../../../../packages/brain/src/services/MarkitdownService.js';

// 1. Create a dummy test file
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markitdown-test-'));
const testDocPath = path.join(tmpDir, 'test-doc.pdf');
const testOutPath = path.join(tmpDir, 'test-doc.md');
fs.writeFileSync(testDocPath, Buffer.from('%PDF-1.4 dummy pdf content'));

try {
  let fetchAttempts = 0;
  const mockFetch: typeof fetch = async (url) => {
    fetchAttempts++;
    if (url.toString().startsWith('https://fail.test')) {
      return new Response('offline', { status: 502 });
    }
    return new Response(JSON.stringify({
      content: '# Converted Document via AnyDoc\n\n- Point 1\n- Point 2',
    }), { status: 200 });
  };

  const service = new MarkitdownService({
    baseUrls: ['https://fail.test', 'https://success.test'],
    fetchImpl: mockFetch,
  });

  const markdown = await service.convertToMarkdown(testDocPath);
  assert.equal(fetchAttempts, 2, 'Should have failed on first node and succeeded on second node');
  assert.equal(markdown, '# Converted Document via AnyDoc\n\n- Point 1\n- Point 2');

  // Test convertAndSave
  await service.convertAndSave(testDocPath, testOutPath);
  const savedContent = fs.readFileSync(testOutPath, 'utf8');
  assert.equal(savedContent, '# Converted Document via AnyDoc\n\n- Point 1\n- Point 2');

  console.log('markitdown service tests passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
