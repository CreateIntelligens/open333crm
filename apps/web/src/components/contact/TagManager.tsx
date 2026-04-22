'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

interface Tag {
  id: string;
  name: string;
  color?: string;
}

interface TagManagerProps {
  contactId: string;
  tags: Tag[];
  onUpdate: () => void;
}

export function TagManager({ contactId, tags, onUpdate }: TagManagerProps) {
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
    (t) => !tags.some((ct) => ct.id === t.id)
  );

  const handleAddTag = async () => {
    if (!selectedTagId) { return; }
    setAdding(true);
    try {
      await api.post(`/contacts/${contactId}/tags`, { tagId: selectedTagId });
      setSelectedTagId('');
      onUpdate();
    } catch (err) {
      console.error('Failed to add tag:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      await api.delete(`/contacts/${contactId}/tags/${tagId}`);
      onUpdate();
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  };

  return (
    <div>
      {/* Current tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              color={tag.color}
              className="flex items-center gap-1 pr-1"
            >
              {tag.name}
              <button
                onClick={() => handleRemoveTag(tag.id)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                title="移除標籤"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">沒有標籤</span>
        )}
      </div>

      {/* Add tag */}
      {availableTags.length > 0 && (
        <div className="flex gap-2">
          <Select
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
            options={availableTags.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="選擇標籤..."
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddTag}
            disabled={!selectedTagId || adding}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
