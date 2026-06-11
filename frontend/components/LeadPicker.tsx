'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import LeadImportFlow, {
  LeadImportFlowHandle,
} from '@/components/LeadImportFlow';
import type { Lead, LeadImportResult, Paginated } from '@/lib/types';

function QualityBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 70
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : pct >= 40
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${color}`}
      title="Lead quality score"
    >
      {Math.round(pct)}
    </span>
  );
}

export type LeadPickerMode = 'select' | 'import';

/**
 * Two-mode lead picker used by the campaign wizard's Leads step and the campaign
 * detail "Add leads" modal:
 *  - "Select existing": scrollable checkbox list of leads, selection tracked by id.
 *  - "Import CSV": the reusable 3-stage import flow.
 *
 * Selection state is controlled by the parent (selectedIds / onSelectedChange).
 * The parent owns any footer/submit buttons and reads the import handle via
 * onImportHandle so it can render Back/Import buttons while in import mode.
 */
export default function LeadPicker({
  selectedIds,
  onSelectedChange,
  campaignId,
  onImportHandle,
  onImported,
}: {
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
  /** if set, CSV imports are attached to this campaign server-side */
  campaignId?: string;
  /** parent can render footer buttons for the import flow using this handle */
  onImportHandle?: (handle: LeadImportFlowHandle | null) => void;
  /** called after a successful import; receives the result and refreshed leads */
  onImported?: (result: LeadImportResult, refreshed: Lead[]) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<LeadPickerMode>('select');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadLeads = useCallback(async (): Promise<Lead[]> => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page_size: '100' });
      const res = await api.get<Paginated<Lead>>(`/api/v1/leads?${params}`);
      setLeads(res.items);
      return res.items;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leads');
      return [];
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Report import-mode handle to parent (null when not in import mode).
  useEffect(() => {
    if (mode !== 'import') onImportHandle?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const toggle = (id: string) => {
    onSelectedChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  };

  const handleImported = async (result: LeadImportResult) => {
    // Re-fetch leads (sorted newest-first by created_at). When there's no
    // campaign yet, auto-select the freshly imported, still-unassigned leads.
    const refreshed = await loadLeads();
    if (!campaignId && result.imported > 0) {
      const newlyUnassigned = refreshed
        .filter((l) => !l.campaign_id)
        .slice(0, result.imported)
        .map((l) => l.id);
      if (newlyUnassigned.length > 0) {
        const merged = Array.from(
          new Set([...selectedIds, ...newlyUnassigned])
        );
        onSelectedChange(merged);
        toast.info(
          `${newlyUnassigned.length} imported lead${
            newlyUnassigned.length === 1 ? '' : 's'
          } selected.`
        );
      }
    }
    onImported?.(result, refreshed);
  };

  const filtered = search.trim()
    ? leads.filter((l) => {
        const q = search.toLowerCase();
        return (
          (l.name || `${l.first_name} ${l.last_name}`)
            .toLowerCase()
            .includes(q) ||
          (l.company || '').toLowerCase().includes(q) ||
          (l.title || '').toLowerCase().includes(q)
        );
      })
    : leads;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('select')}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            mode === 'select'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Select existing
        </button>
        <button
          type="button"
          onClick={() => setMode('import')}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium ${
            mode === 'import'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Import CSV
        </button>
      </div>

      {mode === 'select' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads by name, title, company…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <span className="shrink-0 text-xs font-medium text-slate-500">
              {selectedIds.length} selected
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Spinner size="sm" /> Loading leads…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              {leads.length === 0
                ? 'No leads yet — import a CSV from the tab above.'
                : 'No leads match your search.'}
            </div>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {filtered.map((lead) => {
                const checked = selectedIds.includes(lead.id);
                const displayName =
                  lead.name || `${lead.first_name} ${lead.last_name}`;
                return (
                  <li key={lead.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 ${
                        checked
                          ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-200'
                          : 'border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(lead.id)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {displayName}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {[lead.title, lead.company]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] capitalize text-slate-400">
                        {lead.status}
                      </span>
                      <QualityBadge score={lead.quality_score} />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <LeadImportFlow
          campaignId={campaignId}
          onImported={handleImported}
          onReady={(h) => onImportHandle?.(h)}
        />
      )}
    </div>
  );
}
