import React from 'react';

export type BadgeColor =
  | 'slate'
  | 'indigo'
  | 'green'
  | 'amber'
  | 'red'
  | 'blue'
  | 'purple'
  | 'orange';

const colorClasses: Record<BadgeColor, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
};

export default function Badge({
  children,
  color = 'slate',
  className = '',
  title,
}: {
  children: React.ReactNode;
  color?: BadgeColor;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colorClasses[color]} ${className}`}
    >
      {children}
    </span>
  );
}

export function statusBadgeColor(status: string): BadgeColor {
  switch (status) {
    case 'running':
    case 'active':
    case 'approved':
    case 'edited_and_approved':
    case 'sent':
    case 'ready':
    case 'indexed':
    case 'booked':
    case 'healthy':
    case 'engaged':
      return 'green';
    case 'paused':
    case 'pending_review':
    case 'processing':
    case 'pending':
    case 'queued':
    case 'warning':
      return 'amber';
    case 'failed':
    case 'suspension':
    case 'hard_limit':
    case 'restricted':
      return 'red';
    case 'hot_lead':
    case 'hot':
      return 'orange';
    case 'draft':
    case 'new':
      return 'blue';
    case 'completed':
      return 'indigo';
    case 'contacted':
      return 'purple';
    case 'archived':
    case 'skipped':
    default:
      return 'slate';
  }
}

export function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={statusBadgeColor(status)}>{formatStatus(status)}</Badge>;
}
