'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import EmptyState from '@/components/EmptyState';
import SequenceStepEditor, {
  EditableStep,
  STEP_TYPE_LABELS,
} from '@/components/SequenceStepEditor';
import type {
  Campaign,
  CtaType,
  GeneratedSequence,
  GeneratedStep,
  KbDocument,
  ParsedBrief,
  Persona,
  ToneProfile,
} from '@/lib/types';

const WIZARD_STEPS = [
  'Describe',
  'Basics',
  'Voice',
  'Sequence',
  'Knowledge',
  'Send & CTA',
  'Review',
];

interface BriefPreset {
  title: string;
  icon: string;
  description: string;
  brief: string;
}

const BRIEF_PRESETS: BriefPreset[] = [
  {
    title: 'Book demo calls',
    icon: '📅',
    description: 'Get prospects onto your calendar',
    brief:
      'Reach VPs of Sales at B2B SaaS companies (50-500 employees) and get them to book a 15-minute demo of our product. Friendly but professional tone. My booking link: https://cal.com/your-name',
  },
  {
    title: 'Promote a webinar',
    icon: '🎙️',
    description: 'Fill seats for an upcoming event',
    brief:
      'Invite marketing leaders at e-commerce brands to our live webinar on cutting customer acquisition costs, happening in two weeks. Helpful and low-pressure tone — lead with the value of the content. Registration link: https://example.com/webinar',
  },
  {
    title: 'Recruit candidates',
    icon: '🧑‍💻',
    description: 'Source talent for an open role',
    brief:
      'Reach senior backend engineers (5+ years, Python or Go) at fintech and infrastructure companies about a senior engineering role on our platform team. Warm, respectful tone — no pressure, just open a conversation about whether they are exploring new roles.',
  },
  {
    title: 'Agency client outreach',
    icon: '🤝',
    description: 'Win retainer clients for your agency',
    brief:
      'Reach founders and heads of growth at DTC brands doing $1-10M a year who are running paid ads themselves. Goal: a 20-minute audit call where we show quick wins our agency could deliver. Confident, direct tone with a concrete observation about their ads. Booking link: https://cal.com/your-agency',
  },
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
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';

function toEditableSteps(steps: GeneratedStep[]): EditableStep[] {
  return [...steps]
    .sort((a, b) => a.step_order - b.step_order)
    .map((s, i) => ({
      key: `ai-${Date.now()}-${i}`,
      step_type: s.step_type,
      message_template: s.message_template,
      delay_days: s.delay_days,
    }));
}

export default function NewCampaignPage() {
  const router = useRouter();
  const toast = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [toneProfiles, setToneProfiles] = useState<ToneProfile[]>([]);
  const [creating, setCreating] = useState(false);

  // Step 0 — describe
  const [brief, setBrief] = useState('');
  const [parsing, setParsing] = useState(false);

  // Sequence AI generation
  const [generating, setGenerating] = useState(false);

  // Knowledge sources
  const [kbDocs, setKbDocs] = useState<KbDocument[]>([]);
  const [kbLoading, setKbLoading] = useState(true);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

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
    api
      .get<KbDocument[]>('/api/v1/kb/documents')
      .then(setKbDocs)
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : 'Failed to load knowledge documents'
        )
      )
      .finally(() => setKbLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildFromBrief = async () => {
    if (!brief.trim()) {
      toast.warning('Describe your campaign first — or pick a preset below.');
      return;
    }
    setParsing(true);
    try {
      const parsed = await api.post<ParsedBrief>('/api/v1/campaigns/parse-brief', {
        brief: brief.trim(),
        num_steps: 3,
      });
      patch({
        name: parsed.name || state.name,
        objective: parsed.objective || state.objective,
        target_audience: parsed.target_audience || '',
        persona_id: parsed.persona_id || '',
        tone_profile_id: parsed.tone_profile_id || '',
        cta_type: parsed.cta_type || 'reply',
        cta_value: parsed.cta_value || '',
        daily_send_limit: parsed.daily_send_limit || state.daily_send_limit,
        steps: toEditableSteps(parsed.steps || []),
      });
      toast.success('Campaign drafted — review each step and tweak anything.');
      setStepIndex(1);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Could not build the campaign from your brief'
      );
    } finally {
      setParsing(false);
    }
  };

  const generateSequence = async () => {
    if (!state.objective.trim()) {
      toast.warning('Fill in the campaign goal first (Basics step).');
      return;
    }
    setGenerating(true);
    try {
      const res = await api.post<GeneratedSequence>(
        '/api/v1/campaigns/generate-sequence',
        {
          objective: state.objective.trim(),
          target_audience: state.target_audience.trim() || undefined,
          persona_id: state.persona_id || undefined,
          tone_profile_id: state.tone_profile_id || undefined,
          num_steps: 3,
        }
      );
      patch({ steps: toEditableSteps(res.steps || []) });
      toast.success('Sequence generated — edit any message before you continue.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to generate the sequence'
      );
    } finally {
      setGenerating(false);
    }
  };

  const validateStep = (): string | null => {
    if (stepIndex === 1) {
      if (!state.name.trim()) return 'Give the campaign a name.';
      if (!state.objective.trim()) return 'Tell us what you want to happen.';
    }
    if (stepIndex === 3) {
      if (state.steps.length === 0) return 'Add at least one message step.';
      if (state.steps.some((s) => !s.message_template.trim()))
        return 'Every step needs a message.';
    }
    if (stepIndex === 5) {
      if (state.cta_type !== 'reply' && !state.cta_value.trim())
        return 'Add your link (or what you want people to do).';
      if (state.daily_send_limit < 1) return 'Daily message cap must be at least 1.';
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

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

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

      for (const documentId of selectedDocIds) {
        try {
          await api.post(`/api/v1/campaigns/${campaign.id}/sources`, {
            document_id: documentId,
          });
        } catch (err) {
          toast.warning(
            err instanceof Error
              ? `Could not attach a knowledge source: ${err.message}`
              : 'Could not attach a knowledge source'
          );
        }
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
  const selectedDocs = kbDocs.filter((d) => selectedDocIds.includes(d.id));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        New campaign
      </h1>
      <p className="text-sm text-slate-500">
        Describe it in your own words — Claude drafts everything, you review and
        approve.
      </p>

      {/* Stepper */}
      <ol className="mt-5 flex items-center gap-2">
        {WIZARD_STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <button
              type="button"
              onClick={() => i < stepIndex && setStepIndex(i)}
              className={`flex items-center gap-2 ${i < stepIndex ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  i < stepIndex
                    ? 'bg-indigo-600 text-white'
                    : i === stepIndex
                      ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span
                className={`hidden text-xs font-medium lg:block ${
                  i === stepIndex ? 'text-slate-900' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
            </button>
            {i < WIZARD_STEPS.length - 1 && (
              <span
                className={`h-0.5 flex-1 rounded-full ${
                  i < stepIndex ? 'bg-indigo-400' : 'bg-slate-200'
                }`}
              />
            )}
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        {stepIndex === 0 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                Describe your campaign
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Tell us who you want to reach and what you want to happen — Claude
                fills in the rest, and you can edit everything before launch.
              </p>
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              disabled={parsing}
              className="w-full resize-y rounded-xl border border-slate-300 p-4 text-base leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:bg-slate-50"
              placeholder="Describe who you want to reach and what you want to happen — in your own words"
            />
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Or start from a preset
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {BRIEF_PRESETS.map((p) => (
                  <button
                    key={p.title}
                    type="button"
                    disabled={parsing}
                    onClick={() => setBrief(p.brief)}
                    className={`rounded-xl border p-3 text-left transition hover:shadow-sm disabled:opacity-50 ${
                      brief === p.brief
                        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200'
                        : 'border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      <span className="mr-1.5">{p.icon}</span>
                      {p.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{p.description}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center gap-3 pt-2">
              <button
                type="button"
                onClick={buildFromBrief}
                disabled={parsing}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
              >
                {parsing ? (
                  <>
                    <Spinner size="sm" className="border-white/40 border-t-white" />
                    Claude is designing your campaign…
                  </>
                ) : (
                  <>✨ Build my campaign</>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStepIndex(1)}
                disabled={parsing}
                className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline disabled:opacity-50"
              >
                Skip — build manually
              </button>
            </div>
          </div>
        )}

        {stepIndex === 1 && (
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
              <p className="mt-1 text-xs text-slate-400">
                Just for you and your team — prospects never see it.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                What do you want to happen?
              </label>
              <textarea
                value={state.objective}
                onChange={(e) => patch({ objective: e.target.value })}
                rows={3}
                className={inputCls}
                placeholder="Book discovery calls with SaaS founders evaluating outbound tooling."
              />
              <p className="mt-1 text-xs text-slate-400">
                One sentence is enough — this guides every message Claude drafts.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Who are you reaching?{' '}
                <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                value={state.target_audience}
                onChange={(e) => patch({ target_audience: e.target.value })}
                rows={2}
                className={inputCls}
                placeholder="Founders & VPs of Sales at 20–200 person B2B SaaS companies in North America."
              />
              <p className="mt-1 text-xs text-slate-400">
                Titles, company size, industry, location — anything that describes
                them.
              </p>
            </div>
          </div>
        )}

        {stepIndex === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-900">Persona</h3>
              <p className="mb-3 text-xs text-slate-500">
                Who you&apos;re talking to — shapes the angle of every message.
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
                      className={`rounded-xl border p-3 text-left transition ${
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
              <h3 className="mb-1 text-sm font-semibold text-slate-900">
                Your voice
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                Messages will sound like you, based on samples you&apos;ve provided.
              </p>
              {toneProfiles.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No tone profiles yet — create one under Settings → Tone Profiles,
                  or continue with the default voice.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {toneProfiles.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        patch({
                          tone_profile_id:
                            state.tone_profile_id === t.id ? '' : t.id,
                        })
                      }
                      className={`rounded-xl border p-3 text-left transition ${
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

        {stepIndex === 3 && (
          <div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">
                  Message sequence
                </h3>
                <p className="text-xs text-slate-500">
                  Templates guide the AI — variables like{' '}
                  <code className="rounded bg-slate-100 px-1 font-mono">
                    {'{{first_name}}'}
                  </code>{' '}
                  are filled per person, and every draft still needs your approval.
                </p>
              </div>
              <button
                type="button"
                onClick={generateSequence}
                disabled={generating}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
              >
                {generating ? (
                  <>
                    <Spinner size="sm" />
                    Writing your sequence…
                  </>
                ) : (
                  <>✨ Generate with AI</>
                )}
              </button>
            </div>
            <SequenceStepEditor
              steps={state.steps}
              onChange={(steps) => patch({ steps })}
            />
          </div>
        )}

        {stepIndex === 4 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">
              Knowledge sources
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              Pick documents Claude can cite while drafting — case studies, pricing,
              battle cards. Optional, but it makes messages sharper.
            </p>
            {kbLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <Spinner size="sm" /> Loading documents…
              </div>
            ) : kbDocs.length === 0 ? (
              <EmptyState
                icon="📚"
                title="No documents yet"
                description="Upload documents in the Knowledge page — then come back and attach them here."
              />
            ) : (
              <>
                <ul className="space-y-2">
                  {kbDocs.map((doc) => {
                    const indexed = doc.vector_status === 'indexed';
                    return (
                      <li key={doc.id}>
                        <label
                          className={`flex items-center gap-3 rounded-xl border p-3 ${
                            indexed
                              ? 'cursor-pointer border-slate-200 hover:border-indigo-300'
                              : 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-70'
                          } ${
                            selectedDocIds.includes(doc.id)
                              ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-200'
                              : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!indexed}
                            checked={selectedDocIds.includes(doc.id)}
                            onChange={() => toggleDoc(doc.id)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                            {doc.filename}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                              indexed
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : doc.vector_status === 'failed'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {indexed
                              ? 'Indexed'
                              : doc.vector_status === 'failed'
                                ? 'Index failed'
                                : 'Indexing…'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-slate-400">
                  Only indexed documents can be attached. Upload more in the
                  Knowledge page.
                </p>
              </>
            )}
          </div>
        )}

        {stepIndex === 5 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                What should people do?
              </label>
              <div className="flex gap-2">
                {(
                  [
                    ['booking_link', 'Book a time'],
                    ['reply', 'Just reply'],
                    ['custom', 'Something else'],
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
              <p className="mt-1 text-xs text-slate-400">
                The ask every message builds toward.
              </p>
            </div>
            {state.cta_type !== 'reply' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {state.cta_type === 'booking_link'
                    ? 'Your booking link'
                    : 'Your ask'}
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
                <p className="mt-1 text-xs text-slate-400">
                  Dropped into messages via the{' '}
                  <code className="rounded bg-slate-100 px-1 font-mono">
                    {'{{cta_link}}'}
                  </code>{' '}
                  variable.
                </p>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Daily message cap
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={state.daily_send_limit}
                onChange={(e) => patch({ daily_send_limit: Number(e.target.value) })}
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <p className="mt-1 text-xs text-slate-400">
                Keep this conservative — it protects your LinkedIn account.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Sending window
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={state.working_hours_start}
                  onChange={(e) => patch({ working_hours_start: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
                <span className="text-sm text-slate-500">to</span>
                <input
                  type="time"
                  value={state.working_hours_end}
                  onChange={(e) => patch({ working_hours_end: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Messages go out only during these hours.
              </p>
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

        {stepIndex === 6 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">One last look</h3>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-700">
              <p>
                <span className="font-semibold text-slate-900">
                  You&apos;ll reach:
                </span>{' '}
                {state.target_audience.trim() ||
                  'the audience described in your goal'}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Goal:</span>{' '}
                {state.objective}
              </p>
              <p>
                <span className="font-semibold text-slate-900">
                  Claude will draft:
                </span>{' '}
                a {state.steps.length}-step sequence in{' '}
                {toneName ? `your "${toneName}" voice` : 'the default voice'}
                {personaName ? `, angled for the "${personaName}" persona` : ''}
                {selectedDocs.length > 0
                  ? `, citing ${selectedDocs.length} knowledge document${
                      selectedDocs.length === 1 ? '' : 's'
                    }`
                  : ''}
                .
              </p>
              <p>
                <span className="font-semibold text-slate-900">The ask:</span>{' '}
                {state.cta_type === 'reply'
                  ? 'a simple reply'
                  : state.cta_type === 'booking_link'
                    ? `book a time (${state.cta_value || 'your link'})`
                    : state.cta_value || 'custom'}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Pace:</span> up to{' '}
                {state.daily_send_limit} messages/day, {state.working_hours_start}–
                {state.working_hours_end} on {state.working_days.join(', ')}.
              </p>
              <p className="border-t border-slate-200 pt-2 font-medium text-indigo-700">
                Nothing sends without your approval — every draft lands in your
                review queue first.
              </p>
            </div>
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
                          : `after ${s.delay_days} day${
                              s.delay_days === 1 ? '' : 's'
                            }`}
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                      {s.message_template}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            {selectedDocs.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-slate-400">
                  Knowledge sources
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedDocs.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                    >
                      📄 {d.filename}
                    </span>
                  ))}
                </div>
              </div>
            )}
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

        {stepIndex > 0 && (
          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={back}
              disabled={creating}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Back
            </button>
            {stepIndex < WIZARD_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={create}
                disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
              >
                {creating && (
                  <Spinner size="sm" className="border-white/40 border-t-white" />
                )}
                {state.activate_now ? 'Create & activate' : 'Create campaign'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
