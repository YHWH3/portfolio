'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useWs } from '@/lib/ws';
import StatCard from '@/components/StatCard';
import Badge, { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Spinner, { PageLoader } from '@/components/Spinner';
import type {
  Campaign,
  Conversation,
  ConversationDetail,
  ConversationStatus,
  InboxMessage,
  InboxStats,
  Paginated,
  ReplySuggestion,
  WsNewReply,
} from '@/lib/types';

const STATUS_FILTERS: ('' | ConversationStatus)[] = [
  '',
  'active',
  'hot_lead',
  'booked',
  'archived',
];

const APPROACH_META: Record<
  ReplySuggestion['approach'],
  { label: string; description: string; color: string }
> = {
  direct: {
    label: 'Direct',
    description: 'Straight to the ask',
    color: 'border-indigo-300 bg-indigo-50',
  },
  value_add: {
    label: 'Value-add',
    description: 'Lead with something useful',
    color: 'border-emerald-300 bg-emerald-50',
  },
  soft: {
    label: 'Soft',
    description: 'Low-pressure nudge',
    color: 'border-amber-300 bg-amber-50',
  },
};

function priorityColor(score: number): string {
  if (score >= 80) return 'bg-red-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-slate-300';
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sentimentChip(score: number | null): { label: string; color: 'green' | 'red' | 'slate' } | null {
  if (score === null || score === undefined) return null;
  if (score > 0.2) return { label: `😊 positive`, color: 'green' };
  if (score < -0.2) return { label: `😟 negative`, color: 'red' };
  return { label: '😐 neutral', color: 'slate' };
}

export default function InboxPage() {
  const toast = useToast();
  const { subscribe } = useWs();

  const [stats, setStats] = useState<InboxStats | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [loadingList, setLoadingList] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<ReplySuggestion[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.get<InboxStats>('/api/v1/inbox/stats'));
    } catch {
      // non-critical
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (campaignFilter) params.set('campaign_id', campaignFilter);
      const qs = params.toString();
      const res = await api.get<Conversation[]>(
        `/api/v1/inbox${qs ? `?${qs}` : ''}`
      );
      setConversations(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load inbox');
    } finally {
      setLoadingList(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, campaignFilter]);

  const loadDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      setSuggestions(null);
      try {
        const res = await api.get<ConversationDetail>(`/api/v1/inbox/${id}`);
        setDetail(res);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to load conversation'
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    loadStats();
    api
      .get<Paginated<Campaign>>('/api/v1/campaigns?page=1&page_size=100')
      .then((res) => setCampaigns(res.items))
      .catch(() => {});
  }, [loadStats]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages.length]);

  // Live updates via websocket
  useEffect(() => {
    return subscribe((event) => {
      if (event.event === 'inbox.new_reply') {
        const data = event.data as WsNewReply;
        loadList();
        loadStats();
        if (selectedIdRef.current === data.conversation_id && data.message) {
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  messages: prev.messages.some((m) => m.id === data.message.id)
                    ? prev.messages
                    : [...prev.messages, data.message],
                }
              : prev
          );
        }
      } else if (
        event.event === 'inbox.status_change' ||
        event.event === 'inbox.hot_lead'
      ) {
        loadList();
        loadStats();
      }
    });
  }, [subscribe, loadList, loadStats]);

  const fetchSuggestions = async () => {
    if (!selectedId) return;
    setLoadingSuggestions(true);
    try {
      const res = await api.get<{ suggestions: ReplySuggestion[] }>(
        `/api/v1/inbox/${selectedId}/suggestions`
      );
      setSuggestions(res.suggestions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to get suggestions');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const sendReply = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/v1/inbox/${selectedId}/reply`, { content: reply.trim() });
      const optimistic: InboxMessage = {
        id: `local-${Date.now()}`,
        sender_type: 'user',
        content: reply.trim(),
        sentiment_score: null,
        intent_class: null,
        created_at: new Date().toISOString(),
      };
      setDetail((prev) =>
        prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev
      );
      setReply('');
      setSuggestions(null);
      toast.success('Reply sent');
      loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const leadName = (c: Conversation) =>
    c.lead?.name ||
    [c.lead?.first_name, c.lead?.last_name].filter(Boolean).join(' ') ||
    'Unknown lead';

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 grid grid-cols-3 gap-4">
        <StatCard label="Active conversations" value={stats ? stats.active : '—'} />
        <StatCard label="Hot leads" value={stats ? stats.hot_leads : '—'} accent="red" />
        <StatCard
          label="Needs attention"
          value={stats ? stats.needs_attention : '—'}
          accent="amber"
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: conversation list */}
        <div className="flex w-80 shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-2 border-b border-slate-200 p-3">
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
                    statusFilter === s
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s ? s.replace('_', ' ') : 'All'}
                </button>
              ))}
            </div>
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                No conversations match.
              </p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`block w-full border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 ${
                    selectedId === c.id ? 'bg-indigo-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${priorityColor(c.priority_score)}`}
                      title={`Priority ${Math.round(c.priority_score)}`}
                    />
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {leadName(c)}
                    </span>
                    {c.status === 'hot_lead' && (
                      <span title="Hot lead" className="text-sm">
                        🔥
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                      {timeAgo(c.last_message_at)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {c.last_message_preview}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: thread */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon="💬"
                title="Select a conversation"
                description="Pick a thread on the left to read the exchange and reply."
              />
            </div>
          ) : loadingDetail || !detail ? (
            <PageLoader label="Loading conversation…" />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {leadName(detail.conversation)}
                    {detail.conversation.status === 'hot_lead' && ' 🔥'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[detail.conversation.lead?.title, detail.conversation.lead?.company]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={detail.conversation.status} />
                  <Badge color="slate">
                    priority {Math.round(detail.conversation.priority_score)}
                  </Badge>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {detail.messages.map((m) => {
                  const isUser = m.sender_type === 'user';
                  const sentiment = !isUser ? sentimentChip(m.sentiment_score) : null;
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          isUser
                            ? 'rounded-br-sm bg-indigo-600 text-white'
                            : 'rounded-bl-sm bg-slate-100 text-slate-800'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        <div
                          className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] ${
                            isUser ? 'text-indigo-200' : 'text-slate-400'
                          }`}
                        >
                          <span>
                            {new Date(m.created_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                          {!isUser && m.intent_class && (
                            <Badge color="blue">{m.intent_class.replace(/_/g, ' ')}</Badge>
                          )}
                          {sentiment && (
                            <Badge color={sentiment.color}>{sentiment.label}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-slate-200 p-3">
                {suggestions && (
                  <div className="mb-3 grid gap-2 sm:grid-cols-3">
                    {suggestions.map((s) => {
                      const meta = APPROACH_META[s.approach] ?? {
                        label: s.approach,
                        description: '',
                        color: 'border-slate-300 bg-slate-50',
                      };
                      return (
                        <button
                          key={s.approach}
                          onClick={() => setReply(s.content)}
                          className={`rounded-xl border p-3 text-left transition hover:shadow-md ${meta.color}`}
                        >
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
                            {meta.label}
                          </p>
                          <p className="text-[11px] text-slate-500">{meta.description}</p>
                          <p className="mt-1.5 line-clamp-4 text-xs text-slate-700">
                            {s.content}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder="Write a reply, or get AI suggestions and edit before sending…"
                    className="flex-1 resize-y rounded-lg border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={fetchSuggestions}
                      disabled={loadingSuggestions}
                      className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {loadingSuggestions ? (
                        <Spinner size="sm" />
                      ) : (
                        <span>✨</span>
                      )}
                      Suggest replies
                    </button>
                    <button
                      onClick={sendReply}
                      disabled={sending || !reply.trim()}
                      className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {sending && (
                        <Spinner size="sm" className="border-white/40 border-t-white" />
                      )}
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
