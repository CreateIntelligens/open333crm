import { fileTypeFromBuffer } from 'file-type';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../config/env.js';
import { logger } from '@open333crm/core';

export interface UploadDetectionPolicy {
  name: string;
  allowedMimes: readonly string[];
}

export interface UploadDetectionInput {
  buffer: Buffer;
  filename: string;
  clientMime: string;
  policy: UploadDetectionPolicy;
}

export interface UploadDetectionResult {
  accepted: boolean;
  detectedMime?: string;
  label?: string;
  confidence?: number;
  reason: string;
}

export interface UploadMagikaClient {
  identifyBytes(bytes: Uint8Array): Promise<{
    status: string;
    prediction: { output: { label: string }; score: number };
  }>;
}

const MAGIKA_MODEL_DIR = new URL('../../../assets/magika/standard_v3_3/', import.meta.url);
const MAGIKA_MIN_SCORE = 0.5;
const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export const UPLOAD_POLICIES = {
  generic: {
    name: 'generic-storage',
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/html',
      'text/markdown',
      'text/plain',
    ],
  },
  conversationImage: {
    name: 'conversation-image',
    allowedMimes: ['image/jpeg', 'image/png'],
  },
  conversationVideo: {
    name: 'conversation-video',
    allowedMimes: ['video/mp4', 'video/quicktime'],
  },
  imagemap: {
    name: 'line-imagemap',
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  knowledge: {
    name: 'knowledge-document',
    allowedMimes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/html',
      'text/markdown',
      'text/plain',
    ],
  },
  partnerAttachment: {
    name: 'partner-attachment',
    allowedMimes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/html',
      'text/markdown',
      'text/plain',
    ],
  },
} as const satisfies Record<string, UploadDetectionPolicy>;

let magikaClientPromise: Promise<UploadMagikaClient> | null = null;

function patchTensorflowNodeUtilForNode24(): void {
  const nodeUtil = createRequire(import.meta.url)('node:util') as {
    isNullOrUndefined?: (value: unknown) => boolean;
  };
  // @tensorflow/tfjs-node 4.22 still references this removed Node util helper.
  // Patch the CommonJS util object before Magika dynamically imports tfjs-node.
  if (!nodeUtil.isNullOrUndefined) {
    nodeUtil.isNullOrUndefined = (value) => value === null || value === undefined;
  }
}

export async function preloadUploadContentDetector(): Promise<void> {
  if (!getConfig().UPLOAD_CONTENT_DETECTION_ENABLED) {
    logger.warn('[UploadDetection] disabled by UPLOAD_CONTENT_DETECTION_ENABLED=false');
    return;
  }

  await getMagikaClient();
  logger.info('[UploadDetection] Magika model preloaded from local image assets');
}

async function getMagikaClient(): Promise<UploadMagikaClient> {
  if (!magikaClientPromise) {
    magikaClientPromise = (async () => {
      patchTensorflowNodeUtilForNode24();
      const { MagikaNode } = await import('magika/node');
      return MagikaNode.create({
        modelPath: fileURLToPath(new URL('model.json', MAGIKA_MODEL_DIR)),
        modelConfigPath: fileURLToPath(new URL('config.min.json', MAGIKA_MODEL_DIR)),
      });
    })();
  }
  return magikaClientPromise;
}

function normalizeMime(mime: string): string {
  return mime.split(';', 1)[0].trim().toLowerCase();
}

function zipOfficeMime(buffer: Buffer): string | undefined {
  if (!buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) return undefined;
  const sample = buffer.subarray(0, 512 * 1024).toString('latin1');
  if (sample.includes('word/document.xml')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (sample.includes('xl/workbook.xml')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return undefined;
}

function magikaMime(label: string): string | undefined {
  const labels: Record<string, string> = {
    csv: 'text/csv',
    html: 'text/html',
    markdown: 'text/markdown',
    md: 'text/markdown',
    txt: 'text/plain',
    text: 'text/plain',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
  };
  return labels[label.toLowerCase()];
}

function extensionMatches(mime: string, filename: string): boolean {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  const expected: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'video/mp4': ['mp4'],
    'video/quicktime': ['mov', 'qt'],
    'application/pdf': ['pdf'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'text/csv': ['csv'],
    'text/html': ['html', 'htm'],
    'text/markdown': ['md', 'markdown'],
    'text/plain': ['txt', 'text'],
  };
  return !expected[mime] || expected[mime].includes(extension);
}

export async function detectUploadContent(
  input: UploadDetectionInput,
  client?: UploadMagikaClient,
): Promise<UploadDetectionResult> {
  if (!getConfig().UPLOAD_CONTENT_DETECTION_ENABLED) {
    return { accepted: true, reason: 'content detection disabled by configuration' };
  }

  if (input.buffer.length === 0) {
    return { accepted: false, reason: 'empty file' };
  }

  const magika = client ?? await getMagikaClient();
  const [fileType, prediction] = await Promise.all([
    fileTypeFromBuffer(input.buffer),
    magika.identifyBytes(input.buffer),
  ]);
  const label = prediction.prediction.output.label;
  const confidence = prediction.prediction.score;
  const rawMime = fileType?.mime;
  const detectedMime =
    zipOfficeMime(input.buffer) ??
    (rawMime === 'application/zip' ? magikaMime(label) ?? rawMime : rawMime) ??
    magikaMime(label);
  const clientMime = normalizeMime(input.clientMime);

  if (prediction.status !== 'ok' || confidence < MAGIKA_MIN_SCORE) {
    return { accepted: false, detectedMime, label, confidence, reason: 'Magika confidence is too low' };
  }
  if (!detectedMime) {
    return { accepted: false, label, confidence, reason: 'file content type is unknown' };
  }
  if (!input.policy.allowedMimes.includes(detectedMime)) {
    return { accepted: false, detectedMime, label, confidence, reason: `type ${detectedMime} is not allowed for ${input.policy.name}` };
  }
  if (!GENERIC_MIMES.has(clientMime) && clientMime !== detectedMime) {
    return { accepted: false, detectedMime, label, confidence, reason: `client MIME ${clientMime} does not match detected MIME ${detectedMime}` };
  }
  if (!extensionMatches(detectedMime, input.filename)) {
    return { accepted: false, detectedMime, label, confidence, reason: `filename extension does not match ${detectedMime}` };
  }

  return { accepted: true, detectedMime, label, confidence, reason: 'content type validated' };
}
