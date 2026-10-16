'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';

interface Tag {
  id: string;
  name: string;
  color?: string;
  type?: string;
  scope?: TagTargetType;
}

type TagTargetType = 'CONTACT' | 'CASE' | 'CONVERSATION';

interface TagManagerProps {
  targetType: TagTargetType;
  targetId: string;
  tags: Tag[];
  onUpdate: () => void;
}

const TARGET_ENDPOINTS: Record<TagTargetType, string> = {
  CONTACT: 'contacts',
  CASE: 'cases',
  CONVERSATION: 'conversations',
};

export function TagManager({ targetType, targetId, tags, onUpdate }: TagManagerProps) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api
      .get('/tags')
      .then((res) => setAllTags(res.data.data || []))
      .catch(() => {});
  }, []);

  const availableTags = allTags.filter(
    (t) => t.scope === targetType && !tags.some((ct) => ct.id === t.id)
  );

  const endpoint = `/${TARGET_ENDPOINTS[targetType]}/${targetId}/tags`;

  const [picking, setPicking] = useState(false);

  const handleAddTag = async (tagId = selectedTagId) => {
    if (!tagId) return;
    setAdding(true);
    try {
      await api.post(endpoint, { tagId });
      setSelectedTagId('');
      setPicking(false);
      onUpdate();
    } catch (err) {
      console.error('Failed to add tag:', err);
      alert(getApiErrorMessage(err, '加上標籤失敗，請稍後重試'));
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      await api.delete(`${endpoint}/${tagId}`);
      onUpdate();
    } catch (err) {
      console.error('Failed to remove tag:', err);
      alert(getApiErrorMessage(err, '移除標籤失敗，請稍後重試'));
    }
  };

  // 樣式依 Claude Design「收件匣 v4」：淡藍膠囊標籤＋虛線「＋ 貼標」，點了才出現選單，選了就直接貼上
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-subtle pl-3 pr-1.5 text-xs font-medium text-primary-hover"
        >
          {tag.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />}
          {tag.name}
          <button
            type="button"
            onClick={() => handleRemoveTag(tag.id)}
            className="rounded-full p-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`移除標籤「${tag.name}」`}
            title="移除標籤"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {availableTags.length > 0 && (picking ? (
        <select
          autoFocus
          value={selectedTagId}
          disabled={adding}
          onChange={(e) => { setSelectedTagId(e.target.value); void handleAddTag(e.target.value); }}
          onBlur={() => { if (!adding) setPicking(false); }}
          aria-label="選擇要貼上的標籤"
          className="h-7 cursor-pointer rounded-full border border-primary bg-background px-3 text-xs font-medium text-foreground focus-visible:outline-none"
        >
          <option value="">選擇標籤…</option>
          {availableTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-control-disabled px-3 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3 w-3" />
          貼標
        </button>
      ))}

      {tags.length === 0 && availableTags.length === 0 && (
        <span className="text-sm text-muted-foreground">沒有標籤</span>
      )}
    </div>
  );
}
