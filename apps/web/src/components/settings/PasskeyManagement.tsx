'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/providers/AuthProvider';
import api from '@/lib/api';

interface PasskeyCredential {
  id: string;
  name: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export function PasskeyManagement() {
  const { registerPasskey, passkeyEnabled } = useAuth();
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');

  const fetchCredentials = useCallback(async () => {
    try {
      const response = await api.get<{ data: PasskeyCredential[] }>('/auth/passkeys');
      setCredentials(response.data.data);
      setError('');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosError.response?.data?.error?.message || '無法載入 Passkey 設定。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!passkeyEnabled) {
      setLoading(false);
      return;
    }
    void fetchCredentials();
  }, [fetchCredentials, passkeyEnabled]);

  const handleRegister = async () => {
    setError('');
    setRegistering(true);
    try {
      await registerPasskey();
      await fetchCredentials();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosError.response?.data?.error?.message || 'Passkey 綁定失敗，請稍後再試。');
    } finally {
      setRegistering(false);
    }
  };

  const handleRevoke = async (credential: PasskeyCredential) => {
    if (!confirm(`確定要撤銷「${credential.name}」嗎？撤銷後必須重新綁定才能使用。`)) return;
    try {
      await api.delete(`/auth/passkeys/${credential.id}`);
      await fetchCredentials();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosError.response?.data?.error?.message || '撤銷 Passkey 失敗。');
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Passkey 登入</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            使用 Touch ID、Face ID、Windows Hello 或裝置 PIN 登入，不需要輸入密碼。
          </p>
        </div>
        <Button onClick={handleRegister} loading={registering} disabled={!passkeyEnabled}>
          <Plus className="h-4 w-4" />
          綁定 Passkey
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!passkeyEnabled && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Passkey 尚未啟用，請先在 API 環境設定 WEBAUTHN_RP_ID 與 WEBAUTHN_ORIGIN。
          </CardContent>
        </Card>
      )}

      {passkeyEnabled && loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : passkeyEnabled && credentials.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Fingerprint className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">尚未綁定 Passkey</p>
            <p className="mt-1 text-xs text-muted-foreground">
              點擊「綁定 Passkey」後，依照裝置提示完成驗證。
            </p>
          </CardContent>
        </Card>
      ) : passkeyEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">已綁定的裝置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {credentials.map((credential) => (
              <div key={credential.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <Fingerprint className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{credential.name}</p>
                    <p className="text-xs text-muted-foreground">
                      綁定於 {new Date(credential.createdAt).toLocaleString()}
                      {credential.lastUsedAt
                        ? ` · 最後使用 ${new Date(credential.lastUsedAt).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`撤銷 ${credential.name}`}
                  onClick={() => handleRevoke(credential)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
