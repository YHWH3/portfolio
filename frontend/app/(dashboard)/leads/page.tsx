'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api, apiDownload } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Modal from '@/components/Modal';
import Spinner, { PageLoader } from '@/components/Spinner';
import Pagination from '@/components/Pagination';
import LeadImportFlow, { LeadImportFlowHandle } from '@/components/LeadImportFlow';
import LeadConnectionChip from '@/components/LeadConnectionChip';
import type {
  Campaign,
  IcpProfile,
  Lead,
  LeadStatus,
  Paginated,
} from '@/lib/types';

const STATUS_OPTIONS: ('' | LeadStatus)[] = [
  '',
  'new',
  'queued',
  'contacted',
  'engaged',
  'hot',
  'booked',
  'skipped',
  'archived',
];

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';

function ScoreBar({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600">{Math.round(pct)}</span>
    </div>
  );
}

// ---------- Tag input ----------

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!value.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange([...value, v]);
    }
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/40">
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-indigo-400 hover:text-indigo-700"
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : 'Add more…'}
        className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-0"
      />
    </div>
  );
}

// ---------- ICP panel ----------

const EMPTY_ICP = {
  titles: [] as string[],
  industries: [] as string[],
  company_sizes: [] as string[],
  geographies: [] as string[],
  exclusion_list: [] as string[],
};

