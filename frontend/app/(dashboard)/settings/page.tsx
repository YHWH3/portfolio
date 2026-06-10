'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';
import Spinner, { PageLoader } from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import type { TeamMember, ToneProfile, Workspace } from '@/lib/types';

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

type Tab = 'workspace' | 'team' | 'tone';

// ---------- Workspace tab ----------

function WorkspaceTab() {
  const toast = useToast();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Workspace>('/api/v1/workspace')
      .then((w) => {
        setWorkspace(w);
        setName(w.name);
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to load workspace')
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!name.trim()) {
      toast.warning('Workspace name is required.');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.put<Workspace>('/api/v1/workspace', {
        name: name.trim(),
      });
      setWorkspace(updated);
      toast.success('Workspace updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update workspace');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading workspace…" />;
  if (!workspace) return null;

  const usagePct =
    workspace.monthly_outreach_limit > 0
      ? Math.min(
          100,
          (workspace.current_month_usage / workspace.monthly_outreach_limit) * 100
        )
      : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Workspace name</h3>
        <div className="mt-3 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <button
            onClick={save}
            disabled={saving}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving && <Spinner size="sm" className="border-white/40 border-t-white" />}
            Save
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Plan & usage</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-slate-400">Plan</p>
            <p className="mt-0.5 font-medium capitalize text-slate-900">
              {workspace.plan_tier}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Team seats</p>
            <p className="mt-0.5 font-medium text-slate-900">{workspace.team_seats}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-slate-500">Monthly outreach usage</span>
            <span className="font-medium text-slate-700">
              {workspace.current_month_usage} / {workspace.monthly_outreach_limit}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full ${
                usagePct >= 90
                  ? 'bg-red-500'
                  : usagePct >= 70
                    ? 'bg-amber-500'
                    : 'bg-indigo-500'
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Resets at the start of each month. Approved messages count toward usage.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Team tab ----------

function TeamTab() {
  const toast = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await api.get<TeamMember[]>('/api/v1/workspace/team'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async () => {
    if (!inviteEmail.trim()) {
      toast.warning('Enter an email to invite.');
      return;
    }
    setInviting(true);
    try {
      await api.post('/api/v1/workspace/team', {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const remove = async (m: TeamMember) => {
    if (!confirm(`Remove ${m.email} from the workspace?`)) return;
    try {
      await api.delete(`/api/v1/workspace/team/${m.id}`);
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      toast.success('Member removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Invite a teammate</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={invite}
            disabled={inviting}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {inviting && <Spinner size="sm" className="border-white/40 border-t-white" />}
            Send invite
          </button>
        </div>
      </div>

      {loading ? (
        <PageLoader label="Loading team…" />
      ) : members.length === 0 ? (
        <EmptyState
          icon="👋"
          title="Just you so far"
          description="Invite teammates so they can review drafts and manage campaigns."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}
                    </p>
                    <p className="text-xs text-slate-500">{m.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color="indigo" className="capitalize">
                      {m.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {m.accepted_at ? (
                      <Badge color="green">Active</Badge>
                    ) : (
                      <Badge color="amber">
                        Invited {new Date(m.invited_at).toLocaleDateString()}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(m)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Tone profiles tab ----------

function ToneTab() {
  const toast = useToast();
  const [profiles, setProfiles] = useState<ToneProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSamples, setNewSamples] = useState('');
  const [creating, setCreating] = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [testPrompts, setTestPrompts] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles(await api.get<ToneProfile[]>('/api/v1/tone-profiles'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load tone profiles');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const samples = newSamples
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!newName.trim()) {
      toast.warning('Give the profile a name.');
      return;
    }
    if (samples.length < 2) {
      toast.warning('Paste at least 2 sample messages (one per line).');
      return;
    }
    setCreating(true);
    try {
      await api.post('/api/v1/tone-profiles', {
        name: newName.trim(),
        sample_messages: samples,
      });
      toast.success('Tone profile created — style extraction in progress');
      setShowCreate(false);
      setNewName('');
      setNewSamples('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (p: ToneProfile) => {
    if (!confirm(`Delete tone profile "${p.name}"?`)) return;
    try {
      await api.delete(`/api/v1/tone-profiles/${p.id}`);
      setProfiles((prev) => prev.filter((x) => x.id !== p.id));
      toast.success('Tone profile deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const makeDefault = async (p: ToneProfile) => {
    try {
      await api.put(`/api/v1/tone-profiles/${p.id}`, { is_default: true });
      toast.success(`"${p.name}" is now the default voice`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default');
    }
  };

  const runTest = async (p: ToneProfile) => {
    const prompt = (testPrompts[p.id] || '').trim();
    if (!prompt) {
      toast.warning('Enter a test prompt first.');
      return;
    }
    setTestingId(p.id);
    try {
      const res = await api.post<{ message: string }>(
        `/api/v1/tone-profiles/${p.id}/test`,
        { prompt }
      );
      setTestResults((prev) => ({ ...prev, [p.id]: res.message }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test generation failed');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Tone profiles teach the AI to write like you — paste real messages you&apos;ve
          sent and it extracts your style.
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + New profile
        </button>
      </div>

      {loading ? (
        <PageLoader label="Loading tone profiles…" />
      ) : profiles.length === 0 ? (
        <EmptyState
          icon="🎙️"
          title="No tone profiles yet"
          description="Create one from a few of your real messages so drafts sound like you, not a robot."
          action={
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Create tone profile
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <button
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                  {p.is_default && <Badge color="indigo">Default</Badge>}
                  <span className="text-xs text-slate-400">
                    {p.sample_messages.length} samples
                  </span>
                </div>
                <span className="text-slate-400">{expanded === p.id ? '▴' : '▾'}</span>
              </button>
              {expanded === p.id && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                    Extracted style
                  </p>
                  {p.extracted_style && Object.keys(p.extracted_style).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(p.extracted_style).map(([k, v]) => (
                        <Badge key={k} color="purple">
                          <span className="font-semibold">{k.replace(/_/g, ' ')}:</span>{' '}
                          {String(v)}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      Style extraction pending — check back shortly.
                    </p>
                  )}

                  <p className="mt-4 mb-2 text-xs font-semibold uppercase text-slate-500">
                    Sample messages
                  </p>
                  <ul className="space-y-1.5">
                    {p.sample_messages.slice(0, 5).map((s, i) => (
                      <li
                        key={i}
                        className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
                      >
                        {s}
                      </li>
                    ))}
                    {p.sample_messages.length > 5 && (
                      <li className="text-xs text-slate-400">
                        …and {p.sample_messages.length - 5} more
                      </li>
                    )}
                  </ul>

                  <p className="mt-4 mb-2 text-xs font-semibold uppercase text-slate-500">
                    Test this voice
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={testPrompts[p.id] || ''}
                      onChange={(e) =>
                        setTestPrompts((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      placeholder="e.g. Intro message to a VP of Sales at a fintech"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                    <button
                      onClick={() => runTest(p)}
                      disabled={testingId === p.id}
                      className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {testingId === p.id ? <Spinner size="sm" /> : '✨'} Generate
                    </button>
                  </div>
                  {testResults[p.id] && (
                    <div className="mt-2 whitespace-pre-wrap rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-slate-700">
                      {testResults[p.id]}
                    </div>
                  )}

                  <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                    {!p.is_default && (
                      <button
                        onClick={() => makeDefault(p)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Make default
                      </button>
                    )}
                    <button
                      onClick={() => remove(p)}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New tone profile"
        wide
        footer={
          <>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {creating && <Spinner size="sm" className="border-white/40 border-t-white" />}
              Create profile
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Profile name
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputCls}
              placeholder="e.g. Jane — casual founder voice"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Sample messages{' '}
              <span className="font-normal text-slate-400">(one per line, 2+ required)</span>
            </label>
            <textarea
              value={newSamples}
              onChange={(e) => setNewSamples(e.target.value)}
              rows={8}
              className={inputCls}
              placeholder={
                'Hey Sam — saw your post on outbound benchmarks, great stuff. Quick q…\nCongrats on the Series B! Curious how you’re thinking about…'
              }
            />
            <p className="mt-1 text-xs text-slate-400">
              Paste real LinkedIn messages you&apos;ve sent. The more, the better the
              style match.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Page ----------

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('workspace');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'team', label: 'Team' },
    { id: 'tone', label: 'Tone Profiles' },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">
          Workspace, team and the voices your drafts are written in.
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'workspace' && <WorkspaceTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'tone' && <ToneTab />}
    </div>
  );
}
