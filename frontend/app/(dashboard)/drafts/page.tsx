'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useWs } from '@/lib/ws';
import StatCard from '@/components/StatCard';
import Badge, { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Spinner, { PageLoader } from '@/components/Spinner';
import Pagination from '@/components/Pagination';
import type {
  Campaign,
  Draft,
  DraftStats,
  DraftStatus,
  Paginated,
} from '@/lib/types';

const STATUS_OPTIONS: { value: '' | DraftStatus; label: string }[] = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'edited_and_approved', label: 'Edited & approved' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: '', label: 'All statuses' },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function DraftCard({
  draft,
  selected,
  onToggleSelect,
  onApprove,
  onSkip,
  onSaveEdit,
}: {
  draft: Draft;
  selected: boolean;
  onToggleSelect: () => void;
  onApprove: () => Promise<void>;
  onSkip: () => Promise<void>;
  onSaveEdit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(draft.human_edit ?? draft.ai_draft);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [acting, setActing] = useState<'approve' | 'skip' | null>(null);
  const debounceRef = useRef<number | null>(null);
  const edited = text !== draft.ai_draft;

  const handleChange = (value: string) => {
    setText(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSaving('saving');
      try {
        await onSaveEdit(value);
        setSaving('saved');
        window.setTimeout(() => setSaving('idle'), 2000);
      } catch {
        setSaving('idle');
      }
    }, 700);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const hooks = draft.personalization_hooks || {};

  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md ${
        selected ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          aria-label={`Select draft for ${draft.lead.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {draft.lead.name}
              </p>
              <p className="text-xs text-slate-500">
                {[draft.lead.title, draft.lead.company].filter(Boolean).join(' · ')}
              </p>
              {draft.lead.headline && (
                <p className="mt-0.5 truncate text-xs italic text-slate-400">
                  “{draft.lead.headline}”
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={draft.status} />
              <span className="text-xs text-slate-400">
                Scheduled: {formatDateTime(draft.scheduled_for)}
              </span>
            </div>
          </div>

          {Object.keys(hooks).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(hooks).map(([key, value]) => (
                <Badge key={key} color="indigo" title={`${key}: ${value}`}>
                  <span className="font-semibold">{key.replace(/_/g, ' ')}:</span>
                  <span className="max-w-[180px] truncate">{String(value)}</span>
                </Badge>
              ))}
            </div>
          )}

          <div className="relative mt-3">
            <textarea
              value={text}
              onChange={(e) => handleChange(e.target.value)}
              rows={5}
              className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm leading-relaxed focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              aria-label="Draft message"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-2 text-[11px] text-slate-400">
              {edited && <Badge color="amber">edited</Badge>}
              {saving === 'saving' && <span>Saving…</span>}
              {saving === 'saved' && <span className="text-emerald-600">Saved ✓</span>}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {text.length} characters
            </span>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setActing('skip');
                  try {
                    await onSkip();
                  } finally {
                    setActing(null);
                  }
                }}
                disabled={acting !== null}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {acting === 'skip' ? 'Skipping…' : 'Skip'}
              </button>
              <button
                onClick={async () => {
                  setActing('approve');
                  try {
                    await onApprove();
                  } finally {
                    setActing(null);
                  }
                }}
                disabled={acting !== null}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              >
                {acting === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DraftsPage() {
  const toast = useToast();
  const { subscribe } = useWs();

  const [stats, setStats] = useState<DraftStats | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('pending_review');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.get<DraftStats>('/api/v1/drafts/stats'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load draft stats');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (campaignFilter) params.set('campaign_id', campaignFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      const res = await api.get<Paginated<Draft>>(`/api/v1/drafts?${params}`);
      setDrafts(res.items);
      setTotal(res.total);
      if (res.page_size) setPageSize(res.page_size);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignFilter, statusFilter, page]);

  useEffect(() => {
    loadStats();
    api
      .get<Paginated<Campaign>>('/api/v1/campaigns?page=1&page_size=100')
      .then((res) => setCampaigns(res.items))
      .catch(() => {
        /* campaign filter is non-critical */
      });
  }, [loadStats]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // Refresh when new drafts are generated in the background.
  useEffect(() => {
    return subscribe((event) => {
      if (event.event === 'drafts.ready') {
        loadStats();
        loadDrafts();
      }
    });
  }, [subscribe, loadStats, loadDrafts]);

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const approveDraft = async (draft: Draft) => {
    try {
      await api.post(`/api/v1/drafts/${draft.id}/approve`);
      removeDraft(draft.id);
      toast.success(`Draft for ${draft.lead.name} approved`);
      loadStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve draft');
    }
  };

  const skipDraft = async (draft: Draft) => {
    try {
      await api.post(`/api/v1/drafts/${draft.id}/skip`);
      removeDraft(draft.id);
      toast.info(`Draft for ${draft.lead.name} skipped`);
      loadStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to skip draft');
    }
  };

  const saveEdit = async (draft: Draft, text: string) => {
    try {
      await api.put(`/api/v1/drafts/${draft.id}`, { human_edit: text });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save edit');
      throw err;
    }
  };

  const bulkApprove = async () => {
    if (selected.size === 0) return;
    setBulkApproving(true);
    try {
      const ids = Array.from(selected);
      await api.post('/api/v1/drafts/bulk-approve', { draft_ids: ids });
      setDrafts((prev) => prev.filter((d) => !selected.has(d.id)));
      setSelected(new Set());
      toast.success(`${ids.length} drafts approved`);
      loadStats();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk approve failed');
    } finally {
      setBulkApproving(false);
    }
  };

  const generateDrafts = async () => {
    if (!campaignFilter) {
      toast.warning('Pick a campaign in the filter to generate drafts for it.');
      return;
    }
    setGenerating(true);
    try {
      const res = await api.post<{ queued: number }>('/api/v1/drafts/generate', {
        campaign_id: campaignFilter,
      });
      toast.success(`${res.queued} drafts queued for generation`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue generation');
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = drafts.length > 0 && drafts.every((d) => selected.has(d.id));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Review queue</h1>
          <p className="text-sm text-slate-500">
            Every AI draft waits here for your approval before it goes anywhere.
          </p>
        </div>
        <button
          onClick={generateDrafts}
          disabled={generating}
          className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {generating ? 'Queuing…' : '✨ Generate drafts'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Pending review"
          icon="⏳"
          value={stats ? stats.pending_review : '—'}
          accent="amber"
        />
        <StatCard label="Approved" value={stats ? stats.approved : '—'} accent="green" icon="✅" />
        <StatCard label="Sent today" value={stats ? stats.sent_today : '—'} accent="indigo" icon="📤" />
        <StatCard label="Skipped" value={stats ? stats.skipped : '—'} accent="slate" icon="↷" />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/60 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
        <select
          value={campaignFilter}
          onChange={(e) => {
            setCampaignFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected(
                  allSelected ? new Set() : new Set(drafts.map((d) => d.id))
                )
              }
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Select all
          </label>
          <button
            onClick={bulkApprove}
            disabled={selected.size === 0 || bulkApproving}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {bulkApproving && (
              <Spinner size="sm" className="border-white/40 border-t-white" />
            )}
            Approve selected ({selected.size})
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {loading ? (
          <PageLoader label="Loading drafts…" />
        ) : drafts.length === 0 ? (
          <EmptyState
            icon="🎉"
            title="Queue is clear"
            description="No drafts match these filters. Generate drafts for a campaign or adjust the filters above."
          />
        ) : (
          drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              selected={selected.has(draft.id)}
              onToggleSelect={() => toggleSelect(draft.id)}
              onApprove={() => approveDraft(draft)}
              onSkip={() => skipDraft(draft)}
              onSaveEdit={(text) => saveEdit(draft, text)}
            />
          ))
        )}
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </div>
  );
}
