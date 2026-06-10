import React from 'react';

export default function StatCard({
  label,
  value,
  sub,
  icon,
  accent = 'indigo',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: string;
  accent?: 'indigo' | 'green' | 'amber' | 'red' | 'slate';
}) {
  const accents = {
    indigo: 'text-indigo-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-rose-600',
    slate: 'text-slate-700',
  };
  const iconTints = {
    indigo: 'bg-indigo-50 text-indigo-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base ${iconTints[accent]}`}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className={`mt-1 text-2xl font-semibold ${accents[accent]}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
