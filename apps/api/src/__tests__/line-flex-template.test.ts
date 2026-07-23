import assert from 'node:assert/strict';
import {
  createFieldHole,
  extractEditableContainers,
  getJsonPointer,
  insertFlexComponent,
  normalizeLineFlexMessageBody,
  normalizeLineFlexTemplateBody,
  validateLineFlexMessageBody,
  renderLineFlexTemplateBody,
  setJsonPointer,
  validateLineFlexTemplateBody,
  validateRequiredFlexTemplateValues,
  type FlexTemplateField,
} from '../../../../packages/shared/src/line-flex-template.js';

const rawBubble = {
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: 'Brown Cafe', weight: 'bold' },
      {
        type: 'button',
        action: { type: 'uri', label: 'Open', uri: 'https://example.com' },
      },
    ],
  },
};

async function testNormalizeMessageAndRawContents() {
  const flexMessage = normalizeLineFlexMessageBody({
    type: 'flex',
    altText: 'Sale',
    contents: rawBubble,
  });
  assert.equal(flexMessage.type, 'flex');
  assert.equal(flexMessage.altText, 'Sale');
  assert.equal(flexMessage.contents.type, 'bubble');
  assert.equal(validateLineFlexMessageBody(flexMessage).valid, true);

  const rawMessage = normalizeLineFlexMessageBody(rawBubble, { altText: 'Raw' });
  assert.deepEqual(rawMessage, {
    type: 'flex',
    altText: 'Raw',
    contents: rawBubble,
  });

  const message = normalizeLineFlexTemplateBody({
    type: 'flex',
    altText: 'Sale',
    contents: rawBubble,
  });
  assert.equal(message.altText, 'Sale');
  assert.equal(message.contents.type, 'bubble');
  assert.equal(message.source?.format, 'message');

  const raw = normalizeLineFlexTemplateBody(rawBubble, { altText: 'Raw' });
  assert.equal(raw.altText, 'Raw');
  assert.equal(raw.source?.format, 'contents');

  assert.throws(
    () => normalizeLineFlexTemplateBody({ type: 'text', text: 'x' }),
    /LINE Flex contents root must be bubble or carousel/,
  );
}

async function testJsonPointerHelpers() {
  const value = { a: [{ b: 'old' }], 'x/y': { '~z': 1 } };
  assert.equal(getJsonPointer(value, '/a/0/b'), 'old');
  assert.equal(getJsonPointer(value, '/x~1y/~0z'), 1);

  const next = setJsonPointer(value, '/a/0/b', 'new');
  assert.equal(getJsonPointer(next, '/a/0/b'), 'new');
  assert.equal(getJsonPointer(value, '/a/0/b'), 'old');
}

async function testFieldHoleAndValidation() {
  const body = normalizeLineFlexTemplateBody(rawBubble, { altText: 'Cafe' });
  const field: FlexTemplateField = {
    key: 'store_name',
    label: '店名',
    path: '/body/contents/0/text',
    kind: 'text',
    required: true,
    defaultValue: 'Default Cafe',
  };
  const next = createFieldHole(body, field);

  assert.equal(getJsonPointer(next.contents, '/body/contents/0/text'), '{{store_name}}');
  assert.equal(next.fields.length, 1);

  const validation = validateLineFlexTemplateBody(next);
  assert.equal(validation.valid, true);

  const duplicate = validateLineFlexTemplateBody({
    ...next,
    fields: [...next.fields, field],
  });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some((error) => error.code === 'DUPLICATE_TEMPLATE_FIELD'));
}

async function testEditableContainersAndInsertion() {
  const body = normalizeLineFlexTemplateBody({
    type: 'carousel',
    contents: [rawBubble],
  });
  const containers = extractEditableContainers(body.contents);
  assert.ok(containers.some((container) => container.path === '/contents'));
  assert.ok(containers.some((container) => container.path === '/contents/0/body/contents'));

  const withText = insertFlexComponent(body, '/contents/0/body/contents', 'text');
  const bodyContents = getJsonPointer(withText.contents, '/contents/0/body/contents');
  assert.equal(Array.isArray(bodyContents), true);
  assert.equal((bodyContents as unknown[]).length, 3);

  const withBubble = insertFlexComponent(body, '/contents', 'bubble');
  const carouselContents = getJsonPointer(withBubble.contents, '/contents');
  assert.equal(Array.isArray(carouselContents), true);
  assert.equal((carouselContents as unknown[]).length, 2);

  assert.throws(
    () => insertFlexComponent(body, '/contents/0/body/contents', 'bubble'),
    /Cannot insert bubble/,
  );
}

async function testRenderRequiredFields() {
  const body = createFieldHole(normalizeLineFlexTemplateBody(rawBubble), {
    key: 'store_name',
    label: '店名',
    path: '/body/contents/0/text',
    kind: 'text',
    required: true,
  });

  assert.deepEqual(validateRequiredFlexTemplateValues(body, {}), ['store_name']);
  assert.throws(() => renderLineFlexTemplateBody(body, {}), /Missing required/);

  const rendered = renderLineFlexTemplateBody(body, { store_name: 'Open333 Cafe' });
  assert.equal(getJsonPointer(rendered.contents, '/body/contents/0/text'), 'Open333 Cafe');
}

await testNormalizeMessageAndRawContents();
await testJsonPointerHelpers();
await testFieldHoleAndValidation();
await testEditableContainersAndInsertion();
await testRenderRequiredFields();

console.log('line-flex-template tests passed');
