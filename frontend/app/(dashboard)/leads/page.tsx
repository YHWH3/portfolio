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
  IcpProfile,
  Lead,
  LeadImportPreview,
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

// ---------- CSV import ----------

type ImportStage = 'upload' | 'map' | 'result';

const NOT_MAPPED = '';

interface MappingField {
  key: string;
  label: string;
}

const MAPPING_FIELDS: MappingField[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'name', label: 'Full name' },
  { key: 'linkedin_url', label: 'LinkedIn profile URL' },
  { key: 'title', label: 'Job title' },
  { key: 'company', label: 'Company' },
  { key: 'industry', label: 'Industry' },
  { key: 'location', label: 'Location' },
  { key: 'email', label: 'Email' },
];

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
  const [importStage, setImportStage] = useState<ImportStage>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCampaign, setImportCampaign] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<LeadImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
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

  const previewImport = async (file: File) => {
    setImportFile(file);
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<LeadImportPreview>(
        '/api/v1/leads/import/preview',
        fd
      );
      setPreview(res);
      const initial: Record<string, string> = {};
      for (const f of MAPPING_FIELDS) {
        const suggested = res.suggested_mapping?.[f.key];
        initial[f.key] =
          suggested && res.headers.includes(suggested) ? suggested : NOT_MAPPED;
      }
      setMapping(initial);
      setImportStage('map');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not read that CSV file'
      );
      setImportFile(null);
    } finally {
      setPreviewing(false);
    }
  };

  const nameMapped =
    !!mapping['name'] || (!!mapping['first_name'] && !!mapping['last_name']);
  const linkedinMapped = !!mapping['linkedin_url'];
  const mappingProblems: string[] = [];
  if (!nameMapped) {
    mappingProblems.push(
      'Pick which columns contain First name and Last name — or map a single Full name column and we’ll split it for you.'
    );
  }
  if (!linkedinMapped) {
    mappingProblems.push('Pick which column contains the LinkedIn profile URL.');
  }

  const runImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importCampaign) fd.append('campaign_id', importCampaign);
      const cleaned: Record<string, string> = {};
      for (const [field, header] of Object.entries(mapping)) {
        if (header) cleaned[field] = header;
      }
      fd.append('mapping', JSON.stringify(cleaned));
      const res = await api.upload<LeadImportResult>('/api/v1/leads/import', fd);
      setImportResult(res);
      setImportStage('result');
      toast.success(`Imported ${res.imported} leads`);
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
    setImportStage('upload');
    setImportFile(null);
    setPreview(null);
    setMapping({});
    setImportResult(null);
    setImportCampaign('');
  };

  const mappedFields = MAPPING_FIELDS.filter((f) => mapping[f.key]);

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
          importStage === 'upload'
            ? 'Import leads from CSV'
            : importStage === 'map'
              ? 'Match your columns'
              : 'Import complete'
        }
        wide
        footer={
          importStage === 'upload' ? (
            <button
              onClick={closeImport}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          ) : importStage === 'map' ? (
            <>
              <button
                onClick={() => {
                  setImportStage('upload');
                  setImportFile(null);
                  setPreview(null);
                }}
                disabled={importing}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={runImport}
                disabled={importing || mappingProblems.length > 0}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              >
                {importing && (
                  <Spinner size="sm" className="border-white/40 border-t-white" />
                )}
                {importing
                  ? 'Importing…'
                  : `Import ${preview?.total_rows ?? ''} leads`}
              </button>
            </>
          ) : (
            <button
              onClick={closeImport}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              Done
            </button>
          )
        }
      >
        {importStage === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Any CSV works — next you&apos;ll match your columns to our fields, so
              the headers don&apos;t need to be exact.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={previewing}
              className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/40 disabled:opacity-60"
            >
              {previewing ? (
                <>
                  <Spinner size="lg" />
                  <span className="mt-2 font-medium text-slate-700">
                    Reading your file…
                  </span>
                </>
              ) : (
                <>
                  <span className="text-2xl">📄</span>
                  <span className="mt-2 font-medium text-slate-700">
                    {importFile ? importFile.name : 'Click to choose a CSV file'}
                  </span>
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) previewImport(f);
                e.target.value = '';
              }}
            />
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
          </div>
        )}

        {importStage === 'map' && preview && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              We found{' '}
              <span className="font-semibold">{preview.total_rows} rows</span> in{' '}
              <span className="font-medium">{importFile?.name}</span>. Tell us which
              of your columns goes where — we&apos;ve guessed where we could.
            </p>

            {mappingProblems.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold">Almost there — a required field isn&apos;t matched yet:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {mappingProblems.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Lead field</th>
                    <th className="px-3 py-2">Column in your file</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MAPPING_FIELDS.map((f) => {
                    const requiredName =
                      f.key === 'first_name' || f.key === 'last_name' || f.key === 'name';
                    const requiredUrl = f.key === 'linkedin_url';
                    return (
                      <tr key={f.key} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <span className="font-medium text-slate-800">{f.label}</span>
                          {requiredUrl && (
                            <span className="ml-1.5 text-xs font-medium text-rose-500">
                              Required
                            </span>
                          )}
                          {requiredName && (
                            <span className="ml-1.5 text-xs text-slate-400">
                              {f.key === 'name'
                                ? 'Counts as first + last name'
                                : 'Required (or map Full name)'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={mapping[f.key] || NOT_MAPPED}
                            onChange={(e) =>
                              setMapping((prev) => ({
                                ...prev,
                                [f.key]: e.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          >
                            <option value={NOT_MAPPED}>— not in my file —</option>
                            {preview.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {mappedFields.length > 0 && preview.sample_rows.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Preview — first rows as they&apos;ll import
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        {mappedFields.map((f) => (
                          <th key={f.key} className="whitespace-nowrap px-3 py-2">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.sample_rows.slice(0, 3).map((row, i) => (
                        <tr key={i}>
                          {mappedFields.map((f) => (
                            <td
                              key={f.key}
                              className="max-w-[160px] truncate px-3 py-2 text-slate-700"
                            >
                              {row[mapping[f.key]] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {importStage === 'result' && importResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <span className="text-3xl">🎉</span>
              <div>
                <p className="text-2xl font-semibold text-emerald-700">
                  {importResult.imported} leads imported
                </p>
                <p className="text-sm text-emerald-700/80">
                  {importResult.skipped > 0
                    ? `${importResult.skipped} rows were skipped.`
                    : 'No rows were skipped.'}
                </p>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-semibold text-slate-800">
                  Issues ({importResult.errors.length})
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-rose-600">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
