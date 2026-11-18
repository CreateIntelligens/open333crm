'use client';

/**
 * 留言自動私訊規則編輯（planning/01-ux.md §3.2、§3.3；design「API」RuleInput；
 * spec comment-reply-rules、comment-reply-platform-controls「前端隱藏未開放的能力」）。
 *
 * 前端驗證只為了即時提示，後端是權威：後端回 `details.field` 時，錯誤顯示在對應欄位下。
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Info, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAuth, usePermission } from '@/providers/AuthProvider';
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage, getFieldErrors } from '@/lib/api-error';
import { platformLabel, platformOf } from '@/lib/comment-reply/codes';
import type {
  CommentReplyPost,
  CommentReplyReadiness,
  CommentReplyReadinessChannel,
  CommentReplyRuleInput,
  CommentReplyRulePatch,
  CommentReplyRuleView,
} from '@/lib/comment-reply/types';
import {
  createCommentReplyRule,
  fetchCommentReplyPosts,
  resolveCommentReplyPost,
  updateCommentReplyRule,
  useCommentReplyMaterialOptions,
} from '@/hooks/useCommentReplies';
import { CommentReplyTestPhaseCard, isNotReceiving, testPhasePlatforms } from './CommentReplyReadinessCard';
import { CommentReplyTestPanel } from './CommentReplyTestPanel';

const LIST_HREF = '/dashboard/comment-replies';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LEN = 50;
const MAX_POSTS = 50;
const MAX_TEXT = 1000;
const MAX_PUBLIC_TEXT = 300;
const MAX_PUBLIC_TEXTS = 5;
const LEAVE_CONFIRM = '有尚未儲存的變更，確定離開？';

type FieldKey = 'channel' | 'name' | 'keywords' | 'posts' | 'content' | 'publicReply';
const FIELD_ORDER: FieldKey[] = ['channel', 'name', 'keywords', 'posts', 'content', 'publicReply'];

/** 比對用的正規化：與後端一樣 NFKC＋小寫（spec「關鍵字比對方式」） */
function normalizeKeyword(k: string): string {
  return k.normalize('NFKC').toLowerCase().trim();
}

function isShortKeyword(k: string): boolean {
  const n = normalizeKeyword(k);
  return n.length === 1 || /^\d+$/.test(n);
}

function isOlderThan7Days(publishedAt?: string | null): boolean {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) && Date.now() - t > 7 * DAY_MS;
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 後端 details.field（例如 `posts.2`、`channelId`）對應到表單欄位 */
function toFieldKey(field: string | undefined): FieldKey | null {
  if (!field) return null;
  const head = field.split('.')[0];
  if (head === 'channelId') return 'channel';
  return (FIELD_ORDER as string[]).includes(head) ? (head as FieldKey) : null;
}

