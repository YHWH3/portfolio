'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import type { LeadImportPreview, LeadImportResult } from '@/lib/types';

export type ImportStage = 'upload' | 'map' | 'result';

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

/**
 * The 3-stage CSV import-with-mapping flow (upload → map → result), extracted so
 * it can be reused on the leads page, the campaign wizard, and the campaign
 * detail page. Renders only the modal *body* — the caller owns the Modal shell
 * and footer, and drives it via the imperative handle passed to onReady.
 */
export interface LeadImportFlowHandle {
  stage: ImportStage;
  back: () => void;
  submit: () => void;
  canSubmit: boolean;
  busy: boolean;
  totalRows: number;
  reset: () => void;
}

export default function LeadImportFlow({
  /** if provided, imported leads are attached to this campaign */
  campaignId,
  /** called with the import result once the import succeeds */
  onImported,
  /** receives an imperative handle so the parent can render footer buttons */
  onReady,
}: {
  campaignId?: string;
  onImported?: (result: LeadImportResult) => void;
  onReady?: (handle: LeadImportFlowHandle) => void;
}) {
  const toast = useToast();
  const [stage, setStage] = useState<ImportStage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<LeadImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewImport = async (f: File) => {
    setFile(f);
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.upload<LeadImportPreview>(
        '/api/v1/leads/import/preview',
        fd
      );
      setPreview(res);
      const initial: Record<string, string> = {};
      for (const fld of MAPPING_FIELDS) {
        const suggested = res.suggested_mapping?.[fld.key];
        initial[fld.key] =
          suggested && res.headers.includes(suggested) ? suggested : NOT_MAPPED;
      }
      setMapping(initial);
      setStage('map');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not read that CSV file'
      );
      setFile(null);
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
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (campaignId) fd.append('campaign_id', campaignId);
      const cleaned: Record<string, string> = {};
      for (const [field, header] of Object.entries(mapping)) {
        if (header) cleaned[field] = header;
      }
      fd.append('mapping', JSON.stringify(cleaned));
      const res = await api.upload<LeadImportResult>('/api/v1/leads/import', fd);
      setResult(res);
      setStage('result');
      toast.success(`Imported ${res.imported} leads`);
      onImported?.(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStage('upload');
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
  };

  const back = () => {
    if (stage === 'map') {
      setStage('upload');
      setFile(null);
      setPreview(null);
    }
  };

  const canSubmit =
    stage === 'map' && mappingProblems.length === 0 && !importing;
  const totalRows = preview?.total_rows ?? 0;

  // Expose an imperative handle to the parent (for footer buttons) via effect,
  // so we never call setState during render.
  useEffect(() => {
    onReady?.({
      stage,
      back,
      submit: runImport,
      canSubmit,
      busy: importing,
      totalRows,
      reset,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, canSubmit, importing, totalRows, mapping, file]);

  const mappedFields = MAPPING_FIELDS.filter((f) => mapping[f.key]);

  return (
    <>
      {stage === 'upload' && (
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
                  {file ? file.name : 'Click to choose a CSV file'}
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
        </div>
      )}

      {stage === 'map' && preview && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            We found{' '}
            <span className="font-semibold">{preview.total_rows} rows</span> in{' '}
            <span className="font-medium">{file?.name}</span>. Tell us which of
            your columns goes where — we&apos;ve guessed where we could.
          </p>

          {mappingProblems.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">
                Almost there — a required field isn&apos;t matched yet:
              </p>
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
                    f.key === 'first_name' ||
                    f.key === 'last_name' ||
                    f.key === 'name';
                  const requiredUrl = f.key === 'linkedin_url';
                  return (
                    <tr key={f.key} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-800">
                          {f.label}
                        </span>
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

      {stage === 'result' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <span className="text-3xl">🎉</span>
            <div>
              <p className="text-2xl font-semibold text-emerald-700">
                {result.imported} leads imported
              </p>
              <p className="text-sm text-emerald-700/80">
                {result.skipped > 0
                  ? `${result.skipped} rows were skipped.`
                  : 'No rows were skipped.'}
              </p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-800">
                Issues ({result.errors.length})
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-rose-600">
                {result.errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
