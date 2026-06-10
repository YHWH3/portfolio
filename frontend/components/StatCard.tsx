import React from 'react';

export default function StatCard({
  label,
  value,
  sub,
  accent = 'indigo',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: 'indigo' | 'green' | 'amber' | 'red' | 'slate';
}) {
  const accents = {
    indigo: 'text-indigo-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    slate: 'text-slate-700',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${accents[accent]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
