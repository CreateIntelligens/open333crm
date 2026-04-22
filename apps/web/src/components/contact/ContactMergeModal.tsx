'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Check, Loader2, Search, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

interface ContactMergeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryContact: {
    id: string;
    displayName: string;
    phone?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    channelIdentities?: Array<{
      id: string;
      channelType: string;
      uid: string;
      profileName?: string;
    }>;
  };
  onMergeComplete: () => void;
}

interface SearchResult {
  id: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  channelIdentities?: Array<{
    id: string;
    channelType: string;
    uid: string;
    profileName?: string;
  }>;
}

interface MergePreview {
  primary: {
    id: string;
    displayName: string;
    phone?: string | null;
    channelIdentities: Array<{ channelType: string }>;
    tags: Array<{ id: string; name: string; color: string }>;
    attributes: Array<{ key: string; value: string }>;
    conversationsCount: number;
    casesCount: number;
  };
  secondary: {
    id: string;
    displayName: string;
    phone?: string | null;
    channelIdentities: Array<{ channelType: string }>;
    tags: Array<{ id: string; name: string; color: string }>;
    attributes: Array<{ key: string; value: string }>;
    conversationsCount: number;
    casesCount: number;
  };
  diff: {
    newChannelIdentities: Array<{ channelType: string }>;
    newTags: Array<{ id: string; name: string; color: string }>;
    newAttributes: Array<{ key: string; value: string }>;
    totalConversations: number;
    totalCases: number;
  };
}

const CHANNEL_LABELS: Record<string, string> = {
  LINE: 'LINE',
  FB: 'Facebook',
  WEBCHAT: 'WebChat',
  WHATSAPP: 'WhatsApp',
};

const STEPS = ['選擇合併對象', '確認資料保留', '確認合併'];

