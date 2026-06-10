'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import StatCard from '@/components/StatCard';
import { StatusBadge } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { PageLoader } from '@/components/Spinner';
import type {
  AnalyticsDashboard,
  HeatmapCell,
  HeatmapResponse,
} from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function TrendChart({
  trend,
}: {
  trend: AnalyticsDashboard['trend'];
}) {
  const width = 720;
  const height = 220;
  const padX = 40;
  const padY = 24;
  if (trend.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-slate-400">
        No trend data yet.
      </p>
    );
  }
  const maxVal = Math.max(
    1,
    ...trend.map((p) => Math.max(p.messages_sent, p.replies_received))
  );
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const x = (i: number) =>
    padX + (trend.length === 1 ? innerW / 2 : (i / (trend.length - 1)) * innerW);
  const y = (v: number) => padY + innerH - (v / maxVal) * innerH;

  const path = (key: 'messages_sent' | 'replies_received') =>
    trend
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`)
      .join(' ');

  const gridLines = 4;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Messages sent vs replies received over time"
      >
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const gy = padY + (innerH / gridLines) * i;
          const val = Math.round(maxVal - (maxVal / gridLines) * i);
          return (
            <g key={i}>
              <line
                x1={padX}
                y1={gy}
                x2={width - padX}
                y2={gy}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text x={padX - 8} y={gy + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                {val}
              </text>
            </g>
          );
        })}
        <path d={path('messages_sent')} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
        <path d={path('replies_received')} fill="none" stroke="#10b981" strokeWidth="2.5" />
        {trend.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.messages_sent)} r="3" fill="#4f46e5">
              <title>{`${p.date}: ${p.messages_sent} sent`}</title>
            </circle>
            <circle cx={x(i)} cy={y(p.replies_received)} r="3" fill="#10b981">
              <title>{`${p.date}: ${p.replies_received} replies`}</title>
            </circle>
          </g>
        ))}
        {trend.map((p, i) =>
          trend.length <= 14 || i % Math.ceil(trend.length / 10) === 0 ? (
            <text
              key={`label-${p.date}`}
              x={x(i)}
              y={height - 6}
              textAnchor="middle"
              fontSize="9"
              fill="#94a3b8"
            >
              {new Date(p.date).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </text>
          ) : null
        )}
      </svg>
      <div className="mt-2 flex justify-center gap-6 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-600" /> Messages sent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Replies received
        </span>
      </div>
    </div>
  );
}

function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const map = new Map<string, HeatmapCell>();
  let max = 0;
  for (const c of cells) {
    map.set(`${c.day_of_week}-${c.hour_of_day}`, c);
    if (c.engagement_score > max) max = c.engagement_score;
  }
  const intensity = (score: number) => (max > 0 ? score / max : 0);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `48px repeat(24, minmax(0, 1fr))` }}
        >
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-center text-[9px] text-slate-400">
              {h % 3 === 0 ? `${h}h` : ''}
            </div>
          ))}
          {DAYS.map((day, d) => (
            <React.Fragment key={day}>
              <div className="flex items-center text-[10px] font-medium text-slate-500">
                {day}
              </div>
              {Array.from({ length: 24 }).map((_, h) => {
                const cell = map.get(`${d}-${h}`);
                const alpha = cell ? 0.12 + intensity(cell.engagement_score) * 0.88 : 0;
                return (
                  <div
                    key={h}
                    className="aspect-square rounded-[3px] bg-slate-100"
                    style={
                      cell
                        ? { backgroundColor: `rgba(79, 70, 229, ${alpha.toFixed(2)})` }
                        : undefined
                    }
                    title={
                      cell
                        ? `${day} ${h}:00 — engagement ${cell.engagement_score.toFixed(
                            2
                          )} (${cell.sample_size} samples)`
                        : `${day} ${h}:00 — no data`
                    }
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-slate-500">
          Less
          {[0.12, 0.35, 0.6, 1].map((a) => (
            <span
              key={a}
              className="h-3 w-3 rounded-[3px]"
              style={{ backgroundColor: `rgba(79, 70, 229, ${a})` }}
            />
          ))}
          More
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const toast = useToast();
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, heat] = await Promise.all([
        api.get<AnalyticsDashboard>('/api/v1/analytics/dashboard'),
        api.get<HeatmapResponse>('/api/v1/analytics/heatmap').catch(() => null),
      ]);
      setDashboard(dash);
      setHeatmap(heat ? heat.cells : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageLoader label="Loading analytics…" />;
  if (!dashboard) {
    return (
      <EmptyState
        icon="📈"
        title="No analytics yet"
        description="Once campaigns start sending, performance data will appear here."
      />
    );
  }

  const t = dashboard.totals;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500">
          How your reviewed outreach is performing across campaigns.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Messages sent" value={t.messages_sent} />
        <StatCard label="Replies" value={t.replies_received} accent="indigo" />
        <StatCard
          label="Reply rate"
          value={`${(t.reply_rate * 100).toFixed(1)}%`}
          accent="green"
        />
        <StatCard label="Meetings booked" value={t.meetings_booked} accent="green" />
        <StatCard label="Drafts generated" value={t.drafts_generated} />
        <StatCard
          label="Drafts edited"
          value={`${t.drafts_edited_pct.toFixed(0)}%`}
          accent="amber"
          sub="before approval"
        />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Sending & reply trend
        </h2>
        <TrendChart trend={dashboard.trend} />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          Engagement heatmap
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          When prospects actually engage — use this to schedule sends.
        </p>
        {heatmap && heatmap.length > 0 ? (
          <Heatmap cells={heatmap} />
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">
            Not enough engagement data for a heatmap yet.
          </p>
        )}
      </div>

      <div className="mt-6 mb-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Campaign breakdown</h2>
        </div>
        {dashboard.campaigns.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">
            No campaigns with activity yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Campaign</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Messages sent</th>
                <th className="px-5 py-3 text-right">Reply rate</th>
                <th className="px-5 py-3 text-right">Meetings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dashboard.campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {c.messages_sent}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {(c.reply_rate * 100).toFixed(1)}%
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {c.meetings_booked}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
