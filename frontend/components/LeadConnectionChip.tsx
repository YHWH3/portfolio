'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Badge from '@/components/Badge';
import Spinner from '@/components/Spinner';
import type { Lead, LeadStatus } from '@/lib/types';

// Statuses that imply a connection request has already gone out.
const CONTACTED_OR_LATER: LeadStatus[] = [
  'contacted',
  'engaged',
  'hot',
  'booked',
];

/**
 * Connection-acceptance chip for the auto-send-then-message flow:
 *  - new / queued                       → "Not contacted" (grey)
 *  - invite sent, not yet accepted      → "Invite sent" (amber) + "Mark accepted"
 *  - connection_accepted_at set         → "Connected ✓" (green)
 */
export default function LeadConnectionChip({
  lead,
  onChange,
}: {
  lead: Lead;
  /** called after a successful "Mark accepted" so the parent can refresh */
  onChange?: () => void;
}) {
  const toast = useToast();
  const [marking, setMarking] = useState(false);

  const accepted = !!lead.connection_accepted_at;
  const inviteSent = !accepted && CONTACTED_OR_LATER.includes(lead.status);

  const markAccepted = async () => {
    setMarking(true);
    try {
      await api.post(`/api/v1/leads/${lead.id}/connection-accepted`);
      toast.success('Marked as connected — the next message will be drafted.');
      onChange?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to mark as connected'
      );
    } finally {
      setMarking(false);
    }
  };

  if (accepted) {
    return <Badge color="green">Connected ✓</Badge>;
  }

  if (inviteSent) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge color="amber">Invite sent</Badge>
        <button
          type="button"
          onClick={markAccepted}
          disabled={marking}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {marking && <Spinner size="sm" />}
          Mark accepted
        </button>
      </span>
    );
  }

  return <Badge color="slate">Not contacted</Badge>;
}
