'use client';

import React, { useRef } from 'react';
import type { StepType } from '@/lib/types';

export interface EditableStep {
  /** local key for React lists; server id when persisted */
  key: string;
  id?: string;
  step_type: StepType;
  message_template: string;
  delay_days: number;
}

export const SMART_VARIABLES = [
  '{{first_name}}',
  '{{last_name}}',
  '{{company}}',
  '{{title}}',
  '{{industry}}',
  '{{personalization_hook}}',
  '{{cta_link}}',
];

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  connection_request: 'Connection request',
  message: 'Message',
  follow_up: 'Follow-up',
};

export function StepTemplateEditor({
  value,
  onChange,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const el = ref.current;
    if (!el) {
      onChange(value + variable);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + variable + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + variable.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder="Hi {{first_name}}, noticed {{company}} just…"
        className="w-full resize-y rounded-lg border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {SMART_VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => insertVariable(v)}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] text-indigo-700 hover:bg-indigo-100"
            title={`Insert ${v}`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SequenceStepEditor({
  steps,
  onChange,
}: {
  steps: EditableStep[];
  onChange: (steps: EditableStep[]) => void;
}) {
  const update = (key: string, patch: Partial<EditableStep>) => {
    onChange(steps.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const remove = (key: string) => {
    onChange(steps.filter((s) => s.key !== key));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addStep = () => {
    onChange([
      ...steps,
      {
        key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        step_type: steps.length === 0 ? 'connection_request' : 'follow_up',
        message_template: '',
        delay_days: steps.length === 0 ? 0 : 3,
      },
    ]);
  };

  return (
    <div className="space-y-4">
      {steps.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No steps yet. Add a connection request or first message to start the
          sequence.
        </p>
      )}
      {steps.map((step, i) => (
        <div
          key={step.key}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              {i + 1}
            </span>
            <select
              value={step.step_type}
              onChange={(e) =>
                update(step.key, { step_type: e.target.value as StepType })
              }
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            >
              {(Object.keys(STEP_TYPE_LABELS) as StepType[]).map((t) => (
                <option key={t} value={t}>
                  {STEP_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Wait
              <input
                type="number"
                min={0}
                max={90}
                value={step.delay_days}
                onChange={(e) =>
                  update(step.key, { delay_days: Math.max(0, Number(e.target.value)) })
                }
                className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              days
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(step.key)}
                className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                title="Remove step"
              >
                ✕
              </button>
            </div>
          </div>
          <StepTemplateEditor
            value={step.message_template}
            onChange={(v) => update(step.key, { message_template: v })}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="w-full rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
      >
        + Add step
      </button>
    </div>
  );
}
