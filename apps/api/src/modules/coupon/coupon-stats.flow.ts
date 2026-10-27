/**
 * 優惠券成效與已發出序號的查詢（後台詳情頁與分析頁）。route 呼叫這裡，不自己開交易（AGENTS.md 結構規則 2）。
 */
import type { PrismaClient } from '@prisma/client';
import { inTenant } from '../../lib/tenant-ctx.js';
import { getCouponAnalytics, getCouponStats, listInstances } from './coupon-stats.service.js';

export interface CouponQueryDeps {
  prisma: PrismaClient;
}

export function getCouponStatsFlow(deps: CouponQueryDeps, tenantId: string, couponId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => getCouponStats(scope, couponId));
}

export function listInstancesFlow(
  deps: CouponQueryDeps,
  tenantId: string,
  couponId: string,
  query: Parameters<typeof listInstances>[2],
) {
  return inTenant(deps.prisma, tenantId, (scope) => listInstances(scope, couponId, query));
}

export function getCouponAnalyticsFlow(deps: CouponQueryDeps, tenantId: string, from: Date, to: Date) {
  return inTenant(deps.prisma, tenantId, (scope) => getCouponAnalytics(scope, from, to));
}
