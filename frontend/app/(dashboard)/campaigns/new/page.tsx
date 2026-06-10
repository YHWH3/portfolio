'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import SequenceStepEditor, {
  EditableStep,
  STEP_TYPE_LABELS,
} from '@/components/SequenceStepEditor';
import type { Campaign, CtaType, Persona, ToneProfile } from '@/lib/types';

const WIZARD_STEPS = [
  'Objective',
  'Persona & Tone',
  'Sequence',
  'CTA & Schedule',
  'Review',
];

interface WizardState {
  name: string;
  objective: string;
  target_audience: string;
  persona_id: string;
  tone_profile_id: string;
  steps: EditableStep[];
  cta_type: CtaType;
  cta_value: string;
  daily_send_limit: number;
  working_hours_start: string;
  working_hours_end: string;
  working_days: string[];
  activate_now: boolean;
}

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

export default function NewCampaignPage() {
  const router = useRouter();
  const toast = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [toneProfiles, setToneProfiles] = useState<ToneProfile[]>([]);
  const [creating, setCreating] = useState(false);
  const [state, setState] = useState<WizardState>({
    name: '',
    objective: '',
    target_audience: '',
    persona_id: '',
    tone_profile_id: '',
    steps: [],
    cta_type: 'reply',
    cta_value: '',
    daily_send_limit: 25,
    working_hours_start: '09:00',
    working_hours_end: '17:00',
    working_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    activate_now: false,
  });

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));

  useEffect(() => {
    api
      .get<Persona[]>('/api/v1/personas')
      .then(setPersonas)
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to load personas')
      );
    api
      .get<ToneProfile[]>('/api/v1/tone-profiles')
      .then(setToneProfiles)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : 'Failed to load tone profiles'
        )
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateStep = (): string | null => {
    if (stepIndex === 0) {
      if (!state.name.trim()) return 'Give the campaign a name.';
      if (!state.objective.trim()) return 'Describe the campaign objective.';
    }
    if (stepIndex === 2) {
      if (state.steps.length === 0) return 'Add at least one sequence step.';
      if (state.steps.some((s) => !s.message_template.trim()))
        return 'Every step needs a message template.';
    }
    if (stepIndex === 3) {
      if (state.cta_type !== 'reply' && !state.cta_value.trim())
        return 'Provide a CTA value (e.g. your booking link).';
      if (state.daily_send_limit < 1) return 'Daily send limit must be at least 1.';
    }
    return null;
  };

  const next = () => {
    const error = validateStep();
    if (error) {
      toast.warning(error);
      return;
    }
    setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
  };

  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  const create = async () => {
    setCreating(true);
    try {
      const campaign = await api.post<Campaign>('/api/v1/campaigns', {
        name: state.name.trim(),
        objective: state.objective.trim(),
        persona_id: state.persona_id || undefined,
        tone_profile_id: state.tone_profile_id || undefined,
        target_audience: state.target_audience.trim() || undefined,
        cta_type: state.cta_type,
        cta_value: state.cta_value.trim() || undefined,
        daily_send_limit: state.daily_send_limit,
        schedule_config: {
          working_hours_start: state.working_hours_start,
          working_hours_end: state.working_hours_end,
          working_days: state.working_days,
        },
      });

      for (let i = 0; i < state.steps.length; i++) {
        const s = state.steps[i];
        await api.post(`/api/v1/campaigns/${campaign.id}/steps`, {
          step_order: i + 1,
          step_type: s.step_type,
          message_template: s.message_template,
          delay_days: s.delay_days,
        });
      }

      if (state.activate_now) {
        await api.post(`/api/v1/campaigns/${campaign.id}/activate`);
        toast.success(`Campaign "${campaign.name}" created and activated`);
      } else {
        toast.success(`Campaign "${campaign.name}" created`);
      }
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
      setCreating(false);
    }
  };

  const personaName = personas.find((p) => p.id === state.persona_id)?.name;
  const toneName = toneProfiles.find((t) => t.id === state.tone_profile_id)?.name;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">New campaign</h1>
      <p className="text-sm text-slate-500">
        Five quick steps — the AI handles the personalization, you keep the final say.
      </p>

      {/* Stepper */}
      <ol className="mt-5 flex items-center gap-2">
        {WIZARD_STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => i < stepIndex && setStepIndex(i)}
              className={`flex items-center gap-2 ${i < stepIndex ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i < stepIndex
                    ? 'bg-emerald-500 text-white'
                    : i === stepIndex
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span
                className={`hidden text-xs font-medium sm:block ${
                  i === stepIndex ? 'text-slate-900' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
            </button>
            {i < WIZARD_STEPS.length - 1 && (
              <span className="h-px flex-1 bg-slate-200" />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {stepIndex === 0 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Campaign name
              </label>
              <input
                value={state.name}
                onChange={(e) => patch({ name: e.target.value })}
                className={inputCls}
                placeholder="Q3 SaaS founders — demo push"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Objective
              </label>
              <textarea
                value={state.objective}
                onChange={(e) => patch({ objective: e.target.value })}
                rows={3}
                className={inputCls}
                placeholder="Book discovery calls with Series A SaaS founders evaluating outbound tooling."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Target audience <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                value={state.target_audience}
                onChange={(e) => patch({ target_audience: e.target.value })}
                rows={2}
                className={inputCls}
                placeholder="Founders & VPs of Sales at 20–200 person B2B SaaS companies in North America."
              />
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Persona</h3>
              <p className="mb-3 text-xs text-slate-500">
                The buyer persona shapes the angle and psychology of every draft.
              </p>
              {personas.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No personas available — you can continue without one.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {personas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        patch({ persona_id: state.persona_id === p.id ? '' : p.id })
                      }
                      className={`rounded-xl border p-3 text-left ${
                        state.persona_id === p.id
                          ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {p.industry_vertical} · {p.tone_profile}
                      </p>
                      <p className="mt-1 text-xs italic text-slate-400">
                        {p.psychology_principle}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Tone profile
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                Drafts will mimic the writing style extracted from your samples.
              </p>
              {toneProfiles.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No tone profiles yet — create one under Settings → Tone Profiles, or
                  continue with the default voice.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {toneProfiles.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        patch({
                          tone_profile_id: state.tone_profile_id === t.id ? '' : t.id,
                        })
                      }
                      className={`rounded-xl border p-3 text-left ${
                        state.tone_profile_id === t.id
                          ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {t.name}
                        {t.is_default && (
                          <span className="ml-2 text-[10px] font-medium uppercase text-indigo-500">
                            default
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {t.sample_messages.length} sample messages
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {stepIndex === 2 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">
              Sequence steps
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              Templates guide the AI — smart variables like{' '}
              <code className="rounded bg-slate-100 px-1 font-mono">
                {'{{first_name}}'}
              </code>{' '}
              are filled per lead, and each draft is still reviewed by a human.
            </p>
            <SequenceStepEditor
              steps={state.steps}
              onChange={(steps) => patch({ steps })}
            />
          </div>
        )}

        {stepIndex === 3 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Call to action
              </label>
              <div className="flex gap-2">
                {(
                  [
                    ['booking_link', 'Booking link'],
                    ['reply', 'Ask for a reply'],
                    ['custom', 'Custom'],
                  ] as [CtaType, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => patch({ cta_type: value })}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      state.cta_type === value
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {state.cta_type !== 'reply' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {state.cta_type === 'booking_link' ? 'Booking link' : 'Custom CTA'}
                </label>
                <input
                  value={state.cta_value}
                  onChange={(e) => patch({ cta_value: e.target.value })}
                  className={inputCls}
                  placeholder={
                    state.cta_type === 'booking_link'
                      ? 'https://cal.com/you/intro'
                      : 'e.g. Download the benchmark report'
                  }
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Daily send limit
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={state.daily_send_limit}
                onChange={(e) =>
                  patch({ daily_send_limit: Number(e.target.value) })
                }
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-400">
                Keep this conservative to protect account health.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Working hours
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={state.working_hours_start}
                  onChange={(e) => patch({ working_hours_start: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-sm text-slate-500">to</span>
                <input
                  type="time"
                  value={state.working_hours_end}
                  onChange={(e) => patch({ working_hours_end: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Send days
              </label>
              <div className="flex gap-1.5">
                {ALL_DAYS.map((d) => {
                  const active = state.working_days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        patch({
                          working_days: active
                            ? state.working_days.filter((x) => x !== d)
                            : [...state.working_days, d],
                        })
                      }
                      className={`w-12 rounded-lg border py-1.5 text-xs font-medium capitalize ${
                        active
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {stepIndex === 4 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Review & create
            </h3>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs font-medium uppercase text-slate-400">Name</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{state.name}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs font-medium uppercase text-slate-400">
                  Persona / Tone
                </dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {personaName || 'None'} / {toneName || 'Default voice'}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
                <dt className="text-xs font-medium uppercase text-slate-400">
                  Objective
                </dt>
                <dd className="mt-0.5 text-slate-700">{state.objective}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs font-medium uppercase text-slate-400">CTA</dt>
                <dd className="mt-0.5 capitalize text-slate-700">
                  {state.cta_type.replace(/_/g, ' ')}
                  {state.cta_value && ` — ${state.cta_value}`}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs font-medium uppercase text-slate-400">
                  Schedule
                </dt>
                <dd className="mt-0.5 text-slate-700">
                  {state.daily_send_limit}/day · {state.working_hours_start}–
                  {state.working_hours_end} · {state.working_days.join(', ')}
                </dd>
              </div>
            </dl>
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-slate-400">
                Sequence ({state.steps.length} steps)
              </p>
              <ol className="space-y-2">
                {state.steps.map((s, i) => (
                  <li
                    key={s.key}
                    className="rounded-lg border border-slate-200 p-3 text-sm"
                  >
                    <p className="font-medium text-slate-900">
                      {i + 1}. {STEP_TYPE_LABELS[s.step_type]}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {s.delay_days === 0
                          ? 'immediately'
                          : `after ${s.delay_days} day${s.delay_days === 1 ? '' : 's'}`}
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                      {s.message_template}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
              <input
                type="checkbox"
                checked={state.activate_now}
                onChange={(e) => patch({ activate_now: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Activate immediately after creating (drafts still require approval)
            </label>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0 || creating}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Back
          </button>
          {stepIndex < WIZARD_STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {creating && (
                <Spinner size="sm" className="border-white/40 border-t-white" />
              )}
              {state.activate_now ? 'Create & activate' : 'Create campaign'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