function IcpPanel() {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasIcp, setHasIcp] = useState(false);
  const [icp, setIcp] = useState(EMPTY_ICP);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<IcpProfile[]>('/api/v1/icp')
      .then((profiles) => {
        if (profiles.length > 0) {
          const p = profiles[0];
          setHasIcp(true);
          setIcp({
            titles: p.titles || [],
            industries: p.industries || [],
            company_sizes: p.company_sizes || [],
            geographies: p.geographies || [],
            exclusion_list: p.exclusion_list || [],
          });
        } else {
          setExpanded(true);
        }
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to load your ICP')
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/api/v1/icp', icp);
      setHasIcp(true);
      toast.success('Lead quality scores will use this ICP on next enrichment');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save your ICP');
    } finally {
      setSaving(false);
    }
  };

  const fields: {
    key: keyof typeof EMPTY_ICP;
    label: string;
    placeholder: string;
  }[] = [
    { key: 'titles', label: 'Job titles', placeholder: 'CEO, Founder, VP Sales' },
    { key: 'industries', label: 'Industries', placeholder: 'SaaS, Fintech, E-commerce' },
    { key: 'company_sizes', label: 'Company sizes', placeholder: '11-50, 51-200' },
    { key: 'geographies', label: 'Locations', placeholder: 'United States, UK, DACH' },
    {
      key: 'exclusion_list',
      label: 'Exclude',
      placeholder: 'Competitors, agencies, students',
    },
  ];

  return (
    <div className="mb-5 rounded-2xl border border-slate-200/60 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-slate-900">
            🎯 Define your ideal customer
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {hasIcp
              ? 'Leads are scored against this profile during enrichment.'
              : 'Tell us who a great lead looks like — quality scores depend on it.'}
          </p>
        </div>
        <span className="text-slate-400">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <Spinner size="sm" /> Loading…
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.key} className={f.key === 'exclusion_list' ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      {f.label}
                    </label>
                    <TagInput
                      value={icp[f.key]}
                      onChange={(next) => setIcp((prev) => ({ ...prev, [f.key]: next }))}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Type a value and press Enter to add it. Click × to remove.
              </p>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
                >
                  {saving && (
                    <Spinner size="sm" className="border-white/40 border-t-white" />
                  )}
                  Save ICP
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Add lead form ----------

interface NewLeadForm {
  first_name: string;
  last_name: string;
  linkedin_url: string;
  title: string;
  company: string;
  email: string;
  campaign_id: string;
}

const emptyLead: NewLeadForm = {
  first_name: '',
  last_name: '',
  linkedin_url: '',
  title: '',
  company: '',
  email: '',
  campaign_id: '',
};

export default function LeadsPage() {
  const toast = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [minScore, setMinScore] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const [showAdd, setShowAdd] = useState(false);
  const [newLead, setNewLead] = useState<NewLeadForm>(emptyLead);
  const [savingLead, setSavingLead] = useState(false);

  // Import flow
  const [showImport, setShowImport] = useState(false);
  const [importCampaign, setImportCampaign] = useState('');
  const [importHandle, setImportHandle] = useState<LeadImportFlowHandle | null>(
    null
  );

  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (campaignFilter) params.set('campaign_id', campaignFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (minScore) params.set('min_score', minScore);
      const res = await api.get<Paginated<Lead>>(`/api/v1/leads?${params}`);
      setLeads(res.items);
      setTotal(res.total);
      if (res.page_size) setPageSize(res.page_size);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, campaignFilter, statusFilter, minScore]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<Paginated<Campaign>>('/api/v1/campaigns?page=1&page_size=100')
      .then((res) => setCampaigns(res.items))
      .catch(() => {});
  }, []);

  const addLead = async () => {
    if (
      !newLead.first_name.trim() ||
      !newLead.last_name.trim() ||
      !newLead.linkedin_url.trim()
    ) {
      toast.warning('First name, last name and LinkedIn URL are required.');
      return;
    }
    setSavingLead(true);
    try {
      await api.post('/api/v1/leads', {
        first_name: newLead.first_name.trim(),
        last_name: newLead.last_name.trim(),
        linkedin_url: newLead.linkedin_url.trim(),
        title: newLead.title.trim() || undefined,
        company: newLead.company.trim() || undefined,
        email: newLead.email.trim() || undefined,
        campaign_id: newLead.campaign_id || undefined,
      });
      toast.success('Lead added');
      setShowAdd(false);
      setNewLead(emptyLead);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add lead');
    } finally {
      setSavingLead(false);
    }
  };

  const enrich = async (lead: Lead) => {
    setEnrichingIds((prev) => new Set(prev).add(lead.id));
    try {
      await api.post(`/api/v1/leads/${lead.id}/enrich`);
      toast.success(`Enrichment queued for ${lead.name || lead.first_name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue enrichment');
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  const removeLead = async (lead: Lead) => {
    if (!confirm(`Delete lead ${lead.name || lead.first_name}?`)) return;
    try {
      await api.delete(`/api/v1/leads/${lead.id}`);
      toast.success('Lead deleted');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete lead');
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await apiDownload('/api/v1/leads/export', 'leads-export.csv');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const closeImport = () => {
    setShowImport(false);
    importHandle?.reset();
    setImportCampaign('');
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Leads
          </h1>
          <p className="text-sm text-slate-500">
            Your prospect pool, scored against your ICP.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : '⬇ Export CSV'}
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            ⬆ Import CSV
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            + Add lead
          </button>
        </div>
      </div>

      <IcpPanel />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/60 bg-white p-3 shadow-sm">
        <select
          value={campaignFilter}
          onChange={(e) => {
            setCampaignFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm capitalize focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s || 'all'} value={s}>
              {s || 'All statuses'}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Min score
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => {
              setMinScore(e.target.value);
              setPage(1);
            }}
            placeholder="0"
            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </label>
      </div>

      {loading ? (
        <PageLoader label="Loading leads…" />
      ) : leads.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No leads found"
          description="Import a CSV or add leads manually to start building your pipeline."
          action={
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              Import CSV
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
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">ICP match</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Connection</th>
                <th className="px-4 py-3">Enriched</th>
                <th className="px-4 py-3 text-right">Actions</th>
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
                      {[lead.company, lead.location].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBar score={lead.quality_score} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {lead.icp_match_pct !== null && lead.icp_match_pct !== undefined
                      ? `${Math.round(lead.icp_match_pct)}%`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-3">
                    <LeadConnectionChip lead={lead} onChange={load} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {lead.enriched_at
                      ? new Date(lead.enriched_at).toLocaleDateString()
                      : 'Not yet'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => enrich(lead)}
                        disabled={enrichingIds.has(lead.id)}
                        className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {enrichingIds.has(lead.id) ? 'Queuing…' : 'Enrich'}
                      </button>
                      <button
                        onClick={() => removeLead(lead)}
                        className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        Delete
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

      {/* Add lead modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add lead"
        footer={
          <>
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={addLead}
              disabled={savingLead}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
            >
              {savingLead && (
                <Spinner size="sm" className="border-white/40 border-t-white" />
              )}
              Add lead
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                First name *
              </label>
              <input
                value={newLead.first_name}
                onChange={(e) => setNewLead({ ...newLead, first_name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Last name *
              </label>
              <input
                value={newLead.last_name}
                onChange={(e) => setNewLead({ ...newLead, last_name: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              LinkedIn URL *
            </label>
            <input
              value={newLead.linkedin_url}
              onChange={(e) => setNewLead({ ...newLead, linkedin_url: e.target.value })}
              className={inputCls}
              placeholder="https://linkedin.com/in/…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Title
              </label>
              <input
                value={newLead.title}
                onChange={(e) => setNewLead({ ...newLead, title: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Company
              </label>
              <input
                value={newLead.company}
                onChange={(e) => setNewLead({ ...newLead, company: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={newLead.email}
              onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Assign to campaign
            </label>
            <select
              value={newLead.campaign_id}
              onChange={(e) => setNewLead({ ...newLead, campaign_id: e.target.value })}
              className={inputCls}
            >
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Import modal */}
      <Modal
        open={showImport}
        onClose={closeImport}
        title={
          importHandle?.stage === 'map'
            ? 'Match your columns'
            : importHandle?.stage === 'result'
              ? 'Import complete'
              : 'Import leads from CSV'
        }
        wide
        footer={
          importHandle?.stage === 'map' ? (
            <>
              <button
                onClick={() => importHandle.back()}
                disabled={importHandle.busy}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={() => importHandle.submit()}
                disabled={!importHandle.canSubmit}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              >
                {importHandle.busy && (
                  <Spinner size="sm" className="border-white/40 border-t-white" />
                )}
                {importHandle.busy
                  ? 'Importing…'
                  : `Import ${importHandle.totalRows || ''} leads`}
              </button>
            </>
          ) : importHandle?.stage === 'result' ? (
            <button
              onClick={closeImport}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              Done
            </button>
          ) : (
            <button
              onClick={closeImport}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          )
        }
      >
        <div className="space-y-4">
          {importHandle?.stage !== 'result' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Assign to campaign <span className="text-slate-400">(optional)</span>
              </label>
              <select
                value={importCampaign}
                onChange={(e) => setImportCampaign(e.target.value)}
                className={inputCls}
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <LeadImportFlow
            campaignId={importCampaign || undefined}
            onReady={setImportHandle}
            onImported={() => load()}
          />
        </div>
      </Modal>
    </div>
  );
}
