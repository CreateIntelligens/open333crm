import assert from 'node:assert/strict';
import {
  ocrThrough2md,
  parseDocumentThrough2md,
} from '../modules/ai/agent/web-client.js';
import {
  getAgentToolDefinitions,
  executeAgentTool,
  type AgentToolContext,
} from '../modules/ai/agent/tool-registry.js';

// 1. Tool definitions include multimodal tools
{
  const definitions = getAgentToolDefinitions();
  const toolNames = definitions.map((t) => t.name);
  assert.ok(toolNames.includes('ocr_image'), 'definitions should include ocr_image');
  assert.ok(toolNames.includes('parse_document'), 'definitions should include parse_document');
}

// 2. ocrThrough2md execution & SSRF rejection
{
  // Rejects unsafe URL
  await assert.rejects(
    () => ocrThrough2md('http://127.0.0.1:8080/image.png'),
    /Rejected unsafe URL target/,
  );

  // Successful OCR extraction
  const mockOcrFetch: typeof fetch = async (url, init) => {
    if (url.toString() === 'https://example.com/receipt.jpg') {
      return new Response(Buffer.from('fake-image-bytes'), { status: 200 });
    }
    assert.ok(url.toString().includes('/api/ocr'));
    assert.ok(init?.body instanceof FormData);
    return new Response(JSON.stringify({
      data: { content: 'Total: $120.00\nDate: 2026-09-15' },
    }), { status: 200 });
  };

  const result = await ocrThrough2md('https://example.com/receipt.jpg', mockOcrFetch, {
    baseUrls: ['https://test-ocr.com'],
    skipCache: true,
  });

  assert.equal(result.content, 'Total: $120.00\nDate: 2026-09-15');
  assert.equal(result.source, 'https://test-ocr.com');
  assert.equal(result.truncated, false);
}

// 3. parseDocumentThrough2md execution & SSRF rejection
{
  // Rejects unsafe URL
  await assert.rejects(
    () => parseDocumentThrough2md('http://169.254.169.254/secret.pdf'),
    /Rejected unsafe URL target/,
  );

  // Successful AnyDoc extraction
  const mockDocFetch: typeof fetch = async (url, init) => {
    const body = JSON.parse(init?.body as string);
    assert.equal(body.url, 'https://example.com/spec.pdf');
    return new Response(JSON.stringify({
      content: '# Specification Document\n\nChapter 1: Overview',
    }), { status: 200 });
  };

  const result = await parseDocumentThrough2md('https://example.com/spec.pdf', mockDocFetch, {
    baseUrls: ['https://test-doc.com'],
    skipCache: true,
  });

  assert.equal(result.content, '# Specification Document\n\nChapter 1: Overview');
  assert.equal(result.source, 'https://test-doc.com');
}

// 4. executeAgentTool with ocr_image and parse_document
{
  const mockContext: AgentToolContext = {
    tenantId: 'test-tenant',
    runId: 'test-run',
    canPublishWiki: false,
    fetchImpl: async (url, init) => {
      const urlStr = url.toString();
      if (urlStr === 'https://example.com/screen.png') {
        return new Response(Buffer.from('fake-image-bytes'), { status: 200 });
      }
      if (urlStr.includes('/api/ocr')) {
        return new Response(JSON.stringify({ text: 'OCR extracted text' }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: '# Parsed Document Text' }), { status: 200 });
    },
  };

  const ocrRes = (await executeAgentTool('ocr_image', { url: 'https://example.com/screen.png' }, mockContext)) as {
    content: string;
  };
  assert.equal(ocrRes.content, 'OCR extracted text');

  const docRes = (await executeAgentTool('parse_document', { url: 'https://example.com/manual.pdf' }, mockContext)) as {
    content: string;
  };
  assert.equal(docRes.content, '# Parsed Document Text');
}

console.log('agent-multimodal-tools tests passed');
