'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import StatCard from '@/components/StatCard';
import Badge, { StatusBadge } from '@/components/Badge';
import { PageLoader } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import { STEP_TYPE_LABELS } from '@/components/SequenceStepEditor';
import type { CampaignDetail, CampaignPerformance } from '@/lib/types';

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [performance, setPerformance] = useState<CampaignPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api.get<CampaignDetail>(`/api/v1/campaigns/${id}`);
      setCampaign(c);
      try {
        setPerformance(
          await api.get<CampaignPerformance>(`/api/v1/campaigns/${id}/performance`)
        );
      } catch {
        // performance may not exist yet for fresh campaigns
        setPerformance(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const lifecycle = async (
    action: 'activate' | 'pause' | 'resume' | 'duplicate',
    successMsg: string
  ) => {
    setActionBusy(true);
    try {
      await api.post(`/api/v1/campaigns/${id}/${action}`);
      toast.success(successMsg);
      if (action === 'duplicate') router.push('/campaigns');
      else load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionBusy(false);
    }
  };

  const archive = async () => {
    if (!confirm('Archive this campaign? It will stop generating drafts.')) return;
    setActionBusy(true);
    try {
      await api.put(`/api/v1/campaigns/${id}`, { status: 'archived' });
      toast.success('Campaign archived');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <PageLoader label="Loading campaign…" />;
  if (!campaign) {
    return (
      <EmptyState
        icon="🤷"
        title="Campaign not found"
        action={
          <Link href="/campaigns" className="text-sm font-medium text-indigo-600">
            Back to campaigns
          </Link>
        }
      />
    );
  }

  const btn =
    'rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50';

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/campaigns" className="text-sm text-slate-500 hover:text-slate-700">
        ← Campaigns
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">{campaign.name}</h1>
            <StatusBadge status={campaign.status} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{campaign.objective}</p>
          {campaign.target_audience && (
            <p className="mt-1 text-xs text-slate-400">
              Audience: {campaign.target_audience}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(campaign.status === 'draft' || campaign.status === 'ready') && (
            <button
              disabled={actionBusy}
              onClick={() => lifecycle('activate', 'Campaign activated')}
              className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
            >
              ▶ Activate
            </button>
          )}
          {campaign.status === 'running' && (
            <button
              disabled={actionBusy}
              onClick={() => lifecycle('pause', 'Campaign paused')}
              className={`${btn} border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`}
            >
              ⏸ Pause
            </button>
          )}
          {campaign.status === 'paused' && (
            <button
              disabled={actionBusy}
              onClick={() => lifecycle('resume', 'Campaign resumed')}
              className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
            >
              ▶ Resume
            </button>
          )}
          <button
            disabled={actionBusy}
            onClick={() => lifecycle('duplicate', 'Campaign duplicated')}
            className={`${btn} border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
          >
            Duplicate
          </button>
          <Link
            href={`/campaigns/${id}/edit`}
            className={`${btn} border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
          >
            Edit sequence
          </Link>
          {campaign.status !== 'archived' && (
            <button
              disabled={actionBusy}
              onClick={archive}
              className={`${btn} border-red-200 bg-white text-red-600 hover:bg-red-50`}
            >
              Archive
            </button>
          )}
        </div>
      </div>

      {/* Performance */}
      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Performance
      </h2>
      {performance ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Drafts generated" value={performance.drafts_generated} />
            <StatCard
              label="Drafts approved"
              value={performance.drafts_approved}
              accent="green"
            />
            <StatCard
              label="Edited before approval"
              value={`${performance.drafts_edited_pct.toFixed(0)}%`}
              accent="amber"
            />
            <StatCard label="Messages sent" value={performance.messages_sent} />
            <StatCard
              label="Reply rate"
              value={`${(performance.reply_rate * 100).toFixed(1)}%`}
              accent="indigo"
            />
            <StatCard
              label="Positive replies"
              value={`${(performance.positive_reply_rate * 100).toFixed(1)}%`}
              accent="green"
            />
            <StatCard
              label="Meetings booked"
              value={performance.meetings_booked}
              accent="green"
            />
            <StatCard
              label="Avg reply time"
              value={`${performance.avg_reply_time_hours.toFixed(1)}h`}
              sub={`Account health avg: ${performance.account_health_avg.toFixed(0)}`}
            />
          </div>
          {performance.top_performing_signals.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Top performing personalization signals
              </p>
              <div className="flex flex-wrap gap-2">
                {performance.top_performing_signals.map((s) => (
                  <Badge key={s} color="indigo">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          No performance data yet — metrics appear once drafts start flowing.
        </p>
      )}

      {/* Steps */}
      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Sequence steps ({campaign.steps.length})
      </h2>
      {campaign.steps.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          No steps defined.{' '}
          <Link href={`/campaigns/${id}/edit`} className="font-medium text-indigo-600">
            Add steps
          </Link>
          .
        </p>
      ) : (
        <ol className="space-y-3">
          {[...campaign.steps]
            .sort((a, b) => a.step_order - b.step_order)
            .map((s, i) => (
              <li
                key={s.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {STEP_TYPE_LABELS[s.step_type]}
                  </span>
                  <Badge color="slate">
                    {s.delay_days === 0
                      ? 'immediately'
                      : `+${s.delay_days} day${s.delay_days === 1 ? '' : 's'}`}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                  {s.message_template}
                </p>
              </li>
            ))}
        </ol>
      )}

      {/* Objection handlers */}
      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Objection handlers ({campaign.objection_handlers.length})
      </h2>
      {campaign.objection_handlers.length === 0 ? (
        <p className="mb-8 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          No objection handlers yet.{' '}
          <Link href={`/campaigns/${id}/edit`} className="font-medium text-indigo-600">
            Add some
          </Link>{' '}
          so the AI suggests on-message responses to common pushback.
        </p>
      ) : (
        <div className="mb-8 space-y-3">
          {[...campaign.objection_handlers]
            .sort((a, b) => a.priority - b.priority)
            .map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color="amber">priority {o.priority}</Badge>
                  {o.trigger_phrases.map((p) => (
                    <Badge key={p} color="red">
                      “{p}”
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                  {o.response_template}
                </p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
