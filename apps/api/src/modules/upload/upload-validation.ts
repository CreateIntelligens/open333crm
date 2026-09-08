import { logger } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';
import {
  detectUploadContent,
  type UploadDetectionInput,
  type UploadDetectionPolicy,
  type UploadDetectionResult,
  type UploadMagikaClient,
} from './upload-content-detector.js';

export async function assertUploadContent(
  input: Omit<UploadDetectionInput, 'policy'>,
  policy: UploadDetectionPolicy,
  client?: UploadMagikaClient,
): Promise<UploadDetectionResult> {
  try {
    const result = await detectUploadContent({ ...input, policy }, client);
    if (result.accepted) return result;

    throw new AppError(
      `File content type rejected: ${result.reason}`,
      'INVALID_FILE_TYPE',
      400,
      {
        detectedMime: result.detectedMime,
        label: result.label,
        confidence: result.confidence,
      },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;

    const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown detector error';
    logger.error(`[UploadDetection] detector unavailable; rejecting upload: ${message}`);
    throw new AppError(
      'File content detection is temporarily unavailable',
      'FILE_TYPE_DETECTION_UNAVAILABLE',
      503,
    );
  }
}
