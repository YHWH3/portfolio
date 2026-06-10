'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import Spinner, { PageLoader } from '@/components/Spinner';
import Badge from '@/components/Badge';
import Modal from '@/components/Modal';
import SequenceStepEditor, {
  EditableStep,
  StepTemplateEditor,
} from '@/components/SequenceStepEditor';
import type { CampaignDetail, ObjectionHandler } from '@/lib/types';

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

interface ObjectionForm {
  id?: string;
  trigger_phrases: string;
  response_template: string;
  priority: number;
}

export default function CampaignEditPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const toast = useToast();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // basics
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [savingBasics, setSavingBasics] = useState(false);

  // steps
  const [steps, setSteps] = useState<EditableStep[]>([]);
  const [originalStepIds, setOriginalStepIds] = useState<string[]>([]);
  const [savingSteps, setSavingSteps] = useState(false);

  // objections
  const [objections, setObjections] = useState<ObjectionHandler[]>([]);
  const [objectionModal, setObjectionModal] = useState<ObjectionForm | null>(null);
  const [savingObjection, setSavingObjection] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api.get<CampaignDetail>(`/api/v1/campaigns/${id}`);
      setCampaign(c);
      setName(c.name);
      setObjective(c.objective);
      const sorted = [...c.steps].sort((a, b) => a.step_order - b.step_order);
      setSteps(
        sorted.map((s) => ({
          key: s.id,
          id: s.id,
          step_type: s.step_type,
          message_template: s.message_template,
          delay_days: s.delay_days,
        }))
      );
      setOriginalStepIds(sorted.map((s) => s.id));
      setObjections(c.objection_handlers);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveBasics = async () => {
    if (!name.trim() || !objective.trim()) {
      toast.warning('Name and objective are required.');
      return;
    }
    setSavingBasics(true);
    try {
      await api.put(`/api/v1/campaigns/${id}`, {
        name: name.trim(),
        objective: objective.trim(),
      });
      toast.success('Campaign details saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save details');
    } finally {
      setSavingBasics(false);
    }
  };

  const saveSteps = async () => {
    if (steps.some((s) => !s.message_template.trim())) {
      toast.warning('Every step needs a message template.');
      return;
    }
    setSavingSteps(true);
    try {
      const keptIds = new Set(steps.filter((s) => s.id).map((s) => s.id as string));
      // delete removed
      for (const oldId of originalStepIds) {
        if (!keptIds.has(oldId)) {
          await api.delete(`/api/v1/campaigns/${id}/steps/${oldId}`);
        }
      }
      // update existing / create new in order
      const finalIds: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const payload = {
          step_order: i + 1,
          step_type: s.step_type,
          message_template: s.message_template,
          delay_days: s.delay_days,
        };
        if (s.id) {
          await api.put(`/api/v1/campaigns/${id}/steps/${s.id}`, payload);
          finalIds.push(s.id);
        } else {
          const created = await api.post<{ id: string }>(
            `/api/v1/campaigns/${id}/steps`,
            payload
          );
          finalIds.push(created.id);
        }
      }
      // persist ordering
      if (finalIds.length > 0) {
        await api.put(`/api/v1/campaigns/${id}/steps/reorder`, {
          step_ids: finalIds,
        });
      }
      toast.success('Sequence saved');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save sequence');
    } finally {
      setSavingSteps(false);
    }
  };

  const saveObjection = async () => {
    if (!objectionModal) return;
    const phrases = objectionModal.trigger_phrases
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (phrases.length === 0 || !objectionModal.response_template.trim()) {
      toast.warning('Add at least one trigger phrase and a response template.');
      return;
    }
    setSavingObjection(true);
    try {
      const payload = {
        trigger_phrases: phrases,
        response_template: objectionModal.response_template,
        priority: objectionModal.priority,
      };
      if (objectionModal.id) {
        await api.put(
          `/api/v1/campaigns/${id}/objections/${objectionModal.id}`,
          payload
        );
        toast.success('Objection handler updated');
      } else {
        await api.post(`/api/v1/campaigns/${id}/objections`, payload);
        toast.success('Objection handler added');
      }
      setObjectionModal(null);
      load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save objection handler'
      );
    } finally {
      setSavingObjection(false);
    }
  };

  const deleteObjection = async (oid: string) => {
    if (!confirm('Delete this objection handler?')) return;
    try {
      await api.delete(`/api/v1/campaigns/${id}/objections/${oid}`);
      setObjections((prev) => prev.filter((o) => o.id !== oid));
      toast.success('Objection handler deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  if (loading) return <PageLoader label="Loading campaign…" />;
  if (!campaign) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/campaigns/${id}`}
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to campaign
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">
        Edit: {campaign.name}
      </h1>

      {/* Basics */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Details</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Objective
            </label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={saveBasics}
              disabled={savingBasics}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {savingBasics && (
                <Spinner size="sm" className="border-white/40 border-t-white" />
              )}
              Save details
            </button>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Sequence steps</h2>
          <button
            onClick={saveSteps}
            disabled={savingSteps}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {savingSteps && (
              <Spinner size="sm" className="border-white/40 border-t-white" />
            )}
            Save sequence
          </button>
        </div>
        <SequenceStepEditor steps={steps} onChange={setSteps} />
      </section>

      {/* Objection handlers */}
      <section className="mt-8 mb-10">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Objection handlers
            </h2>
            <p className="text-xs text-slate-500">
              When a prospect&apos;s reply matches a trigger phrase, the AI proposes the
              mapped response for your review.
            </p>
          </div>
          <button
            onClick={() =>
              setObjectionModal({
                trigger_phrases: '',
                response_template: '',
                priority: objections.length + 1,
              })
            }
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            + Add handler
          </button>
        </div>
        {objections.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            No objection handlers yet.
          </p>
        ) : (
          <div className="space-y-3">
            {[...objections]
              .sort((a, b) => a.priority - b.priority)
              .map((o) => (
                <div
                  key={o.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color="amber">priority {o.priority}</Badge>
                      {o.trigger_phrases.map((p) => (
                        <Badge key={p} color="red">
                          “{p}”
                        </Badge>
                      ))}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() =>
                          setObjectionModal({
                            id: o.id,
                            trigger_phrases: o.trigger_phrases.join(', '),
                            response_template: o.response_template,
                            priority: o.priority,
                          })
                        }
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteObjection(o.id)}
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                    {o.response_template}
                  </p>
                </div>
              ))}
          </div>
        )}
      </section>

      <Modal
        open={objectionModal !== null}
        onClose={() => setObjectionModal(null)}
        title={objectionModal?.id ? 'Edit objection handler' : 'Add objection handler'}
        wide
        footer={
          <>
            <button
              onClick={() => setObjectionModal(null)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={saveObjection}
              disabled={savingObjection}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {savingObjection && (
                <Spinner size="sm" className="border-white/40 border-t-white" />
              )}
              Save handler
            </button>
          </>
        }
      >
        {objectionModal && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Trigger phrases{' '}
                <span className="font-normal text-slate-400">(comma-separated)</span>
              </label>
              <input
                value={objectionModal.trigger_phrases}
                onChange={(e) =>
                  setObjectionModal({
                    ...objectionModal,
                    trigger_phrases: e.target.value,
                  })
                }
                className={inputCls}
                placeholder="too expensive, no budget, not right now"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Response template
              </label>
              <StepTemplateEditor
                value={objectionModal.response_template}
                onChange={(v) =>
                  setObjectionModal({ ...objectionModal, response_template: v })
                }
                rows={4}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Priority{' '}
                <span className="font-normal text-slate-400">(lower = checked first)</span>
              </label>
              <input
                type="number"
                min={1}
                value={objectionModal.priority}
                onChange={(e) =>
                  setObjectionModal({
                    ...objectionModal,
                    priority: Math.max(1, Number(e.target.value)),
                  })
                }
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
