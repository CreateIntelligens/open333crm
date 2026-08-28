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
  categoryId: string | null;
  tags: string[];
  status: string;
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
  materialCategory?: { id: string; name: string } | null;
}

export type MaterialSort = 'recent_used' | 'most_used' | 'updated' | 'name';

export interface MaterialCategoryNode {
  id: string;
  tenantId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  materialCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialVersionEntry {
  id: string;
  materialId: string;
  versionNo: number;
  name: string;
  body: Record<string, unknown>;
  editedById: string | null;
  createdAt: string;
}

export interface MaterialStats {
  materialId: string;
  usageCount: number;
  lastUsedAt: string | null;
  replyCount: number;
  casesOpened: number;
  clickThroughRate: number | null;
}

interface MaterialFilters {
  channelType?: string;
  category?: string;
  categoryId?: string;
  tags?: string[];
  status?: string;
  sort?: MaterialSort;
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
  const { channelType, category, categoryId, tags, status, sort, q, isActive, page = 1, limit = 50 } = filters;
  const params = new URLSearchParams();
  if (channelType) params.set('channelType', channelType);
  if (category) params.set('category', category);
  if (categoryId) params.set('categoryId', categoryId);
  if (tags && tags.length > 0) params.set('tags', tags.join(','));
  if (status) params.set('status', status);
  if (sort) params.set('sort', sort);
  if (q) params.set('q', q);
  if (isActive !== undefined) params.set('isActive', String(isActive));
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/marketing/materials?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    materials: (data?.data || []) as Material[],
    meta: data?.meta as { total: number; page: number; limit: number; totalPages: number; maxUsageCount?: number } | undefined,
    isLoading,
    error,
    mutate,
  };
}

// ─── 分類樹 ───────────────────────────────────────────────────────────────

export function useMaterialCategoryTree() {
  const { data, error, isLoading, mutate } = useSWR('/marketing/materials/category-tree', fetcher);
  return {
    categories: (data?.data || []) as MaterialCategoryNode[],
    isLoading,
    error,
    mutate,
  };
}

export async function createMaterialCategory(input: { name: string; parentId?: string | null; sortOrder?: number }) {
  const res = await api.post('/marketing/materials/categories', input);
  return res.data.data as MaterialCategoryNode;
}

export async function updateMaterialCategory(id: string, input: { name?: string; parentId?: string | null; sortOrder?: number }) {
  const res = await api.patch(`/marketing/materials/categories/${id}`, input);
  return res.data.data as MaterialCategoryNode;
}

export async function deleteMaterialCategory(id: string) {
  const res = await api.delete(`/marketing/materials/categories/${id}`);
  return res.data.data;
}

// ─── 標籤 ─────────────────────────────────────────────────────────────────

export function useMaterialTags() {
  const { data, isLoading, mutate } = useSWR('/marketing/materials/tags', fetcher);
  return { tags: (data?.data || []) as string[], isLoading, mutate };
}

// ─── 版本歷史 ─────────────────────────────────────────────────────────────

export function useMaterialVersions(id: string | null | undefined) {
  const key = id ? `/marketing/materials/${id}/versions` : null;
  const { data, isLoading, mutate } = useSWR(key, fetcher);
  return { versions: (data?.data || []) as MaterialVersionEntry[], isLoading, mutate };
}

export async function restoreMaterialVersion(id: string, versionNo: number) {
  const res = await api.post(`/marketing/materials/${id}/versions/${versionNo}/restore`);
  return res.data.data as Material;
}

// ─── 成效 ─────────────────────────────────────────────────────────────────

export function useMaterialStats(id: string | null | undefined) {
  const key = id ? `/marketing/materials/${id}/stats` : null;
  const { data, isLoading } = useSWR(key, fetcher);
  return { stats: data?.data as MaterialStats | undefined, isLoading };
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
  categoryId?: string | null;
  tags?: string[];
  status?: string;
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
