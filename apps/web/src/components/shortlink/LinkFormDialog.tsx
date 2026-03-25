'use client';

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';

interface LinkFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editData?: Record<string, unknown> | null;
  tags?: Array<{ id: string; name: string }>;
}

export function LinkFormDialog({ open, onClose, onSaved, editData, tags = [] }: LinkFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [targetUrl, setTargetUrl] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmContent, setUtmContent] = useState('');
  const [utmTerm, setUtmTerm] = useState('');
  const [tagOnClick, setTagOnClick] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  useEffect(() => {
    if (editData) {
      setTargetUrl((editData.targetUrl as string) || '');
      setTitle((editData.title as string) || '');
      setSlug((editData.slug as string) || '');
      setUtmSource((editData.utmSource as string) || '');
      setUtmMedium((editData.utmMedium as string) || '');
      setUtmCampaign((editData.utmCampaign as string) || '');
      setUtmContent((editData.utmContent as string) || '');
      setUtmTerm((editData.utmTerm as string) || '');
      setTagOnClick((editData.tagOnClick as string) || '');
      setExpiresAt(editData.expiresAt ? (editData.expiresAt as string).slice(0, 16) : '');
    } else {
      setTargetUrl('');
      setTitle('');
      setSlug('');
      setUtmSource('');
      setUtmMedium('');
      setUtmCampaign('');
      setUtmContent('');
      setUtmTerm('');
      setTagOnClick('');
      setExpiresAt('');
    }
  }, [editData, open]);

  const handleSave = async () => {
    if (!targetUrl) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        targetUrl,
        title: title || undefined,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        tagOnClick: tagOnClick || undefined,
        expiresAt: expiresAt || undefined,
      };

      if (!editData && slug) {
        payload.slug = slug;
      }

      if (editData) {
        await api.patch(`/shortlinks/${editData.id}`, payload);
      } else {
        await api.post('/shortlinks', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Save link error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editData ? '編輯短連結' : '建立短連結'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">目標 URL *</label>
            <Input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com/page" />
          </div>

          <div>
            <label className="text-sm font-medium">標題</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="連結描述" />
          </div>

          {!editData && (
            <div>
              <label className="text-sm font-medium">自訂 Slug（留空自動產生）</label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="promo1" />
            </div>
          )}

          <details className="group">
            <summary className="text-sm font-medium cursor-pointer">UTM 參數</summary>
            <div className="mt-2 space-y-2">
              <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="utm_source" />
              <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="utm_medium" />
              <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="utm_campaign" />
              <Input value={utmContent} onChange={(e) => setUtmContent(e.target.value)} placeholder="utm_content" />
              <Input value={utmTerm} onChange={(e) => setUtmTerm(e.target.value)} placeholder="utm_term" />
            </div>
          </details>

          <div>
            <label className="text-sm font-medium">點擊時自動貼標</label>
            <select
              value={tagOnClick}
              onChange={(e) => setTagOnClick(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">不貼標</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">到期時間</label>
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !targetUrl}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editData ? '儲存' : '建立'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
