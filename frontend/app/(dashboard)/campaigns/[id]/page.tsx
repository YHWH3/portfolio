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
import Modal from '@/components/Modal';
import { STEP_TYPE_LABELS } from '@/components/SequenceStepEditor';
import LeadPicker from '@/components/LeadPicker';
import LeadConnectionChip from '@/components/LeadConnectionChip';
import { LeadImportFlowHandle } from '@/components/LeadImportFlow';
import type {
  CampaignDetail,
  CampaignPerformance,
  Lead,
  Paginated,
  SendingAccount,
} from '@/lib/types';

function ScoreBar({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600">{Math.round(pct)}</span>
    </div>
  );
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [performance, setPerformance] = useState<CampaignPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  // Leads
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [showAddLeads, setShowAddLeads] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [addImportHandle, setAddImportHandle] =
    useState<LeadImportFlowHandle | null>(null);

  // Sending accounts (banners)
  const [sendingAccounts, setSendingAccounts] = useState<SendingAccount[]>([]);

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const res = await api.get<Paginated<Lead>>(
        `/api/v1/leads?campaign_id=${id}&page_size=100`
      );
      setLeads(res.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLeadsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    loadLeads();
    api
      .get<SendingAccount[]>('/api/v1/sending-accounts')
      .then(setSendingAccounts)
      .catch(() => {});
  }, [load, loadLeads]);

  const assignExisting = async () => {
    if (pickerSelection.length === 0) {
      toast.warning('Select at least one lead to add.');
      return;
    }
    setAssigning(true);
    try {
      await api.post('/api/v1/leads/bulk-assign', {
        lead_ids: pickerSelection,
        campaign_id: id,
      });
      toast.success(
        `${pickerSelection.length} lead${
          pickerSelection.length === 1 ? '' : 's'
        } added to this campaign.`
      );
      setShowAddLeads(false);
      setPickerSelection([]);
      loadLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add leads');
    } finally {
      setAssigning(false);
    }
  };

  const closeAddLeads = () => {
    setShowAddLeads(false);
    setPickerSelection([]);
    addImportHandle?.reset();
  };

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

  const hasAccount = sendingAccounts.length > 0;
  const hasDelivery = sendingAccounts.some((a) => a.delivery_connected);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/campaigns" className="text-sm text-slate-500 hover:text-slate-700">
        ← Campaigns
      </Link>

      {/* LinkedIn connection banners */}
      {!hasAccount ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <span className="text-base leading-none">⚠️</span>
            <p>
              <span className="font-semibold">
                Connect your LinkedIn account to send.
              </span>{' '}
              Approved messages need an account to go out from. Auto-delivery is
              optional — you can also send manually.
            </p>
          </div>
          <Link
            href="/settings"
            className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
          >
            Connect account
          </Link>
        </div>
      ) : !hasDelivery ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-sky-900">
            <span className="text-base leading-none">ℹ️</span>
            <p>
              <span className="font-semibold">Auto-delivery is off</span> —
              approved messages are tracked here and you send them from LinkedIn.
              Enable auto-delivery in Settings to send automatically.
            </p>
          </div>
          <Link
            href="/settings"
            className="shrink-0 rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
          >
            Open Settings
          </Link>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{campaign.name}</h1>
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
              className={`${btn} border-rose-200 bg-white text-rose-600 hover:bg-rose-50`}
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
              value={`${(performance.drafts_edited_pct ?? 0).toFixed(0)}%`}
              accent="amber"
            />
            <StatCard label="Messages sent" value={performance.messages_sent} />
            <StatCard
              label="Reply rate"
              value={`${(performance.reply_rate ?? 0).toFixed(1)}%`}
              accent="indigo"
            />
            <StatCard
              label="Positive replies"
              value={`${(performance.positive_reply_rate ?? 0).toFixed(1)}%`}
              accent="green"
            />
            <StatCard
              label="Meetings booked"
              value={performance.meetings_booked}
              accent="green"
            />
            <StatCard
              label="Avg reply time"
              value={
                performance.avg_reply_time_hours != null
                  ? `${performance.avg_reply_time_hours.toFixed(1)}h`
                  : '—'
              }
              sub={
                performance.account_health_avg != null
                  ? `Account health avg: ${performance.account_health_avg.toFixed(0)}`
                  : 'No replies yet'
              }
            />
          </div>
          {performance.top_performing_signals.length > 0 && (
            <div className="mt-4 rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
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

      {/* Leads */}
      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Leads ({leads.length})
        </h2>
        <button
          onClick={() => setShowAddLeads(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        >
          + Add leads
        </button>
      </div>
      {leadsLoading ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          Loading leads…
        </p>
      ) : leads.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No leads on this campaign yet"
          description="A campaign needs at least one lead before it can be activated. Add existing leads or import a CSV."
          action={
            <button
              onClick={() => setShowAddLeads(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              Add leads
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/60 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Title / Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Connection</th>
                <th className="px-4 py-3">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {lead.name || `${lead.first_name} ${lead.last_name}`}
                    </p>
                    <a
                      href={lead.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      LinkedIn ↗
                    </a>
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate text-slate-700">{lead.title || '—'}</p>
                    <p className="truncate text-xs text-slate-500">
                      {lead.company || ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBar score={lead.quality_score} />
                  </td>
                  <td className="px-4 py-3">
                    <LeadConnectionChip lead={lead} onChange={loadLeads} />
                  </td>
                  <td className="px-4 py-3">
                    {lead.enriched_at ? (
                      <Badge color="green" title="Profile context fetched for personalization">
                        📄 context ready
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Steps */}
      <h2 className="mt-8 mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Sequence steps ({campaign.steps.length})
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Connection requests are sent first. Follow-up messages are only drafted
        after the prospect accepts — so you never message someone who hasn&apos;t
        connected.
      </p>
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
                className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
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
                className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
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

      {/* Add leads modal */}
      <Modal
        open={showAddLeads}
        onClose={closeAddLeads}
        title="Add leads to this campaign"
        wide
        footer={
          addImportHandle?.stage === 'map' ? (
            <>
              <button
                onClick={() => addImportHandle.back()}
                disabled={addImportHandle.busy}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={() => addImportHandle.submit()}
                disabled={!addImportHandle.canSubmit}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {addImportHandle.busy
                  ? 'Importing…'
                  : `Import ${addImportHandle.totalRows || ''} leads`}
              </button>
            </>
          ) : addImportHandle?.stage === 'result' ? (
            <button
              onClick={closeAddLeads}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={closeAddLeads}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={assignExisting}
                disabled={assigning || pickerSelection.length === 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {assigning
                  ? 'Adding…'
                  : `Add ${pickerSelection.length || ''} selected`}
              </button>
            </>
          )
        }
      >
        <LeadPicker
          selectedIds={pickerSelection}
          onSelectedChange={setPickerSelection}
          campaignId={id}
          onImportHandle={setAddImportHandle}
          onImported={() => loadLeads()}
        />
      </Modal>
    </div>
  );
}
