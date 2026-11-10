'use client';

/**
 * 平台稽核紀錄表格（規格 platform-audit-log）。租戶詳細頁與平台帳號詳細頁共用：
 * 動作顯示中文名稱、對象顯示可讀名稱並連到對應頁面、操作者顯示平台帳號名稱。
 */
import { useId } from 'react';
import Link from 'next/link';
import { C, card, sectionTitle, table, th, td } from './ui';
import {
  auditActionLabel,
  auditTargetHref,
  auditTargetText,
  fmtAuditTime,
  type PlatformAuditEntry,
} from './audit-log';

export function AuditLogTable({
  logs,
  hasMore = false,
  title = '操作紀錄',
}: {
  logs: PlatformAuditEntry[];
  /** API 回報還有更舊的紀錄時，提示只顯示最近的筆數 */
  hasMore?: boolean;
  title?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} style={{ ...sectionTitle, margin: '30px 0 14px' }}>
        {title}（{logs.length}）
      </h2>
      {hasMore && (
        <p style={{ color: C.muted, fontSize: 12.5, margin: '-6px 0 10px' }}>只顯示最近 {logs.length} 筆紀錄</p>
      )}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>操作</th>
              <th style={th}>對象</th>
              <th style={th}>操作者</th>
              <th style={th}>時間</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td style={{ ...td, color: C.faint, textAlign: 'center' }} colSpan={4}>
                  尚無紀錄
                </td>
              </tr>
            )}
            {logs.map((l) => {
              const href = auditTargetHref(l);
              const text = auditTargetText(l);
              return (
                <tr key={l.id}>
                  <td style={td}>
                    <span style={{ fontWeight: 500, color: C.ink }}>{auditActionLabel(l.action)}</span>
                  </td>
                  <td style={{ ...td, color: C.muted }}>
                    {href ? (
                      <Link href={href} style={{ color: C.brand, textDecoration: 'none' }}>
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                  <td style={{ ...td, color: C.muted }}>
                    {l.actor ? (
                      <span title={l.actor.email}>{l.actor.name}</span>
                    ) : (
                      <span style={{ color: C.faint }}>系統排程</span>
                    )}
                  </td>
                  <td style={{ ...td, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtAuditTime(l.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