/** 可開關的 switch（role="switch"） */
function Switch({ id, checked, onChange, label, disabled }: { id?: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

interface FormState {
  channelId: string;
  name: string;
  keywords: string[];
  matchMode: 'any' | 'all';
  postScope: 'all' | 'selected';
  posts: CommentReplyPost[];
  contentType: 'material' | 'text';
  materialId: string;
  text: string;
  dedupePerCommenter: boolean;
  publicEnabled: boolean;
  publicTexts: string[];
  isActive: boolean;
}

function initialState(rule: CommentReplyRuleView | null | undefined, channelId: string, channelType: string | undefined): FormState {
  if (rule) {
    return {
      channelId: rule.channelId,
      name: rule.name,
      keywords: [...rule.keywords],
      matchMode: rule.matchMode,
      postScope: rule.postScope,
      posts: rule.posts.map((p) => ({ ...p })),
      contentType: rule.content.type,
      materialId: rule.content.type === 'material' ? rule.content.materialId ?? '' : '',
      text: rule.content.type === 'text' ? rule.content.text ?? '' : '',
      dedupePerCommenter: rule.dedupePerCommenter,
      publicEnabled: rule.publicReply.enabled,
      publicTexts: rule.publicReply.texts.length > 0 ? [...rule.publicReply.texts] : [''],
      isActive: rule.isActive,
    };
  }
  return {
    channelId,
    name: '',
    keywords: [],
    matchMode: 'any',
    postScope: 'all',
    posts: [],
    // FB 預設素材、IG 預設文字（IG 沒有素材）
    contentType: channelType && platformOf(channelType) === 'ig' ? 'text' : 'material',
    materialId: '',
    text: '',
    dedupePerCommenter: true,
    publicEnabled: false,
    publicTexts: [''],
    isActive: true,
  };
}

function snapshot(s: FormState) {
  return JSON.stringify(s);
}

interface Props {
  readiness: CommentReplyReadiness;
  /** 編輯時傳入；新增時不傳 */
  rule?: CommentReplyRuleView | null;
  /** 新增時預設選的渠道（例如列表目前篩選的渠道） */
  defaultChannelId?: string;
  /** 用來提示「已有同名規則」 */
  existingRules?: CommentReplyRuleView[];
  onSaved?: (rule: CommentReplyRuleView) => void;
}

export function CommentReplyRuleEditor({ readiness, rule, defaultChannelId, existingRules = [], onSaved }: Props) {
  const router = useRouter();
  const { reloadPermissions } = useAuth();
  const canManage = usePermission('comment_reply.manage');
  const uid = useId();

  const [savedRule, setSavedRule] = useState<CommentReplyRuleView | null>(rule ?? null);
  const isEdit = Boolean(savedRule);

  const capabilities = readiness.capabilities;
  const privateReplyOpen = (c: { channelType: string }) =>
    platformOf(c.channelType) === 'ig' ? capabilities.igPrivateReply : capabilities.fbPrivateReply;
  const selectable = readiness.channels.filter((c) => platformOf(c.channelType));
  const enabledChannels = selectable.filter(privateReplyOpen);

  const initialChannelId = useMemo(() => {
    if (rule) return rule.channelId;
    if (defaultChannelId && enabledChannels.some((c) => c.channelId === defaultChannelId)) return defaultChannelId;
    return enabledChannels.length === 1 ? enabledChannels[0].channelId : '';
    // 只在第一次渲染決定預設值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialType = rule?.channel.channelType ?? readiness.channels.find((c) => c.channelId === initialChannelId)?.channelType;

  const [form, setForm] = useState<FormState>(() => initialState(rule, initialChannelId, initialType));
  const [baseline, setBaseline] = useState(() => snapshot(initialState(rule, initialChannelId, initialType)));
  const [keywordInput, setKeywordInput] = useState('');
  const [keywordNotice, setKeywordNotice] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [banner, setBanner] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = snapshot(form) !== baseline;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const channel: CommentReplyReadinessChannel | undefined =
    readiness.channels.find((c) => c.channelId === form.channelId) ??
    (savedRule ? { channelId: savedRule.channelId, channelType: savedRule.channel.channelType, displayName: savedRule.channel.displayName, appMode: 'platform', receiving: true, subscribed: null, missingPermissions: null, canPrivateReply: true, canPublicReply: true } : undefined);
  const platform = channel ? platformOf(channel.channelType) : null;
  const isIg = platform === 'ig';
  const postPickerOpen = platform === 'ig' ? capabilities.igPostPicker : capabilities.fbPostPicker;
  const publicReplyOpen = platform === 'ig' ? capabilities.igPublicReply : platform === 'fb' ? capabilities.fbPublicReply : false;
  const testPhase = channel ? testPhasePlatforms(readiness, [channel]) : [];

  const readOnlyReason = readiness.emergencyStopped
    ? '平台暫停中，暫時不能修改規則'
    : !canManage
      ? '你只有檢視權限，無法修改規則'
      : savedRule && !savedRule.canEdit
        ? '你對這個渠道只有檢視權限，無法修改這條規則'
        : '';
  const readOnly = Boolean(readOnlyReason);

  // 未儲存就離開（重新整理、關閉分頁）
  useEffect(() => {
    if (!dirty || readOnly) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, readOnly]);

  const { options: materialOptions, isLoading: materialsLoading } = useCommentReplyMaterialOptions(
    channel && !isIg && form.contentType === 'material' ? channel.channelId : null,
  );
  const selectedMaterial = materialOptions.find((m) => m.id === form.materialId);

  // ── 渠道 ──
  const changeChannel = (id: string) => {
    const c = readiness.channels.find((x) => x.channelId === id);
    setForm((f) => ({
      ...f,
      channelId: id,
      posts: [],
      materialId: '',
      contentType: c && platformOf(c.channelType) === 'ig' ? 'text' : 'material',
    }));
    setErrors((e) => ({ ...e, channel: undefined }));
  };

  // ── 關鍵字 ──
  const addKeyword = () => {
    const k = keywordInput.trim();
    if (!k) return;
    if (form.keywords.some((x) => normalizeKeyword(x) === normalizeKeyword(k))) {
      setKeywordNotice('已經加入過了');
      return;
    }
    if (k.length > MAX_KEYWORD_LEN) {
      setKeywordNotice(`單一關鍵字最多 ${MAX_KEYWORD_LEN} 字`);
      return;
    }
    if (form.keywords.length >= MAX_KEYWORDS) {
      setKeywordNotice(`最多 ${MAX_KEYWORDS} 個關鍵字`);
      return;
    }
    set('keywords', [...form.keywords, k]);
    setKeywordInput('');
    setKeywordNotice('');
    setErrors((e) => ({ ...e, keywords: undefined }));
  };

  // ── 貼文 ──
  const [recentPosts, setRecentPosts] = useState<CommentReplyPost[]>([]);
  const [postsCursor, setPostsCursor] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState('');
  const [postFilter, setPostFilter] = useState('');
  const [postRef, setPostRef] = useState('');
  const [postRefError, setPostRefError] = useState('');
  const loadedFor = useRef<string | null>(null);

  const loadPosts = useCallback(async (channelId: string, cursor?: string | null) => {
    setPostsLoading(true);
    setPostsError('');
    try {
      const res = await fetchCommentReplyPosts(channelId, cursor);
      setRecentPosts((prev) => (cursor ? [...prev, ...res.posts] : res.posts));
      setPostsCursor(res.nextCursor);
    } catch (err) {
      setPostsError(`讀不到最近貼文：${getApiErrorMessage(err, '請稍後重試')}`);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const channelIdForPosts = channel?.channelId ?? null;
  useEffect(() => {
    if (readOnly || form.postScope !== 'selected' || !channelIdForPosts || !postPickerOpen) return;
    if (loadedFor.current === channelIdForPosts) return;
    loadedFor.current = channelIdForPosts;
    setRecentPosts([]);
    void loadPosts(channelIdForPosts);
  }, [form.postScope, channelIdForPosts, postPickerOpen, readOnly, loadPosts]);

  const isSelected = (postId: string) => form.posts.some((p) => p.postId === postId);
  const togglePost = (post: CommentReplyPost) => {
    if (isSelected(post.postId)) {
      set('posts', form.posts.filter((p) => p.postId !== post.postId));
    } else if (form.posts.length < MAX_POSTS) {
      set('posts', [...form.posts, post]);
      setErrors((e) => ({ ...e, posts: undefined }));
    }
  };
  const addPostRef = async () => {
    const raw = postRef.trim();
    if (!raw || !channel) return;
    setPostRefError('');
    if (form.posts.length >= MAX_POSTS) {
      setPostRefError(`最多 ${MAX_POSTS} 篇貼文`);
      return;
    }
    if (!postPickerOpen) {
      // 平台未開放貼文挑選：只能手動填貼文 ID（後端以外掛的 parsePostReference 正規化）
      if (!isSelected(raw)) set('posts', [...form.posts, { postId: raw }]);
      setPostRef('');
      setErrors((e) => ({ ...e, posts: undefined }));
      return;
    }
    try {
      const post = await resolveCommentReplyPost(channel.channelId, raw);
      if (!isSelected(post.postId)) set('posts', [...form.posts, post]);
      setPostRef('');
      setErrors((e) => ({ ...e, posts: undefined }));
    } catch (err) {
      setPostRefError(
        getApiErrorCode(err) === 'POST_NOT_FOUND'
          ? '找不到這篇貼文。請確認是這個粉專（或 IG 帳號）發布的貼文；廣告貼文請貼上廣告預覽網址'
          : getApiErrorMessage(err, '無法加入這篇貼文，請稍後重試'),
      );
    }
  };
  const filteredPosts = postFilter.trim()
    ? recentPosts.filter((p) => (p.excerpt ?? '').toLowerCase().includes(postFilter.trim().toLowerCase()))
    : recentPosts;

  // ── 驗證 ──
  const validate = (): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!form.channelId) e.channel = '請選擇粉專或 IG 帳號';
    if (!form.name.trim()) e.name = '請輸入規則名稱';
    if (form.keywords.length === 0) e.keywords = '至少要 1 個關鍵字';
    if (form.postScope === 'selected' && form.posts.length === 0) e.posts = '請至少選擇 1 篇貼文';
    const hasContent = form.contentType === 'material' && !isIg ? Boolean(form.materialId) : Boolean(form.text.trim());
    if (!hasContent) e.content = '請選擇素材或輸入私訊文字';
    if (publicReplyOpen && form.publicEnabled && form.publicTexts.every((t) => !t.trim())) {
      e.publicReply = '請輸入公開回覆的文字，或關閉公開回覆';
    }
    return e;
  };

  const focusField = (field: FieldKey) => {
    const ids: Record<FieldKey, string> = {
      channel: `${uid}-channel`,
      name: `${uid}-name`,
      keywords: `${uid}-keyword`,
      posts: `${uid}-posts`,
      content: form.contentType === 'material' && !isIg ? `${uid}-material` : `${uid}-text`,
      publicReply: `${uid}-public-0`,
    };
    document.getElementById(ids[field])?.focus();
  };

  const buildBody = (): CommentReplyRulePatch => ({
    name: form.name.trim(),
    keywords: form.keywords,
    matchMode: form.keywords.length > 1 ? form.matchMode : 'any',
    postScope: form.postScope,
    // unavailable 只做顯示，不送後端
    posts: form.postScope === 'selected' ? form.posts.map((p) => ({ postId: p.postId, permalink: p.permalink, thumbnailUrl: p.thumbnailUrl, excerpt: p.excerpt, publishedAt: p.publishedAt })) : [],
    content: form.contentType === 'material' && !isIg ? { type: 'material', materialId: form.materialId } : { type: 'text', text: form.text.trim() },
    dedupePerCommenter: form.dedupePerCommenter,
    publicReply:
      publicReplyOpen && form.publicEnabled
        ? { enabled: true, texts: form.publicTexts.map((t) => t.trim()).filter(Boolean) }
        : { enabled: false, texts: [] },
    isActive: form.isActive,
  });

  const applyServerError = async (err: unknown) => {
    const code = getApiErrorCode(err);
    const details = getApiErrorDetails(err);
    const message = getApiErrorMessage(err, '儲存失敗，請稍後重試');
    const field = toFieldKey(typeof details?.field === 'string' ? details.field : undefined);

    if (code === 'COUPON_URL_IN_RULE_MESSAGE') {
      setErrors({ content: `${message}。留言私訊送出時還沒有顧客資料，請改用「回覆關鍵字領券」的玩法。` });
      focusField('content');
      return;
    }
    if (code === 'MATERIAL_UNSUPPORTED') {
      setErrors({ content: '這個素材的類型不能用於留言私訊，請改選文字、圖片或按鈕範本素材。' });
      focusField('content');
      return;
    }
    if (code === 'PLAN_LIMIT_EXCEEDED') {
      const max = details?.max;
      setBanner({
        tone: 'error',
        text: typeof max === 'number'
          ? `啟用中的留言規則已達方案上限（${max} 條）。可以先以停用狀態儲存，或洽管理員升級方案。`
          : '啟用中的留言規則已達方案上限。可以先以停用狀態儲存，或洽管理員升級方案。',
      });
      return;
    }
    if (code === 'CHANNEL_ACCESS_DENIED') {
      setBanner({ tone: 'error', text: '你對這個渠道只有檢視權限，無法儲存這條規則' });
      return;
    }
    if (code === 'FORBIDDEN') {
      setBanner({ tone: 'error', text: '你沒有權限執行這個動作' });
      await reloadPermissions();
      return;
    }
    if (field) {
      setErrors({ [field]: message });
      focusField(field);
      return;
    }
    // Zod 的逐欄位錯誤（details.issues）
    const issues = getFieldErrors(err);
    const mapped: Partial<Record<FieldKey, string>> = {};
    for (const [path, msg] of Object.entries(issues)) {
      const key = toFieldKey(path);
      if (key && !mapped[key]) mapped[key] = msg;
    }
    if (Object.keys(mapped).length > 0) {
      setErrors(mapped);
      return;
    }
    setBanner({ tone: 'error', text: message });
  };

  const save = async () => {
    setBanner(null);
    const e = validate();
    setErrors(e);
    const first = FIELD_ORDER.find((f) => e[f]);
    if (first) {
      focusField(first);
      return;
    }
    setSaving(true);
    try {
      const body = buildBody();
      const saved = savedRule
        ? await updateCommentReplyRule(savedRule.id, body)
        : await createCommentReplyRule({ ...body, channelId: form.channelId } as CommentReplyRuleInput);
      setBaseline(snapshot(form));
      setBanner({ tone: 'success', text: (saved.isActive ?? form.isActive) ? '已儲存，規則已啟用' : '已儲存，規則目前停用' });
      if (!savedRule) {
        setSavedRule(saved);
        // 不重新掛載頁面，只更新網址，成功訊息才不會消失
        window.history.replaceState(null, '', `${LIST_HREF}/${saved.id}`);
      } else {
        setSavedRule((prev) => ({ ...(prev as CommentReplyRuleView), ...saved }));
      }
      onSaved?.(saved);
    } catch (err) {
      await applyServerError(err);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty && !readOnly && !window.confirm(LEAVE_CONFIRM)) return;
    router.push(LIST_HREF);
  };

  const errorCount = FIELD_ORDER.filter((f) => errors[f]).length;
  const duplicateName =
    form.name.trim() &&
    existingRules.some((r) => r.id !== savedRule?.id && r.channelId === form.channelId && r.name.trim() === form.name.trim());

  const previewText =
    form.contentType === 'material' && !isIg ? selectedMaterial?.preview ?? selectedMaterial?.name ?? '' : form.text;
  const publicPreview = form.publicTexts.find((t) => t.trim()) ?? '';
  const senderName = channel?.displayName ?? '粉專';

  return (
    <div className="space-y-4">
      <div>
        <Link href={LIST_HREF} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={(e) => {
          if (dirty && !readOnly && !window.confirm(LEAVE_CONFIRM)) e.preventDefault();
        }}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          返回留言自動私訊
        </Link>
      </div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{isEdit ? (readOnly ? '留言自動私訊規則' : '編輯留言自動私訊規則') : '建立留言自動私訊規則'}</h1>
        <label className="flex items-center gap-2 text-sm">
          <span>啟用</span>
          <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="啟用" disabled={readOnly} />
        </label>
      </header>

      {readOnlyReason && (
        <div className={cn('rounded-md border px-4 py-2 text-sm', readiness.emergencyStopped ? 'border-destructive/30 bg-destructive-subtle text-destructive' : 'border-border bg-muted text-muted-foreground')}>
          {readOnlyReason}
        </div>
      )}
      <CommentReplyTestPhaseCard platforms={testPhase} />

      {banner && (
        <div role={banner.tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md px-4 py-2 text-sm', banner.tone === 'error' ? 'bg-destructive-subtle text-destructive' : 'bg-success-subtle text-success')}>
          {banner.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <fieldset disabled={readOnly} className="min-w-0 space-y-5 rounded-lg border border-border bg-white p-5 lg:col-span-3">
          <legend className="sr-only">規則設定</legend>

          {/* (1) 渠道 */}
          <div id="cr-field-channel">
            {isEdit ? (
              <>
                <div className="text-sm font-medium">粉專或 IG 帳號</div>
                <p className="mt-1 text-sm">{channel ? `${platformLabel(channel.channelType)} · ${channel.displayName}` : ''}</p>
                <p className="mt-1 text-xs text-muted-foreground">渠道建立後不能更改；要換渠道請刪除後重新建立</p>
              </>
            ) : (
              <>
                <label htmlFor={`${uid}-channel`} className="text-sm font-medium">粉專或 IG 帳號</label>
                <select
                  id={`${uid}-channel`}
                  disabled={readOnly}
                  value={form.channelId}
                  onChange={(e) => changeChannel(e.target.value)}
                  aria-invalid={Boolean(errors.channel)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                >
                  <option value="" disabled>請選擇粉專或 IG 帳號</option>
                  {(['fb', 'ig'] as const).map((p) => {
                    const group = selectable.filter((c) => platformOf(c.channelType) === p);
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={p} label={p === 'fb' ? 'Facebook 粉專' : 'Instagram 帳號'}>
                        {group.map((c) => (
                          <option key={c.channelId} value={c.channelId} disabled={!privateReplyOpen(c)}>
                            {privateReplyOpen(c) ? c.displayName : `${c.displayName}（平台尚未開放）`}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">規則只對這一個粉專（或 IG 帳號）的貼文留言生效。</p>
              </>
            )}
            {channel && isNotReceiving(channel) && (
              <p className="mt-1 text-xs text-warning">這個帳號尚未開啟留言接收，留言不會觸發規則。可以先設定好，開啟接收後就會生效。</p>
            )}
            <FieldError message={errors.channel} />
          </div>

          {/* (2) 規則名稱 */}
          <div id="cr-field-name">
            <label htmlFor={`${uid}-name`} className="text-sm font-medium">規則名稱</label>
            <Input
              id={`${uid}-name`}
              disabled={readOnly}
              className="mt-1"
              value={form.name}
              maxLength={200}
              placeholder="例：雙 11 留 +1 送券、詢問價格"
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => {
                set('name', e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">只給管理用，顧客不會看到</p>
            {duplicateName && <p className="mt-1 text-xs text-warning">已有同名規則</p>}
            <FieldError message={errors.name} />
          </div>

          {/* (3) 關鍵字 (4) 比對方式 */}
          <div id="cr-field-keywords">
            <label htmlFor={`${uid}-keyword`} className="text-sm font-medium">關鍵字</label>
            {form.keywords.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {form.keywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-subtle px-2 py-0.5 text-xs text-primary">
                    {k}
                    {!readOnly && (
                      <button type="button" aria-label={`移除關鍵字「${k}」`} onClick={() => set('keywords', form.keywords.filter((x) => x !== k))}>
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {!readOnly && (
              <div className="mt-1 flex gap-2">
                <Input
                  id={`${uid}-keyword`}
                  value={keywordInput}
                  maxLength={MAX_KEYWORD_LEN + 10}
                  placeholder="輸入關鍵字後按 Enter"
                  onChange={(e) => {
                    setKeywordInput(e.target.value);
                    setKeywordNotice('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addKeyword}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  加入
                </Button>
              </div>
            )}
            {keywordNotice && <p className="mt-1 text-xs text-warning">{keywordNotice}</p>}
            {form.keywords.some(isShortKeyword) && (
              <p className="mt-1 text-xs text-warning">這個關鍵字很短，留言中只要包含它就會觸發，例如「1」也會命中「100 元」。</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">比對方式是「包含」且不分大小寫與全形半形。例如關鍵字「+1」也會命中「我要 +1」。</p>
            <FieldError message={errors.keywords} />
            {form.keywords.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="比對方式">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={`${uid}-match`} checked={form.matchMode === 'any'} onChange={() => set('matchMode', 'any')} />
                  任一關鍵字出現就觸發
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={`${uid}-match`} checked={form.matchMode === 'all'} onChange={() => set('matchMode', 'all')} />
                  所有關鍵字都要出現才觸發
                </label>
              </div>
            )}
          </div>

          {/* (5) 貼文範圍 */}
          <div id="cr-field-posts">
            <div className="text-sm font-medium" id={`${uid}-posts-label`}>貼文範圍</div>
            <div className="mt-1 space-y-1 text-sm" role="radiogroup" aria-labelledby={`${uid}-posts-label`}>
              <label className="flex items-center gap-1.5">
                <input type="radio" name={`${uid}-scope`} checked={form.postScope === 'all'} onChange={() => set('postScope', 'all')} />
                全部貼文
                <span className="text-xs text-muted-foreground">（包含之後發布的新貼文與廣告貼文的留言）</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input id={`${uid}-posts`} type="radio" name={`${uid}-scope`} checked={form.postScope === 'selected'} onChange={() => set('postScope', 'selected')} />
                指定貼文
              </label>
            </div>
            {form.postScope === 'selected' && (
              <div className="mt-2 space-y-3 rounded-md border border-border p-3">
                <div>
                  <div className="text-xs font-medium">已選 {form.posts.length} 篇</div>
                  {form.posts.length > 0 && (
                    <ul className="mt-1 divide-y divide-border">
                      {form.posts.map((p) => (
                        <li key={p.postId} className="py-1.5 text-sm">
                          <div className="flex items-center gap-2">
                            {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                            <span className="min-w-0 flex-1 truncate">{p.excerpt ? p.excerpt.slice(0, 40) : p.postId}</span>
                            <span className="text-xs text-muted-foreground">{formatDate(p.publishedAt)}</span>
                            {p.permalink && (
                              <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-primary">
                                在 {isIg ? 'Instagram' : 'Facebook'} 開啟
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            )}
                            {!readOnly && (
                              <button type="button" className="text-xs text-destructive" onClick={() => togglePost(p)} aria-label={`移除貼文「${p.excerpt ?? p.postId}」`}>
                                移除
                              </button>
                            )}
                          </div>
                          {p.unavailable && <p className="text-xs text-warning">讀不到這篇貼文（可能已刪除）</p>}
                          {isOlderThan7Days(p.publishedAt) && (
                            <p className="text-xs text-warning">這篇貼文已發布超過 7 天，之前的留言不會私訊，只有新留言會觸發。</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {!readOnly && channel && postPickerOpen && (
                  <div className="space-y-2 border-t border-border pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium">從最近貼文挑選</span>
                      <Input value={postFilter} onChange={(e) => setPostFilter(e.target.value)} placeholder="搜尋貼文內文" aria-label="搜尋貼文內文" className="h-9 max-w-[200px]" />
                    </div>
                    {postsError && <p className="text-xs text-destructive">{postsError}</p>}
                    <ul className="max-h-64 space-y-1 overflow-y-auto">
                      {filteredPosts.map((p) => (
                        <li key={p.postId}>
                          <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                            <input type="checkbox" checked={isSelected(p.postId)} onChange={() => togglePost(p)} />
                            {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                            <span className="min-w-0 flex-1 truncate">{p.excerpt || p.postId}</span>
                            <span className="text-xs text-muted-foreground">{formatDate(p.publishedAt)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {postsLoading && <p className="text-xs text-muted-foreground">載入中…</p>}
                    {postsCursor && !postsLoading && (
                      <Button type="button" variant="outline" size="sm" onClick={() => loadPosts(channel.channelId, postsCursor)}>
                        載入更多
                      </Button>
                    )}
                  </div>
                )}

                {!readOnly && channel && (
                  <div className="border-t border-border pt-2">
                    <label htmlFor={`${uid}-post-ref`} className="text-xs font-medium">
                      {postPickerOpen ? '或貼上貼文網址' : '貼文 ID 或網址'}
                    </label>
                    <div className="mt-1 flex gap-2">
                      <Input id={`${uid}-post-ref`} value={postRef} maxLength={2000} onChange={(e) => setPostRef(e.target.value)} />
                      <Button type="button" variant="outline" onClick={addPostRef}>加入貼文</Button>
                    </div>
                    {!postPickerOpen && <p className="mt-1 text-xs text-muted-foreground">平台尚未開放從最近貼文挑選，請手動填入貼文 ID。</p>}
                    {postRefError && <p className="mt-1 text-xs text-destructive">{postRefError}</p>}
                  </div>
                )}
              </div>
            )}
            <FieldError message={errors.posts} />
          </div>

          {/* (6) 私訊內容 */}
          <div id="cr-field-content">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">私訊內容</span>
              <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label="私訊內容類型">
                <button
                  type="button"
                  aria-pressed={form.contentType === 'material' && !isIg}
                  disabled={isIg}
                  onClick={() => set('contentType', 'material')}
                  className={cn('rounded px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50', form.contentType === 'material' && !isIg ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                >
                  素材
                </button>
                <button
                  type="button"
                  aria-pressed={form.contentType === 'text' || isIg}
                  onClick={() => set('contentType', 'text')}
                  className={cn('rounded px-3 py-1 text-xs', form.contentType === 'text' || isIg ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                >
                  文字
                </button>
              </div>
            </div>
            {isIg && <p className="mt-1 text-xs text-muted-foreground">Instagram 目前沒有素材，只能用文字</p>}
            {form.contentType === 'material' && !isIg ? (
              <div className="mt-2">
                <label htmlFor={`${uid}-material`} className="sr-only">選擇素材</label>
                <select
                  id={`${uid}-material`}
                  disabled={readOnly}
                  value={form.materialId}
                  onChange={(e) => {
                    set('materialId', e.target.value);
                    setErrors((x) => ({ ...x, content: undefined }));
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                >
                  <option value="">{channel ? (materialsLoading ? '載入中…' : '請選擇素材') : '請先選擇粉專'}</option>
                  {materialOptions.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {channel && !materialsLoading && materialOptions.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    這個粉專沒有可用於留言私訊的素材，請到<Link href="/dashboard/marketing/materials" className="text-primary underline">素材庫</Link>建立，或改用文字。
                  </p>
                )}
                {selectedMaterial?.preview?.includes('{{') && (
                  <p className="mt-1 text-xs text-warning">留言私訊送出時通常還沒有聯絡人資料，變數會用素材的預設值；沒有預設值則留空。</p>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <label htmlFor={`${uid}-text`} className="sr-only">私訊文字</label>
                <Textarea
                  id={`${uid}-text`}
                  disabled={readOnly}
                  rows={4}
                  maxLength={MAX_TEXT}
                  value={form.text}
                  onChange={(e) => {
                    set('text', e.target.value);
                    setErrors((x) => ({ ...x, content: undefined }));
                  }}
                />
                <p className="mt-0.5 text-right text-xs text-muted-foreground">{form.text.length}／{MAX_TEXT}</p>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">每則留言只能私訊一次，而且要在留言後 7 天內。顧客回覆這則私訊後，對話才會進收件匣。</p>
            {errors.content && (
              <p className="mt-1 text-xs text-destructive">
                {errors.content}
                {errors.content.includes('回覆關鍵字領券') && (
                  <>
                    {' '}
                    <Link href="/dashboard/line/keyword-replies" className="underline">前往關鍵字回覆</Link>
                  </>
                )}
              </p>
            )}
          </div>

          {/* (7) 同一位留言者只私訊一次 */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">同一位留言者只私訊一次</div>
              <p className="text-xs text-muted-foreground">開啟時，同一個人在這條規則的範圍內留言多次，只會收到第一次的私訊；後面的留言會記為「已私訊過」。</p>
            </div>
            <Switch checked={form.dedupePerCommenter} onChange={(v) => set('dedupePerCommenter', v)} label="同一位留言者只私訊一次" />
          </div>

          {/* (8) 公開回覆：平台未開放時整個區塊不顯示 */}
          {publicReplyOpen && (
            <div id="cr-field-publicReply">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">同時公開回覆這則留言</div>
                  <p className="text-xs text-muted-foreground">公開回覆會以粉專身分留在貼文底下，所有人都看得到。請不要在這裡放價格或個人資料。私訊沒有送出時，也不會公開回覆。</p>
                </div>
                <Switch
                  checked={form.publicEnabled}
                  onChange={(v) => {
                    set('publicEnabled', v);
                    setErrors((x) => ({ ...x, publicReply: undefined }));
                  }}
                  label="同時公開回覆這則留言"
                  disabled={channel?.canPublicReply === false}
                />
              </div>
              {channel?.canPublicReply === false && (
                <p className="mt-1 text-xs text-warning">需要重新連結 Facebook 並同意「管理貼文互動」權限，才能公開回覆。</p>
              )}
              {form.publicEnabled && channel?.canPublicReply !== false && (
                <div className="mt-2 space-y-2">
                  {form.publicTexts.map((t, i) => (
                    <div key={i} className="flex gap-2">
                      <Textarea
                        id={`${uid}-public-${i}`}
                        aria-label={`公開回覆文字 ${i + 1}`}
                        disabled={readOnly}
                        rows={2}
                        maxLength={MAX_PUBLIC_TEXT}
                        value={t}
                        onChange={(e) => {
                          const next = [...form.publicTexts];
                          next[i] = e.target.value;
                          set('publicTexts', next);
                          setErrors((x) => ({ ...x, publicReply: undefined }));
                        }}
                      />
                      {form.publicTexts.length > 1 && (
                        <button type="button" aria-label={`移除公開回覆文字 ${i + 1}`} className="text-xs text-destructive" onClick={() => set('publicTexts', form.publicTexts.filter((_, j) => j !== i))}>
                          移除
                        </button>
                      )}
                    </div>
                  ))}
                  {form.publicTexts.length < MAX_PUBLIC_TEXTS && (
                    <Button type="button" variant="outline" size="sm" onClick={() => set('publicTexts', [...form.publicTexts, ''])}>
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                      新增一則（輪流使用）
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">同一段文字在同一篇貼文下重複太多次，可能被 Meta 判定為垃圾留言；多寫幾則會輪流使用。</p>
                </div>
              )}
              <FieldError message={errors.publicReply} />
            </div>
          )}
        </fieldset>

        {/* 右欄預覽 */}
        <aside className="space-y-3 lg:col-span-2">
          <div className="rounded-lg border border-border bg-white p-4 lg:sticky lg:top-4">
            <div className="text-sm font-semibold">顧客會收到</div>
            <div className="mt-2 rounded-md bg-muted p-3">
              <div className="text-xs text-muted-foreground">{senderName}</div>
              <div className="mt-1 whitespace-pre-wrap rounded-lg rounded-tl-none border border-border bg-card px-3 py-2 text-sm shadow-bubble">
                {previewText || <span className="text-muted-foreground">（尚未設定私訊內容）</span>}
              </div>
            </div>
            {publicReplyOpen && form.publicEnabled && publicPreview && (
              <>
                <div className="mt-3 text-sm font-semibold">公開回覆（貼文底下所有人看得到）</div>
                <div className="mt-1 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium">{senderName}：</span>
                  {publicPreview}
                </div>
              </>
            )}
            <p className="mt-3 flex gap-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              顧客回覆私訊後，24 小時內客服可以在收件匣繼續回覆。顧客沒有回覆前，不能再傳第二則訊息。
            </p>
          </div>
        </aside>
      </div>

      <CommentReplyTestPanel
        channels={selectable.map((c) => ({ channelId: c.channelId, channelType: c.channelType, displayName: c.displayName }))}
        defaultChannelId={form.channelId || undefined}
      />

      <div className="sticky bottom-0 -mx-6 border-t border-border bg-muted/95 px-6 py-3 backdrop-blur">
        {errorCount > 0 && <p className="mb-2 text-right text-sm text-destructive">有 {errorCount} 個欄位需要修正</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={cancel}>{readOnly ? '返回' : '取消'}</Button>
          {!readOnly && (
            <Button type="button" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              儲存
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
