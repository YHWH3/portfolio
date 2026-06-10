'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useWs } from '@/lib/ws';
import { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Modal from '@/components/Modal';
import Spinner, { PageLoader } from '@/components/Spinner';
import type {
  RestrictionSeverity,
  SafetyAccount,
  SafetyDashboard,
} from '@/lib/types';

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

function healthColor(score: number): string {
  if (score >= 75) return '#10b981'; // emerald-500
  if (score >= 50) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}

function HealthRing({ score }: { score: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  const color = healthColor(clamped);
  return (
    <div className="relative h-20 w-20">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="8"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-lg font-bold"
        style={{ color }}
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const color =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium text-slate-700">
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface LimitsForm {
  account: SafetyAccount;
  daily_send_limit: number;
  weekly_connection_limit: number;
  status: string;
}

interface RestrictionForm {
  account: SafetyAccount;
  restriction_type: string;
  severity: RestrictionSeverity;
  notes: string;
}

interface AddAccountForm {
  account_label: string;
  linkedin_profile_url: string;
  daily_send_limit: number;
  weekly_connection_limit: number;
}

export default function SafetyPage() {
  const toast = useToast();
  const { subscribe } = useWs();
  const [data, setData] = useState<SafetyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [limitsForm, setLimitsForm] = useState<LimitsForm | null>(null);
  const [restrictionForm, setRestrictionForm] = useState<RestrictionForm | null>(null);
  const [addForm, setAddForm] = useState<AddAccountForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<SafetyDashboard>('/api/v1/safety/dashboard'));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load safety dashboard'
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.event === 'safety.warning') load();
    });
  }, [subscribe, load]);

  const saveLimits = async () => {
    if (!limitsForm) return;
    setSaving(true);
    try {
      await api.put(`/api/v1/safety/accounts/${limitsForm.account.id}`, {
        daily_send_limit: limitsForm.daily_send_limit,
        weekly_connection_limit: limitsForm.weekly_connection_limit,
        status: limitsForm.status,
      });
      toast.success('Limits updated');
      setLimitsForm(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update limits');
    } finally {
      setSaving(false);
    }
  };

  const saveRestriction = async () => {
    if (!restrictionForm) return;
    if (!restrictionForm.restriction_type.trim()) {
      toast.warning('Describe the restriction type.');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        `/api/v1/safety/accounts/${restrictionForm.account.id}/restriction`,
        {
          restriction_type: restrictionForm.restriction_type.trim(),
          severity: restrictionForm.severity,
          notes: restrictionForm.notes.trim(),
        }
      );
      toast.success('Restriction logged');
      setRestrictionForm(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log restriction');
    } finally {
      setSaving(false);
    }
  };

  const addAccount = async () => {
    if (!addForm) return;
    if (!addForm.account_label.trim() || !addForm.linkedin_profile_url.trim()) {
      toast.warning('Label and LinkedIn profile URL are required.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/v1/safety/accounts', {
        account_label: addForm.account_label.trim(),
        linkedin_profile_url: addForm.linkedin_profile_url.trim(),
        daily_send_limit: addForm.daily_send_limit,
        weekly_connection_limit: addForm.weekly_connection_limit,
      });
      toast.success('Account added');
      setAddForm(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading safety dashboard…" />;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Account safety</h1>
          <p className="text-sm text-slate-500">
            Keep every linked LinkedIn account inside safe sending limits.
          </p>
        </div>
        <button
          onClick={() =>
            setAddForm({
              account_label: '',
              linkedin_profile_url: '',
              daily_send_limit: 25,
              weekly_connection_limit: 100,
            })
          }
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + Add account
        </button>
      </div>

      {data && data.recommendations.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-800">
            ⚠ Recommendations
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm text-amber-700">
            {data.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {!data || data.accounts.length === 0 ? (
        <EmptyState
          icon="🛡️"
          title="No LinkedIn accounts connected"
          description="Add an account to start monitoring health and sending limits."
          action={
            <button
              onClick={() =>
                setAddForm({
                  account_label: '',
                  linkedin_profile_url: '',
                  daily_send_limit: 25,
                  weekly_connection_limit: 100,
                })
              }
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Add account
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.accounts.map((acc) => (
            <div
              key={acc.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-4">
                <HealthRing score={acc.health_score} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {acc.account_label}
                    </p>
                    <StatusBadge status={acc.status} />
                  </div>
                  <a
                    href={acc.linkedin_profile_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    View profile ↗
                  </a>
                  <p className="mt-1 text-xs text-slate-400">
                    Health score — higher is safer
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <UsageBar
                  label="Messages today"
                  used={acc.sends_today}
                  limit={acc.daily_send_limit}
                />
                <UsageBar
                  label="Connections this week"
                  used={acc.connections_this_week}
                  limit={acc.weekly_connection_limit}
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Total sends this week</span>
                  <span className="font-medium text-slate-700">
                    {acc.sends_this_week}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                <button
                  onClick={() =>
                    setLimitsForm({
                      account: acc,
                      daily_send_limit: acc.daily_send_limit,
                      weekly_connection_limit: acc.weekly_connection_limit,
                      status: acc.status,
                    })
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Edit limits
                </button>
                <button
                  onClick={() =>
                    setRestrictionForm({
                      account: acc,
                      restriction_type: '',
                      severity: 'warning',
                      notes: '',
                    })
                  }
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Log restriction
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit limits modal */}
      <Modal
        open={limitsForm !== null}
        onClose={() => setLimitsForm(null)}
        title={`Edit limits — ${limitsForm?.account.account_label ?? ''}`}
        footer={
          <>
            <button
              onClick={() => setLimitsForm(null)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={saveLimits}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving && <Spinner size="sm" className="border-white/40 border-t-white" />}
              Save limits
            </button>
          </>
        }
      >
        {limitsForm && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Daily send limit
              </label>
              <input
                type="number"
                min={1}
                value={limitsForm.daily_send_limit}
                onChange={(e) =>
                  setLimitsForm({
                    ...limitsForm,
                    daily_send_limit: Math.max(1, Number(e.target.value)),
                  })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Weekly connection limit
              </label>
              <input
                type="number"
                min={1}
                value={limitsForm.weekly_connection_limit}
                onChange={(e) =>
                  setLimitsForm({
                    ...limitsForm,
                    weekly_connection_limit: Math.max(1, Number(e.target.value)),
                  })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Status
              </label>
              <select
                value={limitsForm.status}
                onChange={(e) =>
                  setLimitsForm({ ...limitsForm, status: e.target.value })
                }
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
          </div>
        )}
      </Modal>

      {/* Log restriction modal */}
      <Modal
        open={restrictionForm !== null}
        onClose={() => setRestrictionForm(null)}
        title={`Log restriction — ${restrictionForm?.account.account_label ?? ''}`}
        footer={
          <>
            <button
              onClick={() => setRestrictionForm(null)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={saveRestriction}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {saving && <Spinner size="sm" className="border-white/40 border-t-white" />}
              Log restriction
            </button>
          </>
        }
      >
        {restrictionForm && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Restriction type
              </label>
              <input
                value={restrictionForm.restriction_type}
                onChange={(e) =>
                  setRestrictionForm({
                    ...restrictionForm,
                    restriction_type: e.target.value,
                  })
                }
                className={inputCls}
                placeholder="e.g. connection_request_limit, account_warning"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Severity
              </label>
              <select
                value={restrictionForm.severity}
                onChange={(e) =>
                  setRestrictionForm({
                    ...restrictionForm,
                    severity: e.target.value as RestrictionSeverity,
                  })
                }
                className={inputCls}
              >
                <option value="warning">Warning</option>
                <option value="soft_limit">Soft limit</option>
                <option value="hard_limit">Hard limit</option>
                <option value="suspension">Suspension</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Notes
              </label>
              <textarea
                value={restrictionForm.notes}
                onChange={(e) =>
                  setRestrictionForm({ ...restrictionForm, notes: e.target.value })
                }
                rows={3}
                className={inputCls}
                placeholder="What happened, when, and any action taken."
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Add account modal */}
      <Modal
        open={addForm !== null}
        onClose={() => setAddForm(null)}
        title="Add LinkedIn account"
        footer={
          <>
            <button
              onClick={() => setAddForm(null)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={addAccount}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving && <Spinner size="sm" className="border-white/40 border-t-white" />}
              Add account
            </button>
          </>
        }
      >
        {addForm && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Account label
              </label>
              <input
                value={addForm.account_label}
                onChange={(e) =>
                  setAddForm({ ...addForm, account_label: e.target.value })
                }
                className={inputCls}
                placeholder="e.g. Jane — primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                LinkedIn profile URL
              </label>
              <input
                value={addForm.linkedin_profile_url}
                onChange={(e) =>
                  setAddForm({ ...addForm, linkedin_profile_url: e.target.value })
                }
                className={inputCls}
                placeholder="https://linkedin.com/in/…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Daily send limit
                </label>
                <input
                  type="number"
                  min={1}
                  value={addForm.daily_send_limit}
                  onChange={(e) =>
                    setAddForm({
                      ...addForm,
                      daily_send_limit: Math.max(1, Number(e.target.value)),
                    })
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Weekly connections
                </label>
                <input
                  type="number"
                  min={1}
                  value={addForm.weekly_connection_limit}
                  onChange={(e) =>
                    setAddForm({
                      ...addForm,
                      weekly_connection_limit: Math.max(1, Number(e.target.value)),
                    })
                  }
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