export function ContactMergeModal({
  open,
  onOpenChange,
  primaryContact,
  onMergeComplete,
}: ContactMergeModalProps) {
  const [step, setStep] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedSecondary, setSelectedSecondary] = useState<SearchResult | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep(0);
      setSearchQuery('');
      setSearchResults([]);
      setShowDropdown(false);
      setSelectedSecondary(null);
      setPreview(null);
      setLoadingPreview(false);
      setConfirmed(false);
      setMerging(false);
      setError('');
    }
  }, [open]);

  // Debounced search
  const searchContacts = useCallback(
    async (q: string) => {
      if (!q || q.length < 2) {
        setSearchResults([]);
        return;
      }
      try {
        const res = await api.get(`/contacts?q=${encodeURIComponent(q)}&limit=10`);
        const results = (res.data.data || []).filter(
          (c: SearchResult) => c.id !== primaryContact.id,
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    },
    [primaryContact.id],
  );

  useEffect(() => {
    const timer = setTimeout(() => searchContacts(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchContacts]);

  // Load preview when entering step 2
  const loadPreview = useCallback(async () => {
    if (!selectedSecondary) { return; }
    setLoadingPreview(true);
    setError('');
    try {
      const res = await api.get(
        `/contacts/merge-preview?primaryId=${primaryContact.id}&secondaryId=${selectedSecondary.id}`,
      );
      setPreview(res.data.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || '載入預覽失敗');
    } finally {
      setLoadingPreview(false);
    }
  }, [primaryContact.id, selectedSecondary]);

  const handleNextStep = () => {
    if (step === 0 && selectedSecondary) {
      setStep(1);
      loadPreview();
    } else if (step === 1) {
      setStep(2);
    }
  };

  const handlePrevStep = () => {
    if (step > 0) {
      setStep(step - 1);
      if (step === 2) { setConfirmed(false); }
    }
  };

  const handleMerge = async () => {
    if (!selectedSecondary || !confirmed) { return; }
    setMerging(true);
    setError('');
    try {
      await api.post('/contacts/merge', {
        primaryContactId: primaryContact.id,
        secondaryContactId: selectedSecondary.id,
      });
      onOpenChange(false);
      onMergeComplete();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || '合併失敗');
    } finally {
      setMerging(false);
    }
  };

  const shortId = (id: string) => id.slice(0, 5).toUpperCase();

  const channelPills = (identities?: Array<{ channelType: string }>) => {
    if (!identities || identities.length === 0) { return null; }
    const types = [...new Set(identities.map((ci) => ci.channelType))];
    return (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {types.map((t) => (
          <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
            {CHANNEL_LABELS[t] || t}
          </Badge>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>合併聯繫人</DialogTitle>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 pb-2">
          {STEPS.map((label, i) => (
            <React.Fragment key={label}>
              {i > 0 && (
                <div className={`h-px w-8 ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    i < step
                      ? 'bg-primary text-primary-foreground'
                      : i === step
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span
                  className={`text-xs ${
                    i === step ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {/* Step 1: Select merge target */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
              {/* Primary contact card */}
              <div className="rounded-lg border p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  主要聯繫人（保留）
                </p>
                <div className="flex items-center gap-3">
                  <Avatar
                    alt={primaryContact.displayName}
                    src={primaryContact.avatarUrl || undefined}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {primaryContact.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      C-{shortId(primaryContact.id)}
                    </p>
                    {primaryContact.phone && (
                      <p className="text-xs text-muted-foreground">{primaryContact.phone}</p>
                    )}
                    {channelPills(primaryContact.channelIdentities)}
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex h-full items-center pt-8">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>

              {/* Secondary contact card / search */}
              <div className="rounded-lg border p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  合併來源（資料保留，ID 刪除）
                </p>
                {selectedSecondary ? (
                  <div className="flex items-center gap-3">
                    <Avatar
                      alt={selectedSecondary.displayName}
                      src={selectedSecondary.avatarUrl || undefined}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {selectedSecondary.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        C-{shortId(selectedSecondary.id)}
                        {primaryContact.phone &&
                          selectedSecondary.phone &&
                          primaryContact.phone === selectedSecondary.phone &&
                          '（相同電話）'}
                      </p>
                      {selectedSecondary.phone && (
                        <p className="text-xs text-muted-foreground">
                          {selectedSecondary.phone}
                        </p>
                      )}
                      {channelPills(selectedSecondary.channelIdentities)}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => {
                        setSelectedSecondary(null);
                        setSearchQuery('');
                      }}
                    >
                      變更
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowDropdown(true);
                      }}
                      onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                      placeholder="搜尋聯繫人..."
                      className="pl-9"
                    />
                    {showDropdown && searchResults.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg max-h-48 overflow-auto">
                        {searchResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedSecondary(c);
                              setShowDropdown(false);
                              setSearchQuery('');
                            }}
                          >
                            <Avatar alt={c.displayName} src={c.avatarUrl || undefined} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{c.displayName}</p>
                              <p className="text-xs text-muted-foreground">
                                {c.phone || c.email || `C-${shortId(c.id)}`}
                                {primaryContact.phone &&
                                  c.phone &&
                                  primaryContact.phone === c.phone &&
                                  ' （相同電話）'}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {showDropdown && searchQuery.length >= 2 && searchResults.length === 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-background p-3 text-sm text-muted-foreground shadow-lg">
                        找不到聯繫人
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="button" disabled={!selectedSecondary} onClick={handleNextStep}>
                下一步
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Preview data retention */}
        {step === 1 && (
          <div className="space-y-4">
            {loadingPreview ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : preview ? (
              <div className="overflow-auto max-h-[50vh]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left font-medium">項目</th>
                      <th className="py-2 text-left font-medium">主要（保留）</th>
                      <th className="py-2 text-left font-medium">來源（合併入）</th>
                      <th className="py-2 text-right font-medium">動作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Channel Identities */}
                    <tr className="border-b">
                      <td className="py-3 font-medium">渠道身份</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(preview.primary.channelIdentities.map((ci) => ci.channelType))].map(
                            (t) => (
                              <Badge key={t} variant="secondary" className="text-[10px]">
                                {CHANNEL_LABELS[t] || t}
                              </Badge>
                            ),
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {preview.diff.newChannelIdentities.length > 0 ? (
                            preview.diff.newChannelIdentities.map((ci) => (
                              <Badge key={ci.channelType} variant="outline" className="text-[10px]">
                                {CHANNEL_LABELS[ci.channelType] || ci.channelType}（新增）
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">（無新增）</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">合併</td>
                    </tr>

                    {/* Conversations */}
                    <tr className="border-b">
                      <td className="py-3 font-medium">歷史對話</td>
                      <td className="py-3">{preview.primary.conversationsCount} 件</td>
                      <td className="py-3">
                        {preview.secondary.conversationsCount > 0
                          ? `${preview.secondary.conversationsCount} 件（合併入）= 共 ${preview.diff.totalConversations} 件`
                          : '0 件'}
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">合併</td>
                    </tr>

                    {/* Cases */}
                    <tr className="border-b">
                      <td className="py-3 font-medium">歷史案件</td>
                      <td className="py-3">{preview.primary.casesCount} 件</td>
                      <td className="py-3">
                        {preview.secondary.casesCount > 0
                          ? `${preview.secondary.casesCount} 件（合併入）= 共 ${preview.diff.totalCases} 件`
                          : '0 件'}
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">合併</td>
                    </tr>

                    {/* Tags */}
                    <tr className="border-b">
                      <td className="py-3 font-medium">標籤</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {preview.primary.tags.map((t) => (
                            <Badge key={t.id} color={t.color} className="text-[10px]">
                              {t.name}
                            </Badge>
                          ))}
                          {preview.primary.tags.length === 0 && (
                            <span className="text-xs text-muted-foreground">（無）</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {preview.diff.newTags.length > 0 ? (
                            preview.diff.newTags.map((t) => (
                              <Badge key={t.id} variant="outline" className="text-[10px]">
                                {t.name}（新增）
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">（無新增）</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">合併</td>
                    </tr>

                    {/* Attributes */}
                    <tr>
                      <td className="py-3 font-medium">自訂屬性</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {preview.primary.attributes.map((a) => (
                            <span key={a.key} className="text-xs">
                              {a.value}
                            </span>
                          ))}
                          {preview.primary.attributes.length === 0 && (
                            <span className="text-xs text-muted-foreground">（無）</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {preview.diff.newAttributes.length > 0 ? (
                            preview.diff.newAttributes.map((a) => (
                              <span key={a.key} className="text-xs">
                                {a.key}: {a.value}（新增）
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">（無新增）</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">保留</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handlePrevStep}>
                上一步
              </Button>
              <Button type="button" disabled={loadingPreview || !preview} onClick={handleNextStep}>
                下一步
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Confirm merge */}
        {step === 2 && selectedSecondary && (
          <div className="space-y-4">
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    合併後 {selectedSecondary.displayName} (C-{shortId(selectedSecondary.id)})
                    將永久封存，此操作無法復原，請確認後再執行。
                  </p>
                  <p className="mt-2 text-yellow-700 dark:text-yellow-300">
                    所有渠道身份、對話、案件、標籤和自訂屬性將轉移至{' '}
                    {primaryContact.displayName} (C-{shortId(primaryContact.id)})。
                  </p>
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">我已確認並瞭解</span>
            </label>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="button" variant="outline" onClick={handlePrevStep}>
                上一步
              </Button>
              <Button
                type="button"
                disabled={!confirmed || merging}
                onClick={handleMerge}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {merging ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    合併中...
                  </>
                ) : (
                  '確認合併'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
