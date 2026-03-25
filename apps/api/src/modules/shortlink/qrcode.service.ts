/**
 * QR Code generation service.
 */

import QRCode from 'qrcode';

/**
 * Generate a QR Code as a base64 data URI (PNG).
 */
export async function generateQrCode(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 400,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
