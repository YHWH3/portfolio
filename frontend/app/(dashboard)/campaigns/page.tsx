'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { PageLoader } from '@/components/Spinner';
import Pagination from '@/components/Pagination';
import type { Campaign, CampaignStatus, Paginated } from '@/lib/types';

const STATUS_FILTERS: ('' | CampaignStatus)[] = [
  '',
  'draft',
  'ready',
  'running',
  'paused',
  'completed',
  'archived',
];

export default function CampaignsPage() {
  const toast = useToast();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (status) params.set('status', status);
      const res = await api.get<Paginated<Campaign>>(`/api/v1/campaigns?${params}`);
      setCampaigns(res.items);
      setTotal(res.total);
      if (res.page_size) setPageSize(res.page_size);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  useEffect(() => {
    load();
  }, [load]);

  const duplicate = async (c: Campaign) => {
    try {
      await api.post(`/api/v1/campaigns/${c.id}/duplicate`);
      toast.success(`Duplicated "${c.name}"`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate');
    }
  };

  const [actingId, setActingId] = useState<string | null>(null);

  const lifecycle = async (
    c: Campaign,
    action: 'launch' | 'pause' | 'resume'
  ) => {
    setActingId(c.id);
    try {
      await api.post(`/api/v1/campaigns/${c.id}/${action}`);
      toast.success(
        action === 'launch'
          ? `"${c.name}" is live — drafts will start appearing in your review queue`
          : action === 'pause'
            ? `"${c.name}" paused`
            : `"${c.name}" resumed`
      );
      load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to ${action} campaign`
      );
    } finally {
      setActingId(null);
    }
  };

  const lifecycleButton = (c: Campaign) => {
    const busy = actingId === c.id;
    if (c.status === 'draft' || c.status === 'ready') {
      return (
        <button
          onClick={() => lifecycle(c, 'launch')}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
        >
          {busy ? 'Launching…' : '▶ Launch'}
        </button>
      );
    }
    if (c.status === 'running') {
      return (
        <button
          onClick={() => lifecycle(c, 'pause')}
          disabled={busy}
          className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {busy ? 'Pausing…' : '⏸ Pause'}
        </button>
      );
    }
    if (c.status === 'paused') {
      return (
        <button
          onClick={() => lifecycle(c, 'resume')}
          disabled={busy}
          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? 'Resuming…' : '▶ Resume'}
        </button>
      );
    }
    return null;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500">
            Outreach sequences your team designs once and reviews daily.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        >
          + New campaign
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-sm font-medium capitalize ${
              status === s
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <PageLoader label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon="🚀"
          title="No campaigns yet"
          description="Create your first campaign to start generating reviewed, personalized outreach."
          action={
            <Link
              href="/campaigns/new"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              Create campaign
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Objective</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">CTA</th>
                <th className="px-4 py-3">Daily limit</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(`/campaigns/${c.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">
                    {c.objective}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-600">
                    {c.cta_type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.daily_send_limit ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div
                      className="flex items-center justify-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {lifecycleButton(c)}
                      <Link
                        href={`/campaigns/${c.id}/edit`}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => duplicate(c)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Duplicate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </div>
  );
}
