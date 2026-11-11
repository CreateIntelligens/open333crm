/**
 * 手機登記公開端點（change add-phone-identity-merge）。
 * Prefix: /api/v1/public/phone-registration
 */
import { createRegistrationRoutes, type RegistrationRoutesOptions } from './registration-routes.js';
import { PHONE_REGISTRATION } from './phone-registration.service.js';

export type PhoneRegistrationRoutesOptions = RegistrationRoutesOptions;

export default createRegistrationRoutes({
  kind: PHONE_REGISTRATION,
  field: 'phone',
  expiredCode: 'PHONE_REGISTRATION_EXPIRED',
  invalid: { message: '請輸入台灣手機號碼，例如 0912345678', code: 'INVALID_PHONE' },
});
