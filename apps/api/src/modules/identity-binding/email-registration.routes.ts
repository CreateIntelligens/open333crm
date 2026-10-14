/**
 * Email 登記公開端點（change add-email-identity-merge，design D4）。
 * Prefix: /api/v1/public/email-registration
 */
import { createRegistrationRoutes, type RegistrationRoutesOptions } from './registration-routes.js';
import { EMAIL_REGISTRATION } from './email-registration.service.js';

export type EmailRegistrationRoutesOptions = RegistrationRoutesOptions;

export default createRegistrationRoutes({
  kind: EMAIL_REGISTRATION,
  field: 'email',
  expiredCode: 'EMAIL_REGISTRATION_EXPIRED',
  invalid: { message: 'email 格式不正確', code: 'INVALID_EMAIL' },
});
