/**
 * 公開領券連結的後台 flow（add-coupon-system design D30）。route 呼叫這裡，不自己開交易
 * （AGENTS.md 結構規則 2）。每個操作只呼叫一個 service 函式，所以用 flowOf。
 */
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { PrismaClient } from '@prisma/client';
import {
  createClaimLink,
  findClaimLinkTenant,
  openPublicClaimPage,
  getClaimLink,
  listAvailableClaimLinks,
  listClaimLinks,
  setClaimLinkStatus,
  updateClaimLink,
} from './coupon-claim-link.service.js';

export const listClaimLinksFlow = flowOf(listClaimLinks);
export const listAvailableClaimLinksFlow = flowOf(listAvailableClaimLinks);
export const createClaimLinkFlow = flowOf(createClaimLink);
export const updateClaimLinkFlow = flowOf(updateClaimLink);
export const setClaimLinkStatusFlow = flowOf(setClaimLinkStatus);
export const getClaimLinkFlow = flowOf(getClaimLink);

/**
 * 公開領券頁：代碼全系統唯一，先以 SECURITY DEFINER 函式查出租戶 id，再在綁定該租戶的交易內讀資料
 * （RLS 生效，不使用 prismaAdmin）。查無代碼回 null。
 */
export async function openPublicClaimPageFlow(deps: { prisma: PrismaClient }, rawCode: string) {
  const found = await findClaimLinkTenant(deps.prisma, rawCode);
  if (!found) return null;
  return inTenant(deps.prisma, found.tenantId, (scope) => openPublicClaimPage(scope, found.code));
}
