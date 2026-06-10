'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiDownload } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Modal from '@/components/Modal';
import Spinner, { PageLoader } from '@/components/Spinner';
import Pagination from '@/components/Pagination';
import type {
  Campaign,
  Lead,
  LeadImportResult,
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
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

function ScoreBar({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600">{Math.round(pct)}</span>
    </div>
  );
}

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

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCampaign, setImportCampaign] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<LeadImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (!newLead.first_name.trim() || !newLead.last_name.trim() || !newLead.linkedin_url.trim()) {
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

  const runImport = async () => {
    if (!importFile) {
      toast.warning('Choose a CSV file first.');
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importCampaign) fd.append('campaign_id', importCampaign);
      const res = await api.upload<LeadImportResult>('/api/v1/leads/import', fd);
      setImportResult(res);
      toast.success(`Imported ${res.imported} leads (${res.skipped} skipped)`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
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
    setImportFile(null);
    setImportResult(null);
    setImportCampaign('');
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Leads</h1>
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
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + Add lead
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm capitalize focus:border-indigo-500 focus:outline-none"
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
            className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
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
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Import CSV
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Title / Company</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">ICP match</th>
                <th className="px-4 py-3">Status</th>
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
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
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
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
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
        title="Import leads from CSV"
        footer={
          <>
            <button
              onClick={closeImport}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {importResult ? 'Done' : 'Cancel'}
            </button>
            <button
              onClick={runImport}
              disabled={importing || !importFile}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {importing && (
                <Spinner size="sm" className="border-white/40 border-t-white" />
              )}
              Import
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Expected columns: first_name, last_name, linkedin_url, title, company,
            email.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/40"
          >
            <span className="text-2xl">📄</span>
            <span className="mt-2 font-medium text-slate-700">
              {importFile ? importFile.name : 'Click to choose a CSV file'}
            </span>
            {importFile && (
              <span className="mt-1 text-xs">
                {(importFile.size / 1024).toFixed(1)} KB
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Assign to campaign
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
          {importResult && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-emerald-700">✓ Imported: {importResult.imported}</p>
              <p className="text-amber-700">↷ Skipped: {importResult.skipped}</p>
              {importResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-red-700">Errors:</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-red-600">
                    {importResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li>…and {importResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
