'use client';

import React, { useState } from 'react';
import { Mail, Pencil } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePermission } from '@/providers/AuthProvider';

interface ContactEmailFieldProps {
  contactId: string;
  email?: string | null;
  onUpdate: () => void;
  /** 客服選擇與使用相同 email 的聯絡人合併：由頁面開啟合併預覽，合併後再寫入 email */
  onRequestMerge: (other: { id: string; displayName: string }, email: string) => void;
}

/**
 * 聯絡人頁的 email 欄位與編輯（change add-email-identity-merge）。
 * email 與另一位聯絡人相同時，後端回 409 EMAIL_IN_USE，由客服選擇合併、仍要儲存或取消。
 */
export function ContactEmailField({ contactId, email, onUpdate, onRequestMerge }: ContactEmailFieldProps) {
  const canUpdate = usePermission('contact.update');
  const canMerge = usePermission('contact.merge');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // id 為 null：對方只在看不到的渠道有身分，後端不回傳對方資料，只能仍要儲存或取消
  const [conflict, setConflict] = useState<{ id: string | null; displayName: string } | null>(null);

  const reset = () => {
    setEditing(false);
    setConflict(null);
    setError(null);
    setValue(email ?? '');
  };

  const save = async (allowDuplicateEmail = false) => {
    setSaving(true);
    setError(null);
    const next = value.trim() || null;
    try {
      await api.patch(`/contacts/${contactId}`, allowDuplicateEmail ? { email: next, allowDuplicateEmail } : { email: next });
      reset();
      onUpdate();
    } catch (err) {
      const details = getApiErrorDetails(err);
      if (getApiErrorCode(err) === 'EMAIL_IN_USE') {
        setConflict(
          typeof details?.contactId === 'string'
            ? { id: details.contactId, displayName: String(details.displayName ?? '未命名') }
            : { id: null, displayName: '' },
        );
      } else {
        setError(getApiErrorMessage(err, '儲存 email 失敗，請稍後重試'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Mail className="h-4 w-4" />
        <span>{email || '沒有 email'}</span>
        {canUpdate && (
          <button
            type="button"
            aria-label="編輯 email"
            className="rounded p-0.5 hover:bg-muted"
            onClick={() => {
              setValue(email ?? '');
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Email"
          type="email"
          value={value}
          disabled={saving || conflict !== null}
          onChange={(e) => setValue(e.target.value)}
          className="h-8"
        />
        {!conflict && (
          <>
            <Button size="sm" disabled={saving} onClick={() => save()}>
              儲存
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={reset}>
              取消
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {conflict && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          {conflict.id ? (
            <p>
              這個 email 已由聯絡人「{conflict.displayName}」使用。如果是同一個人，可以把兩位聯絡人合併，合併後兩邊的對話會整合在一起。
            </p>
          ) : (
            <p>這個 email 已由其他聯絡人使用，該聯絡人不在你可查看的渠道中。可以仍要儲存（不合併）或取消。</p>
          )}
          <div className="flex flex-wrap gap-2">
            {canMerge && conflict.id && (
              <Button
                size="sm"
                disabled={saving}
                onClick={() => onRequestMerge({ id: conflict.id!, displayName: conflict.displayName }, value.trim())}
              >
                與「{conflict.displayName}」合併
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={saving} onClick={() => save(true)}>
              仍要儲存
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={reset}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
