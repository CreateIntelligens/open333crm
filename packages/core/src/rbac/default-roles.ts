// 三個 system role 的預設權限定義在 @open333crm/shared，讓 database 的 demo seed 也用同一份（不能 import core：循環依賴）。
export {
  SYSTEM_ROLE_SLUGS,
  SYSTEM_ROLE_NAMES,
  ENUM_TO_SLUG,
  DEFAULT_ROLE_PERMISSIONS,
  type SystemRoleSlug,
} from '@open333crm/shared';
