import { logger } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';
import {
  UPLOAD_DETECTION_UNAVAILABLE_MESSAGE,
  uploadRejectedMessage,
} from '../../shared/messages/upload.js';
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

    // 給使用者的是中文訊息；英文原因與偵測結果放在 details 與 log 供除錯（issue #470）。
    // log 不寫檔名與檔案內容（spec upload-content-detection「Detection diagnostics and security boundaries」）
    logger.warn(
      `[UploadDetection] rejected policy=${policy.name} reason="${result.reason}" detectedMime=${result.detectedMime ?? 'none'} label=${result.label ?? 'none'}`,
    );
    throw new AppError(
      uploadRejectedMessage(result.rejection ?? 'unrecognized', policy.allowedMimes, result.detectedMime),
      'INVALID_FILE_TYPE',
      400,
      {
        reason: result.reason,
        detectedMime: result.detectedMime,
        label: result.label,
        confidence: result.confidence,
      },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;

    const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown detector error';
    logger.error(`[UploadDetection] detector unavailable; rejecting upload: ${message}`);
    throw new AppError(UPLOAD_DETECTION_UNAVAILABLE_MESSAGE, 'FILE_TYPE_DETECTION_UNAVAILABLE', 503);
  }
}
