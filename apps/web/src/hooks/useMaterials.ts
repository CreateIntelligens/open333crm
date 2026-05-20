'use client';

import useSWR from 'swr';
import api from '@/lib/api';

export interface MaterialVariable {
  key: string;
  label?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface Material {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  description: string | null;
  category: string | null;
  channelType: string;
  contentType: string;
  body: Record<string, unknown>;
  variables: MaterialVariable[];
  targetChannels: string[];
  previewImageUrl: string | null;
  isActive: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  template?: { id: string; name: string; category: string };
}

interface MaterialFilters {
  channelType?: string;
  category?: string;
  q?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useMaterials(filters: MaterialFilters = {}) {
  const { channelType, category, q, isActive, page = 1, limit = 50 } = filters;
  const params = new URLSearchParams();
  if (channelType) params.set('channelType', channelType);
  if (category) params.set('category', category);
  if (q) params.set('q', q);
  if (isActive !== undefined) params.set('isActive', String(isActive));
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/marketing/materials?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    materials: (data?.data || []) as Material[],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useMaterial(id: string | null | undefined) {
  const key = id ? `/marketing/materials/${id}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);
  return {
    material: data?.data as Material | undefined,
    isLoading,
    error,
    mutate,
  };
}

export async function createMaterial(input: {
  templateId?: string;
  name: string;
  description?: string;
  category?: string;
  channelType?: string;
  contentType?: string;
  body?: Record<string, unknown>;
  variables?: MaterialVariable[];
  targetChannels?: string[];
  previewImageUrl?: string;
}) {
  const res = await api.post('/marketing/materials', input);
  return res.data.data as Material;
}

export async function updateMaterial(id: string, input: Partial<Material>) {
  const res = await api.patch(`/marketing/materials/${id}`, input);
  return res.data.data as Material;
}

export async function deleteMaterial(id: string) {
  const res = await api.delete(`/marketing/materials/${id}`);
  return res.data.data;
}

export async function duplicateMaterial(id: string) {
  const res = await api.post(`/marketing/materials/${id}/duplicate`);
  return res.data.data as Material;
}

export async function previewMaterial(
  id: string,
  options: { contactId?: string; variables?: Record<string, string> } = {},
) {
  const res = await api.post(`/marketing/materials/${id}/preview`, options);
  return res.data.data as {
    material: { id: string; name: string; channelType: string; contentType: string };
    rendered: Record<string, unknown>;
    variables: Record<string, string>;
    detectedKeys: string[];
  };
}
