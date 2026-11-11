// 權限點 Registry 是純常數，定義在 @open333crm/shared，讓 database 的 demo seed 也用同一份（不能 import core：循環依賴）。
export { PERMISSIONS, PERMISSION_CODES, PERMISSION_BY_CODE, type PermissionDef } from '@open333crm/shared';
